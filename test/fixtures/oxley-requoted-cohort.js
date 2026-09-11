// Fixtures modelled on ORD-8DCTRDQ — "2027 Renewal: Oxley Christian College,
// Melbourne" — and SUB-JYYK6QP. Both real.
//
// The quote (drafted against subscription version 2) carries CHRG-ZHFTN4X at
// 299 seats and CHRG-N9VNCEG at 325, both Core/Independent, both a plain
// 1.43% discount off list 49. By the time this ran, the subscription had
// taken THREE mid-term amendments (now version 5) that rebalanced seats
// between those same two charges: 371 and 287. Then the 2027 catalog
// re-versioned PLAN-CMJB619 onto PLAN-GHVVWF9, renaming both charges
// (CHRG-ZHFTN4X -> CHRG-W9V9GW5, CHRG-N9VNCEG -> CHRG-PFR72B4).
//
// Every existing cross-charge matching tier failed on this: Pass 1 can't
// match (chargeId renamed), Pass 2 can't break the tie (both quoted lines
// share identical attributes), and Pass 3's cohort pass buckets by exact
// quantity — but 371 and 287 (the CURRENT, amended quantities used to
// search) equal neither 299 nor 325 (the QUOTED quantities being searched
// for), so every bucket comes up empty. The swap itself is completely
// unambiguous — two renamed charges, two quoted lines, identical attributes,
// identical commercial signature — quantity is just the wrong key once an
// amendment has moved seats between the very charges being renamed.

const RENEWAL_START = 1798714800;
const RENEWAL_END = 1830250800;
const SUB_START = 1767178800;

const YEAR_OPTIONS = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13',
  'Staff', 'P/F/K', 'Platform Access', 'Implementation Fee',
  'All Year Groups (EdPotential)', 'Tertiary'
];

