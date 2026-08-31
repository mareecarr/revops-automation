// Fixtures modelled on ORD-9X3HCPP — "2027 Renewal: Barramurra Public School,
// Oran Park: Essential Assessment" — and SUB-N0JCC5Q. Both real.
//
// Essential Assessment differs from Education Perfect in ways that exercise
// paths EP never reaches:
//
//   * No attributeReferences at all. EA is not rate-card priced; the sector
//     lives in the choice of plan ("EA Products (2026) Independent" vs
//     "... Government + Religious"), not in a price attribute. So every
//     buildAttributeKey() comes back empty and the attribute-based matching
//     tiers can no longer discriminate — only chargeId, quantity and the
//     subscription charge link can.
//   * Single period. No termLength, no rampInterval, one date window. The
//     segment engine collapses to one period.
//   * A non-numeric Year Group. "P/F/K; 1; 2; 3; 4; 5; 6" is the value that
//     caught the normaliser rewriting the quote's own wording.
//   * action: "RENEWAL" on every line, where EP's are mostly "ADD".
//   * taxEstimate on lines and on the order, which EP orders do not carry.
//
// The draftRenewal payload is reconstructed. PLAN-T7N6194 is still ACTIVE and
// carries no replacementPlanIds, so a fresh draft proposes the same plan and
// the same charge ids at catalog price — the straightforward case.

const RENEWAL_START = 1798714800; // subscription end / renewal start
const RENEWAL_END = 1830250800;   // one year later
const SUB_START = 1767178800;

const YEAR_OPTIONS = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13',
  'Staff', 'P/F/K', 'Platform Access', 'Implementation Fee',
  'All Year Groups (EdPotential)', 'Tertiary'
];

