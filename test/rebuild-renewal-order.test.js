// Runs the real step 2 custom code action offline, with axios stubbed, and
// asserts the shape of the order it would POST to Subskribe.
//
//   node test/rebuild-renewal-order.test.js
//
// No dependencies, no network. `axios` is redirected to test/stubs/axios.js
// through the module resolver, so the file under test is byte-for-byte the
// one pasted into HubSpot.

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
const step2 = require('../workflows/hubspot-renewal-rebuild/step2-rebuild-renewal-order.js');
const fixtures = require('./fixtures/methodist-ladies-2year.js');
const allSaints = require('./fixtures/all-saints-2year.js');

const { P1, P2, END } = fixtures;

const round2 = (value) => Math.round(value * 100) / 100;

const runStep2 = async ({ subscription, existingOrder, draftRenewal }) => {
  let posted = null;
  let createdOrder = null;

  axiosStub.__reset({
    get: async (url) => {
      if (url.endsWith('/draftRenewal')) return { data: draftRenewal };
      if (url.includes('/subscriptions/')) return { data: subscription };
      if (url.includes('/orders/')) return { data: existingOrder };
      throw new Error(`Unexpected GET ${url}`);
    },
    post: async (url, data) => {
      assert.ok(url.endsWith('/orders'), `Unexpected POST ${url}`);
      posted = data;
      const total = round2(data.lineItems.reduce(
        (sum, i) => sum + (i.quantity || 0) * (i.sellUnitPrice || 0), 0));
      createdOrder = {
        id: 'ORD-REBUILT1',
        status: 'DRAFT',
        accountId: data.accountId,
        totalAmount: total,
        startDate: data.startDate,
        endDate: data.endDate,
        sfdcOpportunityId: data.sfdcOpportunityId,
        sfdcOpportunityName: data.sfdcOpportunityName,
        lineItems: data.lineItems
      };
      return { data: createdOrder };
    }
  });

  const output = await new Promise((resolve, reject) => {
    step2.main(
      {
        inputFields: {
          subskribe_subscription_id: 'SUB-N7YVJCT',
          renewal_order_id: existingOrder.id
        }
      },
      (result) => resolve(result.outputFields)
    ).catch(reject);
  });

  return { posted, createdOrder, output, draftRenewal };
};

const linesFor = (payload, chargeId) => payload.lineItems
  .filter(i => i.chargeId === chargeId)
  .sort((a, b) => a.effectiveDate - b.effectiveDate);

const yearsOf = (line) => (line.customFields || [])
  .find(cf => cf.name === 'years')?.value ?? null;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ==================================================
// TWO-YEAR RAMPED ORDER
// ==================================================
test('two-year order rebuilds one line per charge per ramp period', async () => {
  const { posted, output } = await runStep2({
    subscription: fixtures.buildSubscription(),
    existingOrder: fixtures.buildExistingTwoYearOrder(),
    draftRenewal: fixtures.buildDraftRenewal()
  });

  assert.strictEqual(output.new_order_created, true, output.error_message);
  assert.strictEqual(output.order_periods, 2);

  // 5 ramped charges x 2 periods + 12 full-span catalog lines = 22, which is
  // exactly what the existing order carries.
  assert.strictEqual(posted.lineItems.length, 22);

  const rampedChargeIds = ['CHRG-W9V9GW5', 'CHRG-PFR72B4', 'CHRG-4KF5RH4', 'CHRG-6T5J1FH', 'CHRG-MT1FCH4'];
  for (const chargeId of rampedChargeIds) {
    const lines = linesFor(posted, chargeId);
    assert.strictEqual(lines.length, 2, `${chargeId} should be quoted twice`);
    assert.deepStrictEqual(
      [lines[0].effectiveDate, lines[0].endDate], [P1, P2],
      `${chargeId} period 1 window`);
    assert.deepStrictEqual(
      [lines[1].effectiveDate, lines[1].endDate], [P2, END],
      `${chargeId} period 2 window`);
    assert.ok(lines.every(l => l.isRamp === true), `${chargeId} lines must be ramp segments`);
  }
});

