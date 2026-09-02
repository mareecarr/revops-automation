/**
 * Force the Subskribe -> HubSpot order sync.
 * HubSpot custom-coded action.
 *
 * The HubSpot equivalent of the "Sync Orders" Apps Script: it POSTs to
 * /hubspot/sync/order/{id} so the order Subskribe holds is pushed onto the
 * HubSpot record straight away rather than waiting for the scheduled sync.
 *
 * The sheet version had to loop rows, pace itself between calls and tidy up
 * after each one. A workflow action runs once per enrolled deal, so what is
 * left is the single call, the entity lookup the sheet's Entity column did,
 * and a retry for the throttling that pacing used to avoid - HubSpot can
 * enrol a batch of deals at once and each execution knows nothing about the
 * others, so backing off after a 429 is the only pacing available.
 *
 * INPUT PROPERTIES  subskribe_order_id            (deal, required)
 *                   business_unit                 (text, optional: EP or EA)
 *
 * SECRET            SubskribeAPIKey
 *
 * OUTPUT FIELDS (all String)
 *   hubspot_sync_success   "true" when Subskribe accepted the sync
 *   synced_order_id        the order it synced, empty when nothing was synced
 *   sync_error             empty when everything worked
 */

const axios = require('axios');

// One set of scripts serves every business unit, same as the rebuild steps.
// Omitting business_unit defaults to EP, so an existing workflow keeps working
// untouched; an unrecognised value fails loudly rather than syncing against the
// wrong entity.
const BUSINESS_UNITS = {
  EP: { name: 'Education Perfect', entityId: 'ENT-MNJ0N5D' },
  EA: { name: 'Essential Assessment', entityId: 'ENT-H5MFM0T' }
};
const DEFAULT_UNIT = 'EP';

// Waits between attempts. Only throttling and Subskribe-side errors are worth
// retrying - a 400 or a 404 will say the same thing however many times it is
// asked. The whole budget has to stay well inside HubSpot's 20-second limit on
// a custom coded action, so it is two retries, not five.
const RETRY_DELAYS_MS = [2000, 4000];
const RETRYABLE_STATUSES = [429, 500, 502, 503, 504];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

exports.main = async (event, callback) => {
  let error = '';
  const finish = (orderId) =>
    callback({
      outputFields: {
        hubspot_sync_success: error ? 'false' : 'true',
        synced_order_id: error ? '' : orderId,
        sync_error: error
      }
    });

  const apiKey = process.env.SubskribeAPIKey || '';
  const orderId = String(event.inputFields['subskribe_order_id'] || '').trim();
  const unitKey = String(event.inputFields['business_unit'] || DEFAULT_UNIT).trim().toUpperCase();
  const unit = BUSINESS_UNITS[unitKey];

  if (!apiKey) {
    error = 'No SubskribeAPIKey secret attached to this action.';
    return finish('');
  }
  if (!orderId) {
    error = 'The deal has no Subskribe Order ID, so there is nothing to sync.';
    return finish('');
  }
  if (!unit) {
    error = `Unknown business_unit "${unitKey}" - expected one of ${Object.keys(BUSINESS_UNITS).join(', ')}.`;
    return finish('');
  }

  const url = `https://api.app.subskribe.com/hubspot/sync/order/${encodeURIComponent(orderId)}`;
  console.log(`Syncing ${orderId} to HubSpot as ${unit.name} (${unit.entityId})`);
  console.log(`POST ${url}`);

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await axios.post(url, {}, {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
          'X-Entity-Id': unit.entityId
        },
        timeout: 15000
      });
      console.log(`  HTTP ${res.status} - sync accepted`);
      if (res.data) console.log('  Response: ' + JSON.stringify(res.data).slice(0, 300));
      error = '';
      return finish(orderId);
    } catch (e) {
      const status = e.response && e.response.status;
      const body = e.response && e.response.data ? JSON.stringify(e.response.data).slice(0, 400) : '';
      error = `Sync failed: ${status || 'no status'} ${e.message}${body ? ' - ' + body : ''}`;
      console.error(`  Attempt ${attempt + 1}: ${error}`);

      const retryable = !status || RETRYABLE_STATUSES.includes(status);
      const delay = RETRY_DELAYS_MS[attempt];
      if (!retryable || delay === undefined) break;

      console.log(`  Retrying in ${delay}ms`);
      await sleep(delay);
    }
  }

  console.error(`Giving up on ${orderId}. The scheduled sync will still pick it up.`);
  return finish('');
};
