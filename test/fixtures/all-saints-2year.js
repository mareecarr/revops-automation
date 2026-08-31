// Fixtures modelled on ORD-WD9TZMR — "2027-2028 Renewal: All Saints' College,
// Perth" — and SUB-EBEQYH4, both real.
//
// What makes this deal different from the Methodist one: the subscription
// took a mid-term amendment halfway through 2026 that added a block of "Plus"
// upgrade charges, and the renewal order does not carry them forward (the
// opportunity is named "Plus 2027 only"). draftRenewal still offers every one
// of them, because they are live on the subscription right up to its end.
//
// So the fresh draft proposes ten billable lines and 1,685 seats that the
// 790-seat quote does not contain — including seven charges all sitting at
// quantity 140, which no matching tier can tell apart.
//
// The draftRenewal payload is reconstructed; the order and subscription are
// as captured.

const P1 = 1798714800; // renewal start / subscription end
const P2 = 1830250800; // ramp boundary
const END = 1861873200;

const S0 = 1767178800; // subscription start
const SM = 1782820800; // mid-term amendment — where the Plus block begins

const YEAR_OPTIONS = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13',
  'Staff', 'P/F/K', 'Platform Access', 'Implementation Fee',
  'All Year Groups (EdPotential)', 'Tertiary'
];

const attrs = (tier, sector) => [
  { attributeDefinitionId: 'PATTRB-817VQ5E', attributeValue: tier },
  { attributeDefinitionId: 'PATTRB-8VPMPZZ', attributeValue: sector }
];
const PLUS = attrs('Plus', 'Independent');
const CORE = attrs('Core', 'Independent');
const PLUS_GOV = attrs('Plus', 'Gov > 930');

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

// Subscription charges return customFields keyed by field id, not as a list.
const chargeCustomFields = (years) => ({
  'CF-B0CZ41JW': notesField(undefined),
  'CF-4EJ2B59D': yearsField(undefined, years)
});

let lineSeq = 0;
const orderLine = ({
  planId, chargeId, quantity, isRamp, listUnitPrice, sellUnitPrice,
  effectiveDate, endDate, years = null, attributes, action = 'ADD',
  subscriptionChargeId, replacedPlanId, listPriceOverrideRatio,
  listUnitPriceBeforeOverride
}) => {
  const discounted = sellUnitPrice < listUnitPrice;
  const line = {
    id: `wd9-line-${String(++lineSeq).padStart(3, '0')}`,
    isDryRunItem: false,
    action,
    planId,
    chargeId,
    quantity,
    isRamp,
    listUnitPrice,
    sellUnitPrice,
    discountAmount: discounted ? (listUnitPrice - sellUnitPrice) * quantity : 0,
    discounts: discounted
      ? [{
        name: 'default',
        percent: 1 - (sellUnitPrice / listUnitPrice),
        discountAmount: null,
        status: null,
        discountedPrice: null,
        amount: (listUnitPrice - sellUnitPrice) * quantity
      }]
      : [],
    predefinedDiscounts: [],
    amount: sellUnitPrice * quantity,
    listAmount: listUnitPrice * quantity,
    effectiveDate,
    endDate,
    customFields: orderCustomFields(years),
    dryRunItem: false
  };
  if (attributes) line.attributeReferences = attributes;
  if (subscriptionChargeId) line.subscriptionChargeId = subscriptionChargeId;
  if (replacedPlanId) line.replacedPlanId = replacedPlanId;
  if (listPriceOverrideRatio != null) {
    line.listPriceOverrideRatio = listPriceOverrideRatio;
    line.listUnitPriceBeforeOverride = listUnitPriceBeforeOverride;
  }
  return line;
};