test('each period is priced from its own existing line, not period one', async () => {
  const { posted } = await runStep2({
    subscription: fixtures.buildSubscription(),
    existingOrder: fixtures.buildExistingTwoYearOrder(),
    draftRenewal: fixtures.buildDraftRenewal()
  });

  for (const chargeId of ['CHRG-W9V9GW5', 'CHRG-PFR72B4', 'CHRG-4KF5RH4', 'CHRG-6T5J1FH']) {
    const [year1, year2] = linesFor(posted, chargeId);
    assert.strictEqual(year1.sellUnitPrice, 36, `${chargeId} year 1 price`);
    assert.strictEqual(year2.sellUnitPrice, 37.26, `${chargeId} year 2 price`);
  }
});

test('Year Groups follow the period, including where the cohort changes', async () => {
  const { posted } = await runStep2({
    subscription: fixtures.buildSubscription(),
    existingOrder: fixtures.buildExistingTwoYearOrder(),
    draftRenewal: fixtures.buildDraftRenewal()
  });

  // The subscription charge says "6; 7; 8; 9" for both of these; only the
  // order knows the renewal was quoted differently, and differently again in
  // year two.
  const pfr = linesFor(posted, 'CHRG-PFR72B4');
  assert.strictEqual(yearsOf(pfr[0]), '7; 8; 9; 10');
  assert.strictEqual(yearsOf(pfr[1]), '10');

  const kf5 = linesFor(posted, 'CHRG-4KF5RH4');
  assert.strictEqual(yearsOf(kf5[0]), '11; 12');
  assert.strictEqual(yearsOf(kf5[1]), '11');

  for (const line of posted.lineItems) {
    if (line.quantity > 0) {
      assert.ok(yearsOf(line), `billable ${line.chargeId} must carry Year Groups`);
    }
  }
});

test('order term, ramp boundaries and billing come from the existing order', async () => {
  const { posted } = await runStep2({
    subscription: fixtures.buildSubscription(),
    existingOrder: fixtures.buildExistingTwoYearOrder(),
    draftRenewal: fixtures.buildDraftRenewal()
  });

  assert.strictEqual(posted.startDate, P1);
  assert.strictEqual(posted.endDate, END, 'order must span the full two years, not the draft year');
  assert.deepStrictEqual(posted.termLength, { cycle: 'YEAR', step: 2 });
  assert.deepStrictEqual(posted.rampInterval, [P1, P2]);
  assert.deepStrictEqual(posted.billingCycle, { cycle: 'YEAR', step: 1 });
  assert.strictEqual(posted.billingTerm, 'UP_FRONT');
});

test('total value matches the order being rebuilt', async () => {
  const { createdOrder } = await runStep2({
    subscription: fixtures.buildSubscription(),
    existingOrder: fixtures.buildExistingTwoYearOrder(),
    draftRenewal: fixtures.buildDraftRenewal()
  });

  assert.strictEqual(createdOrder.totalAmount, 54505.44);
});

test('negotiated list price override survives on both periods', async () => {
  const { posted } = await runStep2({
    subscription: fixtures.buildSubscription(),
    existingOrder: fixtures.buildExistingTwoYearOrder(),
    draftRenewal: fixtures.buildDraftRenewal()
  });

  const lines = linesFor(posted, 'CHRG-MT1FCH4');
  for (const line of lines) {
    assert.strictEqual(line.listPriceOverrideRatio, 1.0510204081);
    assert.strictEqual(line.listUnitPriceBeforeOverride, 49);
  }
});

test('zero-quantity catalog lines stay single lines spanning the whole term', async () => {
  const { posted } = await runStep2({
    subscription: fixtures.buildSubscription(),
    existingOrder: fixtures.buildExistingTwoYearOrder(),
    draftRenewal: fixtures.buildDraftRenewal()
  });

  const fullSpan = ['CHRG-8XTEG07', 'CHRG-BWJCB3F', 'CHRG-W2V950C', 'CHRG-F38PDEK',
    'CHRG-RTC7YRP', 'CHRG-TNG3CZG', 'CHRG-YDJPWXR', 'CHRG-45NK9MD', 'CHRG-G32RFDZ',
    'CHRG-1TKH0ZG', 'CHRG-EGYVEMW', 'CHRG-K7210X0'];

  for (const chargeId of fullSpan) {
    const lines = linesFor(posted, chargeId);
    assert.strictEqual(lines.length, 1, `${chargeId} should not be split across periods`);
    assert.deepStrictEqual([lines[0].effectiveDate, lines[0].endDate], [P1, END]);
    assert.strictEqual(lines[0].isRamp, undefined, `${chargeId} is not a ramp segment`);
  }

  // A charge with no price attribution must not be sent an empty one.
  assert.strictEqual(linesFor(posted, 'CHRG-F38PDEK')[0].attributeReferences, undefined);
});