const notesField = (id) => ({
  id,
  type: 'STRING',
  name: 'Notes',
  label: 'Notes',
  value: '',
  selections: [],
  options: [],
  required: false,
  source: 'USER',
  defaultValue: null
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

// PLAN-T7N6194, "EA Products (2025)": three charges, one of which is sold.
// chargeId, subscriptionChargeId, quantity, list, sell, years
const LINES = [
  ['CHRG-1RTQMX6', '24b80d06-d276-49a4-bf5b-748fa4915c92', 1240, 20, 19, 'P/F/K; 1; 2; 3; 4; 5; 6'],
  ['CHRG-R2YDK4Q', null, 0, 14, 14, null],
  ['CHRG-KE876D4', null, 0, 14, 14, null]
];

const buildExistingOrder = () => ({
  id: 'ORD-9X3HCPP',
  entityId: 'ENT-H5MFM0T',
  externalId: '62315787276',
  name: "2027 Renewal: Barramurra Public School, Oran Park: Essential Assessment",
  accountId: 'ACCT-6RRFE93',
  orderType: 'RENEWAL',
  currency: 'AUD',
  paymentTerm: 'NET14',
  status: 'DRAFT',
  shippingContactId: 'CONT-RMMM7T3',
  billingContactId: 'CONT-RMMM7T3',
  lineItems: LINES.map(([chargeId, subscriptionChargeId, quantity, list, sell, years], index) => {
    const line = {
      id: `ea-line-${index + 1}`,
      isDryRunItem: false,
      action: 'RENEWAL',
      planId: 'PLAN-T7N6194',
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
      taxEstimate: sell * quantity * 0.1,
      effectiveDate: RENEWAL_START,
      endDate: RENEWAL_END,
      customFields: orderCustomFields(years),
      dryRunItem: false
    };
    if (subscriptionChargeId) line.subscriptionChargeId = subscriptionChargeId;
    return line;
  }),
  startDate: RENEWAL_START,
  endDate: RENEWAL_END,
  billingCycle: { cycle: 'YEAR', step: 1 },
  billingTerm: 'UP_FRONT',
  billingAnchorDate: RENEWAL_START,
  totalAmount: 23560,
  totalListAmount: 24800,
  taxEstimate: 2356,
  sfdcOpportunityId: '62315787276',
  isPrimaryOrderForSfdcOpportunity: true,
  sfdcOpportunityName: "2027 Renewal: Barramurra Public School, Oran Park: Essential Assessment",
  renewalForSubscriptionId: 'SUB-N0JCC5Q',
  renewalForSubscriptionVersion: 2,
  ownerId: 'USER-J04C7EZ',
  autoRenew: true,
  expiresOn: 1795950000,
  startDateType: 'FIXED'
});

// The current term: the same three charges, the sold one at 18 rather than the
// 19 the renewal quotes — a 5.6% uplift the rebuild has to preserve.
const SUBSCRIPTION_CHARGES = [
  ['24b80d06-d276-49a4-bf5b-748fa4915c92', 'CHRG-1RTQMX6', 1240, 20, 18, 'P/F/K; 1; 2; 3; 4; 5; 6'],
  ['4d3e352c-6f9a-4e42-8602-14dd50eec9b3', 'CHRG-KE876D4', 0, 14, 14, null],
  ['af56c61e-a119-4dc0-9d77-ca25efaec38a', 'CHRG-R2YDK4Q', 0, 14, 14, null]
];

const buildSubscription = () => ({
  id: 'SUB-N0JCC5Q',
  version: 2,
  entityId: 'ENT-H5MFM0T',
  accountId: 'ACCT-6RRFE93',
  state: 'ACTIVE',
  startDate: SUB_START,
  endDate: RENEWAL_START,
  billingCycle: { cycle: 'YEAR', step: 1 },
  paymentTerm: 'NET14',
  billingTerm: 'UP_FRONT',
  autoRenew: true,
  charges: SUBSCRIPTION_CHARGES.map(
    ([id, chargeId, quantity, list, sell, years], index) => ({
      id,
      groupId: `ea-group-${index + 1}`,
      accountId: 'ACCT-6RRFE93',
      chargeId,
      quantity,
      isRamp: false,
      listUnitPrice: list,
      sellUnitPrice: sell,
      discounts: sell < list
        ? [{ name: 'default', percent: 1 - (sell / list), discountAmount: null, status: null, discountedPrice: null }]
        : [],
      predefinedDiscounts: [],
      startDate: SUB_START,
      endDate: RENEWAL_START,
      customFields: chargeCustomFields(years)
    }))
});

// The real draft for SUB-N0JCC5Q (captured as ORD-C2MRPV6).
//
// Subskribe carries the subscription straight forward: the SAME plan
// (PLAN-T7N6194, the deprecated 2025 one), the same charge ids, and the
// subscription's own negotiated price — sell 18 at a 10% discount, not the
// 20 catalog list. No replacementPlanIds are configured on any EA plan, so
// there is no re-version to the 2026 plans and no charge rename to reconcile.
//
// That matters for the rebuild: the draft's 18 must lose to the 19 the
// renewal was quoted at, or the rebuild would quietly undo the uplift.
const buildDraftRenewal = ({ startDate = RENEWAL_START, endDate = RENEWAL_END } = {}) => ({
  accountId: 'ACCT-6RRFE93',
  orderType: 'RENEWAL',
  currency: 'AUD',
  paymentTerm: 'NET14',
  renewalForSubscriptionId: 'SUB-N0JCC5Q',
  billingContactId: 'CONT-RMMM7T3',
  shippingContactId: 'CONT-RMMM7T3',
  startDate,
  endDate,
  billingCycle: { cycle: 'YEAR', step: 1 },
  billingTerm: 'UP_FRONT',
  billingAnchorDate: startDate,
  autoRenew: true,
  ownerId: 'USER-J04C7EZ',
  subscriptionTargetVersion: 1,
  totalAmount: 22320,
  totalListAmount: 24800,
  lineItems: SUBSCRIPTION_CHARGES.map(([subChargeId, chargeId, quantity, list, sell, years], index) => ({
    id: `ea-draft-${index + 1}`,
    isDryRunItem: false,
    action: 'RENEWAL',
    planId: 'PLAN-T7N6194',
    chargeId,
    subscriptionChargeId: subChargeId,
    quantity,
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
    taxEstimate: sell * quantity * 0.1,
    effectiveDate: startDate,
    endDate,
    // The draft carries the subscription's Year Groups forward, unlike EP's
    // plan-swap drafts which default them away.
    customFields: orderCustomFields(years)
  })),
  customFields: []
});

module.exports = {
  RENEWAL_START,
  RENEWAL_END,
  buildSubscription,
  buildDraftRenewal,
  buildExistingOrder
};
