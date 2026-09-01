// Runs the real "All Subjects" rebuild action offline, with axios stubbed, and
// asserts the order it would PUT to Subskribe.
//
//   node test/all-subjects-rebuild.test.js
//
// No dependencies, no network. `axios` is redirected to test/stubs/axios.js
// through the module resolver, so the file under test is byte-for-byte the one
// pasted into HubSpot. The stub prices pass 1 off a fake rate card, which is
// what makes the two-pass discount arithmetic checkable.

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
const action = require('../workflows/hubspot-renewal-all-subjects/rebuild-order-from-details.js');
const fixture = require('./fixtures/dilworth-all-subjects.js');

const ATTR_TIER = 'PATTRB-817VQ5E';
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const tierOf = (item) => {
  const attr = (item.attributeReferences || []).find((a) => a.attributeDefinitionId === ATTR_TIER);
  return (attr && attr.attributeValue) || 'Core';
};

const yearsOf = (item) => {
  const field = (item.customFields || []).find((c) => c.name === 'years');
  return (field && field.value) || '';
};

// Stands in for Subskribe's own pricing: the rate card base comes from the plan
// and the tier attribute, a list price override moves the list price, and a
// discount percent moves the sell price.
const priceLine = (item) => {
  const bases = fixture.RATE_CARD_BASES[item.planId] || {};
  const base = bases[tierOf(item)] || 0;
  const list = item.listPriceOverrideRatio ? round2(base * item.listPriceOverrideRatio) : base;
  const percent = (item.discounts && item.discounts[0] && item.discounts[0].percent) || 0;
  const sell = round2(list * (1 - percent));
  return {
    ...item,
    listUnitPrice: list,
    sellUnitPrice: sell,
    listAmount: round2(list * item.quantity),
    amount: round2(sell * item.quantity)
  };
};

