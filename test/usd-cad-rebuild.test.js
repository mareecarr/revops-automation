// Runs the real USD/CAD domestic rebuild action offline, with axios stubbed.
//
//   node test/usd-cad-rebuild.test.js       # VERBOSE=1 to see the action's log
//
// The fixture is modelled, not taken from a live order: a single 6-12 band, a
// rate card that prices Core and Plus differently, and a rep who sells one
// subject to two cohorts at two prices. That is the shape that used to be
// refused as a conflict.

const assert = require('assert');
const path = require('path');
const Module = require('module');

const STUB_AXIOS = path.join(__dirname, 'stubs', 'axios.js');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'axios') return STUB_AXIOS;
  return originalResolve.call(this, request, ...rest);
};

const axiosStub = require('./stubs/axios.js');
const action = require('../workflows/hubspot-renewal-all-subjects/rebuild-order-from-details-usd-cad.js');

const ATTR_TIER = 'PATTRB-817VQ5E';
const ATTR_SECTOR = 'PATTRB-8VPMPZZ';
const START = 1798714800;
const END = 1830250800;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Core and Plus price differently, so the two cohorts of one charge have two
// different rate card bases - which is what the per-line base lookup is for.
const BASES = { 'PLAN-US612': { Core: 40, Plus: 45 } };

const SUBJECTS = ['English', 'Maths', 'Science', 'Languages', 'Humanities'];

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

const buildOrder = () => ({
  id: 'ORD-USD001',
  entityId: 'ENT-MNJ0N5D',
  accountId: 'ACCT-US1',
  orderType: 'RENEWAL',
  currency: 'USD',
  status: 'DRAFT',
  startDate: START,
  endDate: END,
  renewalForSubscriptionId: 'SUB-US1',
  lineItems: [
    {
      action: 'RENEWAL', planId: 'PLAN-US612', chargeId: 'CHRG-US-ENGLISH', quantity: 85,
      listUnitPrice: 45, sellUnitPrice: 30, effectiveDate: START, endDate: END,
      attributeReferences: [
        { attributeDefinitionId: ATTR_TIER, attributeValue: 'Plus' },
        { attributeDefinitionId: ATTR_SECTOR, attributeValue: 'District' }
      ],
      customFields: [yearsField('9; 10; 11; 12')]
    }
  ]
});

const buildSubscription = () => ({ id: 'SUB-US1', charges: [{ chargeId: 'CHRG-US-ENGLISH' }] });

const buildPlans = () => [
  {
    id: 'PLAN-US612',
    name: '2027 US 6-12 Core Subjects',
    currency: 'USD',
    charges: SUBJECTS.map((s) => ({
      id: `CHRG-US-${s.toUpperCase()}`,
      name: s,
      chargeModel: 'RATE_CARD_LOOKUP',
      isRenewable: true
    }))
  },
  // Wrong currency - must not be used.
  {
    id: 'PLAN-CA612',
    name: '2027 CA 6-12 All Subjects',
    currency: 'CAD',
    charges: [{ id: 'CHRG-CA-ENGLISH', name: 'English', chargeModel: 'RATE_CARD_LOOKUP', isRenewable: true }]
  }
];

const tierOf = (item) => {
  const attr = (item.attributeReferences || []).find((a) => a.attributeDefinitionId === ATTR_TIER);
  return (attr && attr.attributeValue) || 'Core';
};
const yearsOf = (item) => {
  const field = (item.customFields || []).find((c) => c.name === 'years');
  return (field && field.value) || '';
};

const priceLine = (item) => {
  const base = (BASES[item.planId] || {})[tierOf(item)] || 0;
  const list = item.listPriceOverrideRatio ? round2(base * item.listPriceOverrideRatio) : base;
  const percent = (item.discounts && item.discounts[0] && item.discounts[0].percent) || 0;
  const sell = round2(list * (1 - percent));
  return { ...item, listUnitPrice: list, sellUnitPrice: sell, listAmount: round2(list * item.quantity), amount: round2(sell * item.quantity) };
};

