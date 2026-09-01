// ORD-7V4N727 — Dilworth School, Auckland. A 2027 NZD renewal whose rep text
// mixes a whole-year-level bundle with per-subject lines:
//
//   100 Y7-8 EP Essentials Plus Independent $115
//   142 Y9-10 EP Essentials Plus Independent $115
//   74 Y11 EP Essentials Plus Independent $115
//   92 Y 12-13 Eng Plus Independent $49
//   ...
//
// The NZ catalogue bands are 7-10 and 11-13, so several of those lines land on
// the same charge of the same plan while describing different cohorts. That is
// the case this fixture exists to pin down.
//
// Trimmed from the live order: read-only totals, lineItemsNetEffect and the
// opportunity block are left out, everything the rebuild reads is real.
//
// The catalogue below is modelled, not fetched: 7-10 and 11-13 bands, which is
// the layout the AU catalogue uses for its juniors. 11-13 is the band the live
// run collided in. If NZ splits its juniors into 7-8 and 9-10 instead, the two
// junior lines land on separate plans and the assertions about them hold
// trivially.

const START = 1798714800; // 2027-01-01 NZDT
const END = 1830250800;

const yearsField = (value) => ({
  id: 'CF-NFTKQDH2',
  type: 'MULTISELECT_PICKLIST',
  name: 'years',
  label: 'Year Groups',
  value,
  selections: value ? value.split('; ') : [],
  options: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13',
    'Staff', 'P/F/K', 'Platform Access', 'Implementation Fee',
    'All Year Groups (EdPotential)', 'Tertiary'],
  required: false,
  source: 'USER',
  defaultValue: null
});

const attrs = (tier, sector) => [
  { attributeDefinitionId: 'PATTRB-817VQ5E', attributeValue: tier },
  { attributeDefinitionId: 'PATTRB-8VPMPZZ', attributeValue: sector }
];

// The rep's text, as typed into the deal's Order Details property.
const ORDER_DETAILS = [
  '100 Y7-8 EP Essentials Plus Independent $115',
  '142 Y9-10 EP Essentials Plus Independent $115',
  '74 Y11 EP Essentials Plus Independent $115',
  '92 Y 12-13 Eng Plus Independent $49',
  '150 Y12-13 Maths Plus Independent $49',
  '115 Y12-13 Sci Plus Independent $49',
  '20 Y12-13 Humanities Plus Independent $49'
].join('\n');

// Same deal, but the rep has double-booked English for year 11.
const ORDER_DETAILS_DOUBLE_BOOKED = [
  '74 Y11 EP Essentials Plus Independent $115',
  '30 Y11 Eng Plus Independent $49'
].join('\n');

const buildExistingOrder = () => ({
  id: 'ORD-7V4N727',
  entityId: 'ENT-MNJ0N5D',
  name: '2027 Renewal: Dilworth School, Auckland: Essentials - Sci - Math - TAME TAME',
  accountId: 'ACCT-DQ4VDTQ',
  orderType: 'RENEWAL',
  currency: 'NZD',
  paymentTerm: 'NET14',
  shippingContactId: 'CONT-1VCRZW0',
  billingContactId: 'CONT-1VCRZW0',
  status: 'DRAFT',
  startDate: START,
  endDate: END,
  billingCycle: { cycle: 'YEAR', step: 1 },
  billingTerm: 'UP_FRONT',
  billingAnchorDate: START,
  orderFormTemplateIds: ['6f3c0c68-a547-450b-abdd-348898add89a'],
  sfdcOpportunityId: '60143821328',
  isPrimaryOrderForSfdcOpportunity: true,
  sfdcOpportunityName: '2027 Renewal: Dilworth School, Auckland: Essentials - Sci - Math - TAME',
  renewalForSubscriptionId: 'SUB-EXQ9N8M',
  ownerId: 'USER-YCQECR1',
  documentMasterTemplateId: '0f4e081b-a85b-498c-b9e5-5edfffc3939b',
  purchaseOrderRequiredForInvoicing: false,
  autoRenew: true,
  startDateType: 'FIXED',
  totalAmount: 41869.2,
  totalListAmount: 44595,
  customFields: [],
  lineItems: [
    // Last year's whole-year-level bundles, on plans the 2027 catalogue drops.
    { action: 'RENEWAL', planId: 'PLAN-7QX1B04', chargeId: 'CHRG-NX6XC3K', quantity: 100, listUnitPrice: 100, sellUnitPrice: 93, effectiveDate: START, endDate: END, customFields: [yearsField('7; 8')] },
    { action: 'RENEWAL', planId: 'PLAN-9WWPM8H', chargeId: 'CHRG-YJ6G27N', quantity: 142, listUnitPrice: 100, sellUnitPrice: 93, effectiveDate: START, endDate: END, customFields: [yearsField('9; 10')] },
    { action: 'RENEWAL', planId: 'PLAN-Y17V6XV', chargeId: 'CHRG-69JTX8J', quantity: 72, listUnitPrice: 100, sellUnitPrice: 93, effectiveDate: START, endDate: END, customFields: [yearsField('11')] },
    // Senior subjects, already on the 11-13 core plan.
    { action: 'RENEWAL', planId: 'PLAN-6CGJDZ3', chargeId: 'CHRG-BM3X8B8', quantity: 92, listUnitPrice: 35, sellUnitPrice: 33.6, attributeReferences: attrs('Core', 'Independent'), effectiveDate: START, endDate: END, customFields: [yearsField('12; 13')] },
    { action: 'RENEWAL', planId: 'PLAN-6CGJDZ3', chargeId: 'CHRG-EMZGKCZ', quantity: 150, listUnitPrice: 35, sellUnitPrice: 33.6, attributeReferences: attrs('Core', 'Independent'), effectiveDate: START, endDate: END, customFields: [yearsField('12; 13')] },
    { action: 'RENEWAL', planId: 'PLAN-6CGJDZ3', chargeId: 'CHRG-B1K66MY', quantity: 0, listUnitPrice: 49, sellUnitPrice: 0, attributeReferences: attrs('Plus', 'Independent'), effectiveDate: START, endDate: END, customFields: [yearsField(null)] },
    { action: 'RENEWAL', planId: 'PLAN-6CGJDZ3', chargeId: 'CHRG-23MJQGV', quantity: 115, listUnitPrice: 35, sellUnitPrice: 33.6, attributeReferences: attrs('Core', 'Independent'), effectiveDate: START, endDate: END, customFields: [yearsField('12; 13')] },
    { action: 'ADD', planId: 'PLAN-6CGJDZ3', chargeId: 'CHRG-7MCBK05', quantity: 20, listUnitPrice: 35, sellUnitPrice: 33.6, attributeReferences: attrs('Core', 'Independent'), effectiveDate: START, endDate: END, customFields: [yearsField('12; 13')] }
  ]
});