// The four billable lines the deal was actually quoted on. Period 1 is priced
// at the "Plus" tier and period 2 drops back to "Core" — hence "Plus 2027
// only".
const QUOTED_BILLABLE = [
  { planId: 'PLAN-CW65QFW', chargeId: 'CHRG-TQ9CHVP', quantity: 230, years: '4; 5; 6', subscriptionChargeId: '0a7058b6-74a2-428b-9d60-40983769e108', p1: [60, 39.9], p2: [42, 41.1], p2Override: [1.1052631578, 38] },
  { planId: 'PLAN-GHVVWF9', chargeId: 'CHRG-PFR72B4', quantity: 375, years: '7; 8; 9; 10', p1: [79, 47.38], p2: [54.1, 48.8], p2Override: [1.0504854368, 51.5] },
  { planId: 'PLAN-GHVVWF9', chargeId: 'CHRG-W9V9GW5', quantity: 160, years: '7; 8', p1: [79, 47.38], p2: [51.5, 48.8] },
  { planId: 'PLAN-DCK63P6', chargeId: 'CHRG-6T5J1FH', quantity: 25, years: '11; 12', p1: [79, 47.38], p2: [51.5, 48.8] }
];

// Zero-quantity catalog lines spanning the whole two years.
const QUOTED_FULL_SPAN = [
  ['PLAN-CW65QFW', 'CHRG-ERWT3WR', 38, '0f596e5f-467a-4de1-a783-e7face206812', 'RENEWAL'],
  ['PLAN-CW65QFW', 'CHRG-TWE6VH2', 38, '3a094581-eeae-41aa-bf1c-b8c7c4c6c04e', 'RENEWAL'],
  ['PLAN-CW65QFW', 'CHRG-FN1BFRJ', 38, 'a2b115d5-f1a2-49f5-8c50-5e83c30bc15e', 'RENEWAL'],
  ['PLAN-CW65QFW', 'CHRG-XTK6HW2', 38, 'fee89548-9ae4-4e5a-bacf-75190e894c3a', 'RENEWAL'],
  ['PLAN-CW65QFW', 'CHRG-9RQCPHP', 38, 'a0e817c7-4157-432b-a459-0e420a5216b2', 'RENEWAL'],
  ['PLAN-CW65QFW', 'CHRG-9YWEF3G', 38, 'e27e5ef4-07e4-470e-9efe-f328db8649f6', 'RENEWAL'],
  ['PLAN-CW65QFW', 'CHRG-2DJJ4EM', 12, 'e1819060-d7be-4359-ae0a-bf43bb4ca1c9', 'RENEWAL'],
  ['PLAN-CW65QFW', 'CHRG-18X7CHB', 38, 'de5e636c-5248-4667-94f6-bf74bed983af', 'RENEWAL'],
  ['PLAN-GHVVWF9', 'CHRG-W2V950C', 51.5, null, 'ADD', 'PLAN-CMJB619'],
  ['PLAN-GHVVWF9', 'CHRG-8XTEG07', 51.5, null, 'ADD', 'PLAN-CMJB619'],
  ['PLAN-GHVVWF9', 'CHRG-BWJCB3F', 51.5, null, 'ADD', 'PLAN-CMJB619'],
  ['PLAN-DCK63P6', 'CHRG-4KF5RH4', 51.5, null, 'ADD'],
  ['PLAN-DCK63P6', 'CHRG-1TKH0ZG', 51.5, null, 'ADD'],
  ['PLAN-DCK63P6', 'CHRG-EGYVEMW', 51.5, null, 'ADD'],
  ['PLAN-DCK63P6', 'CHRG-K7210X0', 51.5, null, 'ADD']
];

