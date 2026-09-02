// Runs the real HubSpot sync action offline, with axios stubbed.
//
//   node test/sync-order-to-hubspot.test.js
//
// The retry waits are real `setTimeout` calls, so the runner collapses them to
// zero rather than sitting through six seconds of backoff.

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
const action = require('../workflows/hubspot-renewal-all-subjects/sync-order-to-hubspot.js');

const realSetTimeout = global.setTimeout;
global.setTimeout = (fn) => realSetTimeout(fn, 0);

const httpError = (status, data) => {
  const error = new Error(`Request failed with status code ${status}`);
  error.response = { status, data };
  return error;
};

const run = async ({ inputFields, post, apiKey = 'test-key' }) => {
  const calls = [];
  axiosStub.__reset({
    post: async (url, data) => {
      calls.push({ url, data });
      return post(calls.length, url);
    }
  });

  if (apiKey) process.env.SubskribeAPIKey = apiKey;
  else delete process.env.SubskribeAPIKey;

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
      const returned = action.main({ inputFields }, (result) => resolve(result.outputFields));
      if (returned && returned.catch) returned.catch(reject);
    });
  } finally {
    console.log = realLog;
    console.error = realError;
  }

  return { output, calls, log: log.join('\n') };
};

const ok = async () => ({ status: 200, data: { synced: true } });

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('syncs the order against the default entity', async () => {
  const { output, calls } = await run({
    inputFields: { subskribe_order_id: 'ORD-7V4N727' },
    post: ok
  });

  assert.strictEqual(output.hubspot_sync_success, 'true', output.sync_error);
  assert.strictEqual(output.synced_order_id, 'ORD-7V4N727');
  assert.strictEqual(output.sync_error, '');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, 'https://api.app.subskribe.com/hubspot/sync/order/ORD-7V4N727');
});

test('a business unit picks its own entity, however it is typed', async () => {
  // The entity travels in a header, which the stub does not capture, so the
  // action's own log is what proves which one was used.
  const { output, log } = await run({
    inputFields: { subskribe_order_id: 'ORD-EA1', business_unit: ' ea ' },
    post: ok
  });

  assert.strictEqual(output.hubspot_sync_success, 'true', output.sync_error);
  assert.match(log, /Essential Assessment \(ENT-H5MFM0T\)/);
});

test('an unknown business unit fails loudly and calls nothing', async () => {
  const { output, calls } = await run({
    inputFields: { subskribe_order_id: 'ORD-1', business_unit: 'EPP' },
    post: ok
  });

  assert.strictEqual(output.hubspot_sync_success, 'false');
  assert.match(output.sync_error, /Unknown business_unit "EPP"/);
  assert.strictEqual(calls.length, 0);
});

test('a missing order id is reported, not called', async () => {
  const { output, calls } = await run({
    inputFields: { subskribe_order_id: '   ' },
    post: ok
  });

  assert.strictEqual(output.hubspot_sync_success, 'false');
  assert.match(output.sync_error, /no Subskribe Order ID/);
  assert.strictEqual(calls.length, 0);
});

test('throttling is retried, and the sync still succeeds', async () => {
  const { output, calls } = await run({
    inputFields: { subskribe_order_id: 'ORD-7V4N727' },
    post: async (n) => {
      if (n === 1) throw httpError(429, { message: 'Too many requests' });
      return ok();
    }
  });

  assert.strictEqual(output.hubspot_sync_success, 'true', output.sync_error);
  assert.strictEqual(output.synced_order_id, 'ORD-7V4N727');
  assert.strictEqual(output.sync_error, '');
  assert.strictEqual(calls.length, 2);
});

test('three throttled attempts give up, and say so', async () => {
  const { output, calls } = await run({
    inputFields: { subskribe_order_id: 'ORD-7V4N727' },
    post: async () => { throw httpError(503, { message: 'Service unavailable' }); }
  });

  assert.strictEqual(output.hubspot_sync_success, 'false');
  assert.strictEqual(output.synced_order_id, '');
  assert.match(output.sync_error, /503/);
  assert.strictEqual(calls.length, 3, 'one attempt plus two retries');
});

test('a rejected request is not retried', async () => {
  const { output, calls } = await run({
    inputFields: { subskribe_order_id: 'ORD-NOPE' },
    post: async () => { throw httpError(404, { message: 'Order not found' }); }
  });

  assert.strictEqual(output.hubspot_sync_success, 'false');
  assert.match(output.sync_error, /404/);
  assert.strictEqual(calls.length, 1, '404 says the same thing however often it is asked');
});

test('a network failure with no response is retried', async () => {
  const { output, calls } = await run({
    inputFields: { subskribe_order_id: 'ORD-7V4N727' },
    post: async (n) => {
      if (n === 1) throw new Error('socket hang up');
      return ok();
    }
  });

  assert.strictEqual(output.hubspot_sync_success, 'true', output.sync_error);
  assert.strictEqual(calls.length, 2);
});

test('a missing secret is reported before anything is called', async () => {
  const { output, calls } = await run({
    inputFields: { subskribe_order_id: 'ORD-1' },
    post: ok,
    apiKey: null
  });

  assert.strictEqual(output.hubspot_sync_success, 'false');
  assert.match(output.sync_error, /No SubskribeAPIKey secret/);
  assert.strictEqual(calls.length, 0);
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
