// Fixtures modelled on ORD-7723YDP — "2027 Renewal: Gulf Christian College,
// Normanton" — and SUB-FFPG3KT. Both real.
//
// This is NOT a matching bug. draftRenewal for SUB-FFPG3KT came back with
// ten line items, every single one at quantity 0 — including the successor
// of CHRG-RHX8VCN, a genuinely paid $6,480 charge (132.30 x 41 seats) still
// live on the subscription today, no discount at all. The quote asks for
// 192 seats across four charges; the fresh draft offers none of them, paid
// or complimentary. No cohort logic can invent a quantity Subskribe itself
// did not propose — this needs a human to look at why Subskribe's own
// renewal computation for this subscription came back empty, not a fix to
// the rebuild's matching passes.
//
// Kept deliberately minimal: only what is needed to reproduce the all-zero
// draft and the quoted total it is measured against.

const RENEWAL_START = 1798714800;
const RENEWAL_END = 1830250800;
const SUB_START = 1767178800;
const AMENDMENT_START = 1788177600;

const YEAR_OPTIONS = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13',
  'Staff', 'P/F/K', 'Platform Access', 'Implementation Fee',
  'All Year Groups (EdPotential)', 'Tertiary'
];

const CORE_INDEPENDENT = [
  { attributeDefinitionId: 'PATTRB-817VQ5E', attributeValue: 'Core' },
  { attributeDefinitionId: 'PATTRB-8VPMPZZ', attributeValue: 'Independent' }
];