test('the subscription charge link is claimed by period one only', async () => {
  const { posted } = await runStep2({
    subscription: fixtures.buildSubscription(),
    existingOrder: fixtures.buildExistingTwoYearOrder(),
    draftRenewal: fixtures.buildDraftRenewal()
  });

  for (const chargeId of ['CHRG-W9V9GW5', 'CHRG-PFR72B4', 'CHRG-4KF5RH4', 'CHRG-6T5J1FH']) {
    const [year1, year2] = linesFor(posted, chargeId);
    assert.ok(year1.subscriptionChargeId, `${chargeId} period 1 keeps the charge link`);
    assert.strictEqual(year2.subscriptionChargeId, undefined,
      `${chargeId} period 2 must not claim the same subscription charge`);
  }
});

test('a renewal starting later than quoted shifts every period with it', async () => {
  const shift = 14 * 86400;
  const { posted, output } = await runStep2({
    subscription: fixtures.buildSubscription(),
    existingOrder: fixtures.buildExistingTwoYearOrder(),
    draftRenewal: fixtures.buildDraftRenewal({ startDate: P1 + shift, endDate: P2 + shift })
  });

  assert.strictEqual(output.new_order_created, true, output.error_message);
  assert.strictEqual(posted.startDate, P1 + shift);
  assert.strictEqual(posted.endDate, END + shift);
  assert.deepStrictEqual(posted.rampInterval, [P1 + shift, P2 + shift]);
  const [year1, year2] = linesFor(posted, 'CHRG-W9V9GW5');
  assert.deepStrictEqual([year1.effectiveDate, year1.endDate], [P1 + shift, P2 + shift]);
  assert.deepStrictEqual([year2.effectiveDate, year2.endDate], [P2 + shift, END + shift]);
});

test('a renewal for a completely different term is refused', async () => {
  const shift = 200 * 86400;
  const { posted, output } = await runStep2({
    subscription: fixtures.buildSubscription(),
    existingOrder: fixtures.buildExistingTwoYearOrder(),
    draftRenewal: fixtures.buildDraftRenewal({ startDate: P1 + shift, endDate: P2 + shift })
  });

  assert.strictEqual(posted, null, 'nothing should be created');
  assert.strictEqual(output.new_order_created, false);
  assert.match(output.error_message, /refusing to reuse its per-period pricing/);
});

test('a billable line outside every ramp period stops the rebuild', async () => {
  const existingOrder = fixtures.buildExistingTwoYearOrder();
  // A mid-term line whose window matches no ramp period at all.
  existingOrder.lineItems.push({
    ...existingOrder.lineItems[0],
    id: 'stray-line',
    effectiveDate: P1 + 1000,
    endDate: P2 - 1000
  });

  const { posted, output } = await runStep2({
    subscription: fixtures.buildSubscription(),
    existingOrder,
    draftRenewal: fixtures.buildDraftRenewal()
  });

  assert.strictEqual(posted, null);
  assert.match(output.error_message, /fall outside every ramp period/);
});

// ==================================================
// THE REAL SUB-N7YVJCT — A RENEWAL QUOTED DOWN
//
// The subscription's final period carries 809 billable seats; the renewal
// order quotes 744. Reproducing the quote is the job, so this must build.
// ==================================================
const realCase = () => ({
  subscription: fixtures.buildRealSubscription(),
  existingOrder: fixtures.buildExistingTwoYearOrder(),
  draftRenewal: fixtures.buildPlanSwapDraft()
});

test('a renewal quoted below the subscription still rebuilds', async () => {
  const { posted, output } = await runStep2(realCase());

  assert.strictEqual(output.new_order_created, true, output.error_message);
  assert.strictEqual(posted.lineItems.length, 22);

  const period1 = posted.lineItems
    .filter(i => i.effectiveDate === P1)
    .reduce((sum, i) => sum + i.quantity, 0);
  assert.strictEqual(period1, 744, 'period 1 must match the quote, not the subscription');

  const period2 = posted.lineItems
    .filter(i => i.effectiveDate === P2)
    .reduce((sum, i) => sum + i.quantity, 0);
  assert.strictEqual(period2, 744);
});

