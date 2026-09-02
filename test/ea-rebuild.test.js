// Runs the real Essential Assessment rebuild action offline, with axios
// stubbed.
//
//   node test/ea-rebuild.test.js       # VERBOSE=1 to see the action's log
//
// EA bundles are flat PER_UNIT charges, so two lines that pick the same
// bundle merge when the price matches and split into two line items when it
// does not.

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
const action = require('../workflows/hubspot-renewal-all-subjects/rebuild-order-from-details-ea.js');

const START = 1798714800;
const END = 1830250800;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Each charge's own flat price, which pass 1 reads back and pass 2 discounts.
const BASES = {
  'CHRG-EA-NUM': 20,
  'CHRG-EA-LIT': 20,
  'CHRG-EA-BOTH': 32
};

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

const yearsOf = (item) => {
  const field = (item.customFields || []).find((c) => c.name === 'years');
  return (field && field.value) || '';
};

const buildOrder = () => ({
  id: 'ORD-EA001',
  entityId: 'ENT-H5MFM0T',
  accountId: 'ACCT-EA1',
  orderType: 'RENEWAL',
  currency: 'AUD',
  status: 'DRAFT',
  startDate: START,
  endDate: END,
  renewalForSubscriptionId: 'SUB-EA1',
  lineItems: [
    {
      action: 'RENEWAL', planId: 'PLAN-EA2027I', chargeId: 'CHRG-EA-NUM', quantity: 70,
      listUnitPrice: 20, sellUnitPrice: 17, effectiveDate: START, endDate: END,
      customFields: [yearsField('6')]
    }
  ]
});

const buildSubscription = () => ({ id: 'SUB-EA1', charges: [{ chargeId: 'CHRG-EA-NUM' }] });

const perUnit = (id, name) => ({ id, name, chargeModel: 'PER_UNIT', isRenewable: true, isListPriceEditable: true });

const buildPlans = () => [
  {
    id: 'PLAN-EA2027I',
    name: 'EA Products (2027) Independent',
    currency: 'AUD',
    charges: [
      perUnit('CHRG-EA-NUM', 'Numeracy Bundle'),
      perUnit('CHRG-EA-LIT', 'Literacy Bundle'),
      perUnit('CHRG-EA-BOTH', 'Numeracy + Literacy Bundle')
    ]
  },
  // Superseded by 2027 - must not be used.
  {
    id: 'PLAN-EA2026I',
    name: 'EA Products (2026) Independent',
    currency: 'AUD',
    charges: [perUnit('CHRG-EA26-NUM', 'Numeracy Bundle')]
  },
  {
    id: 'PLAN-EA2027G',
    name: 'EA Products (2027) Government + Religious',
    currency: 'AUD',
    charges: [perUnit('CHRG-EAG-NUM', 'Numeracy Bundle')]
  }
];

const priceLine = (item) => {
  const base = BASES[item.chargeId] || 0;
  const list = item.listPriceOverrideRatio ? round2(base * item.listPriceOverrideRatio) : base;
  const percent = (item.discounts && item.discounts[0] && item.discounts[0].percent) || 0;
  const sell = round2(list * (1 - percent));
  return { ...item, listUnitPrice: list, sellUnitPrice: sell, amount: round2(sell * item.quantity) };
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
      saved = { ...existingOrder, lineItems, totalAmount: round2(lineItems.reduce((s, i) => s + i.amount, 0)) };
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

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('one bundle at two prices builds two lines', async () => {
  const { output, puts } = await run('92 Y5 Numeracy Independent $16\n50 Y6 Numeracy Independent $14');

  assert.strictEqual(output.update_error, '', output.update_error);
  assert.strictEqual(output.order_updated, 'true');
  assert.strictEqual(puts.length, 2);

  const numeracy = linesFor(puts[1].data, 'CHRG-EA-NUM');
  assert.strictEqual(numeracy.length, 2);
  assert.deepStrictEqual(numeracy.map(yearsOf), ['5', '6']);
  assert.deepStrictEqual(numeracy.map((l) => l.quantity), [92, 50]);
});

test('each cohort gets its own discount off the flat price', async () => {
  const { puts, saved } = await run('92 Y5 Numeracy Independent $16\n50 Y6 Numeracy Independent $14');

  const [y5, y6] = linesFor(puts[1].data, 'CHRG-EA-NUM');
  assert.strictEqual(round2(20 * (1 - y5.discounts[0].percent)), 16);
  assert.strictEqual(round2(20 * (1 - y6.discounts[0].percent)), 14);

  const savedNumeracy = linesFor(saved, 'CHRG-EA-NUM');
  assert.deepStrictEqual(savedNumeracy.map((l) => l.sellUnitPrice), [16, 14]);
});

test('the cohort the order already sells is the one that renews', async () => {
  const { puts } = await run('92 Y5 Numeracy Independent $16\n50 Y6 Numeracy Independent $14');

  // The existing order sells Numeracy to year 6, so that line continues the
  // subscription charge and the new year 5 cohort is an ADD.
  const numeracy = linesFor(puts[1].data, 'CHRG-EA-NUM');
  assert.deepStrictEqual(numeracy.map((l) => l.action), ['ADD', 'RENEWAL']);
});

test('the same price still merges onto one line', async () => {
  const { output, puts } = await run('92 Y5 Numeracy Independent $16\n50 Y6 Numeracy Independent $16');

  assert.strictEqual(output.update_error, '', output.update_error);
  const numeracy = linesFor(puts[1].data, 'CHRG-EA-NUM');
  assert.strictEqual(numeracy.length, 1);
  assert.strictEqual(numeracy[0].quantity, 142);
  assert.strictEqual(yearsOf(numeracy[0]), '5; 6');
});

test('two prices for the same year group are refused', async () => {
  const { output, puts } = await run('92 Y5 Numeracy Independent $16\n50 Y5 Numeracy Independent $14');

  assert.match(output.update_error, /priced differently for year 5/);
  assert.strictEqual(output.order_updated, 'false');
  assert.strictEqual(puts.length, 0);
});

test('unsold bundles ride along at quantity 0, on the newest plan only', async () => {
  const { puts } = await run('92 Y5 Numeracy Independent $16');
  const payload = puts[1].data;

  ['CHRG-EA-LIT', 'CHRG-EA-BOTH'].forEach((chargeId) => {
    const lines = linesFor(payload, chargeId);
    assert.strictEqual(lines.length, 1, chargeId);
    assert.strictEqual(lines[0].quantity, 0, chargeId);
  });

  const touched = new Set(payload.lineItems.map((l) => l.planId));
  assert.ok(!touched.has('PLAN-EA2026I'), 'the 2026 plan must not be used');
  assert.ok(!touched.has('PLAN-EA2027G'), 'the Government plan must not be used for an Independent line');
  assert.ok(payload.lineItems.every((li) => !('attributeReferences' in li)), 'EA never sets price attribution');
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