// The expiring subscription. CHRG-7MCBK05 is absent — Social Sciences was added
// to the order mid-term, so it can only ever be an ADD.
const buildSubscription = () => ({
  id: 'SUB-EXQ9N8M',
  charges: [
    { chargeId: 'CHRG-NX6XC3K' },
    { chargeId: 'CHRG-YJ6G27N' },
    { chargeId: 'CHRG-69JTX8J' },
    { chargeId: 'CHRG-BM3X8B8' },
    { chargeId: 'CHRG-EMZGKCZ' },
    { chargeId: 'CHRG-B1K66MY' },
    { chargeId: 'CHRG-23MJQGV' }
  ]
});

const rateCard = (id, name) => ({ id, name, chargeModel: 'RATE_CARD_LOOKUP', isRenewable: true });

const CORE_710 = ['English', 'Maths', 'Languages', 'Science', 'Social Sciences'];
const OTHER = ['EAL', 'PDHPE', 'Arts', 'Technology', 'Religious Education', 'AO Histories', 'Decode'];

const buildPlans = () => [
  {
    id: 'PLAN-NZCORE710',
    name: '2027 NZ 7-10 Core Subjects',
    currency: 'NZD',
    charges: CORE_710.map((s, i) => rateCard(`CHRG-710C${i}`, s))
  },
  {
    id: 'PLAN-NZOTH710',
    name: '2027 NZ 7-10 Other Subjects',
    currency: 'NZD',
    charges: OTHER.map((s, i) => rateCard(`CHRG-710O${i}`, s))
  },
  {
    id: 'PLAN-6CGJDZ3',
    name: '2027 NZ 11-13 Core Subjects',
    currency: 'NZD',
    charges: [
      rateCard('CHRG-BM3X8B8', 'English'),
      rateCard('CHRG-EMZGKCZ', 'Maths'),
      rateCard('CHRG-B1K66MY', 'Languages'),
      rateCard('CHRG-23MJQGV', 'Science'),
      rateCard('CHRG-7MCBK05', 'Social Sciences')
    ]
  },
  {
    id: 'PLAN-NZOTH1113',
    name: '2027 NZ 11-13 Other Subjects',
    currency: 'NZD',
    charges: [
      ...OTHER.map((s, i) => rateCard(`CHRG-1113O${i}`, s)),
      // Priced per unit, not off the rate card: carried at quantity 0 with no
      // tier/sector attribution.
      { id: 'CHRG-1113PD', name: 'Decode Teacher PD', chargeModel: 'PER_UNIT', isRenewable: false }
    ]
  },
  // Superseded by the 2027 plan above — must not be used.
  {
    id: 'PLAN-OLD1113',
    name: '2026 NZ 11-13 Core Subjects',
    currency: 'NZD',
    charges: CORE_710.map((s, i) => rateCard(`CHRG-OLD${i}`, s))
  },
  // Wrong currency — must not be used.
  {
    id: 'PLAN-AU1112',
    name: '2027 AU 11-12 Core Subjects',
    currency: 'AUD',
    charges: ['English', 'Maths', 'Languages', 'Science', 'Humanities'].map((s, i) => rateCard(`CHRG-AU${i}`, s))
  }
];

// What Subskribe's rate card returns per plan and tier, so the stub can price
// pass 1 the way the real API does.
const RATE_CARD_BASES = {
  'PLAN-NZCORE710': { Core: 30, Plus: 42 },
  'PLAN-NZOTH710': { Core: 20, Plus: 28 },
  'PLAN-6CGJDZ3': { Core: 35, Plus: 49 },
  'PLAN-NZOTH1113': { Core: 20, Plus: 28 },
  'PLAN-OLD1113': { Core: 33, Plus: 46 }
};

module.exports = {
  START,
  END,
  ORDER_DETAILS,
  ORDER_DETAILS_DOUBLE_BOOKED,
  RATE_CARD_BASES,
  buildExistingOrder,
  buildSubscription,
  buildPlans
};
