// Fixtures modelled on ORD-7V4N727 — "2027 Renewal: Dilworth School,
// Auckland" — and SUB-EXQ9N8M. Both real.
//
// This is a single-period EP order, and it is the one that proved the quote
// has to decide quantity there too:
//
//   charge          quoted   subscription
//   CHRG-NX6XC3K       100            107
//   CHRG-YJ6G27N       142            170
//   CHRG-69JTX8J        72             74
//   CHRG-BM3X8B8        92            109
//   CHRG-EMZGKCZ       150            109
//   CHRG-B1K66MY         0            109   <- deliberately zeroed by the rep
//   CHRG-23MJQGV       115            109
//   CHRG-7MCBK05        20            109
//
// Every quoted number differs from the subscription's. The old single-period
// path took the subscription's, so the five PLAN-6CGJDZ3 lines all came out
// at 109 (545 seats) instead of the quoted 377 — and a line the rep had set
// to zero came back carrying 109.
//
// Two other things this order carries that EP fixtures did not:
//   * The subscription took a mid-term amendment adding a block of free
//     "Plus" charges (sellUnitPrice 0, percent 1) that the quote re-tiers to
//     paid Core. Six charges share quantity 107 and five share 109, so
//     quantity alone cannot disambiguate them.
//   * ORD-7V4N727's CHRG-69JTX8J line points at subscription charge
//     e9ff81bd..., which no longer exists — the subscription has been
//     amended since (order says version 3, subscription is now 4). The uuid
//     tier misses and the match has to fall through to chargeId.

const RENEWAL_START = 1798714800;
const RENEWAL_END = 1830250800;
const SUB_START = 1767178800;
const SUB_MIDTERM = 1782648000; // where the free Plus block begins

const YEAR_OPTIONS = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13',
  'Staff', 'P/F/K', 'Platform Access', 'Implementation Fee',
  'All Year Groups (EdPotential)', 'Tertiary'
];

const attrs = (tier) => [
  { attributeDefinitionId: 'PATTRB-817VQ5E', attributeValue: tier },
  { attributeDefinitionId: 'PATTRB-8VPMPZZ', attributeValue: 'Independent' }
];
const PLUS = attrs('Plus');
const CORE = attrs('Core');

const notesField = (id) => ({
  id, type: 'STRING', name: 'Notes', label: 'Notes', value: '',
  selections: [], options: [], required: false, source: 'USER', defaultValue: null
});
const yearsField = (id, value) => ({
  id, type: 'MULTISELECT_PICKLIST', name: 'years', label: 'Year Groups',
  value: value === undefined ? null : value,
  selections: value ? value.split(';').map(v => v.trim()).filter(Boolean) : [],
  options: YEAR_OPTIONS, required: false, source: 'USER', defaultValue: null
});
const orderCustomFields = (years) => [notesField('CF-NFH5VBNH'), yearsField('CF-NFTKQDH2', years)];
const chargeCustomFields = (years) => ({
  'CF-B0CZ41JW': notesField(undefined),
  'CF-4EJ2B59D': yearsField(undefined, years)
});

