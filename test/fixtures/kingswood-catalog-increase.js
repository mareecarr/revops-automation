// Fixtures modelled on ORD-16QXXQ8 — "2027 Renewal: Kingswood College, Box
// Hill" — rebuilt from the quote ORD-M08V46M. Both real.
//
// The catalog behind PLAN-3PQ1PCG/PLAN-CMJB619 was re-versioned onto
// PLAN-DCK63P6/PLAN-GHVVWF9 for 2027, and list price rose 49 -> 51.50 in the
// move. The quote carries a plain 7.86% discount off the old list (no
// listPriceOverrideRatio of its own) — CHRG-Y1JWZ9T at 12 seats and
// CHRG-N9VNCEG at 215, both sell 45.15.
//
// The rebuild used to re-anchor that absolute $45.15 onto the new charge via
// a listPriceOverrideRatio (49 / 51.5 = 0.951456), which pins the price at
// its PRE-rise value regardless of which way the catalog moved: List Unit
// Price came back as 48.99998, an invented override, not the new list. The
// 7.86% discount should instead survive onto the CURRENT list, landing on
// 47.4536 — a rise, because the catalog rose.
//
// Deliberately kept unambiguous: both draft lines match their quoted
// counterpart on quantity as well as attributes, so this exercises
// repriceSwappedLine in isolation from the cohort-ambiguity guard.

const RENEWAL_START = 1798714800;
const RENEWAL_END = 1830250800;
const SUB_START = 1767178800;

const YEAR_OPTIONS = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13',
  'Staff', 'P/F/K', 'Platform Access', 'Implementation Fee',
  'All Year Groups (EdPotential)', 'Tertiary'
];

const INDEPENDENT_CORE = [
  { attributeDefinitionId: 'PATTRB-8VPMPZZ', attributeValue: 'Independent' },
  { attributeDefinitionId: 'PATTRB-817VQ5E', attributeValue: 'Core' }
];

const notesField = (id) => ({
  id, type: 'STRING', name: 'Notes', label: 'Notes', value: null,
  selections: [], options: [], required: false, source: 'USER', defaultValue: null
});

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

const orderCustomFields = (years) => [
  notesField('CF-NFH5VBNH'),
  yearsField('CF-NFTKQDH2', years)
];

const chargeCustomFields = (years) => ({
  'CF-B0CZ41JW': notesField(undefined),
  'CF-4EJ2B59D': yearsField(undefined, years)
});

const discountsFor = (list, sell) => (list && sell != null && sell < list)
  ? [{ name: 'default', percent: 1 - (sell / list), discountAmount: null, status: null, discountedPrice: null }]
  : [];

// uuid, chargeId, qty, list, sell, years — the 2026 term, list 49 throughout.
const SUBSCRIPTION_CHARGES = [
  ['b101397e-0000-4000-8000-000000000001', 'CHRG-Y1JWZ9T', 12, 49, 45.15, '11; 12'],
  ['63e5c201-0000-4000-8000-000000000002', 'CHRG-N9VNCEG', 215, 49, 45.15, '7; 8; 9; 10'],
  ['564ab05c-0000-4000-8000-000000000003', 'CHRG-1CM34Z2', 0, 49, 49, null],
  ['2b9fdbde-0000-4000-8000-000000000004', 'CHRG-5DRR6YH', 0, 49, 49, null],
  ['7fe808b0-0000-4000-8000-000000000005', 'CHRG-ZYHZ5BH', 0, 49, 49, null],
  ['5d1684e8-0000-4000-8000-000000000006', 'CHRG-1ZCF3J6', 0, 49, 49, null],
  ['5bedd562-0000-4000-8000-000000000007', 'CHRG-99QCRB7', 0, 49, 49, null],
  ['6133e3f7-0000-4000-8000-000000000008', 'CHRG-ZHFTN4X', 0, 49, 49, null],
  ['7efabae9-0000-4000-8000-000000000009', 'CHRG-4F7PC2M', 0, 49, 49, null],
  ['8226d3ff-0000-4000-8000-00000000000a', 'CHRG-4091V3F', 0, 49, 49, null]
];