test('quantities come from the quote where it renegotiated the subscription', async () => {
  const { posted } = await runStep2(realCase());

  // Subscription says 341/353/13/33 for these; the order quotes
  // 325/360/16/43 and the order wins.
  const quoted = { 'CHRG-W9V9GW5': 325, 'CHRG-PFR72B4': 360, 'CHRG-4KF5RH4': 16, 'CHRG-6T5J1FH': 43 };
  for (const [chargeId, quantity] of Object.entries(quoted)) {
    for (const line of linesFor(posted, chargeId)) {
      assert.strictEqual(line.quantity, quantity, `${chargeId} quantity`);
    }
  }
});

test('the seat shortfall against the subscription is reported, not fatal', async () => {
  const messages = [];
  const realError = console.error;
  console.error = (...args) => messages.push(args.map(String).join(' '));
  try {
    await runStep2(realCase());
  } finally {
    console.error = realError;
  }

  assert.ok(
    messages.some(m => /carries 744 seats where the subscription's renewing charges carry 809/.test(m)),
    `expected a shortfall note, got:\n${messages.join('\n')}`);
  // The consolidated Y11/12 charge has no line in the rebuild, and that is
  // where the 65 seats went.
  assert.ok(
    messages.some(m => /not represented.*CHRG-ZY51B7H\(qty 68\)/.test(m)),
    `expected the orphaned charge to be named, got:\n${messages.join('\n')}`);
});

test('a genuinely dropped line is still caught', async () => {
  const testCase = realCase();
  // The draft loses the 360-seat line entirely.
  testCase.draftRenewal.lineItems = testCase.draftRenewal.lineItems
    .filter(i => i.chargeId !== 'CHRG-PFR72B4');

  const { posted, output } = await runStep2(testCase);

  assert.strictEqual(posted, null, 'nothing should be created');
  assert.match(output.error_message, /is below the 744 quoted on ORD-39HY7JN/);
});

test('pricing and Year Groups survive the plan swap on real data', async () => {
  const { posted, createdOrder } = await runStep2(realCase());

  const [year1, year2] = linesFor(posted, 'CHRG-PFR72B4');
  assert.strictEqual(year1.sellUnitPrice, 36);
  assert.strictEqual(year2.sellUnitPrice, 37.26);
  assert.strictEqual(yearsOf(year1), '7; 8; 9; 10');
  assert.strictEqual(yearsOf(year2), '10');

  assert.strictEqual(createdOrder.totalAmount, 54505.44);
});

// ==================================================
// ALL SAINTS' — A DRAFT THAT OFFERS MORE THAN THE QUOTE
//
// A mid-term amendment added a block of Plus charges the renewal does not
// carry forward. draftRenewal still offers all of them, so the fresh draft
// proposes ten billable lines and 1,685 seats the 790-seat quote omits.
// ==================================================
const allSaintsCase = () => ({
  subscription: allSaints.buildSubscription(),
  existingOrder: allSaints.buildExistingOrder(),
  draftRenewal: allSaints.buildDraftRenewal()
});

test('lines the quote does not carry are left out, not invented', async () => {
  const { posted, output } = await runStep2(allSaintsCase());

  assert.strictEqual(output.new_order_created, true, output.error_message);

  const billable = posted.lineItems.filter(i => i.quantity > 0);
  const chargeIds = [...new Set(billable.map(i => i.chargeId))].sort();
  assert.deepStrictEqual(chargeIds,
    ['CHRG-6T5J1FH', 'CHRG-PFR72B4', 'CHRG-TQ9CHVP', 'CHRG-W9V9GW5'],
    'only the four charges the deal was quoted on may be billable');

  const period1 = billable.filter(i => i.effectiveDate === P1)
    .reduce((sum, i) => sum + i.quantity, 0);
  const period2 = billable.filter(i => i.effectiveDate === P2)
    .reduce((sum, i) => sum + i.quantity, 0);
  assert.strictEqual(period1, 790, 'period 1 must be the 790 seats quoted, not 2475');
  assert.strictEqual(period2, 790);
});

test('the rebuilt All Saints order reproduces the quoted total exactly', async () => {
  const { createdOrder } = await runStep2(allSaintsCase());
  assert.strictEqual(createdOrder.totalAmount, 72490.8);
});

test('the zeroed lines are reported with their seat count', async () => {
  const messages = [];
  const realError = console.error;
  console.error = (...args) => messages.push(args.map(String).join(' '));
  try {
    await runStep2(allSaintsCase());
  } finally {
    console.error = realError;
  }

  assert.ok(
    messages.some(m => /10 charge\(s\) worth 1685 seats are offered by the draft but not on ORD-WD9TZMR — held at qty 0/.test(m)),
    `expected the zeroed lines to be reported, got:\n${messages.join('\n')}`);
});

test('the tier change between periods is carried per period', async () => {
  const { posted } = await runStep2(allSaintsCase());

  // "Plus 2027 only": period 1 is quoted at Plus, period 2 falls back to Core.
  const [year1, year2] = linesFor(posted, 'CHRG-W9V9GW5').filter(i => i.quantity > 0);
  const tierOf = (line) => (line.attributeReferences || [])
    .find(r => r.attributeDefinitionId === 'PATTRB-817VQ5E')?.attributeValue;
  assert.strictEqual(tierOf(year1), 'Plus');
  assert.strictEqual(tierOf(year2), 'Core');
  assert.strictEqual(year1.quantity, 160);
  assert.strictEqual(year2.quantity, 160);
});

test('every draft line survives, so no plan is left half-represented', async () => {
  const { posted, draftRenewal } = await runStep2(allSaintsCase());

  // Subskribe rejects an order that carries some of a plan's charges and not
  // others ("charges ... from plan id ... are missing in order"), so nothing
  // may be removed — the lines the quote does not carry are held at zero.
  const draftCharges = new Set(draftRenewal.lineItems.map(i => `${i.planId}|${i.chargeId}`));
  const postedCharges = new Set(posted.lineItems.map(i => `${i.planId}|${i.chargeId}`));
  for (const charge of draftCharges) {
    assert.ok(postedCharges.has(charge), `${charge} was dropped from the payload`);
  }

  // 21 catalog placeholders + 10 charges the quote does not carry.
  const zeroQuantity = posted.lineItems.filter(i => i.quantity === 0);
  assert.strictEqual(zeroQuantity.length, 31);
  assert.ok(zeroQuantity.every(i => i.effectiveDate === P1 && i.endDate === END));
});

// ==================================================
// SINGLE-PERIOD ORDER — NO REGRESSION
// ==================================================
test('a one-year order still builds exactly one line per charge', async () => {
  const { posted, output } = await runStep2({
    subscription: fixtures.buildSubscription(),
    existingOrder: fixtures.buildExistingOneYearOrder(),
    draftRenewal: fixtures.buildDraftRenewal()
  });

  assert.strictEqual(output.new_order_created, true, output.error_message);
  assert.strictEqual(output.order_periods, 1);
  assert.strictEqual(posted.lineItems.length, 17);
  assert.strictEqual(posted.startDate, P1);
  assert.strictEqual(posted.endDate, P2);
  assert.strictEqual(posted.termLength, undefined, 'single-period payload is unchanged');
  assert.strictEqual(posted.rampInterval, undefined, 'single-period payload is unchanged');

  const [only] = linesFor(posted, 'CHRG-W9V9GW5');
  assert.strictEqual(only.sellUnitPrice, 36);
  assert.strictEqual(only.quantity, 325);
  assert.strictEqual(yearsOf(only), '7; 8; 9');
  assert.ok(only.subscriptionChargeId, 'single-period lines keep the charge link');
});

// ==================================================
// RUNNER
// ==================================================
(async () => {
  const quiet = process.argv.includes('--quiet') || !process.argv.includes('--logs');
  const realLog = console.log;
  const realError = console.error;

  let failures = 0;
  for (const { name, fn } of tests) {
    if (quiet) {
      console.log = () => {};
      console.error = () => {};
    }
    try {
      await fn();
      console.log = realLog;
      console.error = realError;
      realLog(`  PASS  ${name}`);
    } catch (error) {
      console.log = realLog;
      console.error = realError;
      failures += 1;
      realError(`  FAIL  ${name}`);
      realError(`        ${error.message}`);
    }
  }

  realLog(`\n${tests.length - failures}/${tests.length} passed`);
  process.exit(failures === 0 ? 0 : 1);
})();
