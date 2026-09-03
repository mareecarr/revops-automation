// Fixtures modelled on ORD-YT4NWKB — "2027 Renewal: Encounter Lutheran
// College, South Australia" — and SUB-FDGKQ1P. Both real, and both single
// period. This is the order that produced ORD-3YQB21H at $43,839.19 against
// a $23,706.50 quote.
//
// Two separate faults, both reproduced here:
//
//   1. THE SAME QUOTED LINE PRICED TWO REBUILT LINES. The subscription
//      carries three charges at 211 seats: CHRG-TNG3CZG and CHRG-YDJPWXR at
//      list 25.50 and sell 0 (given away), and CHRG-HW42JYY at sell 90. The
//      quote carries only the paid one, at 94.50 — $19,939.50, most of the
//      order. The fresh draft re-versions the free pair onto PLAN-TG9K5EY as
//      CHRG-Z16B0CQ and CHRG-GHMDQKD, so two draft lines arrive at 211 seats
//      with one quoted line between them. The cohort pass paired the first
//      and handed the second a copy of the same quoted line, so both were
//      billed at 94.50 and neither was zeroed: 19939.50 + 19939.50 + 396.02
//      + 792.04 + 2772.13 = 43839.19, the created total exactly.
//
//      Which of the two renews is a commercial decision — one is Religious
//      Education, the other Arts — so the rebuild refuses rather than guess.
//
//   2. THE API REPRICED THE RECOVERED-ATTRIBUTE LINES. The quote prices
//      CHRG-Y1JWZ9T, CHRG-N9VNCEG and CHRG-4F7PC2M at list 39 / sell 37.67
//      on Catholic + Core. The draft defaults every line to Core +
//      Independent (list 51.50), so the attributes have to be recovered from
//      the quote, which makes the draft's own price base unusable and sends
//      the line down the catalog path: placeholder prices plus the 3.41%
//      discount. Catholic + Core has since moved 39 -> 41, so the API
//      returned 39.60179 rather than 37.67 — invisible in the total, which
//      only moved 0.8%.
//
// The draftRenewal payload is reconstructed from ORD-3YQB21H's own line
// items, which carry the plan ids, charge ids, replaced plans, attributes
// and catalog prices the draft supplied.

const RENEWAL_START = 1798714800;
const RENEWAL_END = 1830250800;
const SUB_START = 1767178800;

const YEAR_OPTIONS = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13',
  'Staff', 'P/F/K', 'Platform Access', 'Implementation Fee',
  'All Year Groups (EdPotential)', 'Tertiary'
];

const TIER = 'PATTRB-817VQ5E';   // Core / Plus
const SECTOR = 'PATTRB-8VPMPZZ'; // Independent / Catholic / Gov

const attrs = (tier, sector) => (tier == null ? null : [
  { attributeDefinitionId: SECTOR, attributeValue: sector },
  { attributeDefinitionId: TIER, attributeValue: tier }
]);

const yearsField = (id, value) => ({
  id,
  type: 'MULTISELECT_PICKLIST',
  name: 'years',
  label: 'Year Groups',
  value: value === undefined ? null : value,
  selections: value ? value.split(';').map(v => v.trim()).filter(Boolean) : [],
  options: YEAR_OPTIONS,
  required: false,
  source: 'USER',
  defaultValue: null
});

const notesField = (id) => ({
  id,
  type: 'STRING',
  name: 'Notes',
  label: 'Notes',
  value: null,
  selections: [],
  options: [],
  required: false,
  source: 'USER',
  defaultValue: null
});

const orderCustomFields = (years) => [
  notesField('CF-NFH5VBNH'),
  yearsField('CF-NFTKQDH2', years)
];

const chargeCustomFields = (years) => ({
  'CF-B0CZ41JW': notesField(undefined),
  'CF-4EJ2B59D': yearsField(undefined, years)
});

const discountsFor = (list, sell) => (list && sell != null && sell < list)
  ? [{
    name: 'default',
    percent: 1 - (sell / list),
    discountAmount: null,
    status: null,
    discountedPrice: null
  }]
  : [];

