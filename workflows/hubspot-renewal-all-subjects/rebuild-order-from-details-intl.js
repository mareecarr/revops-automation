/**
 * Renewal order automation - INTERNATIONAL TEAM ACTION.
 * HubSpot custom-coded action.
 *
 * This is a CURRENCY-AGNOSTIC action, deliberately separate from
 * step5-update-order.js (AUD/NZD domestic) and the domestic USD/CAD action.
 * Routing to this action is by HubSpot TEAM (the international sales team),
 * not by order currency - every currency that has "{CUR} INTL ..." plans
 * (AUD, NZD, CAD, USD, EUR, GBP, AED) is handled by this one script.
 *
 * WHAT THIS COVERS: only the "{CUR} INTL ..." plan family -
 *   - "{CUR} INTL Single Subject" / "{CUR} INTL Languages" / "{CUR} INTL
 *     Other Subjects" - each subject is its own VOLUME charge. Subskribe
 *     resolves the unit price automatically from a quantity-tier table
 *     baked into the charge (e.g. 1-125 students = $25, 126-250 = $23.90,
 *     ...). A rep can NEVER type a price on any line in this script - it is
 *     rejected outright, on every line type.
 *   - "{CUR} INTL 3-Subject Bundle" - a single billed VOLUME charge (the
 *     "Bundle" keyword) plus a set of $0 PER_UNIT "tag" charges (one per
 *     subject) that exist purely to record which subjects were chosen.
 *
 * WHAT THIS DOES NOT COVER: any domestic-style plan (AUD/NZD Core/Other
 * Subjects bands, USD/CAD Core Subjects/All Subjects). Those have their own
 * separate action(s) and are never touched here. This action does not use
 * Tier or Sector at all - none of the INTL charges are RATE_CARD_LOOKUP, and
 * Subskribe only allows price attribution on that charge model.
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
// ============================================================================
const DRY_RUN = false;

const ENTITY_ID = 'ENT-MNJ0N5D';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ============================================================================
// PARSER
// ============================================================================
// Union of every subject name seen across every currency's INTL plans
// (confirmed from a full export of every active INTL plan). "Humanities" and
// "Maths" are always spelled this way on every INTL plan regardless of
// currency - unlike the domestic AUD/NZD plans, there's no per-currency
// naming variant to resolve here (e.g. NZD's domestic plan uses "Social
// Sciences", but NZD's own INTL Bundle plan still uses "Humanities").
const SUBJECT_NAMES = [
  'English', 'Maths', 'Science', 'Languages', 'Humanities',
  'EAL', 'Arts', 'Religious Education', 'PDHPE', 'Music', 'Moral Education'
];

const SUBJECT_ALIASES = {
  Eng: 'English', Math: 'Maths', Mathematics: 'Maths', Mat: 'Maths',
  Sci: 'Science',
  Langs: 'Languages', Lang: 'Languages', Langauges: 'Languages',
  ESOL: 'EAL', EALD: 'EAL',
  Hums: 'Humanities', SOSE: 'Humanities', Soc: 'Humanities', 'Social Sciences': 'Humanities',
  RE: 'Religious Education', Religion: 'Religious Education',
  HPE: 'PDHPE', Health: 'PDHPE', 'Health & PE': 'PDHPE', PD: 'PDHPE',
  Art: 'Arts', Drama: 'Arts'
};

// Keyword that means "select the 3-Subject Bundle VOLUME container charge"
// rather than an ordinary subject. Can be combined with subject names, which
// get tagged ($0, quantity only) alongside the billed container charge.
const BUNDLE_RE = /\b(?:3[\s-]*subject\s*bundle|bundle)\b/i;

function parseOrderDetailsIntl(orderDetails) {
  const errors = [];
  const warnings = [];

  const normaliseSubject = (raw, lineErrors) => {
    const cleaned = String(raw).trim().replace(/\s+/g, ' ');
    if (!cleaned) return null;
    const aliasKey = Object.keys(SUBJECT_ALIASES).find((k) => k.toLowerCase() === cleaned.toLowerCase());
    if (aliasKey) return SUBJECT_ALIASES[aliasKey];
    const exact = SUBJECT_NAMES.find((s) => s.toLowerCase() === cleaned.toLowerCase());
    if (exact) return exact;
    lineErrors.push(`unknown subject "${cleaned}"`);
    return null;
  };

  // Same chaining/splitting rules as the AUD/NZD script: comma, "and", "&",
  // real newline, or (safety net) plain whitespace before a new
  // quantity+year-word - see step5-update-order.js for the full rationale.
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

  // No Tier or Sector anywhere in this script - only a trailing price is
  // ever stripped, and only so it can be flagged as an error. INTL charges
  // are always volume-tiered/auto-priced; nothing here is ever rep-priced.
  const stripTrailingPrice = (text) => {
    const priceMatch = text.match(/\$\s*([\d,]+(?:\.\d{1,2})?)\s*$/);
    if (!priceMatch) return { remaining: text.trim(), price: null };
    return {
      remaining: text.slice(0, priceMatch.index).replace(/[,\s]+$/, '').trim(),
      price: Number(priceMatch[1].replace(/,/g, ''))
    };
  };

  const lines = [];
  rawLines.forEach((raw) => {
    const lineErrors = [];
    if (/teacher access/i.test(raw)) {
      lines.push({ raw, type: 'TEACHER_ACCESS' });
      return;
    }
    const { remaining, price } = stripTrailingPrice(raw);
    if (price !== null) lineErrors.push('pricing is automatic (volume-tiered) - remove the "$..." amount');

    const head = remaining.match(
      /^(\d+)\s+(?:(y|yr|yrs|year|years|g|gr|grade|grades)\s*)?((?:\d{1,2}\s*-\s*\d{1,2}|\d{1,2}|staff|p\/f\/k|pfk|prep|foundation|kindy|kindergarten)(?:\s*(?:,|and|&)\s*(?:\d{1,2}\s*-\s*\d{1,2}|\d{1,2}|staff|p\/f\/k|pfk|prep|foundation|kindy|kindergarten))*)\s*(.*)$/i
    );
    if (!head) {
      errors.push(`Could not read line: "${raw}"`);
      return;
    }
    const quantity = Number(head[1]);
    const prefix = (head[2] || 'year').toLowerCase();
    const subjectSpec = (head[4] || '').trim();
    const grading = ['g', 'gr', 'grade', 'grades'].includes(prefix) ? 'Grade' : 'Year';
    const { years, special } = parseYears(head[3], lineErrors);

    if (!quantity || quantity < 1) lineErrors.push('quantity must be 1 or more');
    if (!years.length && !special.length) lineErrors.push('no year groups found');

    const isBundle = BUNDLE_RE.test(subjectSpec);
    let type = 'SUBJECTS';
    let subjects = null;

    if (isBundle) {
      type = 'CONTAINER';
      const rest = subjectSpec.replace(BUNDLE_RE, '').replace(/^[\s,]+|[\s,]+$/g, '');
      subjects = rest
        ? rest.split(/\s*,\s*|\s+(?:and|&)\s+/i).map((s) => normaliseSubject(s, lineErrors)).filter(Boolean)
        : [];
    } else if (!subjectSpec) {
      lineErrors.push('no subjects listed');
    } else {
      subjects = subjectSpec
        .split(/\s*,\s*|\s+(?:and|&)\s+/i)
        .map((s) => normaliseSubject(s, lineErrors))
        .filter(Boolean);
      if (!subjects.length) lineErrors.push('no recognisable subjects');
    }

    if (lineErrors.length) {
      errors.push(`"${raw}" -> ${lineErrors.join('; ')}`);
      return;
    }

    lines.push({ raw, type, quantity, grading, years, specialYears: special, subjects });
  });

  return { lines, errors, warnings };
}

// ============================================================================
// CATALOGUE
// ============================================================================
// "{CUR} INTL ..." plans are a fixed, non-versioned set of literal names per
// currency, e.g. "USD INTL Single Subject", "EUR INTL 3-Subject Bundle".
const intlPlanRe = (currency) => new RegExp(`^${escapeRegex(currency)}\\s+INTL\\s+(.+)$`, 'i');

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
 *   'VOLUME'    - chargeModel VOLUME, named as an ordinary subject (e.g. the
 *                 "Languages"/"English" charges inside a Single Subject
 *                 plan). Quantity only - Subskribe resolves the price from
 *                 its own quantity-tier table.
 *   'CONTAINER' - chargeModel VOLUME, NOT named as a subject (e.g.
 *                 "3-Subject Bundle"). Selected via the Bundle keyword, not
 *                 a subject name.
 *   'FREE_TAG'  - PER_UNIT with amount === 0, sitting alongside a CONTAINER
 *                 charge in the same plan. Quantity only, always $0 - exists
 *                 purely to record which subjects were chosen for a Bundle.
 */