const CORE_INDEPENDENT = [
  { attributeDefinitionId: 'PATTRB-817VQ5E', attributeValue: 'Core' },
  { attributeDefinitionId: 'PATTRB-8VPMPZZ', attributeValue: 'Independent' }
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

// The CURRENT (version 5) subscription: three amendments after the quote,
// seats rebalanced 299/325 -> 371/287 on the same two charges, plus a
// handful of zero-quantity catalog placeholders.
const SUBSCRIPTION_CHARGES = [
  ['fd9ab844', 'CHRG-5DRR6YH', 0, 49, 49, null],
  ['ee2004d1', 'CHRG-N9VNCEG', 287, 49, 46, '7; 8; 9; 10'],
  ['526a4e43', 'CHRG-4091V3F', 0, 49, 49, null],
  ['9d60c0d2', 'CHRG-Y1JWZ9T', 0, 49, 46, '11; 12'],
  ['56ae9253', 'CHRG-4F7PC2M', 0, 49, 49, null],
  ['e7359583', 'CHRG-ZHFTN4X', 371, 49, 46, '7; 8; 9; 10'],
  ['ee75921a', 'CHRG-ZYHZ5BH', 0, 49, 49, null],
  ['6c742e78', 'CHRG-1ZCF3J6', 0, 49, 49, null],
  ['6eafe042', 'CHRG-1CM34Z2', 0, 49, 49, null],
  ['2b698d9a', 'CHRG-99QCRB7', 0, 49, 49, null]
];

const buildSubscription = () => ({
  id: 'SUB-JYYK6QP',
  version: 5,
  entityId: 'ENT-MNJ0N5D',
  accountId: 'ACCT-YFK3D8P',
  shippingContactId: 'CONT-EYZNNQC',
  billingContactId: 'CONT-EYZNNQC',
  state: 'ACTIVE',
  startDate: SUB_START,
  endDate: RENEWAL_START,
  billingCycle: { cycle: 'YEAR', step: 1 },
  paymentTerm: 'NET14',
  billingTerm: 'UP_FRONT',
  autoRenew: true,
  renewedFromSubscriptionId: 'SUB-YNHQZJX',
  charges: SUBSCRIPTION_CHARGES.map(([id, chargeId, quantity, list, sell, years], index) => ({
    id,
    groupId: `ox-group-${index + 1}`,
    accountId: 'ACCT-YFK3D8P',
    chargeId,
    quantity,
    isRamp: false,
    listUnitPrice: list,
    sellUnitPrice: sell,
    discounts: discountsFor(list, sell),
    predefinedDiscounts: [],
    attributeReferences: CORE_INDEPENDENT,
    startDate: SUB_START,
    endDate: RENEWAL_START,
    customFields: chargeCustomFields(years)
  }))
});

// ORD-8DCTRDQ as quoted — version 2, before any of the three amendments.
// CHRG-ZHFTN4X 299, CHRG-N9VNCEG 325, plain 1.43% discount, no override.
const QUOTE_LINES = [
  ['CHRG-ZHFTN4X', 299, '7; 8; 9; 10'],
  ['CHRG-N9VNCEG', 325, '7; 8; 9; 10'],
  ['CHRG-99QCRB7', 0, null],
  ['CHRG-4F7PC2M', 0, null],
  ['CHRG-4091V3F', 0, null]
];

const buildExistingOrder = () => ({
  id: 'ORD-8DCTRDQ',
  entityId: 'ENT-MNJ0N5D',
  externalId: '60147007354',
  name: '2027 Renewal: Oxley Christian College, Melbourne: Eng - Lang -',
  accountId: 'ACCT-YFK3D8P',
  orderType: 'RENEWAL',
  currency: 'AUD',
  paymentTerm: 'NET14',
  status: 'DRAFT',
  shippingContactId: 'CONT-EYZNNQC',
  billingContactId: 'CONT-EYZNNQC',
  lineItems: QUOTE_LINES.map(([chargeId, quantity, years], index) => ({
    id: `ox-quote-${index + 1}`,
    isDryRunItem: false,
    action: 'RENEWAL',
    planId: 'PLAN-CMJB619',
    chargeId,
    quantity,
    isRamp: false,
    listUnitPrice: 49,
    sellUnitPrice: 48.3,
    discountAmount: (49 - 48.3) * quantity,
    discounts: discountsFor(49, 48.3),
    predefinedDiscounts: [],
    attributeReferences: CORE_INDEPENDENT,
    amount: 48.3 * quantity,
    listAmount: 49 * quantity,
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
  totalAmount: 30139.2,
  totalListAmount: 30576,
  sfdcOpportunityId: '60147007354',
  sfdcOpportunityName: '2027 Renewal: Oxley Christian College, Melbourne: Eng - Lang -',
  renewalForSubscriptionId: 'SUB-JYYK6QP',
  renewalForSubscriptionVersion: 2,
  ownerId: 'USER-J04C7EZ',
  autoRenew: true,
  startDateType: 'FIXED',
  customFields: []
});

// The fresh draft, current (v5) quantities, both charges re-versioned onto
// PLAN-GHVVWF9. Same attributes as the quote — nothing here needs recovering.
const DRAFT_PLAN_AND_REPLACED = {
  'CHRG-6T5J1FH': ['PLAN-DCK63P6', 'PLAN-3PQ1PCG'],
  'CHRG-1TKH0ZG': ['PLAN-DCK63P6', 'PLAN-3PQ1PCG'],
  'CHRG-EGYVEMW': ['PLAN-DCK63P6', 'PLAN-3PQ1PCG'],
  'CHRG-K7210X0': ['PLAN-DCK63P6', 'PLAN-3PQ1PCG'],
  'CHRG-4KF5RH4': ['PLAN-DCK63P6', 'PLAN-3PQ1PCG'],
  'CHRG-W9V9GW5': ['PLAN-GHVVWF9', 'PLAN-CMJB619'],
  'CHRG-PFR72B4': ['PLAN-GHVVWF9', 'PLAN-CMJB619'],
  'CHRG-8XTEG07': ['PLAN-GHVVWF9', 'PLAN-CMJB619'],
  'CHRG-BWJCB3F': ['PLAN-GHVVWF9', 'PLAN-CMJB619'],
  'CHRG-W2V950C': ['PLAN-GHVVWF9', 'PLAN-CMJB619']
};

// chargeId, qty (from the CURRENT amended subscription, not the quote)
const DRAFT_LINES = [
  ['CHRG-6T5J1FH', 0],
  ['CHRG-1TKH0ZG', 0],
  ['CHRG-EGYVEMW', 0],
  ['CHRG-K7210X0', 0],
  ['CHRG-4KF5RH4', 0],
  ['CHRG-W9V9GW5', 371],
  ['CHRG-PFR72B4', 287],
  ['CHRG-8XTEG07', 0],
  ['CHRG-BWJCB3F', 0],
  ['CHRG-W2V950C', 0]
];

const buildDraftRenewal = ({ startDate = RENEWAL_START, endDate = RENEWAL_END, dropCharge = null } = {}) => ({
  accountId: 'ACCT-YFK3D8P',
  orderType: 'RENEWAL',
  currency: 'AUD',
  paymentTerm: 'NET14',
  renewalForSubscriptionId: 'SUB-JYYK6QP',
  billingContactId: 'CONT-EYZNNQC',
  shippingContactId: 'CONT-EYZNNQC',
  startDate,
  endDate,
  billingCycle: { cycle: 'YEAR', step: 1 },
  billingTerm: 'UP_FRONT',
  billingAnchorDate: startDate,
  autoRenew: true,
  subscriptionTargetVersion: 1,
  lineItems: DRAFT_LINES
    .filter(([chargeId]) => chargeId !== dropCharge)
    .map(([chargeId, quantity], index) => {
      const [planId, replacedPlanId] = DRAFT_PLAN_AND_REPLACED[chargeId];
      return {
        id: `ox-draft-${index + 1}`,
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
        attributeReferences: CORE_INDEPENDENT,
        amount: 51.5 * quantity,
        listAmount: 51.5 * quantity,
        effectiveDate: startDate,
        endDate,
        // The swap draft brings no Year Groups across — the quote's own
        // years survive via extractYearsData falling back to the
        // subscription charge / matched existing line.
        customFields: orderCustomFields(undefined)
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