// uuid, chargeId, qty, list, sell, tier, sector, years
const SUBSCRIPTION_CHARGES = [
  ['238bbf58-8a0a-4a84-89e5-48004847524d', 'CHRG-TNG3CZG', 211, 25.5, 0, 'Core', 'Independent', '7; 8; 9'],
  ['61d70ed4-0000-4000-8000-000000000001', 'CHRG-YDJPWXR', 211, 25.5, 0, 'Core', 'Independent', '7; 8; 9'],
  ['193f73bd-0000-4000-8000-000000000002', 'CHRG-HW42JYY', 211, 114.5, 90, null, null, '7; 8; 9'],
  ['0d13a8b8-0000-4000-8000-000000000003', 'CHRG-Y1JWZ9T', 10, 39, 35.88, 'Core', 'Catholic', '11; 12'],
  ['d3c12c4d-0000-4000-8000-000000000004', 'CHRG-N9VNCEG', 20, 39, 35.88, 'Core', 'Catholic', '10'],
  ['a596bf8a-0000-4000-8000-000000000005', 'CHRG-4F7PC2M', 70, 39, 35.88, 'Core', 'Catholic', '10'],
  ['08feeb69-0000-4000-8000-000000000006', 'CHRG-5DRR6YH', 0, 49, 49, 'Core', 'Independent', null],
  ['b5c96c38-0000-4000-8000-000000000007', 'CHRG-ZYHZ5BH', 0, 49, 49, 'Core', 'Independent', null],
  ['0e416ead-0000-4000-8000-000000000008', 'CHRG-1ZCF3J6', 0, 49, 49, 'Core', 'Independent', null],
  ['1bc04ec3-0000-4000-8000-000000000009', 'CHRG-1CM34Z2', 0, 49, 49, 'Core', 'Independent', null],
  ['3b1a1609-0000-4000-8000-00000000000a', 'CHRG-99QCRB7', 0, 49, 49, 'Core', 'Independent', null],
  ['f3b1e84a-0000-4000-8000-00000000000b', 'CHRG-ZHFTN4X', 0, 49, 49, 'Core', 'Independent', null],
  ['f9cdf548-0000-4000-8000-00000000000c', 'CHRG-4091V3F', 0, 49, 49, 'Core', 'Independent', null],
  ['b8e4dfbd-0000-4000-8000-00000000000d', 'CHRG-C4MB46Z', 0, 15, 15, null, null, null],
  ['b1102cda-0000-4000-8000-00000000000e', 'CHRG-RTC7YRP', 0, 25.5, 25.5, 'Core', 'Independent', null]
];

const buildSubscription = () => ({
  id: 'SUB-FDGKQ1P',
  version: 2,
  entityId: 'ENT-MNJ0N5D',
  accountId: 'ACCT-14WGE4W',
  shippingContactId: 'CONT-GY06MXF',
  billingContactId: 'CONT-GY06MXF',
  state: 'ACTIVE',
  startDate: SUB_START,
  endDate: RENEWAL_START,
  billingCycle: { cycle: 'YEAR', step: 1 },
  paymentTerm: 'NET14',
  billingTerm: 'UP_FRONT',
  autoRenew: true,
  charges: SUBSCRIPTION_CHARGES.map(
    ([id, chargeId, quantity, list, sell, tier, sector, years], index) => {
      const charge = {
        id,
        groupId: `enc-group-${index + 1}`,
        accountId: 'ACCT-14WGE4W',
        chargeId,
        quantity,
        isRamp: false,
        listUnitPrice: list,
        sellUnitPrice: sell,
        discounts: sell === 0 && list > 0
          ? [{ name: 'default', percent: 1, discountAmount: null, status: null, discountedPrice: null }]
          : discountsFor(list, sell),
        predefinedDiscounts: [],
        startDate: SUB_START,
        endDate: RENEWAL_START,
        customFields: chargeCustomFields(years)
      };
      const references = attrs(tier, sector);
      if (references) charge.attributeReferences = references;
      return charge;
    })
});