const run = async ({ orderDetails, order, subscription, plans }) => {
  const existingOrder = order || fixture.buildExistingOrder();
  const puts = [];
  let saved = null;

  axiosStub.__reset({
    get: async (url) => {
      if (url.includes('/plans?')) {
        return { data: { data: plans || fixture.buildPlans(), nextCursor: null } };
      }
      if (url.includes('/subscriptions/')) {
        return { data: subscription || fixture.buildSubscription() };
      }
      if (url.includes('/orders/')) {
        return { data: saved || existingOrder };
      }
      throw new Error(`Unexpected GET ${url}`);
    },
    put: async (url, data) => {
      assert.ok(url.startsWith('https://api.app.subskribe.com/orders'), `Unexpected PUT ${url}`);
      puts.push({ url, data });
      const lineItems = data.lineItems.map(priceLine);
      saved = {
        ...existingOrder,
        status: 'DRAFT',
        lineItems,
        totalAmount: round2(lineItems.reduce((sum, i) => sum + i.amount, 0)),
        totalListAmount: round2(lineItems.reduce((sum, i) => sum + i.listAmount, 0))
      };
      return { status: 200, data: saved };
    }
  });

  process.env.SubskribeAPIKey = 'test-key';

  // The action logs the whole build for the rep to read in HubSpot. Keep it out
  // of the test output unless something needs looking at: VERBOSE=1 node ...
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
        {
          inputFields: {
            subskribe_order_id: existingOrder.id,
            order_details: orderDetails === undefined ? fixture.ORDER_DETAILS : orderDetails
          }
        },
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

// ==================================================
// TWO COHORTS OF ONE CHARGE
// ==================================================
test('a bundle line and a subject line inside the same band build two lines, not a conflict', async () => {
  const { output, puts } = await run({});

  assert.strictEqual(output.update_error, '', output.update_error);
  assert.strictEqual(output.order_updated, 'true');
  assert.strictEqual(puts.length, 2, 'structure pass then price pass');

  // English lives on one charge of the 11-13 core plan, and is sold to year 11
  // through the EP Essentials bundle and to years 12-13 on its own line.
  const english = linesFor(puts[1].data, 'CHRG-BM3X8B8');
  assert.strictEqual(english.length, 2);
  assert.deepStrictEqual(english.map(yearsOf), ['11', '12; 13']);
  assert.deepStrictEqual(english.map((l) => l.quantity), [74, 92]);

  // Same again in the 7-10 band: two bundle lines, one charge.
  const junior = linesFor(puts[1].data, 'CHRG-710C0');
  assert.strictEqual(junior.length, 2);
  assert.deepStrictEqual(junior.map(yearsOf), ['7; 8', '9; 10']);
  assert.deepStrictEqual(junior.map((l) => l.quantity), [100, 142]);

  // Languages was only ever in the year 11 bundle, so it stays a single line.
  const languages = linesFor(puts[1].data, 'CHRG-B1K66MY');
  assert.strictEqual(languages.length, 1);
  assert.strictEqual(yearsOf(languages[0]), '11');
  assert.strictEqual(languages[0].quantity, 74);
});

test('each cohort is priced from its own target, not the other one', async () => {
  const { puts, saved } = await run({});

  const english = linesFor(puts[1].data, 'CHRG-BM3X8B8');
  // $115 over 5 core subjects = $23 each for year 11; $49 for years 12-13.
  // Both sit on the Plus rate card at $49, so one is discounted and one is not.
  const [y11, y1213] = english;
  assert.strictEqual(round2(49 * (1 - y11.discounts[0].percent)), 23);
  assert.strictEqual(round2(49 * (1 - ((y1213.discounts[0] || {}).percent || 0))), 49);

  // And the saved order agrees, line by line.
  const savedEnglish = linesFor(saved, 'CHRG-BM3X8B8');
  assert.deepStrictEqual(savedEnglish.map((l) => l.sellUnitPrice), [23, 49]);
  assert.deepStrictEqual(savedEnglish.map((l) => l.listUnitPrice), [49, 49]);
});

test('only one cohort of a charge renews the subscription charge', async () => {
  const { puts } = await run({});

  // CHRG-BM3X8B8 renews, and the cohort that continues it is the one the order
  // already sells: years 12-13. The year 11 cohort is new, so it is an ADD.
  const english = linesFor(puts[1].data, 'CHRG-BM3X8B8');
  assert.deepStrictEqual(english.map((l) => l.action), ['ADD', 'RENEWAL']);

  // Social Sciences is not in the subscription at all, so neither cohort can
  // claim RENEWAL.
  const social = linesFor(puts[1].data, 'CHRG-7MCBK05');
  assert.deepStrictEqual(social.map((l) => l.action), ['ADD', 'ADD']);

  // Every RENEWAL on the order is backed by a subscription charge.
  const subscriptionCharges = new Set(fixture.buildSubscription().charges.map((c) => c.chargeId));
  puts[1].data.lineItems
    .filter((l) => l.action === 'RENEWAL')
    .forEach((l) => assert.ok(subscriptionCharges.has(l.chargeId), `${l.chargeId} is not in the subscription`));

  // One RENEWAL per renewing charge, never two.
  const renewalCounts = {};
  puts[1].data.lineItems
    .filter((l) => l.action === 'RENEWAL')
    .forEach((l) => { renewalCounts[l.chargeId] = (renewalCounts[l.chargeId] || 0) + 1; });
  Object.entries(renewalCounts).forEach(([chargeId, n]) =>
    assert.strictEqual(n, 1, `${chargeId} carries ${n} RENEWAL lines`));
});

test('the rest of the payload still holds together', async () => {
  const { puts, output } = await run({});
  const payload = puts[1].data;

  // Every charge of every touched plan is present, or Subskribe rejects the lot.
  const plans = fixture.buildPlans();
  const touched = new Set(payload.lineItems.map((l) => l.planId));
  plans.filter((p) => touched.has(p.id)).forEach((plan) => {
    plan.charges.forEach((charge) => {
      assert.ok(
        payload.lineItems.some((l) => l.planId === plan.id && l.chargeId === charge.id),
        `${charge.id} (${charge.name}) missing from ${plan.id}`);
    });
  });

  // Superseded and wrong-currency plans stay out of it.
  assert.ok(!touched.has('PLAN-OLD1113'), '2026 plan must not be used');
  assert.ok(!touched.has('PLAN-AU1112'), 'AUD plan must not be used');

  // The subscription charges the rebuild drops are declared, not omitted.
  const missing = payload.lineItems.filter((l) => l.action === 'MISSING_RENEWAL');
  assert.deepStrictEqual(
    missing.map((l) => l.chargeId).sort(),
    ['CHRG-69JTX8J', 'CHRG-NX6XC3K', 'CHRG-YJ6G27N']);
  assert.ok(missing.every((l) => l.quantity === 0));

  // Free Other Subjects ride along with each bundle cohort at $0.
  const arts1113 = linesFor(payload, 'CHRG-1113O2');
  assert.strictEqual(arts1113.length, 1);
  assert.strictEqual(arts1113[0].quantity, 74);
  assert.strictEqual(arts1113[0].discounts[0].percent, 1);

  // EAL, AO Histories and Decode are not freebies.
  ['CHRG-1113O0', 'CHRG-1113O5', 'CHRG-1113O6'].forEach((chargeId) => {
    const lines = linesFor(payload, chargeId);
    assert.strictEqual(lines.length, 1, chargeId);
    assert.strictEqual(lines[0].quantity, 0, chargeId);
  });

  // A charge priced per unit carries no price attribution at all.
  const pd = linesFor(payload, 'CHRG-1113PD')[0];
  assert.strictEqual(pd.quantity, 0);
  assert.ok(!('attributeReferences' in pd), 'PER_UNIT charge must not carry attributeReferences');

  assert.ok(!/mismatch/.test(output.update_summary), output.update_summary);
});

// ==================================================
// A REAL DOUBLE BOOKING IS STILL REFUSED
// ==================================================
test('the same charge claimed twice for the same year group is still a conflict', async () => {
  const { output, puts } = await run({ orderDetails: fixture.ORDER_DETAILS_DOUBLE_BOOKED });

  assert.match(output.update_error, /Conflict: English in PLAN-6CGJDZ3 is set for year 11/);
  assert.match(output.update_error, /74 Y11 EP Essentials Plus Independent \$115/);
  assert.match(output.update_error, /30 Y11 Eng Plus Independent \$49/);
  assert.strictEqual(output.order_updated, 'false');
  assert.strictEqual(puts.length, 0, 'nothing may be written when a line is ambiguous');
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
