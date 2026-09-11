// Fixtures modelled on ORD-V0ZZV09 — "Emmaus College" — and SUB-DZE4XNV.
// Both real.
//
// The quote negotiates the SAME attribute pair (Core + Independent) at
// three genuinely different price points across five catalog charges:
//   - CHRG-4091V3F  15 seats,  Years 10,       sell $44.10 (list $49)
//   - CHRG-ZHFTN4X  773 seats, Years 7; 8; 9,  sell $24.05 (list $49)
//   - CHRG-N9VNCEG  773 seats, Years 7; 8; 9,  sell $24.05 (list $49)
//   - CHRG-G32RFDZ  773 seats, Years 7; 8; 9,  sell $0.00  (list $49)
//   - CHRG-RTC7YRP  773 seats, Years 7; 8; 9,  sell $0.00  (list $25.50)
// A 2027 catalog re-version renames every one of them onto new chargeIds
// with no subscriptionChargeId and no Year Groups carried across — the
// fresh draft's successors all present as identical "Core + Independent"
// lines with no way back to which quoted price each one funds. Pass 1-3
// can't place them (chargeId renamed, quantities don't line up with the
// quote), and Pass 4's cohort-by-attribute pass finds real candidates but
// refuses once it sees they aren't commercially identical to each other —
// correctly, since two of them differ by $24.05/seat on hundreds of seats
// and guessing wrong would silently misprice real revenue.
//
// Kept deliberately minimal: one ordinary charge that resolves normally
// (proving the rest of the order still rebuilds fine), plus exactly the
// five ambiguous lines above.

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

// The current subscription: one ordinary, unrenamed charge, plus the five
// ambiguous charges at their current (amendment-drifted) quantities — none
// of which need to match the quote exactly; that drift is the point.
// id, chargeId, qty, list, sell, years
const SUBSCRIPTION_CHARGES = [
  ['em-sub-1', 'CHRG-45NK9MD', 40, 12, 12, 'P/F/K'],
  ['em-sub-2', 'CHRG-4091V3F', 15, 49, 42, '10'],
  ['em-sub-3', 'CHRG-ZHFTN4X', 789, 49, 22.9, '7; 8; 9'],
  ['em-sub-4', 'CHRG-N9VNCEG', 792, 49, 22.9, '7; 8; 9'],
  ['em-sub-5', 'CHRG-G32RFDZ', 780, 49, 0, '7; 8; 9'],
  ['em-sub-6', 'CHRG-RTC7YRP', 780, 25.5, 0, '7; 8; 9']
];

const buildSubscription = () => ({
  id: 'SUB-DZE4XNV',
  version: 8,
  entityId: 'ENT-MNJ0N5D',
  accountId: 'ACCT-3E1ZYRK',
  shippingContactId: 'CONT-E8D9T2Y',
  billingContactId: 'CONT-E8D9T2Y',
  state: 'ACTIVE',
  startDate: SUB_START,
  endDate: RENEWAL_START,
  billingCycle: { cycle: 'PAID_IN_FULL', step: 1 },
  paymentTerm: 'NET14',
  billingTerm: 'UP_FRONT',
  autoRenew: true,
  renewedFromSubscriptionId: 'SUB-WZVR9Y6',
  charges: SUBSCRIPTION_CHARGES.map(([id, chargeId, quantity, list, sell, years], index) => ({
    id,
    groupId: `em-group-${index + 1}`,
    accountId: 'ACCT-3E1ZYRK',
    chargeId,
    quantity,
    isRamp: false,
    listUnitPrice: list,
    sellUnitPrice: sell,
    discounts: discountsFor(list, sell),
    predefinedDiscounts: [],
    attributeReferences: chargeId === 'CHRG-45NK9MD' ? [] : CORE_INDEPENDENT,
    startDate: SUB_START,
    endDate: RENEWAL_START,
    customFields: chargeCustomFields(years)
  }))
});

// ORD-V0ZZV09 as quoted — the ordinary charge plus the five commercially
// distinct "Core + Independent" lines: 15 @ $44.10 (Years 10), 773 @ $24.05
// x2 (Years 7-9), 773 @ $0 x2 (Years 7-9, one list $49, one list $25.50).
// chargeId, quantity, list, sell, years
const QUOTE_LINES = [
  ['CHRG-45NK9MD', 40, 12, 12, 'P/F/K'],
  ['CHRG-4091V3F', 15, 49, 44.1, '10'],
  ['CHRG-ZHFTN4X', 773, 49, 24.05, '7; 8; 9'],
  ['CHRG-N9VNCEG', 773, 49, 24.05, '7; 8; 9'],
  ['CHRG-G32RFDZ', 773, 49, 0, '7; 8; 9'],
  ['CHRG-RTC7YRP', 773, 25.5, 0, '7; 8; 9']
];

