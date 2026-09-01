/**
 * Renewal "All Subjects" automation — THE COMPLETE ACTION.
 * HubSpot custom-coded action.
 *
 * Reads the rep's free text from order_details, finds the deal's renewal order
 * in Subskribe, throws away its existing plans, and rebuilds it from the newest
 * ACTIVE year-band plans with the stated quantity, year groups, tier, sector and
 * price. The order is left in DRAFT for the rep to review and execute.
 *
 *   >>> DRY_RUN = true   sends the real payload with ?isDryRun=true, so
 *                        Subskribe validates and prices it but saves nothing.
 *   >>> DRY_RUN = false  saves the rebuilt order.
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

// Charges named here are carried at quantity 0, even inside an All Subjects
// bundle. They stay on the order so the rep can fill them in by hand.
const EXCLUDED_CHARGES = ['Decode'];

// Subskribe requires EVERY charge of a plan to appear on the order ("charges
// CHRG-x from plan id PLAN-y are missing in order"), but only allows tier/sector
// price attribution on RATE_CARD_LOOKUP charges ("Price attribution at order
// line is allowed with ... charge model rate card lookup"). So charges priced
// another way - e.g. the one-time PER_UNIT "Decode Teacher PD" fee - are
// included at quantity 0 with no attributeReferences.
const RATE_CARD_MODEL = 'RATE_CARD_LOOKUP';

// Attribute definitions, confirmed against a live paid order in Step 3.
const ATTR_TIER = 'PATTRB-817VQ5E';
const ATTR_SECTOR = 'PATTRB-8VPMPZZ';

// "Humanities" (AUD) and "Social Sciences" (NZD) are the same core-subject
// slot, just named differently per currency in Subskribe's actual charge
// names - both are listed here so either literal name resolves to a valid,
// chargeable subject. See HUMANITIES_ALIASES_BY_CURRENCY below for how a
// rep's shorthand ("Hums", "SOSE", "Social Sciences", ...) is mapped to
// whichever one actually exists on the order's currency.
const CORE_SUBJECTS = ['English', 'Maths', 'Languages', 'Science', 'Humanities', 'Social Sciences'];
// AO Histories and Decode are NZ-only Other Subjects charges (no AUD
// equivalent). They're recognised subjects a rep can order on their own
// line, same as any other subject, but - per business decision - are NOT
// among the freebies bundled into an All Subjects/EP Essentials order.
const OTHER_SUBJECTS = ['EAL', 'PDHPE', 'Arts', 'Technology', 'Religious Education', 'AO Histories', 'Decode'];
const ALL_SUBJECT_NAMES = [...CORE_SUBJECTS, ...OTHER_SUBJECTS];

// Other-subject charges that come along for free (qty/years, $0) when a rep
// enters an All Subjects bundle. EAL, AO Histories and Decode are
// deliberately left out - they're still recognised subjects a rep can order
// on their own line, they're just not freebies bundled into All Subjects.
const ALL_SUBJECTS_FREE_OTHER_SUBJECTS = OTHER_SUBJECTS.filter((s) => !['EAL', 'AO Histories', 'Decode'].includes(s));

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ============================================================================
// PARSER (identical logic to Step 2)
// ============================================================================
function parseOrderDetails(orderDetails, currency) {
  const errors = [];
  const warnings = [];

  // "Humanities" and "Social Sciences" are the same subject slot, named
  // differently per currency (AUD plans carry a "Humanities" charge, NZD
  // plans carry a "Social Sciences" charge). Whichever term a rep types -
  // the full name or a shorthand - resolves to whichever one actually
  // exists on this order's currency, not a fixed literal.
  const HUMANITIES_BY_CURRENCY = { AUD: 'Humanities', NZD: 'Social Sciences' };
  const humanitiesCanonical = HUMANITIES_BY_CURRENCY[currency] || 'Humanities';

  const SUBJECT_ALIASES = {
    Eng: 'English', Math: 'Maths', Mat: 'Maths', Maths: 'Maths', Mathematics: 'Maths',
    Sci: 'Science', Langs: 'Languages', Lang: 'Languages', Langauges: 'Languages',
    Humanities: humanitiesCanonical, Hums: humanitiesCanonical, SOSE: humanitiesCanonical, Soc: humanitiesCanonical,
    'Social Sciences': humanitiesCanonical, 'Social Science': humanitiesCanonical,
    ESOL: 'EAL', EALD: 'EAL', Tech: 'Technology', Digitech: 'Technology',
    'Digital Technology': 'Technology', 'Digital Technologies': 'Technology', 'Digi Tech': 'Technology',
    Art: 'Arts', Drama: 'Arts', Music: 'Arts',
    HPE: 'PDHPE', Health: 'PDHPE', 'Health & PE': 'PDHPE', PD: 'PDHPE',
    RE: 'Religious Education', Religion: 'Religious Education'
  };

  // The generic government-sector aliases ("gov", "government", "state", ...)
  // resolve to a different canonical value depending on the order's
  // currency - AUD deals use the "> 930" threshold, NZD deals use "< 495".
  // A rep can still type the exact threshold explicitly on either currency.
  const GOV_SECTOR_BY_CURRENCY = { AUD: 'Gov > 930', NZD: 'Gov < 495' };
  const govCanonical = GOV_SECTOR_BY_CURRENCY[currency] || 'Gov > 930';
  const SECTOR_ALIASES = [
    ['Equitable Access', ['equitable access', 'equitable', 'ea']],
    ['Gov > 930', ['gov > 930', 'gov>930', 'gov 930']],
    ['Gov < 495', ['gov < 495', 'gov<495', 'gov 495']],
    [govCanonical, ['government', 'govt', 'gov', 'state']],
    ['Catholic', ['catholic', 'cath']],
    ['Independent', ['independent', 'indep', 'ind']]
  ];

  const TIERS = ['Core', 'Starter', 'Plus'];
  const ALL_SUBJECTS_RE = /\ball\s+subjects?\b|\bep\s+essentials\b/i;
  const LEGACY_BUNDLE_RE = /\bfull\s*school(\s*solution)?\b|\bfss\b|\bwhole\s*school\b/i;

  // Line items can be chained with a comma, "and", or "&", or put on separate
  // lines - the same three options as the trial automation. The lookahead
  // (a new quantity immediately followed by a year word) is what makes this
  // safe: it only splits at a genuine new line item, not at a comma or "and"
  // joining subjects ("English and Science") or years ("9 and 11") within one.
  // A new line item is recognised wherever a quantity is immediately followed
  // by a year word - whether that's after a real line break, a comma, "and",
  // "&", or (as a safety net) nothing at all. That last case matters because
  // some ways of entering text into HubSpot's Order Details field silently
  // collapse real line breaks into a single space, which previously caused
  // two separate lines to be read as one - e.g. an "All Subjects" line
  // swallowing a second line's text and using ITS trailing price instead of
  // its own.
  // The separator itself is a comma/"and"/"&", OR just plain whitespace as a
  // fallback - but that fallback whitespace must be genuinely present (not
  // zero-width), otherwise the lookahead can trigger mid-number (e.g.
  // splitting "200" into "2" and "00 Year...") since digits are followed by
  // more digits that could themselves look like the start of a run ending in
  // a year word. Requiring an actual space anchors every split to a real
  // token boundary.
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

  const normaliseSubject = (raw, lineErrors) => {
    const cleaned = String(raw).trim().replace(/\s+/g, ' ');
    if (!cleaned) return null;
    // Alias lookup runs first, not after the exact-name check, because
    // "Humanities" and "Social Sciences" are both literal, valid subject
    // names (ALL_SUBJECT_NAMES has both) AND both keys in SUBJECT_ALIASES -
    // the alias table is what routes either spelling to whichever one
    // actually exists on this order's currency, so it must win over a
    // same-currency-agnostic exact match.
    const aliasKey = Object.keys(SUBJECT_ALIASES).find((k) => k.toLowerCase() === cleaned.toLowerCase());
    if (aliasKey) return SUBJECT_ALIASES[aliasKey];
    const exact = ALL_SUBJECT_NAMES.find((s) => s.toLowerCase() === cleaned.toLowerCase());
    if (exact) return exact;
    lineErrors.push(`unknown subject "${cleaned}"`);
    return null;
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

    const isAllSubjects = ALL_SUBJECTS_RE.test(subjectSpec);
    let subjects = null;

    if (isAllSubjects) {
      if (price === null) lineErrors.push('an All Subjects line needs a price, e.g. $50.00');
    } else if (LEGACY_BUNDLE_RE.test(subjectSpec)) {
      lineErrors.push('use "All Subjects" for a whole-school bundle');
    } else if (!subjectSpec) {
      lineErrors.push('no subjects listed, and not marked as All Subjects');
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
      raw, type: isAllSubjects ? 'ALL_SUBJECTS' : 'SUBJECTS',
      quantity, grading, years, specialYears: special, subjects,
      tier: tier || 'Core', sector: sector || null, bundlePrice: price
    });
  });

  return { lines, errors, warnings };
}

// ============================================================================
// CATALOGUE
// ============================================================================
const PLAN_NAME_RE = /^(20\d{2})\s+([A-Za-z]+)\s+(\d{1,2})-(\d{1,2})\s+(Core Subjects|Other Subjects|All Products|All Subjects)\s*$/i;

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
 * Groups plans into year bands, keeping only the newest contract year per band.
 * AU ends up as: 3-6 (All Products), 7-10 (Core + Other), 11-12 (Core + Other).
 */