const buildExistingOrder = () => {
  lineSeq = 0;
  const lineItems = [];

  for (const line of QUOTED_BILLABLE) {
    lineItems.push(orderLine({
      planId: line.planId,
      chargeId: line.chargeId,
      quantity: line.quantity,
      isRamp: true,
      listUnitPrice: line.p1[0],
      sellUnitPrice: line.p1[1],
      effectiveDate: P1,
      endDate: P2,
      years: line.years,
      attributes: PLUS,
      subscriptionChargeId: line.subscriptionChargeId
    }));
    lineItems.push(orderLine({
      planId: line.planId,
      chargeId: line.chargeId,
      quantity: line.quantity,
      isRamp: true,
      listUnitPrice: line.p2[0],
      sellUnitPrice: line.p2[1],
      effectiveDate: P2,
      endDate: END,
      years: line.years,
      attributes: CORE,
      subscriptionChargeId: line.subscriptionChargeId,
      listPriceOverrideRatio: line.p2Override ? line.p2Override[0] : undefined,
      listUnitPriceBeforeOverride: line.p2Override ? line.p2Override[1] : undefined
    }));
  }

  for (const [planId, chargeId, price, subscriptionChargeId, action, replacedPlanId] of QUOTED_FULL_SPAN) {
    lineItems.push(orderLine({
      planId,
      chargeId,
      quantity: 0,
      isRamp: false,
      listUnitPrice: price,
      sellUnitPrice: price,
      effectiveDate: P1,
      endDate: END,
      attributes: CORE,
      action,
      subscriptionChargeId,
      replacedPlanId
    }));
  }

  return {
    id: 'ORD-WD9TZMR',
    entityId: 'ENT-MNJ0N5D',
    name: "2027-2028 Renewal: All Saints' College, Perth: Lang - Eng",
    accountId: 'ACCT-T6CGRX0',
    orderType: 'RENEWAL',
    currency: 'AUD',
    paymentTerm: 'NET14',
    status: 'DRAFT',
    shippingContactId: 'CONT-Z737ZJ6',
    billingContactId: 'CONT-Z737ZJ6',
    lineItems,
    startDate: P1,
    endDate: END,
    termLength: { cycle: 'YEAR', step: 2 },
    billingCycle: { cycle: 'YEAR', step: 1 },
    billingTerm: 'UP_FRONT',
    billingAnchorDate: P1,
    rampInterval: [P1, P2],
    totalAmount: 72490.8,
    totalListAmount: 97515,
    sfdcOpportunityId: '60142895178',
    sfdcOpportunityName: "2027-2028 Renewal: All Saints' College, Perth: Y4-12 Lang - Y7-8 Eng (Plus 2027 only)",
    renewalForSubscriptionId: 'SUB-EBEQYH4',
    ownerId: 'USER-V8T26D5',
    autoRenew: true
  };
};