const buildExistingOrder = () => ({
  id: 'ORD-V0ZZV09',
  entityId: 'ENT-MNJ0N5D',
  externalId: '60158227289',
  name: '2028 Renewal: Emmaus College',
  accountId: 'ACCT-3E1ZYRK',
  orderType: 'RENEWAL',
  currency: 'AUD',
  paymentTerm: 'NET14',
  status: 'DRAFT',
  shippingContactId: 'CONT-E8D9T2Y',
  billingContactId: 'CONT-E8D9T2Y',
  lineItems: QUOTE_LINES.map(([chargeId, quantity, list, sell, years], index) => ({
    id: `em-quote-${index + 1}`,
    isDryRunItem: false,
    action: 'RENEWAL',
    planId: 'PLAN-CMJB619',
    chargeId,
    quantity,
    isRamp: false,
    listUnitPrice: list,
    sellUnitPrice: sell,
    discountAmount: (list - sell) * quantity,
    discounts: discountsFor(list, sell),
    predefinedDiscounts: [],
    attributeReferences: chargeId === 'CHRG-45NK9MD' ? [] : CORE_INDEPENDENT,
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
  totalAmount: 480 + 15 * 44.1 + 773 * 24.05 * 2,
  totalListAmount: 480 + (15 + 773 * 4) * 49 + 773 * 25.5,
  sfdcOpportunityId: '60158227289',
  sfdcOpportunityName: '2028 Renewal: Emmaus College',
  renewalForSubscriptionId: 'SUB-DZE4XNV',
  renewalForSubscriptionVersion: 6,
  ownerId: 'USER-Q4EXQN2',
  autoRenew: true,
  startDateType: 'FIXED',
  customFields: []
});

// The fresh draft: CHRG-45NK9MD is untouched (same chargeId, matches
// directly), the five ambiguous charges all re-version onto PLAN-GHVVWF9
// (replacing PLAN-CMJB619) under new chargeIds, at the CURRENT (amended)
// subscription quantities, with no Year Groups carried across at all.
const DRAFT_LINES = [
  // chargeId, quantity, listUnitPrice, sellUnitPrice, replacedPlanId
  ['CHRG-45NK9MD', 40, 12, 12, null],
  ['CHRG-W9V9GW5', 789, 51.5, 24.06837, 'PLAN-CMJB619'],
  ['CHRG-PFR72B4', 792, 51.5, 24.06837, 'PLAN-CMJB619'],
  ['CHRG-DZCPWQC', 780, 26.75, 0, 'PLAN-CMJB619'],
  ['CHRG-FJ0TYZK', 780, 26.75, 0, 'PLAN-CMJB619'],
  // 16, not 15 — an exact-quantity match here would let Pass 2 place it on
  // its own, same as it does for real Emmaus charges outside this cluster.
  // A one-seat amendment drift is exactly what keeps it in the ambiguous
  // cohort instead, which is the case actually worth proving here.
  ['CHRG-6T5J1FH', 16, 51.5, 44.14286, 'PLAN-CMJB619']
];

const buildDraftRenewal = ({ startDate = RENEWAL_START, endDate = RENEWAL_END } = {}) => ({
  entityId: 'ENT-MNJ0N5D',
  accountId: 'ACCT-3E1ZYRK',
  orderType: 'RENEWAL',
  currency: 'AUD',
  paymentTerm: 'NET14',
  subscriptionTargetVersion: 1,
  shippingContactId: 'CONT-E8D9T2Y',
  billingContactId: 'CONT-E8D9T2Y',
  startDate,
  endDate,
  billingCycle: { cycle: 'YEAR', step: 1 },
  billingTerm: 'UP_FRONT',
  billingAnchorDate: startDate,
  autoRenew: true,
  lineItems: DRAFT_LINES.map(([chargeId, quantity, list, sell, replacedPlanId], index) => {
    const line = {
      id: `em-draft-${index + 1}`,
      isDryRunItem: false,
      action: 'ADD',
      planId: replacedPlanId ? 'PLAN-GHVVWF9' : 'PLAN-N2W6RZR',
      chargeId,
      quantity,
      isRamp: false,
      listUnitPrice: list,
      sellUnitPrice: sell,
      discountAmount: (list - sell) * quantity,
      discounts: discountsFor(list, sell),
      predefinedDiscounts: [],
      attributeReferences: chargeId === 'CHRG-45NK9MD' ? [] : CORE_INDEPENDENT,
      amount: sell * quantity,
      listAmount: list * quantity,
      effectiveDate: startDate,
      endDate,
      // The re-versioned lines bring no Year Groups across at all.
      customFields: orderCustomFields(undefined)
    };
    if (replacedPlanId) line.replacedPlanId = replacedPlanId;
    return line;
  }),
  status: 'DRAFT',
  renewalForSubscriptionId: 'SUB-DZE4XNV',
  renewalForSubscriptionVersion: 8,
  customFields: []
});

module.exports = {
  RENEWAL_START,
  RENEWAL_END,
  buildSubscription,
  buildDraftRenewal,
  buildExistingOrder
};