const buildSubscription = () => ({
  id: 'SUB-EGRBXGE',
  version: 3,
  entityId: 'ENT-MNJ0N5D',
  accountId: 'ACCT-R83Y19H',
  shippingContactId: 'CONT-77B6B8X',
  billingContactId: 'CONT-77B6B8X',
  state: 'ACTIVE',
  startDate: SUB_START,
  endDate: RENEWAL_START,
  billingCycle: { cycle: 'YEAR', step: 1 },
  paymentTerm: 'NET14',
  billingTerm: 'UP_FRONT',
  autoRenew: true,
  charges: SUBSCRIPTION_CHARGES.map(([id, chargeId, quantity, list, sell, years], index) => ({
    id,
    groupId: `kw-group-${index + 1}`,
    accountId: 'ACCT-R83Y19H',
    chargeId,
    quantity,
    isRamp: false,
    listUnitPrice: list,
    sellUnitPrice: sell,
    discounts: discountsFor(list, sell),
    predefinedDiscounts: [],
    attributeReferences: INDEPENDENT_CORE,
    startDate: SUB_START,
    endDate: RENEWAL_START,
    customFields: chargeCustomFields(years)
  }))
});

// ORD-M08V46M as quoted: same charges, same quantities, plain 7.86% discount
// off the 2026 list of 49. No listPriceOverrideRatio anywhere on this order.
const QUOTE_PLAN = {
  'CHRG-Y1JWZ9T': 'PLAN-3PQ1PCG', 'CHRG-1CM34Z2': 'PLAN-3PQ1PCG',
  'CHRG-5DRR6YH': 'PLAN-3PQ1PCG', 'CHRG-ZYHZ5BH': 'PLAN-3PQ1PCG',
  'CHRG-1ZCF3J6': 'PLAN-3PQ1PCG',
  'CHRG-N9VNCEG': 'PLAN-CMJB619', 'CHRG-99QCRB7': 'PLAN-CMJB619',
  'CHRG-ZHFTN4X': 'PLAN-CMJB619', 'CHRG-4F7PC2M': 'PLAN-CMJB619',
  'CHRG-4091V3F': 'PLAN-CMJB619'
};

const buildExistingOrder = () => ({
  id: 'ORD-M08V46M',
  entityId: 'ENT-MNJ0N5D',
  externalId: '60151471494',
  name: '2027 Renewal: Kingswood College, Box Hill: Lang -',
  accountId: 'ACCT-R83Y19H',
  orderType: 'RENEWAL',
  currency: 'AUD',
  paymentTerm: 'NET14',
  status: 'DRAFT',
  shippingContactId: 'CONT-77B6B8X',
  billingContactId: 'CONT-77B6B8X',
  lineItems: SUBSCRIPTION_CHARGES.map(([, chargeId, quantity, list, sell, years], index) => ({
    id: `kw-quote-${index + 1}`,
    isDryRunItem: false,
    action: 'RENEWAL',
    planId: QUOTE_PLAN[chargeId],
    chargeId,
    quantity,
    isRamp: false,
    listUnitPrice: list,
    sellUnitPrice: sell,
    discountAmount: (list - sell) * quantity,
    discounts: discountsFor(list, sell),
    predefinedDiscounts: [],
    attributeReferences: INDEPENDENT_CORE,
    amount: sell * quantity,
    listAmount: list * quantity,
    effectiveDate: RENEWAL_START,
    endDate: RENEWAL_END,
    customFields: orderCustomFields(years),
    dryRunItem: false
  })),
  startDate: RENEWAL_START,
  endDate: RENEWAL_END,
  billingCycle: { cycle: 'YEAR', step: 1 },
  billingTerm: 'UP_FRONT',
  billingAnchorDate: RENEWAL_START,
  totalAmount: 10249.05,
  totalListAmount: 11123,
  sfdcOpportunityId: '60151471494',
  sfdcOpportunityName: '2027 Renewal: Kingswood College, Box Hill: Lang -',
  renewalForSubscriptionId: 'SUB-EGRBXGE',
  renewalForSubscriptionVersion: 3,
  ownerId: 'USER-J04C7EZ',
  autoRenew: true,
  startDateType: 'FIXED',
  customFields: []
});