const notesField = (id, value) => ({
  id, type: 'STRING', name: 'Notes', label: 'Notes', value: value === undefined ? null : value,
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

const orderCustomFields = (years, notes) => [
  yearsField('CF-NFTKQDH2', years),
  notesField('CF-NFH5VBNH', notes)
];

const chargeCustomFields = (years, notes) => ({
  'CF-B0CZ41JW': notesField(undefined, notes),
  'CF-4EJ2B59D': yearsField(undefined, years)
});

const discountsFor = (list, sell) => (list && sell != null && sell < list)
  ? [{ name: 'default', percent: 1 - (sell / list), discountAmount: null, status: null, discountedPrice: null }]
  : [];

// The current (v3) subscription: three "Complimentary" (100% discount)
// charges at 35 seats each, plus one genuinely PAID charge at 41 seats /
// $132.30 with no discount at all.
// id, chargeId, qty, list, sell, years, startDate, notes
const SUBSCRIPTION_CHARGES = [
  ['3b7efd28', 'CHRG-C4YB245', 35, 25.5, 0, '7; 8; 9', AMENDMENT_START, 'Complimentary'],
  ['a36cb932', 'CHRG-RG7WJ8T', 35, 25.5, 0, '7; 8; 9', SUB_START, ''],
  ['63c1646d', 'CHRG-5DW1HGQ', 35, 25.5, 0, '7; 8; 9', AMENDMENT_START, 'Complimentary'],
  ['7a68fa0b', 'CHRG-RHX8VCN', 41, 132.3, 132.3, '7; 8; 9', SUB_START, null]
];

const buildSubscription = () => ({
  id: 'SUB-FFPG3KT',
  version: 3,
  entityId: 'ENT-MNJ0N5D',
  accountId: 'ACCT-1XX61QF',
  shippingContactId: 'CONT-QG3PXQ7',
  billingContactId: 'CONT-QG3PXQ7',
  state: 'ACTIVE',
  startDate: SUB_START,
  endDate: RENEWAL_START,
  billingCycle: { cycle: 'YEAR', step: 1 },
  paymentTerm: 'NET14',
  billingTerm: 'UP_FRONT',
  autoRenew: true,
  renewedFromSubscriptionId: 'SUB-WZVR9Y6',
  charges: SUBSCRIPTION_CHARGES.map(([id, chargeId, quantity, list, sell, years, startDate, notes], index) => {
    const attrs = chargeId === 'CHRG-RHX8VCN' ? null : CORE_INDEPENDENT;
    const charge = {
      id,
      groupId: `gulf-group-${index + 1}`,
      accountId: 'ACCT-1XX61QF',
      chargeId,
      quantity,
      isRamp: false,
      listUnitPrice: list,
      sellUnitPrice: sell,
      discounts: discountsFor(list, sell),
      predefinedDiscounts: [],
      startDate,
      endDate: RENEWAL_START,
      customFields: chargeCustomFields(years, notes)
    };
    if (attrs) charge.attributeReferences = attrs;
    return charge;
  })
});

// ORD-7723YDP as quoted: 48 seats on each of the same four charges, total
// 192 — CHRG-RHX8VCN carries a negotiated listPriceOverrideRatio (a real
// absolute override, list 120 -> 135), the other three are the same 100%
// discount the subscription carries today.
const QUOTE_LINES = [
  ['CHRG-RG7WJ8T', 'PLAN-GH26ZF8', 48, 25.5, 0, '7; 8; 9; 10', 'Complimentary', null],
  ['CHRG-RHX8VCN', 'PLAN-N8C3C59', 48, 135, 135, '7; 8; 9; 10', '2027 Essentials Pkg', { ratio: 1.125, base: 120 }],
  ['CHRG-5DW1HGQ', 'PLAN-GH26ZF8', 48, 25.5, 0, '7; 8; 9; 10', 'Complimentary', null],
  ['CHRG-C4YB245', 'PLAN-GH26ZF8', 48, 25.5, 0, '7; 8; 9; 10', 'Complimentary', null]
];

const buildExistingOrder = () => ({
  id: 'ORD-7723YDP',
  entityId: 'ENT-MNJ0N5D',
  externalId: '60134859893',
  name: '2027 Renewal: Gulf Christian College, Normanton: Arts - Essentials -',
  accountId: 'ACCT-1XX61QF',
  orderType: 'RENEWAL',
  currency: 'AUD',
  paymentTerm: 'NET14',
  status: 'APPROVED',
  shippingContactId: 'CONT-QG3PXQ7',
  billingContactId: 'CONT-QG3PXQ7',
  lineItems: QUOTE_LINES.map(([chargeId, planId, quantity, list, sell, years, notes, override], index) => {
    const line = {
      id: `gulf-quote-${index + 1}`,
      isDryRunItem: false,
      action: 'RENEWAL',
      planId,
      chargeId,
      quantity,
      isRamp: false,
      listUnitPrice: list,
      sellUnitPrice: sell,
      discountAmount: (list - sell) * quantity,
      discounts: override ? [] : discountsFor(list, sell),
      predefinedDiscounts: [],
      amount: sell * quantity,
      listAmount: list * quantity,
      effectiveDate: RENEWAL_START,
      endDate: RENEWAL_END,
      customFields: orderCustomFields(years, notes),
      dryRunItem: false
    };
    if (chargeId !== 'CHRG-RHX8VCN') line.attributeReferences = CORE_INDEPENDENT;
    if (override) {
      line.listPriceOverrideRatio = override.ratio;
      line.listUnitPriceBeforeOverride = override.base;
      line.listAmountBeforeOverride = override.base * quantity;
    }
    return line;
  }),
  startDate: RENEWAL_START,
  endDate: RENEWAL_END,
  billingCycle: { cycle: 'YEAR', step: 1 },
  billingTerm: 'UP_FRONT',
  billingAnchorDate: RENEWAL_START,
  totalAmount: 6480,
  totalListAmount: 10152,
  sfdcOpportunityId: '60134859893',
  sfdcOpportunityName: '2027 Renewal: Gulf Christian College, Normanton: Arts - Essentials -',
  renewalForSubscriptionId: 'SUB-FFPG3KT',
  renewalForSubscriptionVersion: 2,
  ownerId: 'USER-Q4EXQN2',
  autoRenew: true,
  startDateType: 'FIXED',
  customFields: []
});

// The real draftRenewal for SUB-FFPG3KT: ten line items, every single one
// at quantity 0. Five distinct chargeIds, each appearing twice — once
// replacing PLAN-N8C3C59, once replacing PLAN-GH26ZF8 — all on the new
// PLAN-GHVVWF9, all list = sell = 51.50, no discount, no Year Groups. None
// of it carries a single seat, paid or complimentary.
const DRAFT_CHARGE_IDS = ['CHRG-W9V9GW5', 'CHRG-8XTEG07', 'CHRG-PFR72B4', 'CHRG-BWJCB3F', 'CHRG-W2V950C'];

const buildDraftRenewal = ({ startDate = RENEWAL_START, endDate = RENEWAL_END } = {}) => ({
  entityId: 'ENT-MNJ0N5D',
  accountId: 'ACCT-1XX61QF',
  orderType: 'RENEWAL',
  currency: 'AUD',
  paymentTerm: 'NET14',
  subscriptionTargetVersion: 1,
  shippingContactId: 'CONT-QG3PXQ7',
  billingContactId: 'CONT-QG3PXQ7',
  startDate,
  endDate,
  billingCycle: { cycle: 'YEAR', step: 1 },
  billingTerm: 'UP_FRONT',
  billingAnchorDate: startDate,
  autoRenew: true,
  lineItems: ['PLAN-N8C3C59', 'PLAN-GH26ZF8'].flatMap((replacedPlanId, group) =>
    DRAFT_CHARGE_IDS.map((chargeId, index) => ({
      id: `gulf-draft-${group}-${index + 1}`,
      isDryRunItem: false,
      action: 'ADD',
      planId: 'PLAN-GHVVWF9',
      chargeId,
      replacedPlanId,
      quantity: 0,
      isRamp: false,
      listUnitPrice: 51.5,
      sellUnitPrice: 51.5,
      discountAmount: 0,
      discounts: [],
      predefinedDiscounts: [],
      attributeReferences: CORE_INDEPENDENT,
      amount: 0,
      listAmount: 0,
      effectiveDate: startDate,
      endDate,
      customFields: orderCustomFields(undefined, undefined)
    }))
  ),
  status: 'DRAFT',
  renewalForSubscriptionId: 'SUB-FFPG3KT',
  renewalForSubscriptionVersion: 3,
  customFields: []
});

module.exports = {
  RENEWAL_START,
  RENEWAL_END,
  buildSubscription,
  buildDraftRenewal,
  buildExistingOrder
};
