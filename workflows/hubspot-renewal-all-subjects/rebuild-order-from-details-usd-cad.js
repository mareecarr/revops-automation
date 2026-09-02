/**
 * Renewal order automation - DOMESTIC USD/CAD BRANCH.
 * HubSpot custom-coded action.
 *
 * This replaces the earlier step5-update-order-intl.js, which mixed two
 * unrelated jobs into one script. It's been split in two:
 *   - THIS script: domestic-style USD/CAD Core/Other Subjects & All
 *     Subjects/All Products plans - a real per-subject rate card
 *     (RATE_CARD_LOOKUP) with Tier + Sector, same mechanism as AUD/NZD.
 *   - step5-update-order-international-team.js: the "{CUR} INTL ..." plan
 *     family (Single Subject / Languages / 3-Subject Bundle / Other
 *     Subjects) - currency-agnostic, routed to by the international sales
 *     TEAM rather than by currency (AUD, NZD, CAD, USD, EUR, GBP and AED
 *     orders can all go through it). Domestic USD/CAD orders being worked by
 *     the international team should use that action, not this one.
 *
 * This script only handles USD and CAD, since those are the only two
 * currencies with a domestic-style plan in the catalogue - EUR/GBP/AED only
 * have the INTL family, which lives in the other script.
 *
 * CONFIRMED (from exported rate card settings): the domestic RATE_CARD_LOOKUP
 * charges (USD "Core Subjects", CAD "All Subjects") require a Tier + Sector
 * price-table lookup, same mechanism as AUD/NZD - just different values:
 *   Tiers   - Core, Plus (no "Starter" seen on either exported rate card)
 *   Sectors - Independent, Government / Faith, and a "District" sector
 *             (plain "District" for USD, "District (Canada)" for CAD)
 *
 * KNOWN GAP - STILL NEEDS LIVE-ORDER VERIFICATION: this script assumes the
 * attribute DEFINITION IDs (ATTR_TIER/ATTR_SECTOR below) are the same
 * entity-wide ones already confirmed for AUD/NZD. The exported CSVs show the
 * values, not the underlying attribute IDs. If Pass 1 fails with a price
 * attribution error, that's the signal a different attribute ID is in play
 * here and needs to be read off a real order line item.
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

const DOMESTIC_CURRENCIES = ['USD', 'CAD'];

// Attribute definitions - assumed to be the same entity-wide Tier/Sector
// attributes already confirmed for AUD/NZD. See the KNOWN GAP note above.
const ATTR_TIER = 'PATTRB-817VQ5E';
const ATTR_SECTOR = 'PATTRB-8VPMPZZ';

// Only Core/Plus have been seen on the exported domestic rate cards (no
// Starter tier). Unselected charges on a touched plan default to Core, same
// as AUD/NZD.
const TIERS = ['Core', 'Plus'];

// The "District" sector is spelled differently per currency on the exported
// rate cards - plain "District" for USD, "District (Canada)" for CAD.
const DISTRICT_SECTOR_BY_CURRENCY = { USD: 'District', CAD: 'District (Canada)' };

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ============================================================================
// PARSER
// ============================================================================
// Union of every subject name seen on USD/CAD's domestic plans.
const SUBJECT_NAMES = ['English', 'Maths', 'Math', 'Science', 'Languages', 'Humanities', 'EAL', 'EAL/ESOL', 'French', 'Indigenous Languages'];

// "Maths" and "Math" are the same subject, spelled differently on CAD's
// plans ("Math") vs USD ("Maths") - both resolve to whichever literal name
// this order's currency actually has, the same way Humanities/Social
// Sciences is handled in the AUD/NZD script.
const MATHS_ALIASES = ['Maths', 'Math', 'Mathematics', 'Mat'];
const SUBJECT_ALIASES = {
  Eng: 'English',
  Sci: 'Science',
  Langs: 'Languages', Lang: 'Languages', Langauges: 'Languages',
  ESOL: 'EAL', EALD: 'EAL'
};

function parseOrderDetailsDomestic(orderDetails, currency) {
  const errors = [];
  const warnings = [];

  const mathsCanonical = currency === 'CAD' ? 'Math' : 'Maths';

  const districtCanonical = DISTRICT_SECTOR_BY_CURRENCY[currency] || 'District';
  const SECTOR_ALIASES = [
    ['Government / Faith', ['government / faith', 'government/faith', 'government', 'govt', 'gov', 'state', 'faith', 'religious']],
    [districtCanonical, ['district (canada)', 'district canada', 'district', 'dist']],
    ['Independent', ['independent', 'indep', 'ind']]
  ];

  const normaliseSubject = (raw, lineErrors) => {
    const cleaned = String(raw).trim().replace(/\s+/g, ' ');
    if (!cleaned) return null;
    if (MATHS_ALIASES.some((a) => a.toLowerCase() === cleaned.toLowerCase())) return mathsCanonical;
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

  const stripTrailingModifiers = (text) => {
    let remaining = text;
    let price = null;
    let sector = null;
    let tier = null;
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
      if (tier === null) {
        const tierMatch = remaining.match(new RegExp(`\\b(${TIERS.join('|')})\\s*$`, 'i'));
        if (tierMatch) {
          tier = TIERS.find((t) => t.toLowerCase() === tierMatch[1].toLowerCase());
          remaining = remaining.slice(0, tierMatch.index).trim();
          changed = true;
          continue;
        }
      }
    }
    return { remaining: remaining.replace(/[,\s]+$/, '').trim(), price, sector, tier };
  };

  const lines = [];
  rawLines.forEach((raw) => {
    const lineErrors = [];
    if (/teacher access/i.test(raw)) {
      lines.push({ raw, type: 'TEACHER_ACCESS' });
      return;
    }
    const { remaining, price, sector, tier } = stripTrailingModifiers(raw);
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

    let subjects = null;
    if (!subjectSpec) {
      lineErrors.push('no subjects listed');
    } else {
      subjects = subjectSpec
        .split(/\s*,\s*|\s+(?:and|&)\s+/i)
        .map((s) => normaliseSubject(s, lineErrors))
        .filter(Boolean);
      if (!subjects.length) lineErrors.push('no recognisable subjects');
      if (subjects.length > 1) {
        warnings.push(`Line "${raw}" lists ${subjects.length} subjects - each will be priced at $${price} per student.`);
      }
    }

    if (lineErrors.length) {
      errors.push(`"${raw}" -> ${lineErrors.join('; ')}`);
      return;
    }

    lines.push({
      raw, type: 'SUBJECTS',
      quantity, grading, years, specialYears: special, subjects,
      tier: tier || 'Core', sector: sector || null, bundlePrice: price
    });
  });

  return { lines, errors, warnings };
}

// ============================================================================
// CATALOGUE
// ============================================================================
const DOMESTIC_PLAN_RE = /^(20\d{2})\s+([A-Za-z]+)\s+(\d{1,2})-(\d{1,2})\s+(Core Subjects|Other Subjects|All Products|All Subjects)\s*$/i;

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

function buildCatalogue(plans, warnings) {
  const bands = {};
  plans.forEach((plan) => {
    const m = String(plan.name || '').match(DOMESTIC_PLAN_RE);
    if (!m) return;
    const [, year, , fromStr, toStr, kindRaw] = m;
    const key = `${fromStr}-${toStr}`;
    const kind = /core/i.test(kindRaw) ? 'core' : /other/i.test(kindRaw) ? 'other' : 'all';
    bands[key] = bands[key] || { key, from: Number(fromStr), to: Number(toStr), plans: {} };
    const existing = bands[key].plans[kind];
    if (!existing || Number(year) > existing.year) {
      bands[key].plans[kind] = { year: Number(year), plan };
    }
  });

  Object.values(bands).forEach((band) => {
    const years = Object.values(band.plans).map((p) => p.year);
    if (new Set(years).size > 1) {
      warnings.push(`Band ${band.key} mixes contract years (${years.join(', ')}) - newest of each type used.`);
    }
  });

  return Object.values(bands).sort((a, b) => a.from - b.from);
}

const chargesOf = (band) =>
  Object.values(band.plans).flatMap(({ plan }) =>
    (plan.charges || []).map((c) => ({ planId: plan.id, planName: plan.name, charge: c }))
  );

// A line item is identified by its plan, its charge AND its year groups. The
// first two are not enough: a plan band is wider than a year level, so one
// charge can carry several cohorts on the same order (see select() below),
// and each cohort has its own rate card base, target price and saved line.
const yearsValueOf = (item) => {
  const field = (item.customFields || []).find((c) => c.name === 'years');
  return (field && field.value) || '';
};
const lineKeyOf = (item) => `${item.planId}|${item.chargeId}|${yearsValueOf(item)}`;

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
    if (order.currency && !DOMESTIC_CURRENCIES.includes(order.currency)) {
      errors.push(`Order currency is ${order.currency} - this action only handles ${DOMESTIC_CURRENCIES.join('/')}.`);
    }
    if (errors.length) return finish(null, '');

    // ---- Parse -------------------------------------------------------------
    const parsed = parseOrderDetailsDomestic(orderDetails, order.currency);
    parsed.errors.forEach((e) => errors.push(e));
    parsed.warnings.forEach((w) => warnings.push(w));
    const directives = parsed.lines.filter((l) => l.type !== 'TEACHER_ACCESS');
    console.log(`Parsed ${directives.length} directive(s) from order_details.`);
    if (!directives.length) { errors.push('Nothing to build - no usable lines in Order Details.'); return finish(null, ''); }

    // Sector to fall back on when a rep omits it.
    const existingSectors = [...new Set((order.lineItems || [])
      .flatMap((li) => (li.attributeReferences || []).filter((a) => a.attributeDefinitionId === ATTR_SECTOR).map((a) => a.attributeValue)))];
    const inheritedSector = existingSectors.length === 1 ? existingSectors[0] : null;
    if (existingSectors.length > 1) warnings.push(`Existing order mixes sectors (${existingSectors.join(', ')}) - a sector must be stated on every line.`);

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

    // ---- Catalogue -------------------------------------------------------
    const plans = await fetchActivePlans(apiKey, order.currency);
    const catalogue = buildCatalogue(plans, warnings);
    console.log(`Catalogue for ${order.currency}: ` + catalogue.map((b) =>
      `${b.key}[${Object.entries(b.plans).map(([k, v]) => `${k} ${v.year}`).join(' ')}]`).join(' '));
    if (!catalogue.length) { errors.push(`No ACTIVE ${order.currency} Core/Other/All Products plans found.`); return finish(null, ''); }
    if (errors.length) return finish(null, '');

    // ---- Resolve ---------------------------------------------------------
    // selections[planId][chargeId] = [{ quantity, price, years, tier, sector, source }, ...]
    //
    // One charge can be selected more than once, and that is not a mistake: a
    // plan band spans several year groups, so two lines that describe
    // different cohorts of the same subject land on the same charge of the
    // same plan -
    //
    //   120 Y6-8 English Core District $32
    //   90 Y9-12 English Plus District $28
    //
    // Each selection becomes its own order line with its own quantity, price
    // and Year Groups, exactly as a rep would build it by hand. Only a real
    // double-booking - the same charge claimed twice for the SAME year group -
    // is a conflict, because then there is no way to know which quantity and
    // price was meant.
    const selections = {};
    const touchedPlans = new Set();

    const select = (planId, chargeId, chargeName, data) => {
      selections[planId] = selections[planId] || {};
      const picks = selections[planId][chargeId] || (selections[planId][chargeId] = []);
      const clash = picks.find((p) => p.years.some((y) => data.years.includes(y)));
      if (clash) {
        const overlap = clash.years.filter((y) => data.years.includes(y));
        errors.push(`Conflict: ${chargeName} in ${planId} is set for year ${overlap.join(', ')} by both "${clash.source}" and "${data.source}". Split these onto lines that don't overlap.`);
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
      if (line.specialYears.length) {
        warnings.push(`"${line.raw}" mentions ${line.specialYears.join(', ')} - these are not mapped to a plan band and were skipped.`);
      }

      const covered = [];
      catalogue.forEach((band) => {
        const overlap = line.years.filter((y) => y >= band.from && y <= band.to);
        if (!overlap.length) return;
        covered.push(...overlap);

        const available = chargesOf(band);
        line.subjects.forEach((subject) => {
          const hit = available.find((c) => c.charge.name === subject);
          if (!hit) {
            errors.push(`"${line.raw}": ${subject} is not available in the ${band.key} band.`);
            return;
          }
          select(hit.planId, hit.charge.id, subject,
            { quantity: line.quantity, price: line.bundlePrice, years: overlap, tier: line.tier, sector, source: line.raw });
        });
      });

      const uncovered = line.years.filter((y) => !covered.includes(y));
      if (uncovered.length) {
        errors.push(`"${line.raw}": no ${order.currency} plan band covers year(s) ${uncovered.join(', ')}.`);
      }
    });

    if (errors.length) return finish(null, '');

    // ---- Build the line items -------------------------------------------
    const planById = {};
    catalogue.forEach((b) => Object.values(b.plans).forEach(({ plan }) => (planById[plan.id] = plan)));

    const lineItems = [];
    const summaryRows = [];
    const splitCharges = [];
    const targetPrices = {}; // lineKeyOf(item) -> the price we want per unit

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

    // The year groups each charge is sold to today. Used to decide which of
    // several cohorts of one charge continues the subscription's charge: one
    // subscription charge can only be renewed once, so the cohort closest to
    // what is already sold takes RENEWAL and the rest are additions.
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

    [...touchedPlans].forEach((planId) => {
      const plan = planById[planId];
      const chosen = selections[planId] || {};
      const anyChoice = Object.values(chosen).reduce((found, picks) => found || picks[0], null);
      let priced = 0;
      let zeroPriced = 0;
      let qtyZero = 0;

      (plan.charges || []).forEach((charge) => {
        const isRateCard = charge.chargeModel === 'RATE_CARD_LOOKUP';
        const isRenewable = charge.isRenewable !== false;
        const picks = isRateCard ? (chosen[charge.id] || []) : [];

        if (picks.length > 1) {
          splitCharges.push(`${charge.name} in ${plan.name}: ${picks.map((p) => `Yr ${p.years.join(',')} x${p.quantity} @ $${p.price}`).join(' + ')}`);
        }

        // RENEWAL is only legal when the charge is already in the subscription
        // AND the charge itself is renewable. Everything else is an addition -
        // including the second and later cohorts of a charge, since the one
        // subscription charge underneath them can only be renewed once.
        const inSubscription = subscriptionChargeIds.has(charge.id);
        const renewalIndex = inSubscription && isRenewable ? renewalPickIndex(charge.id, picks) : -1;

        const emit = (pick, index) => {
          const tier = pick ? pick.tier : 'Core';
          const sector = (pick || anyChoice).sector;

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

          if (isRateCard) {
            item.attributeReferences = [
              { attributeDefinitionId: ATTR_TIER, attributeValue: tier },
              { attributeDefinitionId: ATTR_SECTOR, attributeValue: sector }
            ];
          }

          if (pick) {
            item.customFields = [{
              id: yearsFieldTemplate.id,
              type: yearsFieldTemplate.type,
              name: 'years',
              label: yearsFieldTemplate.label,
              value: pick.years.join('; '),
              selections: pick.years.map(String),
              options: yearsFieldTemplate.options || []
            }];
            // Keyed by plan + charge + year groups, so two cohorts of one
            // charge keep their own target price.
            if (pick.price !== null && pick.price !== undefined) {
              targetPrices[lineKeyOf(item)] = pick.price;
            }
            if (pick.price) priced += 1; else zeroPriced += 1;
          } else {
            qtyZero += 1;
          }

          lineItems.push(item);
        };

        if (!picks.length) emit(null, 0);
        else picks.forEach(emit);
      });

      summaryRows.push(`${plan.name} (${plan.id}): ${priced} priced, ${zeroPriced} at $0, ${qtyZero} at qty 0`);
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

    if (splitCharges.length) {
      console.log('\n=== CHARGES SOLD TO MORE THAN ONE COHORT (one line each) ===');
      splitCharges.forEach((c) => console.log('  - ' + c));
    }

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

    // ---- Pass 1: structure only --------------------------------------------
    const pass1 = await putOrder(lineItems, DRY_RUN, DRY_RUN ? 'DRY RUN' : 'PASS 1 of 2, structure');
    if (!pass1.ok) {
      errors.push(`Subskribe rejected the order (${pass1.message})`);
      return finish(false, '');
    }
    if (DRY_RUN) {
      return finish(false, `Dry run accepted: ${lineItems.length} line items across ${touchedPlans.size} plan(s).`);
    }

    // ---- Pass 2: apply prices as discount/override off the rate card -------
    let priced1;
    try {
      priced1 = await readOrder();
    } catch (e) {
      errors.push(`Saved the structure but could not read the order back: ${e.message}`);
      return finish(true, '');
    }

    // Bases are looked up by plan + charge + year groups, so each cohort of a
    // split charge gets its own base. The plan+charge fallback covers a line
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

    const PERCENT_DECIMALS = 10;
    const roundPercent = (r) => Math.round(r * 10 ** PERCENT_DECIMALS) / 10 ** PERCENT_DECIMALS;
    const RATIO_DECIMALS = 6;
    const roundRatio = (r) => Math.round(r * 10 ** RATIO_DECIMALS) / 10 ** RATIO_DECIMALS;

    const unpriceable = [];
    const pass2Items = lineItems.map((li) => {
      const want = targetPrices[lineKeyOf(li)];
      if (want === undefined) return li;

      const base = baseFor(li);
      if (base === undefined) { unpriceable.push(`${li.chargeId} (wanted $${want}, base unknown)`); return li; }
      if (base === 0) return li;

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
      errors.push(`Structure saved, but the price override was rejected (${pass2.message}). The order is on the right plans but at rate card prices.`);
      return finish(true, '');
    }

    let result;
    try { result = await readOrder(); } catch (e) { warnings.push(`Saved, but could not read the order back to verify: ${e.message}`); result = {}; }
    const returned = (result && result.lineItems) || [];

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

    console.log(`\nSAVED. Order ${result.id || order.id} is now DRAFT with the rebuilt plans.`);
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
