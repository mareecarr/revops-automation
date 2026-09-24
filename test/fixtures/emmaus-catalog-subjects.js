// Fixtures modelled on ORD-V0ZZV09 — "Emmaus College" — and SUB-DZE4XNV.
// Both real, and the follow-up to emmaus-collapsed-price-tiers.js: THAT
// fixture proves the code refuses safely when catalog subject data isn't
// available; THIS one proves the actual real payload resolves cleanly and
// automatically once it is, via the GET /plans/{id} lookups in Pass 1.5.
//
// Trimmed to the charges that actually exercise the new pass (two of the
// real order's seven ambiguous subjects — Maths and Science — are left out
// as redundant with what's already proven here):
//
//   - CHRG-ZHFTN4X   773 seats, Years 7-9,  English & Literature
//       -> CHRG-W9V9GW5, one clean subject match, no other signal needed.
//   - CHRG-N9VNCEG   58 (Years 10) + 773 (Years 7-9), Languages
//       -> CHRG-PFR72B4 (offered twice) — the 58 is a unique exact-quantity
//          match even before subject gets involved; the 773 needs subject
//          to place it at all.
//   - CHRG-4091V3F   15 (Years 10) + 773 (Years 7-9), Humanities
//       -> CHRG-W2V950C (offered twice, neither quantity matches quoted)
//          — the one catalog charge negotiated at two Year Group tiers,
//          resolved by Year Groups once subject narrows it to this pair.
//   - CHRG-G32RFDZ (PDHPE) and CHRG-RTC7YRP (Technology), both 773 seats,
//     both $0/100%-discount, on a DIFFERENT old plan (PLAN-99999WD) — and
//     both tied at quantity 780 on the CURRENT subscription, which is
//     exactly what stops resolveAll from linking either draft successor to
//     a subscription charge at all. Subject still resolves each to its own
//     successor (CHRG-FJ0TYZK / CHRG-DZCPWQC) with no quantity or Year
//     Groups involved — 1 draft line, 1 quoted line, nothing else in the
//     family to confuse it with.
//   - CHRG-Y1JWZ9T (Years 11-12) -> CHRG-6T5J1FH, on yet another plan with
//     no catalog subject fetched at all — proves the existing attrs+qty
//     pass still runs untouched alongside the new one.
//   - CHRG-45NK9MD, an ordinary unrenamed charge, still resolves directly.

const RENEWAL_START = 1798714800;
const RENEWAL_END = 1830250800;
const SUB_START = 1782820800;

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

const subjectField = (value) => ({
  type: 'MULTISELECT_PICKLIST', name: 'Charge_Subjects', label: 'Charge Subjects',
  value, selections: value ? value.split(';').map(v => v.trim()) : [],
  options: [], required: false, source: 'USER', defaultValue: null
});

const discountsFor = (list, sell) => (list && sell != null && sell < list)
  ? [{ name: 'default', percent: 1 - (sell / list), discountAmount: null, status: null, discountedPrice: null }]
  : [];

// id, chargeId, qty, list, sell, years
const SUBSCRIPTION_CHARGES = [
  ['em-sub-1', 'CHRG-45NK9MD', 40, 12, 12, 'P/F/K'],
  ['em-sub-2a', 'CHRG-4091V3F', 27, 49, 0, '10'],
  ['em-sub-2b', 'CHRG-4091V3F', 781, 49, 22.9, '7; 8; 9'],
  ['em-sub-3', 'CHRG-ZHFTN4X', 789, 49, 22.9, '7; 8; 9'],
  ['em-sub-4a', 'CHRG-N9VNCEG', 58, 49, 42, '10'],
  ['em-sub-4b', 'CHRG-N9VNCEG', 792, 49, 22.9, '7; 8; 9'],
  ['em-sub-5', 'CHRG-G32RFDZ', 780, 49, 0, '7; 8; 9'],
  ['em-sub-6', 'CHRG-RTC7YRP', 780, 25.5, 0, '7; 8; 9'],
  ['em-sub-7', 'CHRG-Y1JWZ9T', 43, 49, 42, '11; 12']
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
  billingCycle: { cycle: 'YEAR', step: 1 },
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

// chargeId, quantity, list, sell, years
const QUOTE_LINES = [
  ['CHRG-45NK9MD', 40, 12, 12, 'P/F/K'],
  ['CHRG-4091V3F', 15, 49, 44.1, '10'],
  ['CHRG-4091V3F', 773, 49, 24.05, '7; 8; 9'],
  ['CHRG-ZHFTN4X', 773, 49, 24.05, '7; 8; 9'],
  ['CHRG-N9VNCEG', 58, 49, 44.1, '10'],
  ['CHRG-N9VNCEG', 773, 49, 24.05, '7; 8; 9'],
  ['CHRG-G32RFDZ', 773, 49, 0, '7; 8; 9'],
  ['CHRG-RTC7YRP', 773, 25.5, 0, '7; 8; 9'],
  ['CHRG-Y1JWZ9T', 43, 49, 44.1, '11; 12']
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
    planId: (chargeId === 'CHRG-G32RFDZ' || chargeId === 'CHRG-RTC7YRP') ? 'PLAN-99999WD'
      : chargeId === 'CHRG-Y1JWZ9T' ? 'PLAN-3PQ1PCG'
        : chargeId === 'CHRG-45NK9MD' ? 'PLAN-N2W6RZR'
          : 'PLAN-CMJB619',
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
  sfdcOpportunityId: '60158227289',
  sfdcOpportunityName: '2028 Renewal: Emmaus College',
  renewalForSubscriptionId: 'SUB-DZE4XNV',
  renewalForSubscriptionVersion: 6,
  ownerId: 'USER-Q4EXQN2',
  autoRenew: true,
  startDateType: 'FIXED',
  customFields: []
});

