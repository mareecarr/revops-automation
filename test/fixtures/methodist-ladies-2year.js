// Fixtures modelled on ORD-39HY7JN — "2027-2028 [CAMPION]: Methodist Ladies'
// College, Perth" — a two-year RENEWAL order with an annual ramp.
//
// The existing order below is the real one: same charges, quantities,
// prices, ramp windows and Year Groups. The subscription and the fresh
// draftRenewal payload are reconstructed, because only the order itself was
// captured — they are shaped the way Subskribe returns them (a draft is a
// single one-year period, priced at catalog, with the tier attributes and
// Year Groups it defaults to).

const P1 = 1798714800; // 2027 term start
const P2 = 1830250800; // ramp boundary — 2028 term start
const END = 1861873200; // 2028 term end

const YEAR_OPTIONS = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13',
  'Staff', 'P/F/K', 'Platform Access', 'Implementation Fee',
  'All Year Groups (EdPotential)', 'Tertiary'
];

const CORE_INDEPENDENT = [
  { attributeDefinitionId: 'PATTRB-817VQ5E', attributeValue: 'Core' },
  { attributeDefinitionId: 'PATTRB-8VPMPZZ', attributeValue: 'Independent' }
];

const notesField = () => ({
  id: 'CF-NFH5VBNH',
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

const yearsField = (value) => ({
  id: 'CF-NFTKQDH2',
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

const customFields = (years) => [notesField(), yearsField(years)];

let lineSeq = 0;
const nextId = (prefix) => `${prefix}-${String(++lineSeq).padStart(4, '0')}`;

// One line item on the existing renewal order.
const orderLine = ({
  planId,
  chargeId,
  quantity,
  isRamp,
  listUnitPrice = 51.5,
  sellUnitPrice,
  effectiveDate,
  endDate,
  years = null,
  attributes = CORE_INDEPENDENT,
  listPriceOverrideRatio,
  listUnitPriceBeforeOverride
}) => {
  const discounted = sellUnitPrice < listUnitPrice;
  const line = {
    id: nextId('line'),
    isDryRunItem: false,
    action: 'ADD',
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
    customFields: customFields(years),
    dryRunItem: false
  };
  if (attributes) line.attributeReferences = attributes;
  if (listPriceOverrideRatio != null) {
    line.listPriceOverrideRatio = listPriceOverrideRatio;
    line.listUnitPriceBeforeOverride = listUnitPriceBeforeOverride;
    line.listAmountBeforeOverride = 0;
  }
  return line;
};

// The charges that renew: quantity, price and Year Groups as they stand on
// the CURRENT term, which is deliberately not what the renewal order quotes.
const SUBSCRIPTION_CHARGES = [
  { chargeId: 'CHRG-W9V9GW5', quantity: 325, sellUnitPrice: 35, years: '7; 8; 9' },
  { chargeId: 'CHRG-PFR72B4', quantity: 360, sellUnitPrice: 35, years: '6; 7; 8; 9' },
  { chargeId: 'CHRG-4KF5RH4', quantity: 16, sellUnitPrice: 35, years: '10; 11' },
  { chargeId: 'CHRG-6T5J1FH', quantity: 43, sellUnitPrice: 35, years: '10; 11' },
  { chargeId: 'CHRG-8XTEG07', quantity: 0, sellUnitPrice: 51.5 },
  { chargeId: 'CHRG-BWJCB3F', quantity: 0, sellUnitPrice: 51.5 },
  { chargeId: 'CHRG-W2V950C', quantity: 0, sellUnitPrice: 51.5 },
  { chargeId: 'CHRG-F38PDEK', quantity: 0, sellUnitPrice: 329, listUnitPrice: 329, attributes: null },
  { chargeId: 'CHRG-RTC7YRP', quantity: 0, sellUnitPrice: 25.5, listUnitPrice: 25.5 },
  { chargeId: 'CHRG-TNG3CZG', quantity: 0, sellUnitPrice: 25.5, listUnitPrice: 25.5 },
  { chargeId: 'CHRG-YDJPWXR', quantity: 0, sellUnitPrice: 25.5, listUnitPrice: 25.5 },
  { chargeId: 'CHRG-45NK9MD', quantity: 0, sellUnitPrice: 12, listUnitPrice: 12 },
  { chargeId: 'CHRG-G32RFDZ', quantity: 0, sellUnitPrice: 49, listUnitPrice: 49 },
  { chargeId: 'CHRG-MT1FCH4', quantity: 0, sellUnitPrice: 49, listUnitPrice: 49 },
  { chargeId: 'CHRG-1TKH0ZG', quantity: 0, sellUnitPrice: 51.5 },
  { chargeId: 'CHRG-EGYVEMW', quantity: 0, sellUnitPrice: 51.5 },
  { chargeId: 'CHRG-K7210X0', quantity: 0, sellUnitPrice: 51.5 }
];

const PLAN_BY_CHARGE = {
  'CHRG-W9V9GW5': 'PLAN-GHVVWF9',
  'CHRG-8XTEG07': 'PLAN-GHVVWF9',
  'CHRG-PFR72B4': 'PLAN-GHVVWF9',
  'CHRG-BWJCB3F': 'PLAN-GHVVWF9',
  'CHRG-W2V950C': 'PLAN-GHVVWF9',
  'CHRG-F38PDEK': 'PLAN-99999WD',
  'CHRG-RTC7YRP': 'PLAN-99999WD',
  'CHRG-TNG3CZG': 'PLAN-99999WD',
  'CHRG-YDJPWXR': 'PLAN-99999WD',
  'CHRG-45NK9MD': 'PLAN-99999WD',
  'CHRG-G32RFDZ': 'PLAN-99999WD',
  'CHRG-MT1FCH4': 'PLAN-99999WD',
  'CHRG-4KF5RH4': 'PLAN-DCK63P6',
  'CHRG-1TKH0ZG': 'PLAN-DCK63P6',
  'CHRG-6T5J1FH': 'PLAN-DCK63P6',
  'CHRG-EGYVEMW': 'PLAN-DCK63P6',
  'CHRG-K7210X0': 'PLAN-DCK63P6'
};

const buildSubscription = () => ({
  id: 'SUB-N7YVJCT',
  state: 'ACTIVE',
  accountId: 'ACCT-DWK6PGC',
  startDate: P1 - 31536000,
  endDate: P1,
  charges: SUBSCRIPTION_CHARGES.map((charge, index) => {
    const built = {
      id: `subcharge-${String(index + 1).padStart(3, '0')}`,
      chargeId: charge.chargeId,
      planId: PLAN_BY_CHARGE[charge.chargeId],
      quantity: charge.quantity,
      listUnitPrice: charge.listUnitPrice == null ? 51.5 : charge.listUnitPrice,
      sellUnitPrice: charge.sellUnitPrice,
      startDate: P1 - 31536000,
      endDate: P1,
      customFields: customFields(charge.years || null)
    };
    if (charge.attributes !== null) built.attributeReferences = CORE_INDEPENDENT;
    return built;
  })
});

// The fresh single-period draft: catalog pricing, no discounts, Year Groups
// not yet chosen — exactly what the rebuild has to fill in from the existing
// order.
const buildDraftRenewal = ({ startDate = P1, endDate = P2 } = {}) => ({
  accountId: 'ACCT-DWK6PGC',
  orderType: 'RENEWAL',
  currency: 'AUD',
  paymentTerm: 'NET14',
  renewalForSubscriptionId: 'SUB-N7YVJCT',
  billingContactId: 'CONT-J4V35QB',
  shippingContactId: 'CONT-QF1GR9P',
  startDate,
  endDate,
  billingCycle: { cycle: 'YEAR', step: 1 },
  billingTerm: 'UP_FRONT',
  billingAnchorDate: startDate,
  termLength: { cycle: 'YEAR', step: 1 },
  autoRenew: true,
  ownerId: 'USER-FTMYF7N',
  lineItems: SUBSCRIPTION_CHARGES.map((charge, index) => {
    const listUnitPrice = charge.listUnitPrice == null ? 51.5 : charge.listUnitPrice;
    const line = {
      id: `draft-${String(index + 1).padStart(3, '0')}`,
      isDryRunItem: false,
      action: 'RENEWAL',
      planId: PLAN_BY_CHARGE[charge.chargeId],
      chargeId: charge.chargeId,
      subscriptionChargeId: `subcharge-${String(index + 1).padStart(3, '0')}`,
      quantity: charge.quantity,
      listUnitPrice,
      sellUnitPrice: listUnitPrice,
      discounts: [],
      effectiveDate: startDate,
      endDate,
      customFields: customFields(null)
    };
    if (charge.attributes !== null) line.attributeReferences = CORE_INDEPENDENT;
    return line;
  }),
  customFields: [
    {
      id: 'CF-2R0C53T8',
      type: 'PICKLIST',
      name: 'BooklistingProvider',
      label: 'booklistingProvider',
      value: 'Campion',
      selections: ['Campion'],
      options: ['No Booklisting Provider', 'Campion'],
      required: false,
      source: 'USER',
      defaultValue: null
    }
  ]
});

// ORD-39HY7JN itself: 22 lines, 8 of them billable across two ramp periods.
const buildExistingTwoYearOrder = () => {
  lineSeq = 0;
  const ramped = [
    { chargeId: 'CHRG-W9V9GW5', quantity: 325, years: ['7; 8; 9', '7; 8; 9'] },
    { chargeId: 'CHRG-PFR72B4', quantity: 360, years: ['7; 8; 9; 10', '10'] },
    { chargeId: 'CHRG-4KF5RH4', quantity: 16, years: ['11; 12', '11'] },
    { chargeId: 'CHRG-6T5J1FH', quantity: 43, years: ['11; 12', '11; 12'] }
  ];

  const lineItems = [];
  for (const charge of ramped) {
    lineItems.push(orderLine({
      planId: PLAN_BY_CHARGE[charge.chargeId],
      chargeId: charge.chargeId,
      quantity: charge.quantity,
      isRamp: true,
      sellUnitPrice: 36,
      effectiveDate: P1,
      endDate: P2,
      years: charge.years[0]
    }));
    lineItems.push(orderLine({
      planId: PLAN_BY_CHARGE[charge.chargeId],
      chargeId: charge.chargeId,
      quantity: charge.quantity,
      isRamp: true,
      sellUnitPrice: 37.26,
      effectiveDate: P2,
      endDate: END,
      years: charge.years[1]
    }));
  }

  // A zero-quantity charge that is still ramped, and carries a negotiated
  // list price override.
  lineItems.push(orderLine({
    planId: 'PLAN-99999WD',
    chargeId: 'CHRG-MT1FCH4',
    quantity: 0,
    isRamp: true,
    sellUnitPrice: 36,
    effectiveDate: P1,
    endDate: P2,
    listPriceOverrideRatio: 1.0510204081,
    listUnitPriceBeforeOverride: 49
  }));
  lineItems.push(orderLine({
    planId: 'PLAN-99999WD',
    chargeId: 'CHRG-MT1FCH4',
    quantity: 0,
    isRamp: true,
    sellUnitPrice: 37.26,
    effectiveDate: P2,
    endDate: END,
    listPriceOverrideRatio: 1.0510204081,
    listUnitPriceBeforeOverride: 49
  }));

  // Catalog lines carried at zero quantity, spanning the whole two years.
  const fullSpan = [
    ['CHRG-8XTEG07', 51.5], ['CHRG-BWJCB3F', 51.5], ['CHRG-W2V950C', 51.5],
    ['CHRG-F38PDEK', 329], ['CHRG-RTC7YRP', 25.5], ['CHRG-TNG3CZG', 25.5],
    ['CHRG-YDJPWXR', 25.5], ['CHRG-45NK9MD', 12], ['CHRG-G32RFDZ', 49],
    ['CHRG-1TKH0ZG', 51.5], ['CHRG-EGYVEMW', 51.5], ['CHRG-K7210X0', 51.5]
  ];
  for (const [chargeId, price] of fullSpan) {
    lineItems.push(orderLine({
      planId: PLAN_BY_CHARGE[chargeId],
      chargeId,
      quantity: 0,
      isRamp: false,
      listUnitPrice: price,
      sellUnitPrice: price,
      effectiveDate: P1,
      endDate: END,
      attributes: chargeId === 'CHRG-F38PDEK' ? null : CORE_INDEPENDENT
    }));
  }

  return {
    id: 'ORD-39HY7JN',
    entityId: 'ENT-MNJ0N5D',
    name: "2027-2028 [CAMPION]: Methodist Ladies' College, Perth: Y7-9 Eng - Y10 EAL - Y7-10 Lang+ Y11-12 Eng/Lang Copy",
    accountId: 'ACCT-DWK6PGC',
    orderType: 'RENEWAL',
    currency: 'AUD',
    paymentTerm: 'NET14',
    status: 'DRAFT',
    lineItems,
    startDate: P1,
    endDate: END,
    termLength: { cycle: 'YEAR', step: 2 },
    billingCycle: { cycle: 'YEAR', step: 1 },
    billingTerm: 'UP_FRONT',
    billingAnchorDate: P1,
    rampInterval: [P1, P2],
    totalAmount: 54505.44,
    totalListAmount: 76632,
    sfdcOpportunityId: '60158227287',
    sfdcOpportunityName: "2027-2028 [CAMPION]: Methodist Ladies' College, Perth: Y7-9 Eng - Y10 EAL - Y7-10 Lang+ Y11-12 Eng/Lang",
    renewalForSubscriptionId: 'SUB-N7YVJCT',
    renewalForSubscriptionVersion: 22,
    ownerId: 'USER-FTMYF7N',
    autoRenew: true
  };
};

// The same order as a plain one-year quote: one line per charge, no ramp.
// Used to prove the single-period path still behaves exactly as it did.
const buildExistingOneYearOrder = () => {
  const twoYear = buildExistingTwoYearOrder();
  const lineItems = twoYear.lineItems
    .filter(line => line.effectiveDate === P1)
    .map(line => ({ ...line, isRamp: false, endDate: P2 }));
  return {
    ...twoYear,
    lineItems,
    endDate: P2,
    termLength: { cycle: 'YEAR', step: 1 },
    rampInterval: undefined,
    totalAmount: 26784
  };
};

module.exports = {
  P1,
  P2,
  END,
  CORE_INDEPENDENT,
  buildSubscription,
  buildDraftRenewal,
  buildExistingTwoYearOrder,
  buildExistingOneYearOrder
};
