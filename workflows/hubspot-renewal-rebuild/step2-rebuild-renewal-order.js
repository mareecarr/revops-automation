const axios = require('axios');
const crypto = require('crypto');

exports.main = async (event, callback) => {
  const subscriptionId = event.inputFields.subskribe_subscription_id;
  const existingRenewalOrderId = event.inputFields.renewal_order_id;

  try {
    const SUBSKRIBE_API_KEY = process.env.SubskribeAPIKey;
    const ENTITY_ID = 'ENT-MNJ0N5D';
    const API_BASE = 'https://api.app.subskribe.com';

    // HubSpot kills a custom code action at 20 seconds. Four sequential
    // Subskribe round trips have to fit inside that, so every axios timeout
    // must be well under it: a timeout that fires at 30s or 60s never fires
    // at all, the action is killed mid-flight, and no output fields are
    // emitted — which is indistinguishable downstream from a silent success.
    const READ_TIMEOUT = 5000;
    const WRITE_TIMEOUT = 4000;

    // A ramped order is quoted period by period. More than a handful of
    // periods means something is being read wrongly, not that a six-year
    // ramp was negotiated — refuse rather than post a payload nobody
    // intended.
    const MAX_SEGMENTS = 6;

    // The renewal start comes from the subscription's end, so a rebuild
    // normally lands on exactly the dates the existing order was quoted
    // for. A small shift (a billing-anchor or DST drift) is carried
    // through by moving every period boundary with it; a large one means
    // the existing order was built for a different period entirely and its
    // per-period pricing can't be trusted onto these dates.
    const MAX_START_SHIFT_SECONDS = 45 * 86400;

    if (!subscriptionId) {
      throw new Error('Missing subskribe_subscription_id');
    }
    if (!existingRenewalOrderId) {
      throw new Error('Missing renewal_order_id');
    }

    const authHeaders = {
      'Content-Type': 'application/json',
      'X-API-Key': SUBSKRIBE_API_KEY,
      'X-Entity-Id': ENTITY_ID
    };

    console.log('=== STEP 2 — REBUILD RENEWAL ORDER ===');
    console.log(`Subscription: ${subscriptionId} | Existing renewal order: ${existingRenewalOrderId}`);

    // ==================================================
    // HELPERS
    // ==================================================
    const getCustomFieldsArray = (item) => {
      if (!item) return [];
      if (Array.isArray(item.customFields)) return item.customFields;
      if (item.customFields && typeof item.customFields === 'object') {
        return Object.entries(item.customFields).map(([key, value]) => ({
          ...value,
          id: key
        }));
      }
      return [];
    };

    const normaliseCustomFields = (item) => getCustomFieldsArray(item).map(cf => ({
      id: cf.id,
      type: cf.type,
      name: cf.name,
      label: cf.label,
      value: cf.value,
      selections: cf.selections || [],
      options: cf.options || [],
      required: cf.required || false,
      source: cf.source || 'USER',
      defaultValue: cf.defaultValue || null
    }));

    const normaliseYearsValue = (value) => {
      if (value === null || value === undefined || value === '') return '';
      return String(value)
        .split(';')
        .map(v => String(v).trim())
        .filter(Boolean)
        .sort((a, b) => {
          const numA = Number(a);
          const numB = Number(b);
          const aIsNumber = !Number.isNaN(numA);
          const bIsNumber = !Number.isNaN(numB);
          if (aIsNumber && bIsNumber) return numA - numB;
          return String(a).localeCompare(String(b));
        })
        .join('; ');
    };

    const buildAttributeKey = (attributeReferences = []) => {
      return JSON.stringify(
        [...(attributeReferences || [])]
          .map(ref => ({
            definitionId: ref.attributeDefinitionId || null,
            value: ref.attributeValue || null
          }))
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      );
    };

    const describeAttributes = (attributeReferences) =>
      (attributeReferences || []).map(r => r.attributeValue).filter(Boolean).join('+') || 'none';

    const getYearsCustomField = (item) => {
      return getCustomFieldsArray(item).find(cf => cf.name === 'years');
    };

    const getYearsValue = (item) => normaliseYearsValue(getYearsCustomField(item)?.value);

    const extractYearsData = (item) => {
      if (!item) return null;
      const yearsCf = getYearsCustomField(item);
      if (!yearsCf) return null;
      const normalisedValue = normaliseYearsValue(yearsCf.value);
      if (!normalisedValue) return null;
      return {
        value: normalisedValue,
        selections: Array.from(
          new Set(
            (yearsCf.selections || [])
              .map(v => String(v).trim())
              .filter(Boolean)
          )
        )
      };
    };

    const findOrderYearsFieldId = (items) => {
      for (const item of (items || [])) {
        const yearsCf = getYearsCustomField(item);
        if (yearsCf && yearsCf.id) return yearsCf.id;
      }
      return null;
    };

    const injectYearsField = (item, yearsData, orderYearsFieldId) => {
      if (!yearsData) return item;
      const customFields = [...getCustomFieldsArray(item)];
      const existingYearsIndex = customFields.findIndex(cf => cf.name === 'years');
      const existingYearsCf = existingYearsIndex >= 0 ? customFields[existingYearsIndex] : null;
      const yearsField = {
        id: orderYearsFieldId || (existingYearsCf ? existingYearsCf.id : crypto.randomUUID()),
        type: 'MULTISELECT_PICKLIST',
        name: 'years',
        label: 'Year Groups',
        value: yearsData.value,
        selections: yearsData.selections,
        options: existingYearsCf ? (existingYearsCf.options || []) : [],
        required: existingYearsCf ? existingYearsCf.required : true,
        source: 'USER',
        defaultValue: null
      };
      if (existingYearsIndex >= 0) {
        customFields[existingYearsIndex] = yearsField;
      } else {
        customFields.push(yearsField);
      }
      return { ...item, customFields };
    };

    // Discount percentages survive a catalog re-version; absolute prices
    // do not. Derive a percentage from whatever source we have.
    const deriveDiscounts = (source) => {
      if (!source) return [];
      if (Array.isArray(source.discounts) && source.discounts.length > 0) {
        return source.discounts.map(d => ({
          name: d.name || 'default',
          percent: d.percent,
          discountAmount: null,
          status: null,
          discountedPrice: null
        }));
      }
      const list = source.listUnitPrice;
      const sell = source.sellUnitPrice;
      if (list && sell != null && sell < list) {
        return [{
          name: 'default',
          percent: 1 - (sell / list),
          discountAmount: null,
          status: null,
          discountedPrice: null
        }];
      }
      return [];
    };

    // Copies absolute pricing from an order line verbatim, including any
    // negotiated list price override.
    const copyAbsolutePricing = (lineItem, source) => {
      lineItem.listUnitPrice = source.listUnitPrice;
      lineItem.sellUnitPrice = source.sellUnitPrice;
      lineItem.discounts = source.discounts || [];
      if (source.listPriceOverrideRatio != null) {
        lineItem.listPriceOverrideRatio = source.listPriceOverrideRatio;
      }
      if (source.listUnitPriceBeforeOverride != null) {
        lineItem.listUnitPriceBeforeOverride = source.listUnitPriceBeforeOverride;
      }
      return lineItem;
    };

    // Re-anchors a negotiated absolute price onto the new charge's catalog
    // base, so ratio x base still lands on the agreed price.
    //
    // ONLY valid when the draft line's own attributes are the correct ones.
    // If attributes had to be recovered, the draft priced itself off the
    // wrong rate card row, its base is meaningless, and anchoring to it
    // would misprice the line once the API re-looks-up on the corrected
    // attributes. Those lines take the catalog+discount path instead.
    const repriceSwappedLine = (lineItem, source, draftItem) => {
      const targetList = source.listUnitPrice;
      const targetSell = source.sellUnitPrice;
      const newBase = draftItem.listUnitPriceBeforeOverride != null
        ? draftItem.listUnitPriceBeforeOverride
        : draftItem.listUnitPrice;
      if (targetList == null || !newBase) {
        return copyAbsolutePricing(lineItem, source);
      }
      lineItem.listUnitPrice = targetList;
      lineItem.sellUnitPrice = targetSell;
      lineItem.discounts = deriveDiscounts(source);
      if (Math.abs(targetList - newBase) > 0.0001) {
        lineItem.listPriceOverrideRatio = Math.round((targetList / newBase) * 1000000) / 1000000;
        lineItem.listUnitPriceBeforeOverride = newBase;
      }
      return lineItem;
    };

    const applyUplift = (lineItem, averageIncreaseRatio) => {
      const currentSellPrice = lineItem.sellUnitPrice;
      const currentListPrice = lineItem.listUnitPrice;
      const existingOverrideRatio = lineItem.listPriceOverrideRatio || null;
      const baseListPrice = lineItem.listUnitPriceBeforeOverride || currentListPrice;
      const hasDiscount = lineItem.discounts && lineItem.discounts.length > 0;

      if (hasDiscount) {
        const newSellPrice = currentSellPrice * averageIncreaseRatio;
        if (newSellPrice <= currentListPrice) {
          const newDiscountPercent = 1 - (newSellPrice / currentListPrice);
          return {
            ...lineItem,
            sellUnitPrice: Math.round(newSellPrice * 10000) / 10000,
            discounts: lineItem.discounts.map((d, i) => i === 0 ? { ...d, percent: newDiscountPercent } : d)
          };
        }
        const newOverrideRatio = newSellPrice / baseListPrice;
        return {
          ...lineItem,
          listUnitPrice: Math.round(newSellPrice * 10000) / 10000,
          sellUnitPrice: Math.round(newSellPrice * 10000) / 10000,
          discounts: [],
          listPriceOverrideRatio: Math.round(newOverrideRatio * 1000000) / 1000000,
          listUnitPriceBeforeOverride: baseListPrice
        };
      }

      const newOverrideRatio = existingOverrideRatio
        ? (existingOverrideRatio * averageIncreaseRatio)
        : averageIncreaseRatio;
      const newListPrice = baseListPrice * newOverrideRatio;
      return {
        ...lineItem,
        listUnitPrice: Math.round(newListPrice * 10000) / 10000,
        sellUnitPrice: Math.round(newListPrice * 10000) / 10000,
        discounts: [],
        listPriceOverrideRatio: Math.round(newOverrideRatio * 1000000) / 1000000,
        listUnitPriceBeforeOverride: baseListPrice
      };
    };

    const formatDate = (seconds) => seconds == null
      ? 'none'
      : new Date(seconds * 1000).toISOString().slice(0, 10);

    // ==================================================
    // FETCH DATA
    // ==================================================
    const subResponse = await axios.get(
      `${API_BASE}/subscriptions/${subscriptionId}`,
      { headers: authHeaders, timeout: READ_TIMEOUT }
    );
    const subscription = subResponse.data;
    const subscriptionCharges = subscription.charges || [];
    console.log(`Subscription state=${subscription.state} charges=${subscriptionCharges.length}`);

    const existingOrderResponse = await axios.get(
      `${API_BASE}/orders/${existingRenewalOrderId}`,
      { headers: authHeaders, timeout: READ_TIMEOUT }
    );
    const existingOrder = existingOrderResponse.data;
    const existingLineItems = existingOrder.lineItems || [];
    console.log(`Existing order status=${existingOrder.status} lineItems=${existingLineItems.length} total=${existingOrder.totalAmount}`);
    console.log(`Opportunity: ${existingOrder.sfdcOpportunityId} | ${existingOrder.sfdcOpportunityName}`);

    const newDraftResponse = await axios.get(
      `${API_BASE}/subscriptions/${subscriptionId}/draftRenewal`,
      { headers: authHeaders, timeout: READ_TIMEOUT }
    );
    const newOrder = newDraftResponse.data;
    const draftLineItems = newOrder.lineItems || [];
    console.log(`Fresh draft lineItems=${draftLineItems.length}`);

    // ==================================================
    // SEGMENT PLAN — MULTI-YEAR / RAMPED ORDERS
    //
    // draftRenewal only ever proposes a single period. A multi-year or
    // ramped order quotes the same charge once per period, each period
    // carrying its own negotiated price, quantity and Year Groups, and the
    // whole order carrying a termLength and a rampInterval that spans them.
    //
    // The existing order is the authority on that structure. Its
    // rampInterval gives the period boundaries (and, when absent, the date
    // windows on its own ramp lines do). Each period's line items give that
    // period's commercial terms. The rebuild therefore replicates each
    // draft line once per period and prices each replica from the existing
    // line covering that same period, rather than trying to bridge a
    // single-period draft onto a multi-period order.
    //
    // A plain one-year order collapses to exactly one segment spanning the
    // whole term, which is the single-period behaviour this step has always
    // had.
    // ==================================================
    const deriveSegments = (order, lineItems) => {
      const orderStart = order.startDate;
      const orderEnd = order.endDate;
      if (orderStart == null || orderEnd == null) {
        return [{ index: 0, start: orderStart, end: orderEnd }];
      }
      let starts = (Array.isArray(order.rampInterval) && order.rampInterval.length > 0)
        ? order.rampInterval.map(Number)
        : (lineItems || [])
          .filter(i => i.isRamp && i.effectiveDate != null)
          .map(i => i.effectiveDate);
      starts = [...new Set(starts.filter(v => v != null && !Number.isNaN(v)))]
        .filter(s => s >= orderStart && s < orderEnd)
        .sort((a, b) => a - b);
      if (starts.length === 0 || starts[0] !== orderStart) starts.unshift(orderStart);
      return starts.map((start, index) => ({
        index,
        start,
        end: index + 1 < starts.length ? starts[index + 1] : orderEnd
      }));
    };

    const segments = deriveSegments(existingOrder, existingLineItems);
    const isMultiSegment = segments.length > 1;

    if (segments.length > MAX_SEGMENTS) {
      throw new Error(`Existing order ${existingRenewalOrderId} resolves to ${segments.length} ramp periods (max ${MAX_SEGMENTS}) — refusing to rebuild; this one needs to be built manually.`);
    }

    // The whole per-period approach rests on the draft being a single
    // period that can be stamped out once per segment. If Subskribe ever
    // hands back a draft that is itself ramped, replicating it would double
    // every line — stop instead of quietly quoting twice the term.
    const draftWindows = [...new Set(draftLineItems.map(i => `${i.effectiveDate}|${i.endDate}`))];
    if (draftWindows.length > 1) {
      throw new Error(`Fresh draft for ${subscriptionId} spans ${draftWindows.length} distinct date windows (${draftWindows.slice(0, 3).join(' , ')}) — this step expects a single-period draft to replicate across the existing order's ramp periods; refusing to rebuild.`);
    }

    // Every built period is placed relative to the draft's start, so a
    // renewal that begins a little earlier or later than the existing order
    // assumed still gets periods of the negotiated length.
    const dateShift = (newOrder.startDate != null && existingOrder.startDate != null)
      ? (newOrder.startDate - existingOrder.startDate)
      : 0;
    if (Math.abs(dateShift) > MAX_START_SHIFT_SECONDS) {
      throw new Error(`Fresh draft starts ${formatDate(newOrder.startDate)} but existing order ${existingRenewalOrderId} starts ${formatDate(existingOrder.startDate)} (${Math.round(dateShift / 86400)}d apart) — refusing to reuse its per-period pricing on a different term.`);
    }

    const targetWindows = segments.map(seg => ({
      start: seg.start + dateShift,
      end: seg.end + dateShift
    }));
    const orderStartDate = isMultiSegment ? targetWindows[0].start : newOrder.startDate;
    const orderEndDate = isMultiSegment ? targetWindows[targetWindows.length - 1].end : newOrder.endDate;
    const fullSpanWindow = { start: orderStartDate, end: orderEndDate };

    if (isMultiSegment) {
      console.log(`Multi-period order: ${segments.length} periods, term ${formatDate(orderStartDate)} -> ${formatDate(orderEndDate)}${dateShift ? ` (shifted ${Math.round(dateShift / 86400)}d from existing order)` : ''}`);
      targetWindows.forEach((w, k) => console.log(`  period ${k + 1}: ${formatDate(w.start)} -> ${formatDate(w.end)}`));
    }

    // Existing lines are pooled by the period they cover, so each replica
    // is priced from its own period rather than from whichever period the
    // matcher happened to reach first. For a single-period order the pools
    // collapse back to "every existing line".
    const inWindow = (item, window) =>
      item.effectiveDate === window.start && item.endDate === window.end;
    const segmentPools = isMultiSegment
      ? segments.map(seg => existingLineItems.filter(i => inWindow(i, seg)))
      : [existingLineItems];
    const fullSpanPool = isMultiSegment
      ? existingLineItems.filter(i => inWindow(i, { start: existingOrder.startDate, end: existingOrder.endDate }))
      : existingLineItems;

    if (isMultiSegment) {
      const pooled = new Set();
      segmentPools.forEach(pool => pool.forEach(i => pooled.add(i)));
      fullSpanPool.forEach(i => pooled.add(i));
      const strays = existingLineItems.filter(i => !pooled.has(i));
      const billableStrays = strays.filter(i => i.quantity > 0);
      if (billableStrays.length > 0) {
        throw new Error(`${billableStrays.length} billable line(s) on ${existingRenewalOrderId} fall outside every ramp period (${billableStrays.map(i => `${i.chargeId} ${formatDate(i.effectiveDate)}->${formatDate(i.endDate)}`).slice(0, 3).join(', ')}) — refusing to rebuild and drop their value.`);
      }
      if (strays.length > 0) {
        console.log(`${strays.length} zero-quantity existing line(s) outside every ramp period — ignored`);
      }
      console.log(`Existing lines pooled: ${segmentPools.map((p, k) => `p${k + 1}=${p.length}`).join(' ')} fullSpan=${fullSpanPool.length}`);
    }

    // ==================================================
    // IDENTIFY THE CHARGES THAT ACTUALLY RENEW
    //
    // A charge only carries into a renewal if it is still live at the end
    // of the subscription. Ramp periods and mid-term amendments both leave
    // behind charges that are expired periods rather than missing line
    // items; counting them inflates the expected quantity and creates
    // false ambiguity in the matching pool.
    // ==================================================
    const subscriptionEndDate = subscription.endDate || null;
    const reachesSubscriptionEnd = (charge) => {
      if (!subscriptionEndDate) return true;
      if (charge.endDate == null) return true;
      return charge.endDate >= subscriptionEndDate;
    };

    const liveCharges = subscriptionCharges.filter(reachesSubscriptionEnd);
    const expiredCharges = subscriptionCharges.filter(c => !reachesSubscriptionEnd(c));

    // Secondary tiebreak: if a group still has more than one live charge,
    // keep the one that starts last.
    const liveByGroup = new Map();
    for (const charge of liveCharges) {
      const key = charge.groupId || charge.id;
      const current = liveByGroup.get(key);
      if (!current || (charge.startDate || 0) > (current.startDate || 0)) {
        liveByGroup.set(key, charge);
      }
    }
    const renewalChargeIds = new Set([...liveByGroup.values()].map(c => c.id));
    const renewalCharges = subscriptionCharges.filter(c => renewalChargeIds.has(c.id));

    if (renewalCharges.length !== subscriptionCharges.length) {
      const expiredBillable = expiredCharges.filter(c => c.quantity > 0);
      const shownExpired = expiredBillable.slice(0, 4)
        .map(c => `${c.chargeId}(qty ${c.quantity})`).join(', ');
      console.log(`Renewal charges: ${renewalCharges.length} of ${subscriptionCharges.length} (${expiredCharges.length} expired before subscription end${expiredBillable.length ? `, incl. ${shownExpired}${expiredBillable.length > 4 ? ` (+${expiredBillable.length - 4})` : ''}` : ''})`);
    }

    // ==================================================
    // SUBSCRIPTION CHARGE RESOLVER
    //
    // On a plan re-version, draftRenewal emits plan-swap lines with new
    // catalog chargeIds, no subscriptionChargeId, and default attribute
    // values. Resolution runs in two passes: every strong signal is
    // exhausted across all items first, and only then does a weak
    // unique-quantity match claim what remains. All tiers except the
    // explicit UUID link are restricted to charges that actually renew.
    // ==================================================
    const subChargeById = new Map();
    for (const charge of subscriptionCharges) {
      subChargeById.set(charge.id, charge);
    }

    const chargeSignature = (item) => [
      buildAttributeKey(item.attributeReferences),
      item.quantity == null ? '' : item.quantity,
      getYearsValue(item),
      item.listUnitPrice == null ? '' : item.listUnitPrice,
      item.sellUnitPrice == null ? '' : item.sellUnitPrice
    ].join('|');
    // Commercial identity of a subscription charge, independent of which
    // physical charge id it is — mirrors commercialSignature() in
    // matchExistingItems, one level earlier in the pipeline.
    const chargeCommercialSignature = (charge) => [
      buildAttributeKey(charge.attributeReferences),
      charge.listUnitPrice == null ? '' : charge.listUnitPrice,
      charge.sellUnitPrice == null ? '' : charge.sellUnitPrice,
      getYearsValue(charge)
    ].join('|');
    const resolveStrong = (item, used) => {
      const subChargeId = item.subscriptionChargeId;
      if (subChargeId && subChargeById.has(subChargeId) && !used.has(subChargeId)) {
        return { charge: subChargeById.get(subChargeId), via: 'uuid' };
      }

      const byChargeId = renewalCharges
        .filter(c => c.chargeId === item.chargeId && !used.has(c.id));
      if (byChargeId.length === 1) {
        return { charge: byChargeId[0], via: 'chargeId' };
      }

      const signature = chargeSignature(item);
      const bySignature = renewalCharges
        .filter(c => !used.has(c.id) && chargeSignature(c) === signature);
      if (bySignature.length > 0) {
        return { charge: bySignature[0], via: bySignature.length === 1 ? 'signature' : 'signature/dup' };
      }

      const itemAttributes = buildAttributeKey(item.attributeReferences);
      const byAttributes = renewalCharges.filter(c => !used.has(c.id)
        && buildAttributeKey(c.attributeReferences) === itemAttributes
        && (c.quantity || 0) === (item.quantity || 0));
      if (byAttributes.length > 0
        && new Set(byAttributes.map(chargeSignature)).size === 1) {
        return { charge: byAttributes[0], via: 'attrs+qty' };
      }

      return { charge: null, via: 'none' };
    };

    const resolveAll = (items) => {
      const used = new Set();
      const results = (items || []).map(item => ({ item, charge: null, via: 'none' }));

      // Pass A — strong signals only.
      for (const result of results) {
        const { charge, via } = resolveStrong(result.item, used);
        if (charge) {
          used.add(charge.id);
          result.charge = charge;
          result.via = via;
        }
      }

      // Pass B — last resort: a non-zero quantity unique among what is left.
      for (const result of results) {
        if (result.charge) continue;
        const quantity = result.item.quantity;
        if (!quantity) continue;
        const candidates = renewalCharges
          .filter(c => !used.has(c.id) && c.quantity === quantity);
        if (candidates.length === 1) {
          used.add(candidates[0].id);
          result.charge = candidates[0];
          result.via = 'qty-only';
        }
      }
      // Pass C — cohort: several draft lines share a quantity with several
      // remaining charges at that same quantity. Which specific charge feeds
      // which line can't change the built order as long as every remaining
      // candidate at that quantity is commercially identical (same
      // attributes, same price, same Year Groups) — so pair them
      // positionally. If they differ in any of that, leave them unresolved
      // rather than guess.
      const unresolvedByQty = new Map();
      results.forEach(result => {
        if (result.charge) return;
        const q = result.item.quantity;
        if (!q) return;
        if (!unresolvedByQty.has(q)) unresolvedByQty.set(q, []);
        unresolvedByQty.get(q).push(result);
      });
      for (const [quantity, group] of unresolvedByQty) {
        const candidates = renewalCharges.filter(c => !used.has(c.id) && c.quantity === quantity);
        if (candidates.length === 0) continue;
        const signatures = new Set(candidates.map(chargeCommercialSignature));
        if (signatures.size !== 1) continue;
        group.forEach((result, position) => {
          if (position >= candidates.length) return;
          used.add(candidates[position].id);
          result.charge = candidates[position];
          result.via = 'cohort';
        });
      }
      return { results, used };
    };

    // ==================================================
    // EXISTING ORDER ITEM MATCHER (pricing + Year Groups source)
    //
    // A plan re-version does not just add and remove lines: it renames the
    // charges underneath them. The same commercial line then appears in the
    // existing order under one chargeId and in the fresh draft under
    // another, with defaulted attributes and no subscriptionChargeId.
    //
    // Matching runs in passes so every stronger match is claimed before a
    // weaker one can steal it:
    //   1. same subscription charge, or same catalog chargeId
    //   2. cross-charge on an exact attribute match, unambiguous
    //   3. cohort — a whole set of interchangeable lines swapped at once
    //
    // The candidate pool is passed in rather than closed over: on a ramped
    // order the same draft line is matched once per period, each time
    // against only the existing lines covering that period.
    // ==================================================
    const matchExistingItems = (resolutions, pool) => {
      const used = new Set();
      const matches = resolutions.map(() => ({ item: null, via: 'none' }));
      const claim = (index, item, via) => {
        used.add(item);
        matches[index] = { item, via };
      };

      const targetQuantityFor = (draftItem, charge) =>
        (charge && charge.quantity != null) ? charge.quantity : (draftItem.quantity || 0);

      // Two existing lines are interchangeable only if everything that
      // determines their price and their Year Groups is identical.
      const commercialSignature = (item) => [
        buildAttributeKey(item.attributeReferences),
        item.listUnitPrice == null ? '' : item.listUnitPrice,
        item.sellUnitPrice == null ? '' : item.sellUnitPrice,
        item.listPriceOverrideRatio == null ? '' : item.listPriceOverrideRatio,
        item.listUnitPriceBeforeOverride == null ? '' : item.listUnitPriceBeforeOverride,
        getYearsValue(item)
      ].join('|');

      // Pass 1 — same subscription charge, or same catalog chargeId.
      resolutions.forEach(({ item: draftItem, charge }, index) => {
        if (charge) {
          const byUuid = pool.find(i =>
            i.subscriptionChargeId === charge.id && !used.has(i));
          if (byUuid) {
            claim(index, byUuid, 'uuid');
            return;
          }
        }
        const candidates = pool.filter(i =>
          i.chargeId === draftItem.chargeId && !used.has(i));
        if (candidates.length === 0) return;

        const targetQuantity = targetQuantityFor(draftItem, charge);
        const byQuantity = candidates.filter(i => i.quantity === targetQuantity);
        if (byQuantity.length > 0) {
          claim(index, byQuantity[0], 'chargeId+qty');
          return;
        }
        if (candidates.length === 1) {
          claim(index, candidates[0], 'chargeId');
        }
      });

      // Pass 2 — cross-charge. Only billable lines, only on an exact
      // attribute match, and only when the choice is unambiguous.
      resolutions.forEach(({ item: draftItem, charge }, index) => {
        if (matches[index].item) return;
        const quantity = targetQuantityFor(draftItem, charge);
        if (!quantity) return;

        const attributeKey = buildAttributeKey(
          (charge && charge.attributeReferences && charge.attributeReferences.length
            ? charge.attributeReferences
            : draftItem.attributeReferences)
        );
        const candidates = pool.filter(i => !used.has(i)
          && i.quantity > 0
          && buildAttributeKey(i.attributeReferences) === attributeKey);
        if (candidates.length === 0) return;

        const exact = candidates.filter(i => i.quantity === quantity);
        if (exact.length === 1) {
          claim(index, exact[0], 'swapped');
          return;
        }
        if (exact.length === 0 && candidates.length === 1) {
          claim(index, candidates[0], 'swapped/qty-changed');
        }
      });

      // Pass 3 — cohort swap.
      //
      // When a plan is re-versioned wholesale, several charges are renamed
      // at once and the draft cannot be matched on chargeId (renamed) or on
      // attributes (defaulted to the wrong tier). Pass 2 also cannot break
      // the tie, because the replaced lines are identical to each other.
      //
      // That identity is what makes the pairing safe: if every remaining
      // candidate at this quantity carries the same attributes, prices,
      // override and Year Groups, then which one is paired with which draft
      // line cannot change the resulting order. Pair them positionally.
      //
      // If the candidates differ in ANY of those, the choice would matter,
      // so nothing is claimed and the Year Groups guard rail stops the run.
      const cohortNotes = [];
      const unmatchedByQuantity = new Map();
      resolutions.forEach(({ item: draftItem, charge }, index) => {
        if (matches[index].item) return;
        const quantity = targetQuantityFor(draftItem, charge);
        if (!quantity) return;
        if (!unmatchedByQuantity.has(quantity)) unmatchedByQuantity.set(quantity, []);
        unmatchedByQuantity.get(quantity).push(index);
      });

      for (const [quantity, indexes] of unmatchedByQuantity) {
        const candidates = pool.filter(i => !used.has(i) && i.quantity === quantity);
        if (candidates.length === 0) continue;

        const signatures = new Set(candidates.map(commercialSignature));
        if (signatures.size !== 1) {
          cohortNotes.push(`qty ${quantity}: ${candidates.length} candidates differ — not paired`);
          continue;
        }

        indexes.forEach((index, position) => {
          if (position < candidates.length) {
            claim(index, candidates[position], 'cohort');
          } else {
            // More new charges than old ones at this quantity. The cohort is
            // homogeneous, so the surviving line is still the right pricing
            // and Year Groups source for the extras.
            matches[index] = { item: candidates[candidates.length - 1], via: 'cohort/extra' };
          }
        });
        cohortNotes.push(`qty ${quantity}: ${indexes.length} draft line(s) paired to ${candidates.length} existing line(s)`);
      }

      return { matches, cohortNotes };
    };

    const orderYearsFieldId = findOrderYearsFieldId(draftLineItems)
      || findOrderYearsFieldId(existingLineItems);
    console.log(`Order years field ID: ${orderYearsFieldId || 'NOT FOUND'}`);

    // ==================================================
    // AVERAGE PRICE INCREASE
    //
    // Only meaningful for lines staying on the same plan version. A
    // plan-swap line's price difference is catalog drift between plan
    // versions, not a negotiated uplift.
    //
    // On a ramped order only the FIRST period is compared to the
    // subscription: later periods are already uplifted off period one, and
    // folding them in would inflate the ratio by the ramp itself.
    // ==================================================
    const { results: existingResolutions } = resolveAll(segmentPools[0]);
    const increaseRatios = [];
    for (const { item, charge } of existingResolutions) {
      if (!item.quantity || item.quantity === 0) continue;
      if (item.replacedPlanId) continue;
      if (!charge || !charge.sellUnitPrice) continue;
      increaseRatios.push(item.sellUnitPrice / charge.sellUnitPrice);
    }
    const averageIncreaseRatio = increaseRatios.length > 0
      ? (increaseRatios.reduce((sum, r) => sum + r, 0) / increaseRatios.length)
      : 1.0;
    const hasAnyIncrease = averageIncreaseRatio > 1.0;
    console.log(`Average increase ratio: ${averageIncreaseRatio.toFixed(6)} (from ${increaseRatios.length} same-plan lines)`);

    // ==================================================
    // PERIOD-OVER-PERIOD UPLIFT
    //
    // The ramp the customer actually agreed to, read off the existing
    // order: for each later period, the average of (that period's price /
    // period one's price) over the charges that appear in both. Used only
    // for lines the existing order has no counterpart for in a given
    // period, so a brand new line still ramps in step with the rest of the
    // order instead of sitting flat.
    // ==================================================
    const priceKey = (item) => `${item.chargeId}|${buildAttributeKey(item.attributeReferences)}`;
    const segmentUpliftRatios = segments.map(() => 1);
    if (isMultiSegment) {
      const baseByKey = new Map();
      for (const item of segmentPools[0]) {
        if (!item.sellUnitPrice) continue;
        baseByKey.set(priceKey(item), item.sellUnitPrice);
      }
      for (let k = 1; k < segments.length; k++) {
        const observed = [];
        for (const item of segmentPools[k]) {
          const base = baseByKey.get(priceKey(item));
          if (base && item.sellUnitPrice) observed.push(item.sellUnitPrice / base);
        }
        segmentUpliftRatios[k] = observed.length
          ? observed.reduce((sum, r) => sum + r, 0) / observed.length
          : 1;
      }
      console.log(`Period uplift vs period 1: ${segmentUpliftRatios.map((r, k) => `p${k + 1}=${r.toFixed(4)}`).join(' ')}`);
    }

    // ==================================================
    // BUILD LINE ITEMS
    // ==================================================
    console.log('=== BUILDING LINE ITEMS ===');

    const { results: draftResolutions, used: usedSubCharges } = resolveAll(draftLineItems);

    const segmentMatchSets = segmentPools.map(pool => matchExistingItems(draftResolutions, pool));
    const fullSpanMatchSet = isMultiSegment
      ? matchExistingItems(draftResolutions, fullSpanPool)
      : segmentMatchSets[0];

    // A line is ramped if the existing order quoted it period by period.
    // One that only appears once, spanning the whole term, stays a single
    // full-span line — that is how the zero-quantity catalog lines are
    // carried today and splitting them would just pad the order. A line the
    // existing order has no counterpart for at all is ramped only if it is
    // billable, so it participates in the agreed uplift.
    const rampedLine = draftResolutions.map((resolution, index) => {
      if (!isMultiSegment) return false;
      if (segmentMatchSets.some(set => set.matches[index].item)) return true;
      if (fullSpanMatchSet.matches[index].item) return false;
      const { item, charge } = resolution;
      const quantity = charge && charge.quantity != null ? charge.quantity : (item.quantity || 0);
      return quantity > 0;
    });

    // The match that establishes the line's identity: period one for a
    // ramped line (falling back to whichever period does have it), the
    // full-span pool otherwise.
    const primaryMatchIndex = draftResolutions.map((_, index) => {
      if (!rampedLine[index]) return null;
      for (let k = 0; k < segmentMatchSets.length; k++) {
        if (segmentMatchSets[k].matches[index].item) return k;
      }
      return null;
    });
    const primaryMatch = draftResolutions.map((_, index) => {
      const k = primaryMatchIndex[index];
      if (k != null) return segmentMatchSets[k].matches[index];
      return rampedLine[index] ? { item: null, via: 'none' } : fullSpanMatchSet.matches[index];
    });

    // A cross-charge match hands back the subscription charge the draft
    // could not find: the existing order line records the UUID even when
    // the swap draft omits it. That charge is the authority on quantity and
    // attributes, and adopting it here also keeps the orphaned-charge
    // accounting honest.
    draftResolutions.forEach((resolution, index) => {
      if (resolution.charge) return;
      const existingItem = primaryMatch[index].item;
      const subChargeId = existingItem && existingItem.subscriptionChargeId;
      if (!subChargeId) return;
      const charge = subChargeById.get(subChargeId);
      if (!charge || usedSubCharges.has(charge.id)) return;
      usedSubCharges.add(charge.id);
      resolution.charge = charge;
      resolution.via = 'via-order';
    });

    const mergedLineItems = [];
    const unresolvedCharges = [];
    const attributesRecovered = [];
    const swappedLines = [];
    const zeroQuantityLines = [];

    // Builds one line for one draft item in one period. `segmentIndex` is
    // null for a line that spans the whole term.
    const buildLineItem = (resolution, index, segmentIndex) => {
      const { item: draftItem, charge } = resolution;
      const isRamped = segmentIndex != null;
      const window = isRamped
        ? targetWindows[segmentIndex]
        : (isMultiSegment
          ? fullSpanWindow
          : { start: draftItem.effectiveDate, end: draftItem.endDate });

      // Price and Year Groups come from the existing line covering THIS
      // period. When that period has no counterpart, period one's line is
      // used and carried forward by the agreed period-over-period uplift.
      const ownMatch = isRamped ? segmentMatchSets[segmentIndex].matches[index] : primaryMatch[index];
      const fallbackMatch = primaryMatch[index];
      const existingMatch = ownMatch.item ? ownMatch : fallbackMatch;
      const existingItem = existingMatch.item;
      const usedFallback = isRamped && !ownMatch.item && !!existingItem;
      const fallbackRatio = usedFallback
        ? (segmentUpliftRatios[segmentIndex] / (segmentUpliftRatios[primaryMatchIndex[index]] || 1))
        : 1;

      const isCrossChargeMatch = existingMatch.via.indexOf('swapped') === 0
        || existingMatch.via.indexOf('cohort') === 0;
      const isPlanSwap = !!draftItem.replacedPlanId || isCrossChargeMatch;

      // Recorded once per draft line, not once per period, so the summary
      // counts commercial lines rather than ramp replicas.
      const isFirstPeriod = segmentIndex == null || segmentIndex === 0;
      if (isCrossChargeMatch && isFirstPeriod) {
        swappedLines.push(`${existingItem.chargeId}->${draftItem.chargeId}`);
      }

      // On a ramped order the existing line is the authority on Year
      // Groups: the periods genuinely differ (a cohort ages out of a
      // subject between years) and only the order records that. The
      // subscription charge only describes the term being renewed FROM.
      const yearsData = isMultiSegment
        ? (extractYearsData(existingItem)
          || extractYearsData(fallbackMatch.item)
          || extractYearsData(charge)
          || extractYearsData(draftItem))
        : (extractYearsData(charge)
          || extractYearsData(existingItem)
          || extractYearsData(draftItem));

      // Quantity can be renegotiated per period, so a ramped line takes it
      // from that period's own existing line before falling back to the
      // subscription charge.
      const quantity = (isRamped && existingItem && existingItem.quantity != null)
        ? existingItem.quantity
        : (charge && charge.quantity != null
          ? charge.quantity
          : (draftItem.quantity || 0));

      // The draft defaults the tier attribute (e.g. it emits "Independent"
      // where the customer is on "Gov > 930"), and the attribute drives the
      // catalog price — so the draft is the LAST resort here. Charges that
      // are not attribute-priced have none at all, and the field must then
      // be OMITTED rather than sent empty: Subskribe rejects price
      // attribution on any charge model other than rate card lookup.
      const attributeReferences =
        (existingItem?.attributeReferences?.length && existingItem.attributeReferences)
        || (charge?.attributeReferences?.length && charge.attributeReferences)
        || (draftItem.attributeReferences?.length && draftItem.attributeReferences)
        || null;

      const attributesWereRecovered =
        buildAttributeKey(attributeReferences) !== buildAttributeKey(draftItem.attributeReferences);
      if (attributesWereRecovered && isFirstPeriod) {
        attributesRecovered.push(`${draftItem.chargeId}:${describeAttributes(draftItem.attributeReferences)}->${describeAttributes(attributeReferences)}`);
      }

      let lineItem = {
        id: crypto.randomUUID(),
        isDryRunItem: false,
        action: draftItem.action || 'RENEWAL',
        planId: draftItem.planId || existingItem?.planId || '',
        chargeId: draftItem.chargeId,
        quantity: quantity,
        effectiveDate: window.start,
        endDate: window.end,
        customFields: normaliseCustomFields(draftItem)
      };

      if (attributeReferences) {
        lineItem.attributeReferences = attributeReferences;
      }

      // Every replica of a ramped line is a ramp segment by definition.
      // Otherwise the draft is the authority on ramp structure: a
      // subscription charge can be a ramp segment while the renewal line
      // superseding it is not.
      if (isRamped) {
        lineItem.isRamp = true;
      } else if (isMultiSegment) {
        if (existingItem && existingItem.isRamp) lineItem.isRamp = true;
      } else if (draftItem.isRamp) {
        lineItem.isRamp = true;
      }

      // Only ever echo back the UUID the draft itself supplied, and only on
      // the first period: a subscription charge continues into one renewal
      // line, and the later ramp periods are continuations of that line
      // rather than of the charge. A swap line must not be sent the old
      // plan version's subscription charge at all.
      if (draftItem.subscriptionChargeId && (segmentIndex == null || segmentIndex === 0)) {
        lineItem.subscriptionChargeId = draftItem.subscriptionChargeId;
      }
      if (draftItem.replacedPlanId) {
        lineItem.replacedPlanId = draftItem.replacedPlanId;
      }

      let pricingMode;
      if (!isPlanSwap) {
        const priceSource = existingItem || draftItem;
        lineItem = copyAbsolutePricing(lineItem, priceSource);
        pricingMode = existingItem
          ? `existing sell=${lineItem.sellUnitPrice}`
          : `draft sell=${lineItem.sellUnitPrice}`;
        if (!existingItem && lineItem.quantity > 0 && hasAnyIncrease) {
          lineItem = applyUplift(lineItem, averageIncreaseRatio);
          pricingMode = `draft+uplift sell=${lineItem.sellUnitPrice}`;
        }
      } else if (existingItem && existingItem.listPriceOverrideRatio != null) {
        // A list price override on the existing renewal line is a
        // negotiated price, not catalog drift, and must survive the swap.
        // Dropping it and re-applying only the discount percentage prices
        // the line off the full catalog rate instead of the agreed one.
        lineItem = copyAbsolutePricing(lineItem, existingItem);
        pricingMode = `swap+override sell=${lineItem.sellUnitPrice}`;
      } else if (isCrossChargeMatch && existingItem && !attributesWereRecovered) {
        // The draft priced itself on the right rate card row, so its base is
        // trustworthy and the negotiated absolute price can be re-anchored.
        lineItem = repriceSwappedLine(lineItem, existingItem, draftItem);
        pricingMode = `swapped sell=${lineItem.sellUnitPrice}${lineItem.listPriceOverrideRatio != null ? ` ratio=${lineItem.listPriceOverrideRatio}` : ''}`;
      } else {
        // No negotiated override, or the draft's own pricing is unusable
        // because its attributes were wrong. Let the API price from the new
        // catalog on the corrected attributes and carry over only the
        // version-independent discount percentage. list/sell here are
        // placeholders that the API recomputes.
        lineItem.listUnitPrice = draftItem.listUnitPrice;
        lineItem.sellUnitPrice = draftItem.sellUnitPrice;
        const existingDiscounts = deriveDiscounts(existingItem);
        lineItem.discounts = existingDiscounts.length > 0
          ? existingDiscounts
          : deriveDiscounts(charge);
        pricingMode = `catalog sell=API disc=${lineItem.discounts.length ? (Math.round(lineItem.discounts[0].percent * 10000) / 100) + '%' : '0'}`;
      }

      // This period had no line of its own, so it inherited another
      // period's price. Carry it forward by the ramp the rest of the order
      // agreed to, rather than repeating an earlier year's rate.
      if (usedFallback && Math.abs(fallbackRatio - 1) > 0.000001 && lineItem.quantity > 0) {
        lineItem = applyUplift(lineItem, fallbackRatio);
        pricingMode = `${pricingMode} +ramp x${fallbackRatio.toFixed(4)}`;
      }

      // A brand new billable line with no counterpart anywhere still has to
      // ramp with the order, or period two undercuts period one.
      if (isRamped && !existingItem && lineItem.quantity > 0
        && Math.abs(segmentUpliftRatios[segmentIndex] - 1) > 0.000001) {
        lineItem = applyUplift(lineItem, segmentUpliftRatios[segmentIndex]);
        pricingMode = `${pricingMode} +ramp x${segmentUpliftRatios[segmentIndex].toFixed(4)}`;
      }

      lineItem = injectYearsField(lineItem, yearsData, orderYearsFieldId);
      lineItem.segmentIndex = segmentIndex;

      return { lineItem, existingMatch, pricingMode };
    };

    // Period one and the full-span lines are logged in full; later periods
    // are summarised, because the log has a 4KB ceiling and a three-year
    // order would otherwise blow through it.
    const segmentSummaries = segments.map(() => ({ lines: 0, quantity: 0, value: 0 }));
    draftResolutions.forEach((resolution, index) => {
      const { item: draftItem, via } = resolution;
      if (!resolution.charge) unresolvedCharges.push(draftItem.chargeId);

      const plan = rampedLine[index]
        ? segments.map((_, k) => k)
        : [null];

      for (const segmentIndex of plan) {
        const { lineItem, existingMatch, pricingMode } = buildLineItem(resolution, index, segmentIndex);

        if (segmentIndex != null) {
          const summary = segmentSummaries[segmentIndex];
          summary.lines += 1;
          summary.quantity += lineItem.quantity || 0;
          summary.value += (lineItem.quantity || 0) * (lineItem.sellUnitPrice || 0);
        }

        const isLogged = segmentIndex == null || segmentIndex === 0;
        if (lineItem.quantity > 0 && isLogged) {
          console.log(`[${index}]${segmentIndex != null ? `p1` : ''} ${lineItem.chargeId} sub=${via} ord=${existingMatch.via} qty=${lineItem.quantity} attrs=${describeAttributes(lineItem.attributeReferences)} years="${getYearsCustomField(lineItem)?.value || 'null'}" ${pricingMode}`);
        } else if (lineItem.quantity <= 0 && isLogged) {
          zeroQuantityLines.push(lineItem.chargeId);
        }

        mergedLineItems.push(lineItem);
      }
    });

    if (zeroQuantityLines.length > 0) {
      console.log(`${zeroQuantityLines.length} zero-quantity line(s) carried through: ${zeroQuantityLines.slice(0, 6).join(', ')}${zeroQuantityLines.length > 6 ? ` (+${zeroQuantityLines.length - 6})` : ''}`);
    }
    if (isMultiSegment) {
      segmentSummaries.forEach((summary, k) => {
        console.log(`Period ${k + 1} (${formatDate(targetWindows[k].start)} -> ${formatDate(targetWindows[k].end)}): ${summary.lines} line(s) qty=${summary.quantity} value~${Math.round(summary.value)}`);
      });
    }
    for (const note of fullSpanMatchSet.cohortNotes) {
      console.log(`Cohort swap — ${note}`);
    }

    // ==================================================
    // GUARD RAILS
    // ==================================================
    if (mergedLineItems.length === 0) {
      throw new Error(`Rebuild produced 0 line items — refusing to create order. draftItems=${draftLineItems.length} subscriptionCharges=${subscriptionCharges.length}`);
    }

    const expectedLineCount = rampedLine.reduce(
      (sum, ramped) => sum + (ramped ? segments.length : 1), 0);
    if (mergedLineItems.length !== expectedLineCount) {
      throw new Error(`Line item count mismatch: built ${mergedLineItems.length}, expected ${expectedLineCount} from ${draftLineItems.length} draft items across ${segments.length} period(s)`);
    }

    const missingYears = mergedLineItems.filter(item =>
      item.quantity > 0 && !getYearsCustomField(item)?.value);
    if (missingYears.length > 0) {
      throw new Error(`Missing Year Groups on ${missingYears.length} billable line item(s): ${missingYears.map(i => `${i.chargeId}(qty ${i.quantity})`).join(', ')}`);
    }

    if (swappedLines.length > 0) {
      console.log(`Charge renamed across plan versions on ${swappedLines.length} line(s): ${swappedLines.slice(0, 3).join(' | ')}${swappedLines.length > 3 ? ` (+${swappedLines.length - 3} more)` : ''}`);
    }

    if (attributesRecovered.length > 0) {
      const shown = attributesRecovered.slice(0, 2).join(' | ');
      console.log(`Recovered attributes on ${attributesRecovered.length} line(s): ${shown}${attributesRecovered.length > 2 ? ` (+${attributesRecovered.length - 2} more)` : ''}`);
    }

    if (unresolvedCharges.length > 0) {
      console.log(`NOTE: ${unresolvedCharges.length} draft line(s) built from draft data alone: ${unresolvedCharges.slice(0, 5).join(', ')}${unresolvedCharges.length > 5 ? ` (+${unresolvedCharges.length - 5})` : ''}`);
    }

    const orphanedBillableCharges = renewalCharges
      .filter(c => !usedSubCharges.has(c.id) && c.quantity > 0);
    if (orphanedBillableCharges.length > 0) {
      const shownOrphans = orphanedBillableCharges.slice(0, 5)
        .map(c => `${c.chargeId}(qty ${c.quantity})`).join(', ');
      console.error(`WARNING: ${orphanedBillableCharges.length} billable renewal charge(s) not represented: ${shownOrphans}${orphanedBillableCharges.length > 5 ? ` (+${orphanedBillableCharges.length - 5})` : ''}`);
    }

    // Nothing may be dropped while rebuilding, and the yardstick for that is
    // the order being rebuilt — NOT the subscription. A renewal is routinely
    // quoted at a different seat count from the term it renews: a year group
    // is dropped, students leave, several lines are consolidated into fewer.
    // Reproducing that negotiated quote is the whole job, so measuring
    // against the subscription would refuse every renewal quoted down.
    //
    // Checked period by period: summing the whole order would let a line
    // dropped from one year hide behind the duplicate quantity of another,
    // which is exactly the failure this guard exists to catch.
    const subscriptionQuantity = renewalCharges.reduce((s, c) => s + (c.quantity || 0), 0);
    const quotedFullSpanQuantity = isMultiSegment
      ? fullSpanPool.reduce((s, i) => s + (i.quantity || 0), 0)
      : 0;
    const rebuiltFullSpanQuantity = mergedLineItems
      .filter(i => i.segmentIndex == null)
      .reduce((s, i) => s + (i.quantity || 0), 0);

    for (let k = 0; k < segments.length; k++) {
      const rebuiltQuantity = mergedLineItems
        .filter(i => i.segmentIndex === k)
        .reduce((s, i) => s + (i.quantity || 0), 0) + rebuiltFullSpanQuantity;
      const quotedQuantity = isMultiSegment
        ? segmentPools[k].reduce((s, i) => s + (i.quantity || 0), 0) + quotedFullSpanQuantity
        : existingLineItems.reduce((s, i) => s + (i.quantity || 0), 0);

      console.log(`Quantity period ${k + 1}: quoted=${quotedQuantity} rebuilt=${rebuiltQuantity} subscription=${subscriptionQuantity}`);

      if (rebuiltQuantity < quotedQuantity) {
        throw new Error(`Rebuilt quantity ${rebuiltQuantity} in period ${k + 1} is below the ${quotedQuantity} quoted on ${existingRenewalOrderId} — line items were dropped`);
      }

      // Not a failure: the rebuild matches what was quoted. Surfaced because
      // a renewal well below the term it renews is worth a human glance
      // before it goes out, whether it is a deliberate reduction or an
      // oversight in the order being rebuilt.
      if (rebuiltQuantity < subscriptionQuantity) {
        console.error(`NOTE: period ${k + 1} carries ${rebuiltQuantity} seats where the subscription's renewing charges carry ${subscriptionQuantity} (${subscriptionQuantity - rebuiltQuantity} fewer) — this matches ${existingRenewalOrderId}, but check it is intended before sending`);
      }
    }

    // ==================================================
    // CREATE FINAL ORDER
    // ==================================================
    // A multi-period order has to be posted with the term it was quoted
    // for, not the single period the draft proposed: the line items carry
    // the ramp windows, and termLength/rampInterval tell Subskribe how to
    // read them. The billing arrangement comes from the existing order for
    // the same reason — a two-year term billed annually up front is a
    // negotiated position the one-year draft knows nothing about.
    const derivedTermLength = existingOrder.termLength
      || (orderEndDate != null && orderStartDate != null
        ? { cycle: 'YEAR', step: Math.max(1, Math.round((orderEndDate - orderStartDate) / 86400 / 365)) }
        : null);

    const createPayload = {
      accountId: newOrder.accountId,
      orderType: newOrder.orderType,
      currency: newOrder.currency,
      paymentTerm: newOrder.paymentTerm,
      renewalForSubscriptionId: newOrder.renewalForSubscriptionId || subscriptionId,
      billingContactId: newOrder.billingContactId,
      shippingContactId: newOrder.shippingContactId,
      startDate: orderStartDate,
      endDate: orderEndDate,
      billingCycle: isMultiSegment
        ? (existingOrder.billingCycle || newOrder.billingCycle)
        : newOrder.billingCycle,
      billingTerm: isMultiSegment
        ? (existingOrder.billingTerm || newOrder.billingTerm)
        : newOrder.billingTerm,
      billingAnchorDate: isMultiSegment
        ? (orderStartDate != null ? orderStartDate : newOrder.billingAnchorDate)
        : newOrder.billingAnchorDate,
      autoRenew: newOrder.autoRenew,
      sfdcOpportunityId: existingOrder.sfdcOpportunityId || '',
      sfdcOpportunityName: existingOrder.sfdcOpportunityName || '',
      ownerId: existingOrder.ownerId || newOrder.ownerId || '',
      name: `ORDER REBUILD ${existingOrder.name || existingRenewalOrderId}`,
      lineItems: mergedLineItems.map(item => {
        const lineItem = {
          id: crypto.randomUUID(),
          isDryRunItem: false,
          action: item.action,
          planId: item.planId,
          chargeId: item.chargeId,
          quantity: item.quantity,
          listUnitPrice: item.listUnitPrice,
          sellUnitPrice: item.sellUnitPrice,
          discounts: item.discounts || [],
          effectiveDate: item.effectiveDate,
          endDate: item.endDate,
          customFields: normaliseCustomFields(item)
        };
        // Omitted entirely when the charge is not attribute-priced.
        if (item.attributeReferences && item.attributeReferences.length > 0) {
          lineItem.attributeReferences = item.attributeReferences;
        }
        if (item.isRamp) {
          lineItem.isRamp = true;
        }
        if (item.subscriptionChargeId) {
          lineItem.subscriptionChargeId = item.subscriptionChargeId;
        }
        if (item.replacedPlanId) {
          lineItem.replacedPlanId = item.replacedPlanId;
        }
        if (item.listPriceOverrideRatio != null) {
          lineItem.listPriceOverrideRatio = item.listPriceOverrideRatio;
        }
        if (item.listUnitPriceBeforeOverride != null) {
          lineItem.listUnitPriceBeforeOverride = item.listUnitPriceBeforeOverride;
        }
        return lineItem;
      }),
      customFields: normaliseCustomFields(newOrder)
    };

    if (isMultiSegment) {
      if (derivedTermLength) createPayload.termLength = derivedTermLength;
      createPayload.rampInterval = targetWindows.map(w => w.start);
    }

    console.log(`Creating order with ${createPayload.lineItems.length} line items${isMultiSegment ? ` across ${segments.length} periods (term ${derivedTermLength ? `${derivedTermLength.step}x${derivedTermLength.cycle}` : 'unknown'})` : ''}`);
    const createResponse = await axios.post(
      `${API_BASE}/orders`,
      createPayload,
      { headers: authHeaders, timeout: WRITE_TIMEOUT }
    );
    const createdOrder = createResponse.data;
    console.log(`NEW ORDER CREATED: ${createdOrder.id} | status=${createdOrder.status} | total=${createdOrder.totalAmount}`);

    // Post-creation value check. The API prices catalog-priced lines, so
    // this is the first point at which the rebuilt total is knowable. Both
    // totals cover the full term, so a multi-period rebuild is compared
    // like for like.
    const existingTotal = existingOrder.totalAmount || 0;
    const createdTotal = createdOrder.totalAmount || 0;
    if (existingTotal > 0) {
      const drift = (createdTotal - existingTotal) / existingTotal;
      console.log(`Value: existing=${existingTotal} rebuilt=${createdTotal} drift=${(drift * 100).toFixed(2)}%`);
      if (Math.abs(drift) > 0.10) {
        console.error(`WARNING: rebuilt total ${createdTotal} differs from existing order ${existingTotal} by ${(drift * 100).toFixed(2)}% — DO NOT SEND ${createdOrder.id} without reviewing line pricing`);
      }
    }

    // A term that came back shorter than it was quoted for is the failure
    // mode specific to multi-period rebuilds, and it is invisible in the
    // line-item count.
    if (isMultiSegment && createdOrder.endDate != null && orderEndDate != null
      && createdOrder.endDate !== orderEndDate) {
      console.error(`WARNING: created order ${createdOrder.id} ends ${formatDate(createdOrder.endDate)} but was built to end ${formatDate(orderEndDate)} — check the term before sending`);
    }

    // Report any line the API priced differently from what was intended.
    for (const created of (createdOrder.lineItems || [])) {
      if (!created.quantity) continue;
      const intended = mergedLineItems.find(i =>
        i.chargeId === created.chargeId
        && i.quantity === created.quantity
        && i.effectiveDate === created.effectiveDate);
      if (intended && intended.sellUnitPrice != null
        && Math.abs(created.sellUnitPrice - intended.sellUnitPrice) > 0.01) {
        console.log(`Repriced by API: ${created.chargeId} ${formatDate(created.effectiveDate)} sent=${intended.sellUnitPrice} final=${created.sellUnitPrice} attrs=${describeAttributes(created.attributeReferences)}`);
      }
    }

    return callback({
      outputFields: {
        generated_new_draft: true,
        new_order_created: true,
        new_renewal_order_id: createdOrder.id || '',
        new_order_status: createdOrder.status || '',
        new_order_total: createdOrder.totalAmount || 0,
        error_message: '',
        renewal_for_subscription_id: subscriptionId,
        account_id: createdOrder.accountId || '',
        opportunity_id: createdOrder.sfdcOpportunityId || '',
        opportunity_name: createdOrder.sfdcOpportunityName || '',
        order_periods: segments.length
      }
    });

  } catch (error) {
    console.error('STEP 2 FAILED:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Response:', JSON.stringify(error.response.data));
    }
    // Carried out to Slack so a failure says why, instead of showing blanks.
    const errorMessage = (error.response
      ? `Subskribe ${error.response.status}: ${JSON.stringify(error.response.data)}`
      : (error.message || 'Unknown error')).slice(0, 500);
    callback({
      outputFields: {
        generated_new_draft: false,
        new_order_created: false,
        new_renewal_order_id: '',
        new_order_status: 'ERROR',
        new_order_total: 0,
        error_message: errorMessage,
        renewal_for_subscription_id: subscriptionId || '',
        account_id: '',
        opportunity_id: '',
        opportunity_name: '',
        order_periods: 0
      }
    });
  }
};