// ORD-YT4NWKB as quoted: the paid 211-seat line, three Catholic + Core lines,
// and the catalog placeholders nobody bought. The two free 211-seat charges
// on the subscription are NOT here — that is the whole difficulty.
//
// planId, chargeId, qty, list, sell, tier, sector, years
const QUOTE_LINES = [
  ['PLAN-3PQ1PCG', 'CHRG-Y1JWZ9T', 10, 39, 37.67, 'Core', 'Catholic', '11; 12'],
  ['PLAN-CMJB619', 'CHRG-N9VNCEG', 20, 39, 37.67, 'Core', 'Catholic', '10'],
  ['PLAN-CMJB619', 'CHRG-4F7PC2M', 70, 39, 37.67, 'Core', 'Catholic', '10'],
  ['PLAN-HKMBWJM', 'CHRG-HW42JYY', 211, 105, 94.5, null, null, '7; 8; 9'],
  ['PLAN-3PQ1PCG', 'CHRG-1CM34Z2', 0, 49, 49, 'Core', 'Independent', null],
  ['PLAN-3PQ1PCG', 'CHRG-5DRR6YH', 0, 49, 49, 'Core', 'Independent', null],
  ['PLAN-3PQ1PCG', 'CHRG-ZYHZ5BH', 0, 49, 49, 'Core', 'Independent', null],
  ['PLAN-3PQ1PCG', 'CHRG-1ZCF3J6', 0, 49, 49, 'Core', 'Independent', null],
  ['PLAN-HKMBWJM', 'CHRG-C4MB46Z', 0, 15, 15, null, null, null],
  ['PLAN-CMJB619', 'CHRG-99QCRB7', 0, 49, 49, 'Core', 'Independent', null],
  ['PLAN-CMJB619', 'CHRG-ZHFTN4X', 0, 49, 49, 'Core', 'Independent', null],
  ['PLAN-CMJB619', 'CHRG-4091V3F', 0, 49, 49, 'Core', 'Independent', null]
];

const buildExistingOrder = () => ({
  id: 'ORD-YT4NWKB',
  entityId: 'ENT-MNJ0N5D',
  externalId: '60143666787',
  name: '2027 Renewal: Encounter Lutheran College, South Australia: Lang - Sci - Essentials -',
  accountId: 'ACCT-14WGE4W',
  orderType: 'RENEWAL',
  currency: 'AUD',
  paymentTerm: 'NET14',
  status: 'DRAFT',
  shippingContactId: 'CONT-GY06MXF',
  billingContactId: 'CONT-GY06MXF',
  lineItems: QUOTE_LINES.map(
    ([planId, chargeId, quantity, list, sell, tier, sector, years], index) => {
      const line = {
        id: `enc-quote-${index + 1}`,
        isDryRunItem: false,
        action: 'RENEWAL',
        planId,
        chargeId,
        quantity,
        isRamp: false,
        listUnitPrice: list,
        sellUnitPrice: sell,
        discountAmount: (list - sell) * quantity,
        discounts: discountsFor(list, sell),
        predefinedDiscounts: [],
        amount: sell * quantity,
        listAmount: list * quantity,
        effectiveDate: RENEWAL_START,
        endDate: RENEWAL_END,
        customFields: orderCustomFields(years),
        dryRunItem: false
      };
      const references = attrs(tier, sector);
      if (references) line.attributeReferences = references;
      return line;
    }),
  startDate: RENEWAL_START,
  endDate: RENEWAL_END,
  billingCycle: { cycle: 'YEAR', step: 1 },
  billingTerm: 'UP_FRONT',
  billingAnchorDate: RENEWAL_START,
  totalAmount: 23706.5,
  totalListAmount: 26055,
  sfdcOpportunityId: '60143666787',
  sfdcOpportunityName: '2027 Renewal: Encounter Lutheran College, South Australia: Lang - Sci - Essentials -',
  renewalForSubscriptionId: 'SUB-FDGKQ1P',
  renewalForSubscriptionVersion: 1,
  ownerId: 'USER-J04C7EZ',
  autoRenew: true,
  startDateType: 'FIXED',
  customFields: []
});