// id, chargeId, qty, list, sell, start, end, years, attributes
const SUBSCRIPTION_CHARGES = [
  ['a0e817c7', 'CHRG-9RQCPHP', 0, 38, 38, S0, P1, null, CORE],
  ['fe1727c6', 'CHRG-F38PDEK', 0, 329, 329, SM, P1, null, null],
  ['fa4f1aae', 'CHRG-ZHFTN4X', 0, 49, 49, S0, P1, null, CORE],
  ['40fecdcd', 'CHRG-1ZCF3J6', 0, 49, 49, S0, P1, null, CORE],
  ['130a03fa', 'CHRG-G32RFDZ', 140, 45, 18.9, SM, P1, '8', PLUS_GOV],
  ['135b67cc', 'CHRG-TNG3CZG', 0, 25.5, 25.5, SM, P1, null, CORE],
  ['a2b115d5', 'CHRG-FN1BFRJ', 0, 38, 38, S0, P1, null, CORE],
  ['fbee6b1b', 'CHRG-4F7PC2M', 140, 79, 18.9, SM, P1, '8', PLUS],
  ['fc2f4a91', 'CHRG-N9VNCEG', 140, 79, 18.9, SM, P1, '8', PLUS],
  ['780f3138', 'CHRG-TQ9CHVP', 230, 38, 38, S0, SM, '4; 5; 6', CORE],
  ['c8c20605', 'CHRG-N9VNCEG', 235, 49, 40.1, S0, SM, '7; 9; 10', CORE],
  ['6a82dba6', 'CHRG-99QCRB7', 140, 79, 18.9, SM, P1, '8', PLUS],
  ['ab4e3167', 'CHRG-4091V3F', 460, 49, 40.1, S0, SM, '7; 9; 10', CORE],
  ['bcb1d2c6', 'CHRG-45NK9MD', 0, 12, 12, SM, P1, null, CORE],
  ['e66d7164', 'CHRG-N9VNCEG', 235, 79, 40.1, SM, P1, '7; 9; 10', PLUS],
  ['91e8a25f', 'CHRG-12Y3PB2', 0, 329, 329, S0, P1, null, null],
  ['053613dc', 'CHRG-RTC7YRP', 140, 30.6, 18.9, SM, P1, '8', PLUS],
  ['effe6f9a', 'CHRG-5DRR6YH', 0, 49, 49, S0, P1, null, CORE],
  ['a3c02c86', 'CHRG-ZYHZ5BH', 0, 49, 49, S0, P1, null, CORE],
  ['86224768', 'CHRG-HQGX73G', 0, 15, 15, S0, P1, null, null],
  ['cd2be02f', 'CHRG-ZHFTN4X', 140, 79, 18.9, SM, P1, '8', PLUS],
  ['2e48b9bd', 'CHRG-MT1FCH4', 0, 49, 49, SM, P1, null, CORE],
  ['30ea3235', 'CHRG-Y1JWZ9T', 25, 49, 35, S0, SM, '11; 12', CORE],
  ['f3672757', 'CHRG-TQ9CHVP', 230, 60, 38, SM, P1, '4; 5; 6', PLUS],
  ['f79cdbff', 'CHRG-99QCRB7', 0, 49, 49, S0, P1, null, CORE],
  ['e1819060', 'CHRG-2DJJ4EM', 0, 12, 12, S0, P1, null, CORE],
  ['fee89548', 'CHRG-XTK6HW2', 0, 38, 38, S0, P1, null, CORE],
  ['f412e0ea', 'CHRG-4091V3F', 140, 79, 18.9, SM, P1, '8', PLUS],
  ['0f596e5f', 'CHRG-ERWT3WR', 0, 38, 38, S0, P1, null, CORE],
  ['3a094581', 'CHRG-TWE6VH2', 0, 38, 38, S0, P1, null, CORE],
  ['cc511ed3', 'CHRG-RHX8VCN', 140, 133.5, 132.3, S0, SM, '8', null],
  ['e27e5ef4', 'CHRG-9YWEF3G', 0, 38, 38, S0, P1, null, CORE],
  ['2149b24b', 'CHRG-4F7PC2M', 0, 49, 49, S0, P1, null, CORE],
  ['acbf0f9f', 'CHRG-YDJPWXR', 0, 25.5, 25.5, SM, P1, null, CORE],
  ['1cb97296', 'CHRG-ZHFTN4X', 10, 79, 0, SM, P1, '7', PLUS],
  ['7624f4cd', 'CHRG-4091V3F', 460, 79, 40.1, SM, P1, '7; 9; 10', PLUS],
  ['de5e636c', 'CHRG-18X7CHB', 0, 38, 38, S0, P1, null, CORE],
  ['733f4d2d', 'CHRG-1CM34Z2', 0, 49, 49, S0, P1, null, CORE],
  ['af310024', 'CHRG-Y1JWZ9T', 25, 79, 35, SM, P1, '11; 12', PLUS]
];

const buildSubscription = () => ({
  id: 'SUB-EBEQYH4',
  version: 2,
  entityId: 'ENT-MNJ0N5D',
  accountId: 'ACCT-T6CGRX0',
  state: 'ACTIVE',
  startDate: S0,
  endDate: P1,
  billingCycle: { cycle: 'YEAR', step: 1 },
  paymentTerm: 'NET14',
  billingTerm: 'UP_FRONT',
  autoRenew: true,
  charges: SUBSCRIPTION_CHARGES.map(
    ([id, chargeId, quantity, listUnitPrice, sellUnitPrice, startDate, endDate, years, attributes], index) => {
      const charge = {
        id,
        groupId: `group-${String(index + 1).padStart(3, '0')}`,
        accountId: 'ACCT-T6CGRX0',
        chargeId,
        quantity,
        isRamp: false,
        listUnitPrice,
        sellUnitPrice,
        discounts: sellUnitPrice < listUnitPrice
          ? [{ name: 'default', percent: 1 - (sellUnitPrice / listUnitPrice), discountAmount: null, status: null, discountedPrice: null }]
          : [],
        startDate,
        endDate,
        customFields: chargeCustomFields(years)
      };
      if (attributes) charge.attributeReferences = attributes;
      return charge;
    })
});