// chargeId, quantity, list, sell, planId, replacedPlanId
const DRAFT_LINES = [
  ['CHRG-45NK9MD', 40, 12, 12, 'PLAN-N2W6RZR', null],
  ['CHRG-W9V9GW5', 789, 51.5, 24.06837, 'PLAN-GHVVWF9', 'PLAN-CMJB619'],
  ['CHRG-PFR72B4', 58, 51.5, 44.14286, 'PLAN-GHVVWF9', 'PLAN-CMJB619'],
  ['CHRG-PFR72B4', 792, 51.5, 24.06837, 'PLAN-GHVVWF9', 'PLAN-CMJB619'],
  ['CHRG-W2V950C', 781, 51.5, 24.06837, 'PLAN-GHVVWF9', 'PLAN-CMJB619'],
  ['CHRG-W2V950C', 27, 51.5, 0, 'PLAN-GHVVWF9', 'PLAN-CMJB619'],
  ['CHRG-DZCPWQC', 780, 26.75, 0, 'PLAN-TG9K5EY', 'PLAN-99999WD'],
  ['CHRG-FJ0TYZK', 780, 26.75, 0, 'PLAN-TG9K5EY', 'PLAN-99999WD'],
  ['CHRG-6T5J1FH', 43, 51.5, 44.14286, 'PLAN-DCK63P6', 'PLAN-3PQ1PCG']
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
  lineItems: DRAFT_LINES.map(([chargeId, quantity, list, sell, planId, replacedPlanId], index) => {
    const line = {
      id: `em-draft-${index + 1}`,
      isDryRunItem: false,
      action: 'ADD',
      planId,
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

// The GET /plans/{id} responses driving Pass 1.5. Real chargeIds, real
// Charge_Subjects values, real plan pairing (PLAN-CMJB619 -> PLAN-GHVVWF9
// via replacementPlanIds; PLAN-99999WD's own replacementPlanIds points
// elsewhere, and the real draft placed its charges on PLAN-TG9K5EY
// regardless — Pass 1.5 never follows replacementPlanIds itself, only the
// planIds the quote and draft actually carry, which is what this proves).
// PLAN-3PQ1PCG / PLAN-DCK63P6 are deliberately NOT included: CHRG-Y1JWZ9T
// -> CHRG-6T5J1FH has to keep resolving on attrs+qty alone.
const buildPlans = () => ({
  'PLAN-CMJB619': {
    id: 'PLAN-CMJB619',
    replacementPlanIds: ['PLAN-GHVVWF9'],
    charges: [
      { id: 'CHRG-ZHFTN4X', name: 'English', itemCode: 'Aus_07-10_English', customFields: { 'CF-E0H27PRH': subjectField('English & Literature') } },
      { id: 'CHRG-N9VNCEG', name: 'Languages', itemCode: 'Aus_07-10_Languages', customFields: { 'CF-E0H27PRH': subjectField('Languages') } },
      { id: 'CHRG-4091V3F', name: 'Humanities', itemCode: 'Aus_07-10_Humanities', customFields: { 'CF-E0H27PRH': subjectField('History; Geography; Accounting; Civics & Citizenship; Economics; Enterprise; Social Sciences; Travel and Tourism; Classical Studies; General Knowledge; Resources; Moral Education; Media Studies') } }
    ]
  },
  'PLAN-GHVVWF9': {
    id: 'PLAN-GHVVWF9',
    replacementPlanIds: [],
    charges: [
      { id: 'CHRG-W9V9GW5', name: 'English', itemCode: 'Aus_07-10_English', customFields: { 'CF-E0H27PRH': subjectField('English & Literature') } },
      { id: 'CHRG-PFR72B4', name: 'Languages', itemCode: 'Aus_07-10_Languages', customFields: { 'CF-E0H27PRH': subjectField('Languages') } },
      { id: 'CHRG-W2V950C', name: 'Humanities', itemCode: 'Aus_07-10_Humanities', customFields: { 'CF-E0H27PRH': subjectField('History; Geography; Accounting; Civics & Citizenship; Economics; Enterprise; Social Sciences; Travel and Tourism; Classical Studies; General Knowledge; Resources; Moral Education; Media Studies') } }
    ]
  },
  'PLAN-99999WD': {
    id: 'PLAN-99999WD',
    replacementPlanIds: ['PLAN-EYJY1D9'],
    charges: [
      { id: 'CHRG-RTC7YRP', name: 'Technology', itemCode: 'Aus_07-10_Technology', customFields: { 'CF-E0H27PRH': subjectField('Digital Technologies; Food Technology; Technology') } },
      { id: 'CHRG-G32RFDZ', name: 'PDHPE', itemCode: 'Aus_07-10_PDHPE', customFields: { 'CF-E0H27PRH': subjectField('Health & PE; Physical Education') } }
    ]
  },
  'PLAN-TG9K5EY': {
    id: 'PLAN-TG9K5EY',
    replacementPlanIds: ['PLAN-EYJY1D9'],
    charges: [
      { id: 'CHRG-DZCPWQC', name: 'Technology', itemCode: 'Aus_07-10_Technology', customFields: { 'CF-E0H27PRH': subjectField('Digital Technologies; Food Technology; Technology') } },
      { id: 'CHRG-FJ0TYZK', name: 'PDHPE', itemCode: 'Aus_07-10_PDHPE', customFields: { 'CF-E0H27PRH': subjectField('Health & PE; Physical Education') } }
    ]
  }
});

module.exports = {
  RENEWAL_START,
  RENEWAL_END,
  buildSubscription,
  buildDraftRenewal,
  buildExistingOrder,
  buildPlans
};
