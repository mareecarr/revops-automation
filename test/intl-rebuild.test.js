// Runs the real INTL rebuild action offline, with axios stubbed.
//
//   node test/intl-rebuild.test.js       # VERBOSE=1 to see the action's log
//
// The INTL catalogue has no year bands at all - a subject is one charge for
// every year group - so two lines that split a subject by cohort always land
// on the same charge. They are merged, not split, because the charge is
// VOLUME-priced per line item.

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
const action = require('../workflows/hubspot-renewal-all-subjects/rebuild-order-from-details-intl.js');

const START = 1798714800;
const END = 1830250800;

// The tier table Subskribe would apply per line item: one line of 210 earns
// the 126-250 price, two lines of 120 and 90 do not.
const VOLUME_TIERS = [
  { upTo: 125, price: 25 },
  { upTo: 250, price: 23.9 },
  { upTo: Infinity, price: 22.5 }
];
const tierPrice = (quantity) => (VOLUME_TIERS.find((t) => quantity <= t.upTo) || {}).price || 0;

const yearsOf = (item) => {
  const field = (item.customFields || []).find((c) => c.name === 'years');
  return (field && field.value) || '';
};

const buildOrder = () => ({
  id: 'ORD-INTL01',
  entityId: 'ENT-MNJ0N5D',
  accountId: 'ACCT-INTL1',
  orderType: 'RENEWAL',
  currency: 'USD',
  status: 'DRAFT',
  startDate: START,
  endDate: END,
  renewalForSubscriptionId: 'SUB-INTL1',
  lineItems: []
});

const buildSubscription = () => ({ id: 'SUB-INTL1', charges: [{ chargeId: 'CHRG-SS-ENGLISH' }] });

const volume = (id, name) => ({ id, name, chargeModel: 'VOLUME', isRenewable: true });
const freeTag = (id, name) => ({ id, name, chargeModel: 'PER_UNIT', amount: 0, isRenewable: true });

const buildPlans = () => [
  {
    id: 'PLAN-SS',
    name: 'USD INTL Single Subject',
    currency: 'USD',
    charges: [
      volume('CHRG-SS-ENGLISH', 'English'),
      volume('CHRG-SS-MATHS', 'Maths'),
      volume('CHRG-SS-SCIENCE', 'Science')
    ]
  },
  {
    id: 'PLAN-BUNDLE',
    name: 'USD INTL 3-Subject Bundle',
    currency: 'USD',
    charges: [
      volume('CHRG-B-CONTAINER', '3-Subject Bundle'),
      freeTag('CHRG-B-ENGLISH', 'English'),
      freeTag('CHRG-B-MATHS', 'Maths'),
      freeTag('CHRG-B-HUMANITIES', 'Humanities')
    ]
  },
  // Wrong currency - must not be used.
  {
    id: 'PLAN-EUR-SS',
    name: 'EUR INTL Single Subject',
    currency: 'EUR',
    charges: [volume('CHRG-EUR-ENGLISH', 'English')]
  }
];

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
      const lineItems = data.lineItems.map((li) => ({
        ...li,
        sellUnitPrice: tierPrice(li.quantity),
        amount: tierPrice(li.quantity) * li.quantity
      }));
      saved = { ...existingOrder, lineItems, totalAmount: lineItems.reduce((s, i) => s + i.amount, 0) };
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

const linesFor = (payload, chargeId) => payload.lineItems.filter((i) => i.chargeId === chargeId);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('two cohorts of one subject merge onto a single line', async () => {
  const { output, puts } = await run('120 Y7-8 English\n90 Y9-12 English');

  assert.strictEqual(output.update_error, '', output.update_error);
  assert.strictEqual(output.order_updated, 'true');
  assert.strictEqual(puts.length, 1, 'INTL saves in one pass - nothing is rep-priced');

  const english = linesFor(puts[0].data, 'CHRG-SS-ENGLISH');
  assert.strictEqual(english.length, 1, 'volume pricing is per line, so the cohorts must merge');
  assert.strictEqual(english[0].quantity, 210);
  assert.strictEqual(yearsOf(english[0]), '7; 8; 9; 10; 11; 12');
});

test('merging is what earns the volume tier', async () => {
  const { saved, output } = await run('120 Y7-8 English\n90 Y9-12 English');

  // One line of 210 sits in the 126-250 tier at $23.90. Split into 120 and 90
  // both lines would price at $25, quoting the school $455 more.
  const english = linesFor(saved, 'CHRG-SS-ENGLISH')[0];
  assert.strictEqual(english.sellUnitPrice, 23.9);
  assert.strictEqual(english.amount, 23.9 * 210);
  assert.match(output.update_summary, /merged across cohorts/);
});

test('overlapping year groups are still refused', async () => {
  const { output, puts } = await run('120 Y7-8 English\n40 Y8 English');

  assert.match(output.update_error, /Conflict: English in PLAN-SS is set for year 8/);
  assert.strictEqual(output.order_updated, 'false');
  assert.strictEqual(puts.length, 0);
});

test('a bundle line selects the container and tags its subjects', async () => {
  const { output, puts } = await run('80 Y7-9 3-Subject Bundle English, Maths, Humanities');

  assert.strictEqual(output.update_error, '', output.update_error);
  const container = linesFor(puts[0].data, 'CHRG-B-CONTAINER');
  assert.strictEqual(container.length, 1);
  assert.strictEqual(container[0].quantity, 80);

  ['CHRG-B-ENGLISH', 'CHRG-B-MATHS', 'CHRG-B-HUMANITIES'].forEach((chargeId) => {
    const tag = linesFor(puts[0].data, chargeId)[0];
    assert.strictEqual(tag.quantity, 80, chargeId);
    assert.strictEqual(yearsOf(tag), '7; 8; 9', chargeId);
  });

  // Nothing in this catalogue is rate-card priced, so no line may carry
  // price attribution.
  assert.ok(puts[0].data.lineItems.every((li) => !('attributeReferences' in li)));
});

test('a rep-typed price is still rejected', async () => {
  const { output, puts } = await run('120 Y7-8 English $25');

  assert.match(output.update_error, /pricing is automatic/);
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