// id, chargeId, qty, list, sell, start, years, tier (null = no attributes)
const SUBSCRIPTION_CHARGES = [
  ['e160f8ee', 'CHRG-1DJMP24', 92, 49, 0, SUB_MIDTERM, '12; 13', PLUS],
  ['a4a4912e', 'CHRG-2F34DVV', 128, 49, 0, SUB_MIDTERM, '12; 13', PLUS],
  ['33532ccf', 'CHRG-1FQT4KK', 170, 49, 0, SUB_MIDTERM, '9; 10', PLUS],
  ['7030882c', 'CHRG-DDG0ET7', 170, 32, 30, SUB_START, '12; 13', CORE],
  ['ab866ff5', 'CHRG-TC5FX88', 20, 49, 0, SUB_MIDTERM, '12; 13', PLUS],
  ['77d90496', 'CHRG-7DHYRWJ', 107, 40, 0, SUB_MIDTERM, '7; 8', PLUS],
  ['cbcae37c', 'CHRG-YKNHN0C', 170, 49, 0, SUB_MIDTERM, '9; 10', PLUS],
  ['37224099', 'CHRG-7CZK1KN', 107, 40, 0, SUB_MIDTERM, '7; 8', PLUS],
  ['4fd3bf8e', 'CHRG-1DJMP24', 0, 32, 32, SUB_START, null, CORE],
  ['de2f0e38', 'CHRG-TC5FX88', 0, 32, 32, SUB_START, null, CORE],
  ['3ed53737', 'CHRG-GX6MBNG', 0, 32, 32, SUB_START, null, CORE],
  ['05d09104', 'CHRG-B1K66MY', 109, 49, 0, SUB_MIDTERM, '11', PLUS],
  ['2c37a3c5', 'CHRG-DDG0ET7', 170, 49, 0, SUB_MIDTERM, '12; 13', PLUS],
  ['354ed6a7', 'CHRG-CD6N604', 170, 49, 0, SUB_MIDTERM, '9; 10', PLUS],
  ['ed5f9dde', 'CHRG-69JTX8J', 74, 89, 88, SUB_START, '11', null],
  ['6a67bb58', 'CHRG-EMZGKCZ', 109, 49, 0, SUB_MIDTERM, '11', PLUS],
  ['fe546da8', 'CHRG-8GFX6BB', 107, 40, 0, SUB_MIDTERM, '7; 8', PLUS],
  ['5ff3186d', 'CHRG-YJ6G27N', 170, 89, 88, SUB_START, '9; 10', null],
  ['21f5e2c8', 'CHRG-P5WT6PK', 107, 40, 0, SUB_MIDTERM, '7; 8', PLUS],
  ['b9707e26', 'CHRG-NX6XC3K', 107, 89, 88, SUB_START, '7; 8', null],
  ['5c94749f', 'CHRG-7MCBK05', 109, 49, 0, SUB_MIDTERM, '11', PLUS],
  ['c0003cfc', 'CHRG-BM3X8B8', 109, 49, 0, SUB_MIDTERM, '11', PLUS],
  ['3b48ad49', 'CHRG-KWDHVX5', 170, 49, 0, SUB_MIDTERM, '9; 10', PLUS],
  ['fd56c6ab', 'CHRG-WMJW0CM', 107, 40, 0, SUB_MIDTERM, '7; 8', PLUS],
  ['dee0a741', 'CHRG-4V6PYED', 170, 49, 0, SUB_MIDTERM, '9; 10', PLUS],
  ['ebd453b3', 'CHRG-23MJQGV', 109, 49, 0, SUB_MIDTERM, '11', PLUS],
  ['bd5f8a5c', 'CHRG-2F34DVV', 128, 32, 30, SUB_START, '12; 13', CORE]
];

const buildSubscription = () => ({
  id: 'SUB-EXQ9N8M',
  version: 4,
  entityId: 'ENT-MNJ0N5D',
  accountId: 'ACCT-DQ4VDTQ',
  state: 'ACTIVE',
  startDate: SUB_START,
  endDate: RENEWAL_START,
  billingCycle: { cycle: 'YEAR', step: 1 },
  paymentTerm: 'NET14',
  billingTerm: 'UP_FRONT',
  autoRenew: true,
  charges: SUBSCRIPTION_CHARGES.map(
    ([id, chargeId, quantity, list, sell, startDate, years, attributes], index) => {
      const charge = {
        id,
        groupId: `dilworth-group-${index + 1}`,
        accountId: 'ACCT-DQ4VDTQ',
        chargeId,
        quantity,
        isRamp: false,
        listUnitPrice: list,
        sellUnitPrice: sell,
        discounts: sell < list
          ? [{ name: 'default', percent: 1 - (sell / list), discountAmount: null, status: null, discountedPrice: null }]
          : [],
        predefinedDiscounts: [],
        startDate,
        endDate: RENEWAL_START,
        customFields: chargeCustomFields(years)
      };
      if (attributes) charge.attributeReferences = attributes;
      return charge;
    })
});

// chargeId, planId, subscriptionChargeId, qty, list, sell, years, attrs,
// [overrideRatio, overrideBase], action
const ORDER_LINES = [
  ['CHRG-NX6XC3K', 'PLAN-7QX1B04', 'b9707e26', 100, 100, 93, '7; 8', null, [2.9411764705, 34], 'RENEWAL'],
  ['CHRG-YJ6G27N', 'PLAN-9WWPM8H', '5ff3186d', 142, 100, 93, '9; 10', null, [1.25, 80], 'RENEWAL'],
  // Points at a subscription charge that no longer exists.
  ['CHRG-69JTX8J', 'PLAN-Y17V6XV', 'e9ff81bd-22a6-4c5a-ac30-3ea86da4a996', 72, 100, 93, '11', null, [1.25, 80], 'RENEWAL'],
  ['CHRG-BM3X8B8', 'PLAN-6CGJDZ3', 'c0003cfc', 92, 35, 33.6, '12; 13', CORE, [1.0416666666, 33.6], 'RENEWAL'],
  ['CHRG-EMZGKCZ', 'PLAN-6CGJDZ3', '6a67bb58', 150, 35, 33.6, '12; 13', CORE, [1.0416666666, 33.6], 'RENEWAL'],
  ['CHRG-B1K66MY', 'PLAN-6CGJDZ3', '05d09104', 0, 49, 0, null, PLUS, null, 'RENEWAL'],
  ['CHRG-23MJQGV', 'PLAN-6CGJDZ3', 'ebd453b3', 115, 35, 33.6, '12; 13', CORE, [1.0416666666, 33.6], 'RENEWAL'],
  ['CHRG-7MCBK05', 'PLAN-6CGJDZ3', null, 20, 35, 33.6, '12; 13', CORE, [1.0416666666, 33.6], 'ADD']
];