// The fresh draft, every plan re-versioned. Attributes are defaulted to
// Core + Independent on every line — including the three the customer holds
// on Catholic — and the charge ids are all new, so nothing matches on
// chargeId and the Catholic lines match only once their attributes have been
// recovered from the quote.
//
// planId, chargeId, replacedPlanId, qty, list
const DRAFT_LINES = [
  ['PLAN-TG9K5EY', 'CHRG-DZCPWQC', 'PLAN-99999WD', 0, 26.75],
  ['PLAN-TG9K5EY', 'CHRG-Z16B0CQ', 'PLAN-99999WD', 211, 26.75],
  ['PLAN-TG9K5EY', 'CHRG-GHMDQKD', 'PLAN-99999WD', 211, 26.75],
  ['PLAN-TG9K5EY', 'CHRG-FJ0TYZK', 'PLAN-99999WD', 0, 26.75],
  ['PLAN-TG9K5EY', 'CHRG-WV85GPQ', 'PLAN-99999WD', 0, 26.75],
  ['PLAN-DCK63P6', 'CHRG-6T5J1FH', 'PLAN-3PQ1PCG', 10, 51.5],
  ['PLAN-DCK63P6', 'CHRG-1TKH0ZG', 'PLAN-3PQ1PCG', 0, 51.5],
  ['PLAN-DCK63P6', 'CHRG-EGYVEMW', 'PLAN-3PQ1PCG', 0, 51.5],
  ['PLAN-DCK63P6', 'CHRG-K7210X0', 'PLAN-3PQ1PCG', 0, 51.5],
  ['PLAN-DCK63P6', 'CHRG-4KF5RH4', 'PLAN-3PQ1PCG', 0, 51.5],
  ['PLAN-GHVVWF9', 'CHRG-W9V9GW5', 'PLAN-HKMBWJM', 0, 51.5],
  ['PLAN-GHVVWF9', 'CHRG-8XTEG07', 'PLAN-HKMBWJM', 0, 51.5],
  ['PLAN-GHVVWF9', 'CHRG-PFR72B4', 'PLAN-HKMBWJM', 0, 51.5],
  ['PLAN-GHVVWF9', 'CHRG-BWJCB3F', 'PLAN-HKMBWJM', 0, 51.5],
  ['PLAN-GHVVWF9', 'CHRG-W2V950C', 'PLAN-HKMBWJM', 0, 51.5],
  ['PLAN-GHVVWF9', 'CHRG-PFR72B4', 'PLAN-CMJB619', 20, 51.5],
  ['PLAN-GHVVWF9', 'CHRG-BWJCB3F', 'PLAN-CMJB619', 70, 51.5],
  ['PLAN-GHVVWF9', 'CHRG-8XTEG07', 'PLAN-CMJB619', 0, 51.5],
  ['PLAN-GHVVWF9', 'CHRG-W9V9GW5', 'PLAN-CMJB619', 0, 51.5],
  ['PLAN-GHVVWF9', 'CHRG-W2V950C', 'PLAN-CMJB619', 0, 51.5]
];

// `dropCharge` removes one draft line, which is how the ambiguous 211-seat
// pair is reduced to the unambiguous single line the rest of the rebuild is
// exercised on.
const buildDraftRenewal = ({ startDate = RENEWAL_START, endDate = RENEWAL_END, dropCharge = null } = {}) => ({
  accountId: 'ACCT-14WGE4W',
  orderType: 'RENEWAL',
  currency: 'AUD',
  paymentTerm: 'NET14',
  renewalForSubscriptionId: 'SUB-FDGKQ1P',
  billingContactId: 'CONT-GY06MXF',
  shippingContactId: 'CONT-GY06MXF',
  startDate,
  endDate,
  billingCycle: { cycle: 'YEAR', step: 1 },
  billingTerm: 'UP_FRONT',
  billingAnchorDate: startDate,
  autoRenew: true,
  ownerId: 'USER-J04C7EZ',
  subscriptionTargetVersion: 1,
  lineItems: DRAFT_LINES
    .filter(([, chargeId]) => chargeId !== dropCharge)
    .map(([planId, chargeId, replacedPlanId, quantity, list], index) => ({
      id: `enc-draft-${index + 1}`,
      isDryRunItem: false,
      action: 'RENEWAL',
      planId,
      chargeId,
      replacedPlanId,
      quantity,
      isRamp: false,
      listUnitPrice: list,
      sellUnitPrice: list,
      discountAmount: 0,
      discounts: [],
      predefinedDiscounts: [],
      attributeReferences: attrs('Core', 'Independent'),
      amount: list * quantity,
      listAmount: list * quantity,
      effectiveDate: startDate,
      endDate,
      // The swap draft brings no Year Groups across at all.
      customFields: orderCustomFields(undefined)
    })),
  customFields: []
});

// What the live rate card does to a line the rebuild could not price itself.
// Catholic + Core moved 39 -> 41 between plan versions, so a line sent down
// the catalog path with the quote's 3.41% discount comes back at 39.60179
// rather than the 37.67 that was quoted.
const CATALOG_LIST = { 'Catholic/Core': 41, 'Independent/Core': 51.5 };

const repriceLikeSubskribe = (line) => {
  const key = (line.attributeReferences || [])
    .map(a => a.attributeValue).sort().join('/');
  const list = CATALOG_LIST[key];
  if (!list || line.listPriceOverrideRatio != null) return line;
  const percent = (line.discounts || [])[0]?.percent || 0;
  const sell = Math.round(list * (1 - percent) * 100000) / 100000;
  return { ...line, listUnitPrice: list, sellUnitPrice: sell, amount: sell * line.quantity };
};

module.exports = {
  RENEWAL_START,
  RENEWAL_END,
  buildSubscription,
  buildDraftRenewal,
  buildExistingOrder,
  repriceLikeSubskribe
};
