const axios = require('axios');

exports.main = async (event, callback) => {

  // ==================================================
  // BUSINESS UNITS
  //
  // One set of scripts serves every business unit. The HubSpot workflow
  // picks one with a `business_unit` input field; omitting it defaults to
  // EP, so an existing workflow keeps working without being touched.
  //
  // Only genuinely unit-specific values belong here. Everything else --
  // plans, charges, attributes, prices, discounts -- is discovered at
  // runtime from the order and the subscription, so a new unit needs no
  // code beyond its entry.
  // ==================================================
  const BUSINESS_UNITS = {
    EP: {
      name: 'Education Perfect',
      entityId: 'ENT-MNJ0N5D'
    },
    EA: {
      name: 'Essential Assessment',
      entityId: 'ENT-H5MFM0T'
    }
  };
  const unitKey = String(event.inputFields.business_unit || 'EP').trim().toUpperCase();
  const unit = BUSINESS_UNITS[unitKey];
  if (!unit) {
    throw new Error(`Unknown business_unit "${unitKey}" — expected one of ${Object.keys(BUSINESS_UNITS).join(', ')}`);
  }

  const SUBSKRIBE_API_KEY = process.env.SubskribeAPIKey;
  const ENTITY_ID = unit.entityId;

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
