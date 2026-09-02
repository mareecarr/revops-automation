/**
 * Renewal order automation - ESSENTIAL ASSESSMENT.
 * HubSpot custom-coded action.
 *
 * Routed to by the "School Product" deal property (school_product ==
 * "Essential Assessment"), NOT by currency or team - Essential Assessment is
 * currently AUD-only, but routing on the product property (rather than
 * currency) keeps this consistent with the rest of the automation and future-
 * proofs it if EA ever sells in another currency.
 *
 * ARCHITECTURE - DIFFERENT FROM THE EDUCATION PERFECT SCRIPTS:
 *   - There is NO Tier/Sector attribute mechanism here. Sector is encoded by
 *     which PLAN is used - "EA Products (YYYY) Independent" vs "EA Products
 *     (YYYY) Government + Religious" are two separate plans with identical
 *     charge names but different flat prices. No attributeReferences are
 *     ever set on any line item.
 *   - Every plan currently offers exactly 3 charges, all PER_UNIT (flat
 *     price x quantity, no rate card, no volume tiers): "Numeracy Bundle",
 *     "Literacy Bundle", and "Numeracy + Literacy Bundle". A rep can order
 *     more than one bundle on the same order (e.g. Numeracy for juniors,
 *     Literacy for seniors).
 *   - Plan selection is "use the newest ACTIVE EA Products (YYYY) <Sector>
 *     plan", the same "always pick the newest year" pattern as EP, so a new
 *     year's plan is picked up automatically without a script change.
 *
 * INPUT PROPERTIES  order_details, subskribe_order_id   (deal)
 * SECRET            SubskribeAPIKey
 *
 * OUTPUT FIELDS (all String)
 *   order_updated    "true" when the order was saved, "false" for a dry run
 *   update_summary   short human summary of what was built
 *   update_error     empty when everything worked
 */
const axios = require('axios');

// ============================================================================
// THE ONLY SWITCH THAT MATTERS
// Leave this as `true` until you've dry-run tested this script against a
// real DRAFT Essential Assessment renewal order and confirmed the resolved
// line items look right. Flip to `false` only once you're confident.
// ============================================================================
const DRY_RUN = false;

const ENTITY_ID = 'ENT-H5MFM0T';
const CURRENCY = 'AUD'; // Essential Assessment is AUD-only at this stage.

const BUNDLE_NAMES = ['Numeracy Bundle', 'Literacy Bundle', 'Numeracy + Literacy Bundle'];

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A line item is identified by its plan, its charge AND its year groups -
// one bundle can be sold to two cohorts at two prices on the same order, and
// each cohort has its own base price, target price and saved line.
const yearsValueOf = (item) => {
  const field = (item.customFields || []).find((c) => c.name === 'years');
  return (field && field.value) || '';
};
const lineKeyOf = (item) => `${item.planId}|${item.chargeId}|${yearsValueOf(item)}`;