// The fresh draft: every plan re-versioned onto the 2027 catalog at list
// 51.50 — the same attributes as the quote (Independent + Core), so nothing
// here needs recovering. Quantities match the quote exactly, so the cross-
// charge match is unambiguous ('swapped', not a cohort guess).
const DRAFT_PLAN_AND_REPLACED = {
  'CHRG-6T5J1FH': ['PLAN-DCK63P6', 'PLAN-3PQ1PCG'],
  'CHRG-1TKH0ZG': ['PLAN-DCK63P6', 'PLAN-3PQ1PCG'],
  'CHRG-EGYVEMW': ['PLAN-DCK63P6', 'PLAN-3PQ1PCG'],
  'CHRG-K7210X0': ['PLAN-DCK63P6', 'PLAN-3PQ1PCG'],
  'CHRG-4KF5RH4': ['PLAN-DCK63P6', 'PLAN-3PQ1PCG'],
  'CHRG-PFR72B4': ['PLAN-GHVVWF9', 'PLAN-CMJB619'],
  'CHRG-8XTEG07': ['PLAN-GHVVWF9', 'PLAN-CMJB619'],
  'CHRG-BWJCB3F': ['PLAN-GHVVWF9', 'PLAN-CMJB619'],
  'CHRG-W2V950C': ['PLAN-GHVVWF9', 'PLAN-CMJB619'],
  'CHRG-W9V9GW5': ['PLAN-GHVVWF9', 'PLAN-CMJB619']
};

// chargeId, qty, years
const DRAFT_LINES = [
  ['CHRG-6T5J1FH', 12, '11; 12'],
  ['CHRG-1TKH0ZG', 0, null],
  ['CHRG-EGYVEMW', 0, null],
  ['CHRG-K7210X0', 0, null],
  ['CHRG-4KF5RH4', 0, null],
  ['CHRG-PFR72B4', 215, '7; 8; 9; 10'],
  ['CHRG-8XTEG07', 0, null],
  ['CHRG-BWJCB3F', 0, null],
  ['CHRG-W2V950C', 0, null],
  ['CHRG-W9V9GW5', 0, null]
];

const buildDraftRenewal = ({ startDate = RENEWAL_START, endDate = RENEWAL_END } = {}) => ({
  accountId: 'ACCT-R83Y19H',
  orderType: 'RENEWAL',
  currency: 'AUD',
  paymentTerm: 'NET14',
  renewalForSubscriptionId: 'SUB-EGRBXGE',
  billingContactId: 'CONT-77B6B8X',
  shippingContactId: 'CONT-77B6B8X',
  startDate,
  endDate,
  billingCycle: { cycle: 'YEAR', step: 1 },
  billingTerm: 'UP_FRONT',
  billingAnchorDate: startDate,
  autoRenew: true,
  ownerId: 'USER-J04C7EZ',
  subscriptionTargetVersion: 1,
  lineItems: DRAFT_LINES.map(([chargeId, quantity, years], index) => {
    const [planId, replacedPlanId] = DRAFT_PLAN_AND_REPLACED[chargeId];
    return {
      id: `kw-draft-${index + 1}`,
      isDryRunItem: false,
      action: 'ADD',
      planId,
      chargeId,
      replacedPlanId,
      quantity,
      isRamp: false,
      listUnitPrice: 51.5,
      sellUnitPrice: 51.5,
      discountAmount: 0,
      discounts: [],
      predefinedDiscounts: [],
      attributeReferences: INDEPENDENT_CORE,
      amount: 51.5 * quantity,
      listAmount: 51.5 * quantity,
      effectiveDate: startDate,
      endDate,
      customFields: orderCustomFields(years)
    };
  }),
  customFields: []
});

module.exports = {
  RENEWAL_START,
  RENEWAL_END,
  buildSubscription,
  buildDraftRenewal,
  buildExistingOrder
};