const buildExistingOrder = () => ({
  id: 'ORD-7V4N727',
  entityId: 'ENT-MNJ0N5D',
  name: '2027 Renewal: Dilworth School, Auckland: Essentials - Sci - Math - TAME TAME',
  accountId: 'ACCT-DQ4VDTQ',
  orderType: 'RENEWAL',
  currency: 'NZD',
  paymentTerm: 'NET14',
  status: 'DRAFT',
  shippingContactId: 'CONT-1VCRZW0',
  billingContactId: 'CONT-1VCRZW0',
  lineItems: ORDER_LINES.map(
    ([chargeId, planId, subChargeId, quantity, list, sell, years, attributes, override, action], index) => {
      const line = {
        id: `dilworth-line-${index + 1}`,
        isDryRunItem: false,
        action,
        planId,
        chargeId,
        quantity,
        isRamp: false,
        listUnitPrice: list,
        sellUnitPrice: sell,
        discountAmount: (list - sell) * quantity,
        discounts: sell < list
          ? [{
            name: 'default',
            percent: 1 - (sell / list),
            discountAmount: null,
            status: null,
            discountedPrice: null,
            amount: (list - sell) * quantity
          }]
          : [],
        predefinedDiscounts: [],
        amount: sell * quantity,
        listAmount: list * quantity,
        taxEstimate: sell * quantity * 0.15,
        effectiveDate: RENEWAL_START,
        endDate: RENEWAL_END,
        customFields: orderCustomFields(years),
        dryRunItem: false
      };
      if (attributes) line.attributeReferences = attributes;
      if (subChargeId) line.subscriptionChargeId = subChargeId;
      if (override) {
        line.listPriceOverrideRatio = override[0];
        line.listUnitPriceBeforeOverride = override[1];
        line.listAmountBeforeOverride = override[1] * quantity;
      }
      return line;
    }),
  startDate: RENEWAL_START,
  endDate: RENEWAL_END,
  billingCycle: { cycle: 'YEAR', step: 1 },
  billingTerm: 'UP_FRONT',
  billingAnchorDate: RENEWAL_START,
  // Present but empty — not a ramped order.
  rampInterval: [],
  totalAmount: 41869.2,
  totalListAmount: 44595,
  sfdcOpportunityId: '60143821328',
  sfdcOpportunityName: '2027 Renewal: Dilworth School, Auckland: Essentials - Sci - Math - TAME',
  renewalForSubscriptionId: 'SUB-EXQ9N8M',
  renewalForSubscriptionVersion: 3,
  ownerId: 'USER-YCQECR1',
  autoRenew: true,
  startDateType: 'FIXED',
  subscriptionDurationModel: 'TERMED'
});

// A draft that carries every renewing charge forward on its own plan, each
// linked by subscriptionChargeId. `omitCharges` models the failure mode seen
// in production, where some quoted charges have no counterpart in the draft.
const buildDraftRenewal = ({ omitCharges = [] } = {}) => ({
  accountId: 'ACCT-DQ4VDTQ',
  orderType: 'RENEWAL',
  currency: 'NZD',
  paymentTerm: 'NET14',
  renewalForSubscriptionId: 'SUB-EXQ9N8M',
  billingContactId: 'CONT-1VCRZW0',
  shippingContactId: 'CONT-1VCRZW0',
  startDate: RENEWAL_START,
  endDate: RENEWAL_END,
  billingCycle: { cycle: 'YEAR', step: 1 },
  billingTerm: 'UP_FRONT',
  billingAnchorDate: RENEWAL_START,
  autoRenew: true,
  ownerId: 'USER-YCQECR1',
  lineItems: SUBSCRIPTION_CHARGES
    .filter(([, chargeId]) => !omitCharges.includes(chargeId))
    .map(([subChargeId, chargeId, quantity, list, sell, , years, attributes], index) => {
      const line = {
        id: `dilworth-draft-${index + 1}`,
        isDryRunItem: false,
        action: 'RENEWAL',
        planId: 'PLAN-6CGJDZ3',
        chargeId,
        subscriptionChargeId: subChargeId,
        quantity,
        listUnitPrice: list,
        sellUnitPrice: sell,
        discounts: sell < list
          ? [{ name: 'default', percent: 1 - (sell / list), discountAmount: null, status: null, discountedPrice: null }]
          : [],
        effectiveDate: RENEWAL_START,
        endDate: RENEWAL_END,
        customFields: orderCustomFields(years)
      };
      if (attributes) line.attributeReferences = attributes;
      return line;
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
