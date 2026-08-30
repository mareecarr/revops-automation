const axios = require('axios');

exports.main = async (event, callback) => {

  const SUBSKRIBE_API_KEY = process.env.SubskribeAPIKey;
  const ENTITY_ID = 'ENT-MNJ0N5D';

  const orderId = event.inputFields.new_renewal_order_id;

  if (!orderId) {
    throw new Error('Missing new_renewal_order_id');
  }

  console.log('==================================================');
  console.log('STEP 3 — SET PRIMARY ORDER');
  console.log('==================================================');
  console.log('Order ID:', orderId);

  try {
    const response = await axios.put(
      `https://api.app.subskribe.com/sfdc/order/${orderId}`,
      {},
      {
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': SUBSKRIBE_API_KEY,
          'X-Entity-Id': ENTITY_ID
        },
        timeout: 30000
      }
    );

    console.log('Primary order updated successfully');
    console.log(JSON.stringify(response.data, null, 2));

    callback({
      outputFields: {
        primary_order_updated: true,
        primary_order_id: orderId
      }
    });

  } catch (error) {
    console.error('STEP 3 FAILED');
    console.error('Message:', error.message);

    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Response:', JSON.stringify(error.response.data, null, 2));
    }

    callback({
      outputFields: {
        primary_order_updated: false,
        primary_order_id: orderId
      }
    });
  }
};