// ============================================================================
// PARSER
// ============================================================================
function parseOrderDetailsEA(orderDetails) {
  const errors = [];
  const warnings = [];

  const SECTOR_ALIASES = [
    ['Government + Religious', ['government + religious', 'government and religious', 'government & religious', 'government', 'govt', 'gov', 'religious', 'faith']],
    ['Independent', ['independent', 'indep', 'ind']]
  ];

  // Same chaining/splitting rules as the other scripts: comma, "and", "&",
  // real newline, or (safety net) plain whitespace before a new
  // quantity+year-word.
  const rawLines = String(orderDetails || '')
    .split(/\r?\n+/)
    .reduce((acc, line) => acc.concat(line.split(/(?:\s*(?:,|and|&)\s*|\s+)(?=\d+\s+(?:y|yr|yrs|year|years|g|gr|grade|grades)\b)/i)), [])
    .map((s) => s.trim())
    .filter(Boolean);

  const parseYears = (spec, lineErrors) => {
    const years = [];
    const special = [];
    spec.split(/\s*(?:,|and|&)\s*/i).map((t) => t.trim()).filter(Boolean).forEach((token) => {
      if (/^staff$/i.test(token)) return special.push('Staff');
      if (/^(p\/f\/k|pfk|prep|foundation|kindy|kindergarten)$/i.test(token)) return special.push('P/F/K');
      const range = token.match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
      if (range) {
        const from = Number(range[1]);
        const to = Number(range[2]);
        if (from > to) return lineErrors.push(`year range "${token}" is backwards`);
        for (let y = from; y <= to; y++) {
          if (y < 1 || y > 13) return lineErrors.push(`year ${y} is outside 1-13`);
          years.push(y);
        }
        return;
      }
      const single = token.match(/^(\d{1,2})$/);
      if (single) {
        const y = Number(single[1]);
        if (y < 1 || y > 13) return lineErrors.push(`year ${y} is outside 1-13`);
        return years.push(y);
      }
      lineErrors.push(`could not read year group "${token}"`);
    });
    return { years: [...new Set(years)].sort((a, b) => a - b), special: [...new Set(special)] };
  };

  // A line selects exactly ONE bundle (one charge) - unlike the EP scripts,
  // there's no multi-subject list on a single line. The combo name
  // ("Numeracy + Literacy") is matched as a single unit before falling back
  // to the single-subject names, so "+"/"and"/"&" inside the bundle name
  // itself is never mistaken for a subject separator.
  const resolveBundle = (spec, lineErrors) => {
    const cleaned = spec.replace(/\bbundle\b/gi, '').replace(/\s+/g, ' ').trim();
    if (
      /^numeracy\s*(?:\+|and|&)\s*literacy$/i.test(cleaned) ||
      /^literacy\s*(?:\+|and|&)\s*numeracy$/i.test(cleaned) ||
      /^num\s*(?:\+|and|&)\s*lit$/i.test(cleaned) ||
      /^both$/i.test(cleaned)
    ) {
      return 'Numeracy + Literacy Bundle';
    }
    if (/^(numeracy|num)$/i.test(cleaned)) return 'Numeracy Bundle';
    if (/^(literacy|lit)$/i.test(cleaned)) return 'Literacy Bundle';
    lineErrors.push(`unknown bundle "${spec}"`);
    return null;
  };

  const stripTrailingModifiers = (text) => {
    let remaining = text;
    let price = null;
    let sector = null;
    let changed = true;
    while (changed) {
      changed = false;
      const priceMatch = remaining.match(/\$\s*([\d,]+(?:\.\d{1,2})?)\s*$/);
      if (priceMatch && price === null) {
        price = Number(priceMatch[1].replace(/,/g, ''));
        remaining = remaining.slice(0, priceMatch.index).trim();
        changed = true;
        continue;
      }
      if (sector === null) {
        let hit = null;
        SECTOR_ALIASES.forEach(([canonical, aliases]) => {
          aliases.forEach((alias) => {
            const m = remaining.match(new RegExp(`(^|[\\s,])${escapeRegex(alias)}\\s*$`, 'i'));
            if (m && (!hit || alias.length > hit.alias.length)) {
              hit = { canonical, alias, index: m.index + m[1].length };
            }
          });
        });
        if (hit) {
          sector = hit.canonical;
          remaining = remaining.slice(0, hit.index).trim();
          changed = true;
          continue;
        }
      }
    }
    return { remaining: remaining.replace(/[,\s]+$/, '').trim(), price, sector };
  };

  const lines = [];
  rawLines.forEach((raw) => {
    const lineErrors = [];
    if (/teacher access/i.test(raw)) {
      lines.push({ raw, type: 'TEACHER_ACCESS' });
      return;
    }
    const { remaining, price, sector } = stripTrailingModifiers(raw);
    const head = remaining.match(
      /^(\d+)\s+(?:(y|yr|yrs|year|years|g|gr|grade|grades)\s*)?((?:\d{1,2}\s*-\s*\d{1,2}|\d{1,2}|staff|p\/f\/k|pfk|prep|foundation|kindy|kindergarten)(?:\s*(?:,|and|&)\s*(?:\d{1,2}\s*-\s*\d{1,2}|\d{1,2}|staff|p\/f\/k|pfk|prep|foundation|kindy|kindergarten))*)\s*(.*)$/i
    );
    if (!head) {
      errors.push(`Could not read line: "${raw}" - expected "<quantity> Year <years> <bundle> [sector] $<price>"`);
      return;
    }
    const quantity = Number(head[1]);
    const prefix = (head[2] || 'year').toLowerCase();
    const bundleSpec = (head[4] || '').trim();
    const grading = ['g', 'gr', 'grade', 'grades'].includes(prefix) ? 'Grade' : 'Year';
    const { years, special } = parseYears(head[3], lineErrors);
    if (!quantity || quantity < 1) lineErrors.push('quantity must be 1 or more');
    if (!years.length && !special.length) lineErrors.push('no year groups found');
    if (price === null) lineErrors.push('a price is required, e.g. $16.00');

    let bundle = null;
    if (!bundleSpec) {
      lineErrors.push('no bundle specified - expected Numeracy, Literacy, or Numeracy + Literacy');
    } else {
      bundle = resolveBundle(bundleSpec, lineErrors);
    }

    if (lineErrors.length) {
      errors.push(`"${raw}" -> ${lineErrors.join('; ')}`);
      return;
    }
    lines.push({
      raw, type: 'BUNDLE',
      quantity, grading, years, specialYears: special,
      bundle, sector: sector || null, price
    });
  });
  return { lines, errors, warnings };
}

