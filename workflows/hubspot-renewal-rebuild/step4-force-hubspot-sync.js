const axios = require('axios');

exports.main = async (event, callback) => {

  try {
    const SUBSKRIBE_API_KEY = process.env.SubskribeAPIKey;
    const ENTITY_ID = 'ENT-MNJ0N5D';

    const orderId = event.inputFields.new_renewal_order_id;

    if (!orderId) {
      throw new Error('Missing new_renewal_order_id');
    }

    console.log('==================================================');
    console.log('STEP 4 — FORCE HUBSPOT ORDER SYNC');
    console.log('==================================================');
    console.log('Order ID:', orderId);

    const url = `https://api.app.subskribe.com/hubspot/sync/order/${orderId}`;
    console.log('Calling:', url);

    const response = await axios.post(
      url,
      {},
      {
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': SUBSKRIBE_API_KEY,
          'X-Entity-Id': ENTITY_ID
        },
        timeout: 60000
      }
    );

    console.log('HubSpot sync triggered successfully');
    console.log('Response:', JSON.stringify(response.data));

    callback({
      outputFields: {
        hubspot_sync_success: true,
        synced_order_id: orderId
      }
    });

  } catch (error) {
    console.error('STEP 4 FAILED:', error.message);

    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Response:', JSON.stringify(error.response.data));
    }

    callback({
      outputFields: {
        hubspot_sync_success: false,
        synced_order_id: ''
      }
    });
  }
};