function classifyCharge(charge) {
  const isSubjectName = SUBJECT_NAMES.some((s) => s.toLowerCase() === String(charge.name).toLowerCase());
  if (charge.chargeModel === 'VOLUME') return isSubjectName ? 'VOLUME' : 'CONTAINER';
  if (charge.chargeModel === 'PER_UNIT' && Number(charge.amount) === 0) return 'FREE_TAG';
  return 'OTHER';
}

function buildCatalogue(plans, currency, warnings) {
  const entries = []; // { planId, planName, charge, kind }
  const intlRe = intlPlanRe(currency);
  const bySubtype = {};
  plans.forEach((plan) => {
    const m = String(plan.name || '').match(intlRe);
    if (!m) return;
    const subtype = m[1].trim().toLowerCase();
    bySubtype[subtype] = bySubtype[subtype] || [];
    bySubtype[subtype].push(plan);
  });
  Object.entries(bySubtype).forEach(([subtype, matchingPlans]) => {
    if (matchingPlans.length > 1) {
      warnings.push(`${matchingPlans.length} ACTIVE "${currency} INTL ${subtype}" plans found - using ${matchingPlans[0].id}.`);
    }
    const plan = matchingPlans[0];
    (plan.charges || []).forEach((charge) => {
      entries.push({ planId: plan.id, planName: plan.name, charge, kind: classifyCharge(charge) });
    });
  });
  return entries;
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
    const orderRes = await axios.get(`https://api.app.subskribe.com/orders/${encodeURIComponent(orderId)}`, {
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-API-Key': apiKey, 'X-Entity-Id': ENTITY_ID }
    });
    const order = orderRes.data;
    console.log(`Order ${order.id}: ${order.status} ${order.orderType} ${order.currency}, ${(order.lineItems || []).length} existing line item(s).`);

    if (order.status !== 'DRAFT') errors.push(`Order status is ${order.status}, not DRAFT - cannot rebuild.`);
    if (!order.currency) errors.push('Order has no currency.');
    if (errors.length) return finish(null, '');

    // ---- Parse -------------------------------------------------------------
    const parsed = parseOrderDetailsIntl(orderDetails);
    parsed.errors.forEach((e) => errors.push(e));
    parsed.warnings.forEach((w) => warnings.push(w));
    const directives = parsed.lines.filter((l) => l.type !== 'TEACHER_ACCESS');
    console.log(`Parsed ${directives.length} directive(s) from order_details.`);
    if (!directives.length) { errors.push('Nothing to build - no usable lines in Order Details.'); return finish(null, ''); }

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

    // ---- Catalogue ---------------------------------------------------------
    const plans = await fetchActivePlans(apiKey, order.currency);
    const catalogue = buildCatalogue(plans, order.currency, warnings);
    console.log(`INTL catalogue for ${order.currency}: ${catalogue.length} charge(s) across ${new Set(catalogue.map((c) => c.planId)).size} plan(s).`);
    console.log(catalogue.map((c) => `  ${c.planName} / ${c.charge.name} [${c.kind}]`).join('\n'));
    if (!catalogue.length) { errors.push(`No ACTIVE ${order.currency} INTL plans found.`); return finish(null, ''); }
    if (errors.length) return finish(null, '');

    // ---- Resolve -------------------------------------------------------
    // selections[planId][chargeId] = { quantity, years, source }
    //
    // There are no year bands in this catalogue at all - a subject is one
    // charge for every year group - so two lines that split a subject by
    // cohort always land on the same charge:
    //
    //   120 Y7-8 English
    //   90 Y9-12 English
    //
    // These are MERGED into one line of 210 covering years 7-12, not split
    // into two lines. INTL charges are VOLUME: Subskribe reads the unit price
    // off the charge's own quantity-tier table, per line item. One line of
    // 210 earns the 126-250 tier price, while two lines of 120 and 90 would
    // both sit in the 1-125 tier and quote the school more than the rep
    // intended. (The domestic scripts split instead, because a rate card
    // price does not depend on the line's quantity.)
    //
    // Overlapping year groups are still refused: "120 Y7-8" plus "40 Y8"
    // would silently double-count year 8.
    const selections = {};
    const touchedPlans = new Set();
    const mergedCharges = [];

    const select = (planId, chargeId, chargeName, data) => {
      selections[planId] = selections[planId] || {};
      const existing = selections[planId][chargeId];
      if (existing) {
        const overlap = existing.years.filter((y) => data.years.includes(y));
        if (overlap.length) {
          errors.push(`Conflict: ${chargeName} in ${planId} is set for year ${overlap.join(', ')} by both "${existing.source}" and "${data.source}". Split these onto lines that don't overlap.`);
          return;
        }
        existing.quantity += data.quantity;
        existing.years = [...new Set([...existing.years, ...data.years])].sort((a, b) => a - b);
        existing.source = `${existing.source} + ${data.source}`;
        mergedCharges.push(`${chargeName}: now ${existing.quantity} across Yr ${existing.years.join(',')} (from "${existing.source}")`);
        return;
      }
      selections[planId][chargeId] = data;
      touchedPlans.add(planId);
    };

    directives.forEach((line) => {
      if (line.specialYears.length) {
        warnings.push(`"${line.raw}" mentions ${line.specialYears.join(', ')} - these are not mapped to a plan and were skipped.`);
      }

      if (line.type === 'CONTAINER') {
        const containers = catalogue.filter((c) => c.kind === 'CONTAINER' && /bundle/i.test(c.charge.name));
        if (!containers.length) {
          errors.push(`"${line.raw}": no ${order.currency} plan offers a Bundle.`);
          return;
        }
        if (containers.length > 1) {
          warnings.push(`"${line.raw}": more than one ${order.currency} plan offers a Bundle - using ${containers[0].planId}.`);
        }
        const container = containers[0];
        select(container.planId, container.charge.id, container.charge.name,
          { quantity: line.quantity, years: line.years, source: line.raw });

        line.subjects.forEach((subject) => {
          const tag = catalogue.find((c) => c.planId === container.planId && c.kind === 'FREE_TAG' && c.charge.name === subject);
          if (!tag) {
            errors.push(`"${line.raw}": ${subject} is not one of the subjects available in the ${container.planName} bundle.`);
            return;
          }
          select(tag.planId, tag.charge.id, tag.charge.name,
            { quantity: line.quantity, years: line.years, source: line.raw });
        });
        return;
      }

      // Ordinary SUBJECTS line - matches a standalone VOLUME charge
      // (Single Subject / Languages / Other Subjects plans). Never priced.
      line.subjects.forEach((subject) => {
        const hit = catalogue.find((c) => c.charge.name === subject && c.kind === 'VOLUME');
        if (!hit) {
          errors.push(`"${line.raw}": ${subject} is not available in the ${order.currency} INTL catalogue.`);
          return;
        }
        select(hit.planId, hit.charge.id, subject,
          { quantity: line.quantity, years: line.years, source: line.raw });
      });
    });

    if (errors.length) return finish(null, '');

    if (mergedCharges.length) {
      console.log('\n=== COHORTS MERGED ONTO ONE LINE (volume pricing is per line) ===');
      [...new Set(mergedCharges)].forEach((c) => console.log('  - ' + c));
    }

    // ---- Build the line items -------------------------------------------
    // Every charge is quantity-only here - there is no pricing pass at all,
    // since nothing in this catalogue is ever rep-priced. Subskribe resolves
    // every active charge's price from its own quantity-tier table.
    const fullPlanById = {};
    plans.forEach((p) => { fullPlanById[p.id] = p; });

    const lineItems = [];
    const summaryRows = [];

    const subscriptionChargeIds = new Set();
    if (order.renewalForSubscriptionId) {
      try {
        const subRes = await axios.get(
          `https://api.app.subskribe.com/subscriptions/${encodeURIComponent(order.renewalForSubscriptionId)}`,
          { headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-API-Key': apiKey, 'X-Entity-Id': ENTITY_ID } }
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

    [...touchedPlans].forEach((planId) => {
      const plan = fullPlanById[planId];
      const chosen = selections[planId] || {};
      let selected = 0;
      let emitted = 0;

      (plan.charges || []).forEach((charge) => {
        emitted += 1;
        const pick = chosen[charge.id];
        const active = Boolean(pick);
        const isRenewable = charge.isRenewable !== false;

        const inSubscription = subscriptionChargeIds.has(charge.id);
        const action = inSubscription && isRenewable ? 'RENEWAL' : 'ADD';

        const item = {
          action,
          planId: plan.id,
          chargeId: charge.id,
          quantity: active ? pick.quantity : 0,
          effectiveDate: order.startDate,
          endDate: order.endDate,
          discounts: [],
          customFields: []
        };
        // No attributeReferences - nothing in this catalogue is RATE_CARD_LOOKUP.

        if (active) {
          item.customFields = [{
            id: yearsFieldTemplate.id,
            type: yearsFieldTemplate.type,
            name: 'years',
            label: yearsFieldTemplate.label,
            value: pick.years.join('; '),
            selections: pick.years.map(String),
            options: yearsFieldTemplate.options || []
          }];
          selected += 1;
        }

        lineItems.push(item);
      });

      summaryRows.push(`${plan.name} (${plan.id}): ${selected} selected (auto-priced), ${emitted - selected} at qty 0`);
    });

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

    console.log('\n=== PLANS TO BE USED ===');
    summaryRows.forEach((r) => console.log('  ' + r));

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
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json', 'X-API-Key': apiKey, 'X-Entity-Id': ENTITY_ID };
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

    // ---- Save - single pass, no pricing pass needed ------------------------
    const saved = await putOrder(lineItems, DRY_RUN, DRY_RUN ? 'DRY RUN' : 'SAVE');
    if (!saved.ok) {
      errors.push(`Subskribe rejected the order (${saved.message})`);
      return finish(false, '');
    }
    if (DRY_RUN) {
      return finish(false, `Dry run accepted: ${lineItems.length} line items across ${touchedPlans.size} plan(s).`);
    }

    let result;
    try { result = await readOrder(); } catch (e) { warnings.push(`Saved, but could not read the order back to verify: ${e.message}`); result = {}; }
    const returned = (result && result.lineItems) || [];

    console.log(`\nSAVED. Order ${result.id || order.id} is now DRAFT with the rebuilt plans.`);
    if (warnings.length) { console.log('\n=== WARNINGS ==='); warnings.forEach((w) => console.log('  ! ' + w)); }

    const summary = `${returned.length} line items across ${touchedPlans.size} plan(s), total ${result.currency || order.currency} $${result.totalAmount}` +
      (mergedCharges.length ? `, ${[...new Set(mergedCharges)].length} charge(s) merged across cohorts` : '');
    finish(true, summary);
  } catch (error) {
    const status = error.response && error.response.status;
    console.error('Failed:', status || '', error.message);
    if (error.response) console.error('Response:', JSON.stringify(error.response.data).slice(0, 500));
    errors.push(`Failed: ${status || ''} ${error.message}`);
    finish(null, '');
  }
};