// ============================================================================
// CATALOGUE
// ============================================================================
// Matches "EA Products (2026) Independent" / "EA Products (2026) Government + Religious".
const PLAN_NAME_RE = /^EA Products \((20\d{2})\)\s+(Independent|Government \+ Religious)\s*$/i;

async function fetchActivePlans(apiKey, currency) {
  const plans = [];
  let cursor = null;
  do {
    const url = `https://api.app.subskribe.com/plans?limit=100&status=ACTIVE${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await axios.get(url, {
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-API-Key': apiKey, 'X-Entity-Id': ENTITY_ID }
    });
    plans.push(...(res.data.data || []));
    cursor = res.data.nextCursor || null;
  } while (cursor);
  return plans.filter((p) => p.currency === currency);
}

/**
 * Groups plans by sector, keeping only the newest contract year per sector -
 * the same "newest year wins" pattern used in the EP scripts' buildCatalogue.
 * Returns { 'Independent': { year, plan }, 'Government + Religious': { year, plan } }.
 */
function buildCatalogueEA(plans, warnings) {
  const bySector = {};
  plans.forEach((plan) => {
    const m = String(plan.name || '').match(PLAN_NAME_RE);
    if (!m) return;
    const [, year, sectorRaw] = m;
    const sector = /government/i.test(sectorRaw) ? 'Government + Religious' : 'Independent';
    const existing = bySector[sector];
    if (!existing || Number(year) > existing.year) {
      bySector[sector] = { year: Number(year), plan };
    }
  });
  return bySector;
}

// ============================================================================
// MAIN
// ============================================================================
exports.main = async (event, callback) => {
  const errors = [];
  const warnings = [];
  const finish = (updated, summary) =>
    callback({
      outputFields: {
        order_updated: updated ? 'true' : 'false',
        update_summary: summary || '',
        update_error: errors.join(' | ')
      }
    });

  try {
    const apiKey = process.env.SubskribeAPIKey || '';
    const orderId = String(event.inputFields['subskribe_order_id'] || '').trim();
    const orderDetails = String(event.inputFields['order_details'] || '');

    if (!apiKey) { errors.push('No SubskribeAPIKey secret attached to this action.'); return finish(null, ''); }
    if (!orderId) { errors.push('The deal has no Subskribe Order ID.'); return finish(null, ''); }

    // ---- Existing order --------------------------------------------------
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json', 'X-API-Key': apiKey, 'X-Entity-Id': ENTITY_ID };
    const orderRes = await axios.get(`https://api.app.subskribe.com/orders/${encodeURIComponent(orderId)}`, { headers });
    const order = orderRes.data;
    console.log(`Order ${order.id}: ${order.status} ${order.orderType} ${order.currency}, ${(order.lineItems || []).length} existing line item(s).`);
    if (order.status !== 'DRAFT') errors.push(`Order status is ${order.status}, not DRAFT - cannot rebuild.`);
    if (order.currency !== CURRENCY) errors.push(`Order currency is ${order.currency} - this action only handles ${CURRENCY}.`);
    if (errors.length) return finish(null, '');

    // ---- Parse -------------------------------------------------------------
    const parsed = parseOrderDetailsEA(orderDetails);
    parsed.errors.forEach((e) => errors.push(e));
    parsed.warnings.forEach((w) => warnings.push(w));
    const directives = parsed.lines.filter((l) => l.type !== 'TEACHER_ACCESS');
    console.log(`Parsed ${directives.length} directive(s) from order_details.`);
    if (!directives.length) { errors.push('Nothing to build - no usable lines in Order Details.'); return finish(null, ''); }

    // ---- Catalogue -------------------------------------------------------
    const plans = await fetchActivePlans(apiKey, order.currency);
    const catalogue = buildCatalogueEA(plans, warnings);
    console.log(`Catalogue: ` + Object.entries(catalogue).map(([sector, v]) => `${sector}[${v.plan.name}]`).join(' '));
    if (!Object.keys(catalogue).length) { errors.push(`No ACTIVE "EA Products (YYYY) <Sector>" plans found for ${order.currency}.`); return finish(null, ''); }

    // Infer an inherited sector from the existing order's plan(s), if any of
    // them match a known catalogue plan and there's only one distinct sector.
    const existingSectors = [...new Set((order.lineItems || [])
      .map((li) => Object.entries(catalogue).find(([, v]) => v.plan.id === li.planId))
      .filter(Boolean)
      .map(([sector]) => sector))];
    const inheritedSector = existingSectors.length === 1 ? existingSectors[0] : null;
    if (existingSectors.length > 1) warnings.push(`Existing order mixes sectors (${existingSectors.join(', ')}) - a sector must be stated on every line.`);

    if (errors.length) return finish(null, '');

    // The years picklist definition, preferably taken from the order itself.
    const YEARS_FIELD_FALLBACK = {
      id: 'CF-NFTKQDH2',
      type: 'MULTISELECT_PICKLIST',
      label: 'Year Groups',
      options: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13',
        'Staff', 'P/F/K', 'Platform Access', 'Implementation Fee',
        'All Year Groups (EdPotential)', 'Tertiary']
    };
    const yearsFieldTemplate = (order.lineItems || [])
      .map((li) => (li.customFields || []).find((c) => c.name === 'years'))
      .find(Boolean) || YEARS_FIELD_FALLBACK;
    if (yearsFieldTemplate === YEARS_FIELD_FALLBACK) {
      warnings.push('No existing line item carried a "years" custom field - using the built-in definition.');
    }

    // ---- Resolve ---------------------------------------------------------
    // selections[planId][chargeId] = [{ quantity, price, years, source }, ...]
    //
    // Two lines can both pick the same bundle, and what happens then depends
    // on the price:
    //
    //   - SAME price - the lines are merged. Their quantities are summed and
    //     their year groups combined, which is what a rep means by writing
    //     "92 Y5 Numeracy $16" and "50 Y6 Numeracy $16": 142 students at $16.
    //   - DIFFERENT price - the lines become two separate line items on the
    //     same charge, one per cohort, each carrying its own quantity, price
    //     and Year Groups. EA charges are flat PER_UNIT, so splitting a
    //     charge across cohorts costs nothing: the price does not depend on
    //     the line's quantity.
    //   - DIFFERENT price for the SAME year group - refused. There is no way
    //     to know which price that year level was sold at.
    const selections = {};
    const touchedPlans = new Set();
    const splitCharges = [];

    const select = (planId, chargeId, chargeName, data) => {
      selections[planId] = selections[planId] || {};
      const picks = selections[planId][chargeId] || (selections[planId][chargeId] = []);

      const samePrice = picks.find((p) => round2(p.price) === round2(data.price));
      if (samePrice) {
        samePrice.quantity += data.quantity;
        samePrice.years = [...new Set([...samePrice.years, ...data.years])];
        samePrice.source = `${samePrice.source} + ${data.source}`;
        touchedPlans.add(planId);
        return;
      }

      const clash = picks.find((p) => p.years.some((y) => data.years.includes(y)));
      if (clash) {
        const overlap = clash.years.filter((y) => data.years.includes(y));
        errors.push(`Conflict: ${chargeName} is priced differently for year ${overlap.join(', ')} on "${clash.source}" ($${clash.price}) and "${data.source}" ($${data.price}). One year group can only be sold at one price - fix one of the lines.`);
        return;
      }

      picks.push(data);
      touchedPlans.add(planId);
    };

    directives.forEach((line) => {
      const sector = line.sector || inheritedSector;
      if (!sector) {
        errors.push(`"${line.raw}" has no sector and one could not be inherited from the order.`);
        return;
      }
      if (line.specialYears.length === 0 && line.years.length === 0) {
        errors.push(`"${line.raw}": no year groups found.`);
        return;
      }
      const bucket = catalogue[sector];
      if (!bucket) {
        errors.push(`"${line.raw}": no ACTIVE plan found for sector "${sector}".`);
        return;
      }
      const charge = (bucket.plan.charges || []).find((c) => c.name === line.bundle);
      if (!charge) {
        errors.push(`"${line.raw}": ${line.bundle} is not available on ${bucket.plan.name}.`);
        return;
      }
      const allYears = [...line.years.map(String), ...line.specialYears];
      select(bucket.plan.id, charge.id, line.bundle, {
        quantity: line.quantity, price: line.price, years: allYears, source: line.raw
      });
    });
    if (errors.length) return finish(null, '');

    // ---- Build the line items -------------------------------------------
    // Every charge of every touched plan is emitted; unselected bundles come
    // through at quantity 0, exactly as Subskribe does when a plan is added.
    // A bundle sold to two cohorts at two prices is emitted twice.
    const planById = {};
    Object.values(catalogue).forEach(({ plan }) => (planById[plan.id] = plan));

    const subscriptionChargeIds = new Set();
    if (order.renewalForSubscriptionId) {
      try {
        const subRes = await axios.get(
          `https://api.app.subskribe.com/subscriptions/${encodeURIComponent(order.renewalForSubscriptionId)}`,
          { headers }
        );
        (subRes.data.charges || []).forEach((c) => subscriptionChargeIds.add(c.chargeId));
        console.log(`Subscription ${order.renewalForSubscriptionId} holds ${subscriptionChargeIds.size} charge(s).`);
      } catch (e) {
        errors.push(`Could not read subscription ${order.renewalForSubscriptionId}, so RENEWAL vs ADD cannot be decided safely: ${e.message}`);
        return finish(false, '');
      }
    } else {
      warnings.push('Order has no renewalForSubscriptionId - every line will be an ADD.');
    }

    const planIdByCharge = {};
    (order.lineItems || []).forEach((li) => { planIdByCharge[li.chargeId] = li.planId; });

    // The year groups each charge is sold to today. One subscription charge
    // can only be renewed once, so when a bundle is split across cohorts the
    // cohort closest to what is already sold takes RENEWAL and the rest are
    // additions.
    const existingYearsByCharge = {};
    (order.lineItems || []).forEach((li) => {
      existingYearsByCharge[li.chargeId] = yearsValueOf(li).split(/\s*;\s*/).filter(Boolean);
    });
    const renewalPickIndex = (chargeId, picks) => {
      if (picks.length < 2) return 0;
      const sold = existingYearsByCharge[chargeId] || [];
      if (!sold.length) return 0;
      let best = 0;
      let bestScore = -1;
      picks.forEach((pick, i) => {
        const score = pick.years.filter((y) => sold.includes(String(y))).length;
        if (score > bestScore) { bestScore = score; best = i; }
      });
      return best;
    };

    const lineItems = [];
    const summaryRows = [];
    const targetPrices = {}; // lineKeyOf(item) -> the price we want per unit
    let contractTotal = 0;

    [...touchedPlans].forEach((planId) => {
      const plan = planById[planId];
      const chosen = selections[planId] || {};
      let priced = 0;
      let qtyZero = 0;

      (plan.charges || []).forEach((charge) => {
        const picks = chosen[charge.id] || [];
        const inSubscription = subscriptionChargeIds.has(charge.id);
        const isRenewable = charge.isRenewable !== false;
        const renewalIndex = inSubscription && isRenewable ? renewalPickIndex(charge.id, picks) : -1;

        if (picks.length > 1) {
          splitCharges.push(`${charge.name} in ${plan.name}: ${picks.map((p) => `Yr ${p.years.join(',')} x${p.quantity} @ $${p.price}`).join(' + ')}`);
        }

        const emit = (pick, index) => {
          const item = {
            action: index === renewalIndex ? 'RENEWAL' : 'ADD',
            planId: plan.id,
            chargeId: charge.id,
            quantity: pick ? pick.quantity : 0,
            effectiveDate: order.startDate,
            endDate: order.endDate,
            discounts: [],
            customFields: []
          };
          // NOTE: setting listUnitPrice directly here is NOT respected by
          // Subskribe, even though these are flat PER_UNIT charges marked
          // isListPriceEditable - confirmed by a live test where a requested
          // price different from the charge's own default amount was silently
          // ignored. So the rep's price has to be applied the same way as the
          // EP scripts' RATE_CARD_LOOKUP charges: save the structure first,
          // read back Subskribe's own base price, then apply the difference as
          // a discount (or a list-price override if pricing ABOVE the base).
          // See PASS 2 below.
          if (pick) {
            item.customFields = [{
              id: yearsFieldTemplate.id,
              type: yearsFieldTemplate.type,
              name: 'years',
              label: yearsFieldTemplate.label,
              value: pick.years.join('; '),
              selections: pick.years,
              options: yearsFieldTemplate.options || []
            }];
            // Keyed by plan + charge + year groups, so two cohorts of one
            // bundle keep their own target price.
            targetPrices[lineKeyOf(item)] = pick.price;
            priced += 1;
            contractTotal += round2(pick.price * pick.quantity);
          } else {
            qtyZero += 1;
          }
          lineItems.push(item);
        };

        if (!picks.length) emit(null, 0);
        else picks.forEach(emit);
      });
      summaryRows.push(`${plan.name} (${plan.id}): ${priced} priced, ${qtyZero} at qty 0`);
    });

    // Subscription charges the rebuild drops - declared rather than silently
    // omitted, so Subskribe knows they are not being renewed.
    const droppedCharges = [...subscriptionChargeIds].filter(
      (chargeId) => !lineItems.some((li) => li.chargeId === chargeId)
    );
    droppedCharges.forEach((chargeId) => {
      const planId = planIdByCharge[chargeId];
      if (!planId) {
        warnings.push(`Subscription charge ${chargeId} is being dropped but its plan is unknown, so it was left off the order.`);
        return;
      }
      lineItems.push({
        action: 'MISSING_RENEWAL', planId, chargeId, quantity: 0,
        effectiveDate: order.startDate, endDate: order.endDate, discounts: [], customFields: []
      });
    });

    // ---- Report ------------------------------------------------------------
    console.log('\n=== PLANS TO BE USED ===');
    summaryRows.forEach((r) => console.log('  ' + r));
    if (splitCharges.length) {
      console.log('\n=== BUNDLES SOLD TO MORE THAN ONE COHORT (one line each) ===');
      splitCharges.forEach((c) => console.log('  - ' + c));
    }
    console.log(`\nLine items: ${lineItems.length} (${lineItems.filter((l) => l.quantity > 0).length} with quantity)`);
    console.log(`Expected contract total: $${round2(contractTotal)}`);
    console.log(`Replacing ${(order.lineItems || []).length} existing line item(s).`);
    if (warnings.length) {
      console.log('\n=== WARNINGS ===');
      warnings.forEach((w) => console.log('  ! ' + w));
    }

    // ---- Build the order payload --------------------------------------
    const carryOver = [
      'id', 'externalId', 'name', 'accountId', 'orderType', 'currency', 'paymentTerm',
      'shippingContactId', 'billingContactId', 'startDate', 'endDate', 'termLength',
      'billingCycle', 'billingTerm', 'billingAnchorDate', 'orderFormTemplateIds',
      'sfdcOpportunityId', 'isPrimaryOrderForSfdcOpportunity', 'sfdcOpportunityName',
      'sfdcOpportunityType', 'sfdcOpportunityStage', 'opportunityCrmType', 'ownerId',
      'renewalForSubscriptionId', 'purchaseOrderNumber', 'purchaseOrderRequiredForInvoicing',
      'autoRenew', 'entityId', 'customFields', 'startDateType', 'expiresOn',
      'documentMasterTemplateId', 'approvalSegmentId'
    ];
    const buildPayload = (items) => {
      const p = { lineItems: items };
      carryOver.forEach((key) => { if (order[key] !== undefined && order[key] !== null) p[key] = order[key]; });
      return p;
    };

    const putOrder = async (items, dryRun, label) => {
      const url = `https://api.app.subskribe.com/orders${dryRun ? '?isDryRun=true' : ''}`;
      console.log(`\n=== ${label} - PUT ${url} ===`);
      try {
        const res = await axios.put(url, buildPayload(items), { headers });
        console.log(`  HTTP ${res.status}`);
        return { ok: true };
      } catch (e) {
        const status = e.response && e.response.status;
        const body = e.response && e.response.data ? JSON.stringify(e.response.data) : '';
        console.error(`  PUT failed: ${status || ''} ${e.message}`);
        if (body) console.error('  Subskribe said: ' + body.slice(0, 900));
        return { ok: false, message: `${status || 'no status'}: ${body.slice(0, 1500) || e.message}` };
      }
    };
    const readOrder = async () => {
      const res = await axios.get(`https://api.app.subskribe.com/orders/${encodeURIComponent(orderId)}`, { headers });
      return res.data || {};
    };

    // ---- PASS 1 - structure only, no prices --------------------------------
    // Establishes each charge's own base/list price, which is only knowable
    // after Subskribe has priced the line - see the note above targetPrices.
    const pass1 = await putOrder(lineItems, DRY_RUN, DRY_RUN ? 'DRY RUN' : 'PASS 1 of 2, structure');
    if (!pass1.ok) {
      errors.push(`Subskribe rejected the order (${pass1.message})`);
      return finish(false, '');
    }
    if (DRY_RUN) {
      console.log('\nDRY RUN - validated, nothing saved. Prices cannot be checked in a dry');
      console.log('run because the response carries no body. Set DRY_RUN = false to apply.');
      return finish(false, `Dry run accepted: ${lineItems.length} line items across ${touchedPlans.size} plan(s), target total $${round2(contractTotal)}`);
    }

    // ---- PASS 2 - apply the rep's price as a discount/override off the ----
    // charge's own base price, same mechanism as the EP scripts.
    let priced1;
    try {
      priced1 = await readOrder();
    } catch (e) {
      errors.push(`Saved the structure but could not read the order back: ${e.message}`);
      return finish(true, '');
    }

    // Bases are looked up by plan + charge + year groups, so each cohort of a
    // split bundle gets its own base. The plan+charge fallback covers a line
    // whose Year Groups came back written differently to how they were sent,
    // and is only used when every line of that charge shares one base.
    const basesByLine = {};
    const basesByCharge = {};
    (priced1.lineItems || []).forEach((li) => {
      basesByLine[lineKeyOf(li)] = li.listUnitPrice;
      const chargeKey = `${li.planId}|${li.chargeId}`;
      if (!(chargeKey in basesByCharge)) basesByCharge[chargeKey] = li.listUnitPrice;
      else if (basesByCharge[chargeKey] !== li.listUnitPrice) basesByCharge[chargeKey] = null;
    });
    const baseFor = (item) => {
      const exact = basesByLine[lineKeyOf(item)];
      if (exact !== undefined) return exact;
      const shared = basesByCharge[`${item.planId}|${item.chargeId}`];
      return shared === null ? undefined : shared;
    };

    const RATIO_DECIMALS = 6;
    const roundRatio = (r) => Math.round(r * 10 ** RATIO_DECIMALS) / 10 ** RATIO_DECIMALS;
    const PERCENT_DECIMALS = 10;
    const roundPercent = (r) => Math.round(r * 10 ** PERCENT_DECIMALS) / 10 ** PERCENT_DECIMALS;
    const unpriceable = [];
    const pass2Items = lineItems.map((li) => {
      const want = targetPrices[lineKeyOf(li)];
      if (want === undefined) return li;
      const base = baseFor(li);
      if (base === undefined) { unpriceable.push(`${li.chargeId} (wanted $${want}, base unknown)`); return li; }
      if (base === want) return li; // already matches the charge's own price, nothing to override
      if (base === 0) return li; // nothing to discount off
      if (want > base) {
        const ratio = roundRatio(want / base);
        return { ...li, listPriceOverrideRatio: ratio, listUnitPrice: want };
      }
      const percent = roundPercent(1 - want / base);
      const discountAmount = round2(round2(base * li.quantity) - round2(want * li.quantity));
      return { ...li, discounts: [{ name: 'default', percent, discountAmount: null, status: null, discountedPrice: null, amount: discountAmount }] };
    });
    if (unpriceable.length) warnings.push(`Could not set a price on ${unpriceable.length} line(s): ${unpriceable.slice(0, 5).join('; ')}`);

    const pass2 = await putOrder(pass2Items, false, 'PASS 2 of 2, prices');
    if (!pass2.ok) {
      errors.push(`Structure saved, but the price override was rejected (${pass2.message}). The order is on the right plans but at default prices.`);
      return finish(true, '');
    }

    let result;
    try { result = await readOrder(); } catch (e) { warnings.push(`Saved, but could not read the order back to verify: ${e.message}`); result = {}; }
    const returned = (result && result.lineItems) || [];
    console.log(`\nSAVED. Order ${result.id || order.id} is now DRAFT with the rebuilt plans.`);
    const mismatches = [];
    returned.filter((li) => li.quantity > 0).forEach((li) => {
      const want = targetPrices[lineKeyOf(li)];
      if (want === undefined) return;
      if (round2(li.sellUnitPrice) !== round2(want)) {
        mismatches.push(`${li.chargeId} (Yr ${yearsValueOf(li)}): wanted $${want}, got $${li.sellUnitPrice}`);
      }
    });
    if (mismatches.length) {
      warnings.push(`${mismatches.length} line(s) priced differently to the request: ${mismatches.slice(0, 5).join('; ')}`);
    }
    if (warnings.length) { console.log('\n=== WARNINGS ==='); warnings.forEach((w) => console.log('  ! ' + w)); }
    const summary = `${returned.length} line items across ${touchedPlans.size} plan(s), total ${result.currency || order.currency} $${result.totalAmount}` +
      (mismatches.length ? `, ${mismatches.length} price mismatch(es)` : '');
    finish(true, summary);
  } catch (error) {
    const status = error.response && error.response.status;
    console.error('Failed:', status || '', error.message);
    if (error.response) console.error('Response:', JSON.stringify(error.response.data).slice(0, 500));
    errors.push(`Failed: ${status || ''} ${error.message}`);
    finish(null, '');
  }
};