// The zero-quantity catalog lines the draft carries, listed first so they
// claim their full-span counterparts before the billable lines are matched —
// which is what leaves the extra billable lines with nothing to match.
const DRAFT_ZERO_QUANTITY = [
  ...QUOTED_FULL_SPAN.map(([planId, chargeId, price]) => [planId, chargeId, price]),
  ['PLAN-CW65QFW', 'CHRG-1ZCF3J6', 49],
  ['PLAN-CW65QFW', 'CHRG-5DRR6YH', 49],
  ['PLAN-CW65QFW', 'CHRG-ZYHZ5BH', 49],
  ['PLAN-CW65QFW', 'CHRG-1CM34Z2', 49],
  ['PLAN-CW65QFW', 'CHRG-MT1FCH4', 49],
  ['PLAN-CW65QFW', 'CHRG-HQGX73G', 15]
];

// The billable lines the draft proposes. The first four are the deal; the
// rest are the mid-term Plus block the quote does not carry, seven of them
// indistinguishable at quantity 140.
const DRAFT_BILLABLE = [
  ['PLAN-CW65QFW', 'CHRG-TQ9CHVP', 230, 60, 'f3672757'],
  ['PLAN-GHVVWF9', 'CHRG-PFR72B4', 460, 51.5, null],
  ['PLAN-GHVVWF9', 'CHRG-W9V9GW5', 235, 51.5, null],
  ['PLAN-DCK63P6', 'CHRG-6T5J1FH', 25, 51.5, null],
  ['PLAN-GHVVWF9', 'CHRG-DZCPWQC', 140, 51.5, null],
  ['PLAN-GHVVWF9', 'CHRG-FJ0TYZK', 140, 51.5, null],
  ['PLAN-GHVVWF9', 'CHRG-W2V950C', 140, 51.5, null],
  ['PLAN-GHVVWF9', 'CHRG-PFR72B4', 140, 51.5, null],
  ['PLAN-GHVVWF9', 'CHRG-8XTEG07', 140, 51.5, null],
  ['PLAN-GHVVWF9', 'CHRG-W9V9GW5', 140, 51.5, null],
  ['PLAN-GHVVWF9', 'CHRG-BWJCB3F', 140, 51.5, null],
  ['PLAN-GHVVWF9', 'CHRG-W2V950C', 460, 51.5, null],
  ['PLAN-GHVVWF9', 'CHRG-PFR72B4', 235, 51.5, null],
  ['PLAN-GHVVWF9', 'CHRG-W9V9GW5', 10, 51.5, null]
];

const buildDraftRenewal = ({ startDate = P1, endDate = P2 } = {}) => {
  let seq = 0;
  const line = (planId, chargeId, quantity, price, subscriptionChargeId) => {
    const built = {
      id: `wd9-draft-${String(++seq).padStart(3, '0')}`,
      isDryRunItem: false,
      action: 'RENEWAL',
      planId,
      chargeId,
      quantity,
      listUnitPrice: price,
      sellUnitPrice: price,
      discounts: [],
      effectiveDate: startDate,
      endDate,
      attributeReferences: CORE,
      customFields: orderCustomFields(null)
    };
    if (subscriptionChargeId) built.subscriptionChargeId = subscriptionChargeId;
    return built;
  };

  return {
    accountId: 'ACCT-T6CGRX0',
    orderType: 'RENEWAL',
    currency: 'AUD',
    paymentTerm: 'NET14',
    renewalForSubscriptionId: 'SUB-EBEQYH4',
    billingContactId: 'CONT-Z737ZJ6',
    shippingContactId: 'CONT-Z737ZJ6',
    startDate,
    endDate,
    billingCycle: { cycle: 'YEAR', step: 1 },
    billingTerm: 'UP_FRONT',
    billingAnchorDate: startDate,
    termLength: { cycle: 'YEAR', step: 1 },
    autoRenew: true,
    ownerId: 'USER-V8T26D5',
    lineItems: [
      ...DRAFT_ZERO_QUANTITY.map(([planId, chargeId, price]) => line(planId, chargeId, 0, price, null)),
      ...DRAFT_BILLABLE.map(([planId, chargeId, quantity, price, subChargeId]) =>
        line(planId, chargeId, quantity, price, subChargeId))
    ],
    customFields: []
  };
};

module.exports = {
  P1,
  P2,
  END,
  buildSubscription,
  buildDraftRenewal,
  buildExistingOrder
};