const run = async (orderDetails) => {
  const existingOrder = buildOrder();
  const puts = [];
  let saved = null;

  axiosStub.__reset({
    get: async (url) => {
      if (url.includes('/plans?')) return { data: { data: buildPlans(), nextCursor: null } };
      if (url.includes('/subscriptions/')) return { data: buildSubscription() };
      if (url.includes('/orders/')) return { data: saved || existingOrder };
      throw new Error(`Unexpected GET ${url}`);
    },
    put: async (url, data) => {
      puts.push({ url, data });
      const lineItems = data.lineItems.map(priceLine);
      saved = {
        ...existingOrder,
        lineItems,
        totalAmount: round2(lineItems.reduce((sum, i) => sum + i.amount, 0))
      };
      return { status: 200, data: saved };
    }
  });

  process.env.SubskribeAPIKey = 'test-key';

  const log = [];
  const realLog = console.log;
  const realError = console.error;
  if (!process.env.VERBOSE) {
    console.log = (...args) => log.push(args.join(' '));
    console.error = (...args) => log.push(args.join(' '));
  }

  let output;
  try {
    output = await new Promise((resolve, reject) => {
      action.main(
        { inputFields: { subskribe_order_id: existingOrder.id, order_details: orderDetails } },
        (result) => resolve(result.outputFields)
      ).catch(reject);
    });
  } finally {
    console.log = realLog;
    console.error = realError;
  }

  return { output, puts, saved, log: log.join('\n') };
};

const linesFor = (payload, chargeId) => payload.lineItems
  .filter((i) => i.chargeId === chargeId)
  .sort((a, b) => yearsOf(a).localeCompare(yearsOf(b)));

const TWO_COHORTS = [
  '120 Y6-8 English Core District $32',
  '90 Y9-12 English Plus District $28'
].join('\n');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('one subject sold to two cohorts inside a band builds two lines', async () => {
  const { output, puts } = await run(TWO_COHORTS);

  assert.strictEqual(output.update_error, '', output.update_error);
  assert.strictEqual(output.order_updated, 'true');
  assert.strictEqual(puts.length, 2);

  const english = linesFor(puts[1].data, 'CHRG-US-ENGLISH');
  assert.strictEqual(english.length, 2);
  assert.deepStrictEqual(english.map(yearsOf), ['6; 7; 8', '9; 10; 11; 12']);
  assert.deepStrictEqual(english.map((l) => l.quantity), [120, 90]);
  assert.deepStrictEqual(english.map(tierOf), ['Core', 'Plus']);
});

test('each cohort is priced off its own tier of the rate card', async () => {
  const { puts, saved } = await run(TWO_COHORTS);

  // Core base $40 -> $32, Plus base $45 -> $28. Reading either cohort's base
  // off the other would price both wrong.
  const [core, plus] = linesFor(puts[1].data, 'CHRG-US-ENGLISH');
  assert.strictEqual(round2(40 * (1 - core.discounts[0].percent)), 32);
  assert.strictEqual(round2(45 * (1 - plus.discounts[0].percent)), 28);

  const savedEnglish = linesFor(saved, 'CHRG-US-ENGLISH');
  assert.deepStrictEqual(savedEnglish.map((l) => l.sellUnitPrice), [32, 28]);
});

test('only one cohort renews the subscription charge', async () => {
  const { puts } = await run(TWO_COHORTS);

  // The order already sells English to years 9-12, so that cohort continues
  // the subscription charge and the new junior cohort is an ADD.
  const english = linesFor(puts[1].data, 'CHRG-US-ENGLISH');
  assert.deepStrictEqual(english.map((l) => l.action), ['ADD', 'RENEWAL']);
});

test('unsold charges of a touched plan are still posted, at quantity 0', async () => {
  const { puts } = await run(TWO_COHORTS);
  const payload = puts[1].data;

  SUBJECTS.filter((s) => s !== 'English').forEach((subject) => {
    const lines = linesFor(payload, `CHRG-US-${subject.toUpperCase()}`);
    assert.strictEqual(lines.length, 1, subject);
    assert.strictEqual(lines[0].quantity, 0, subject);
    assert.strictEqual(tierOf(lines[0]), 'Core', `${subject} must default to the Core tier`);
  });

  assert.ok(!payload.lineItems.some((l) => l.planId === 'PLAN-CA612'), 'CAD plan must not be used');
});

test('the same subject claimed twice for one year group is still a conflict', async () => {
  const { output, puts } = await run([
    '120 Y6-8 English Core District $32',
    '40 Y8 English Plus District $28'
  ].join('\n'));

  assert.match(output.update_error, /Conflict: English in PLAN-US612 is set for year 8/);
  assert.strictEqual(output.order_updated, 'false');
  assert.strictEqual(puts.length, 0);
});

// ==================================================
(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (error) {
      failed += 1;
      console.log(`FAIL ${name}`);
      console.log(`     ${error.message}`);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