function buildCatalogue(plans, warnings) {
  const bands = {};
  plans.forEach((plan) => {
    const m = String(plan.name || '').match(PLAN_NAME_RE);
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
// first two are not enough: one charge can carry several cohorts on the same
// order (see the note on select() below), and each cohort has its own rate
// card base, its own target price and its own saved line.
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
    // Fetched before parsing so the sector aliasing (Gov > 930 for AUD vs
    // Gov < 495 for NZD) knows which currency it's resolving against.
    const orderRes = await axios.get(`https://api.app.subskribe.com/orders/${encodeURIComponent(orderId)}`, {
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-API-Key': apiKey, 'X-Entity-Id': ENTITY_ID }
    });
    const order = orderRes.data;
    console.log(`Order ${order.id}: ${order.status} ${order.orderType} ${order.currency}, ${(order.lineItems || []).length} existing line item(s).`);

    if (order.status !== 'DRAFT') errors.push(`Order status is ${order.status}, not DRAFT - cannot rebuild.`);
    if (!order.currency) errors.push('Order has no currency.');
    if (errors.length) return finish(null, '');

    // ---- Parse -----------------------------------------------------------
    const parsed = parseOrderDetails(orderDetails, order.currency);
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

    // The years picklist definition, preferably taken from the order itself so
    // the option list always matches the tenant. Falls back to the known
    // definition when the order has no line items to copy it from.
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
    // plan band spans several year groups (NZ 11-13, AU 7-10), so two lines
    // that describe different cohorts of the same subject land on the same
    // charge of the same plan -
    //
    //   74 Y11 EP Essentials Plus Independent $115
    //   92 Y12-13 Eng Plus Independent $49
    //
    // both set English in the 11-13 core plan, one for year 11 and one for
    // years 12-13. Each selection becomes its own order line with its own
    // quantity, price and Year Groups, exactly as a rep would build it by
    // hand. Only a real double-booking - the same charge claimed twice for the
    // SAME year group - is a conflict, because then there is no way to know
    // which quantity and price was meant.
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

        if (line.type === 'ALL_SUBJECTS') {
          const core = available.filter((c) => CORE_SUBJECTS.includes(c.charge.name));
          const other = available.filter((c) => ALL_SUBJECTS_FREE_OTHER_SUBJECTS.includes(c.charge.name));
          if (!core.length) {
            errors.push(`Band ${band.key} has no core subject charges.`);
            return;
          }
          const unitPrice = round2(line.bundlePrice / core.length);
          const residual = round2(line.bundlePrice - unitPrice * core.length);
          if (residual !== 0) {
            warnings.push(`Band ${band.key}: $${line.bundlePrice} over ${core.length} core subjects is $${unitPrice} each, leaving $${residual} rounding difference.`);
          }
          core.forEach((c) => select(c.planId, c.charge.id, c.charge.name,
            { quantity: line.quantity, price: unitPrice, years: overlap, tier: line.tier, sector, source: line.raw }));
          other.forEach((c) => select(c.planId, c.charge.id, c.charge.name,
            { quantity: line.quantity, price: 0, years: overlap, tier: line.tier, sector, source: line.raw }));
        } else {
          line.subjects.forEach((subject) => {
            const hit = available.find((c) => c.charge.name === subject);
            if (!hit) {
              errors.push(`"${line.raw}": ${subject} is not available in the ${band.key} band.`);
              return;
            }
            select(hit.planId, hit.charge.id, subject,
              { quantity: line.quantity, price: line.bundlePrice, years: overlap, tier: line.tier, sector, source: line.raw });
          });
        }
      });

      const uncovered = line.years.filter((y) => !covered.includes(y));
      if (uncovered.length) {
        errors.push(`"${line.raw}": no ${order.currency} plan band covers year(s) ${uncovered.join(', ')}.`);
      }
    });

    if (errors.length) return finish(null, '');

    // ---- Build the line items -------------------------------------------
    // Every charge of every plan we touch is emitted; unselected charges come
    // through at quantity 0, exactly as Subskribe does when a plan is added.
    // A charge selected for two cohorts is emitted twice, one line each.
    const planById = {};
    catalogue.forEach((b) => Object.values(b.plans).forEach(({ plan }) => (planById[plan.id] = plan)));

    const lineItems = [];
    const summaryRows = [];
    const unattributedCharges = [];
    const splitCharges = [];
    const renewedCharges = [];
    const targetPrices = {}; // lineKeyOf(item) -> the price we want per unit

    // What the expiring subscription actually contains. Only these charges may
    // carry action RENEWAL; anything else must be an ADD, or Subskribe says
    //   "Renewal charge ids missing in subscription: CHRG-..."
    //
    // This MUST come from the subscription, not from the order's current line
    // items. Once this workflow has written to the order, those line items are
    // its own output, and treating them as the subscription's contents makes the
    // second run mark everything RENEWAL and fail.
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

    // chargeId -> planId, for declaring subscription charges that are dropped.
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
        const isRateCard = charge.chargeModel === RATE_CARD_MODEL;
        const isRenewable = charge.isRenewable !== false;
        const isExcluded = EXCLUDED_CHARGES.includes(charge.name);
        const picks = isRateCard && !isExcluded ? (chosen[charge.id] || []) : [];

        if (!isRateCard || !isRenewable) {
          unattributedCharges.push(
            `${charge.name} (${charge.chargeModel}, ${isRenewable ? 'renewable' : 'non-renewable'}) in ${plan.name}`
          );
        }
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
          // A charge the rep didn't ask for still has to be present on the
          // order (Subskribe requires every charge of a touched plan), but it
          // must NOT just inherit whatever tier a picked line on the same plan
          // happens to use - that tier might not be priced for this particular
          // subject ("... does not match with any of the price table attribute
          // references in rate card ..."). Core is the base tier every subject
          // is expected to have priced, so unselected charges default to that.
          const tier = pick ? pick.tier : 'Core';
          const sector = (pick || anyChoice).sector;
          const action = index === renewalIndex ? 'RENEWAL' : 'ADD';
          if (action === 'RENEWAL') renewedCharges.push(charge.id);

          const item = {
            action,
            planId: plan.id,
            chargeId: charge.id,
            quantity: pick ? pick.quantity : 0,
            effectiveDate: order.startDate,
            endDate: order.endDate,
            discounts: [],
            customFields: []
          };

          // Price attribution is only legal on rate-card charges. Subskribe
          // rejects the whole order if the field is merely PRESENT on a charge
          // priced another way, so it is omitted rather than sent empty.
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
            // The target price is recorded rather than sent. listUnitPrice is
            // ignored on a RATE_CARD_LOOKUP charge - the price has to be applied
            // as a discount off the rate card base, which is only knowable after
            // Subskribe has priced the line. See the two passes below. The key
            // carries the year groups, so two cohorts of one charge keep their
            // own target.
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

    // ----------------------------------------------------------------------
    // Subscription charges the rebuild drops - typically the previous year's
    // plans when a school moves onto the newest ones. They are declared rather
    // than silently omitted, so Subskribe knows they are not being renewed.
    // ----------------------------------------------------------------------
    const droppedCharges = [...subscriptionChargeIds].filter(
      (chargeId) => !lineItems.some((li) => li.chargeId === chargeId)
    );

    droppedCharges.forEach((chargeId) => {
      const planId = planIdByCharge[chargeId];
      if (!planId) {
        warnings.push(`Subscription charge ${chargeId} is being dropped but its plan is unknown, so it was left off the order.`);
        return;
      }
      const old = (order.lineItems || []).find((li) => li.chargeId === chargeId) || {};
      const item = {
        action: 'MISSING_RENEWAL',
        planId,
        chargeId,
        quantity: 0,
        effectiveDate: order.startDate,
        endDate: order.endDate,
        discounts: [],
        customFields: []
      };
      if (old.attributeReferences && old.attributeReferences.length) {
        item.attributeReferences = old.attributeReferences.map((a) => ({
          attributeDefinitionId: a.attributeDefinitionId,
          attributeValue: a.attributeValue
        }));
      }
      lineItems.push(item);
    });

    // ---- Report ----------------------------------------------------------
    console.log('\n=== PLANS TO BE USED ===');
    summaryRows.forEach((r) => console.log('  ' + r));

    if (splitCharges.length) {
      console.log('\n=== CHARGES SOLD TO MORE THAN ONE COHORT (one line each) ===');
      splitCharges.forEach((c) => console.log('  - ' + c));
    }

    console.log('\n=== PRICED LINES ===');
    let contractTotal = 0;
    lineItems.filter((li) => li.quantity > 0).forEach((li) => {
      const plan = planById[li.planId];
      const charge = (plan.charges || []).find((c) => c.id === li.chargeId);
      const years = yearsValueOf(li);
      const target = targetPrices[lineKeyOf(li)];
      const price = target === undefined ? '(rate card)' : '$' + target;
      contractTotal += target === undefined ? 0 : li.quantity * target;
      console.log(`  ${charge.name} | qty ${li.quantity} @ ${price} | Yr ${years} | ${plan.name}`);
    });

    console.log(`\nLine items: ${lineItems.length} (${lineItems.filter((l) => l.quantity > 0).length} with quantity)`);
    console.log(`Expected contract total: $${round2(contractTotal)}`);
    console.log(`Replacing ${(order.lineItems || []).length} existing line item(s).`);

    const actionCounts = lineItems.reduce((acc, li) => {
      acc[li.action] = (acc[li.action] || 0) + 1;
      return acc;
    }, {});
    console.log(`Line actions: ${Object.entries(actionCounts).map(([a, n]) => `${a}=${n}`).join(' ')}`);
    if (droppedCharges.length) {
      console.log(`Not renewed (MISSING_RENEWAL): ${droppedCharges.join(', ')}`);
    }

    if (unattributedCharges.length) {
      console.log('\n=== SPECIAL-CASED CHARGES (qty 0, no tier/sector) ===');
      [...new Set(unattributedCharges)].forEach((c) => console.log('  - ' + c));
    }

    if (warnings.length) {
      console.log('\n=== WARNINGS ===');
      warnings.forEach((w) => console.log('  ! ' + w));
    }

    // ======================================================================
    // BUILD THE ORDER PAYLOAD
    // Whitelisted from the fetched order so nothing on it is silently lost,
    // and nothing read-only (totals, status, opportunity) is sent back.
    // ======================================================================
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
      carryOver.forEach((key) => {
        if (order[key] !== undefined && order[key] !== null) p[key] = order[key];
      });
      return p;
    };

    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
      'X-Entity-Id': ENTITY_ID
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

    // ======================================================================
    // PASS 1 - structure only, no prices
    // Establishes the rate card base for every line, which depends on the tier
    // and sector we send and so cannot be known in advance.
    // ======================================================================
    const pass1 = await putOrder(lineItems, DRY_RUN, DRY_RUN ? 'DRY RUN' : 'PASS 1 of 2, structure');
    if (!pass1.ok) {
      errors.push(`Subskribe rejected the order (${pass1.message})`);
      return finish(false, '');
    }

    if (DRY_RUN) {
      console.log('\nDRY RUN - validated, nothing saved. Prices cannot be checked in a dry');
      console.log('run because the response carries no body. Set DRY_RUN = false to apply.');
      return finish(false,
        `Dry run accepted: ${lineItems.length} line items across ${touchedPlans.size} plan(s), target total $${round2(contractTotal)}`);
    }

    // ======================================================================
    // PASS 2 - apply the prices as a discount off the rate card, not as a
    // list-price override.
    //
    // listUnitPrice is ignored on a RATE_CARD_LOOKUP charge, and overriding it
    // via listPriceOverrideRatio changes the order's LIST price itself - which
    // is wrong: the rate card price should stay visible as the list price, and
    // the reduction to what the rep quoted should show up as a discount, the
    // same way it looks when a human builds this order by hand. So instead of
    // touching listUnitPrice/listPriceOverrideRatio, a `discounts` entry is
    // added: percent = 1 - (wanted / rate card base), amount = the dollar gap
    // over the full quantity. The rate card base is only knowable after
    // Subskribe has priced the line, which is why pass 1 (structure only) ran
    // first.
    // ======================================================================
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

    console.log('\n=== RATE CARD BASES FROM PASS 1 ===');
    const seenBases = {};
    lineItems.forEach((li) => {
      const want = targetPrices[lineKeyOf(li)];
      if (want === undefined) return;
      const base = baseFor(li);
      if (base === undefined) return;
      const label = `$${base} -> $${want}`;
      seenBases[label] = (seenBases[label] || 0) + 1;
    });
    Object.entries(seenBases).forEach(([k, n]) => console.log(`  ${k}  (${n} line${n > 1 ? 's' : ''})`));

    // Subskribe rejected a listPriceOverrideRatio with more than 10 decimal
    // places ("scale ... was 17 but maximum is 10"), so both the discount
    // percent and the override ratio below are rounded well under that limit.
    const PERCENT_DECIMALS = 10;
    const roundPercent = (r) => Math.round(r * 10 ** PERCENT_DECIMALS) / 10 ** PERCENT_DECIMALS;
    const RATIO_DECIMALS = 6;
    const roundRatio = (r) => Math.round(r * 10 ** RATIO_DECIMALS) / 10 ** RATIO_DECIMALS;

    const unpriceable = [];
    const pass2Items = lineItems.map((li) => {
      const want = targetPrices[lineKeyOf(li)];
      if (want === undefined) return li;

      const base = baseFor(li);
      if (base === undefined) {
        unpriceable.push(`${li.chargeId} (wanted $${want}, rate card base unknown)`);
        return li;
      }
      if (base === 0) {
        // Nothing to discount off - it's already $0.
        return li;
      }

      if (want > base) {
        // A price ABOVE the rate card is a real list-price override, not a
        // discount - a discount can only ever reduce a price (0-100%).
        // listUnitPrice itself is ignored by Subskribe on a RATE_CARD_LOOKUP
        // charge, so the override has to go through listPriceOverrideRatio.
        const ratio = roundRatio(want / base);
        const achieved = round2(base * ratio);
        if (achieved !== want) {
          warnings.push(`${li.chargeId}: rounding the override gives $${achieved} instead of $${want} (base $${base}).`);
        }
        return { ...li, listPriceOverrideRatio: ratio, listUnitPrice: want };
      }

      const percent = roundPercent(1 - want / base);
      const listAmount = round2(base * li.quantity);
      const wantAmount = round2(want * li.quantity);
      const discountAmount = round2(listAmount - wantAmount);

      const achieved = round2(base * (1 - percent));
      if (achieved !== want) {
        warnings.push(`${li.chargeId}: rounding the discount gives $${achieved} instead of $${want} (base $${base}).`);
      }

      return {
        ...li,
        discounts: [
          {
            name: 'default',
            percent,
            discountAmount: null,
            status: null,
            discountedPrice: null,
            amount: discountAmount
          }
        ]
      };
    });

    if (unpriceable.length) {
      warnings.push(`Could not set a price on ${unpriceable.length} line(s): ${unpriceable.slice(0, 5).join('; ')}`);
    }

    const pass2 = await putOrder(pass2Items, false, 'PASS 2 of 2, prices');
    if (!pass2.ok) {
      errors.push(`Structure saved, but the price override was rejected (${pass2.message}). The order is on the right plans but at rate card prices.`);
      return finish(true, '');
    }

    // ======================================================================
    // VERIFY WHAT SUBSKRIBE ACTUALLY STORED
    // ======================================================================
    let result;
    try {
      result = await readOrder();
    } catch (e) {
      warnings.push(`Saved, but could not read the order back to verify: ${e.message}`);
      result = {};
    }

    const returned = (result && result.lineItems) || [];
    const gotBody = returned.length > 0;

    console.log(`\n=== SAVED ORDER ===`);
    if (!gotBody) {
      console.log('  Could not read the order back, so prices are unverified.');
    } else {
      console.log(`  status          ${result.status}`);
      console.log(`  line items      ${returned.length}`);
      console.log(`  totalAmount     $${result.totalAmount}`);
      console.log(`  totalListAmount $${result.totalListAmount}`);
    }

    const mismatches = [];
    returned.filter((li) => li.quantity > 0).forEach((li) => {
      const want = targetPrices[lineKeyOf(li)];
      if (want === undefined) return;
      if (round2(li.sellUnitPrice) !== round2(want)) {
        mismatches.push(`${li.chargeId} (Yr ${yearsValueOf(li)}): wanted $${want}, got $${li.sellUnitPrice}`);
      }
    });

    if (gotBody) {
      if (mismatches.length) {
        console.log('\n  PRICE MISMATCHES:');
        mismatches.slice(0, 12).forEach((m) => console.log('    ! ' + m));
        if (mismatches.length > 12) console.log(`    ... and ${mismatches.length - 12} more`);
        warnings.push(`${mismatches.length} line(s) priced differently to the request.`);
      } else {
        console.log('  Every price matches the request.');
      }
      const totalMatches = round2(result.totalAmount) === round2(contractTotal);
      console.log(`  Expected $${round2(contractTotal)} vs saved $${result.totalAmount} - ${totalMatches ? 'MATCH' : 'DIFFERENT'}`);
      if (warnings.length) {
        console.log('\n=== WARNINGS ===');
        warnings.forEach((w) => console.log('  ! ' + w));
      }
    }

    const summary = gotBody
      ? `${returned.length} line items across ${touchedPlans.size} plan(s), total $${result.totalAmount}` +
        (mismatches.length ? `, ${mismatches.length} price mismatch(es)` : '')
      : `Saved ${lineItems.length} line items across ${touchedPlans.size} plan(s), target total $${round2(contractTotal)}`;

    console.log(`\nSAVED. Order ${result.id || order.id} is now DRAFT with the rebuilt plans.`);
    finish(true, summary);
  } catch (error) {
    const status = error.response && error.response.status;
    console.error("Failed:", status || '', error.message);
    if (error.response) console.error('Response:', JSON.stringify(error.response.data).slice(0, 500));
    errors.push(`Failed: ${status || ''} ${error.message}`);
    finish(null, '');
  }
};
