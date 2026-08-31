const axios = require('axios');

exports.main = async (event, callback) => {

  try {
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
        entityId: 'ENT-MNJ0N5D',
        orderObjectType: '2-21331974'
      },
      EA: {
        name: 'Essential Assessment',
        entityId: 'ENT-H5MFM0T',
        orderObjectType: '2-21331974'
      }
    };
    const unitKey = String(event.inputFields.business_unit || 'EP').trim().toUpperCase();
    const unit = BUSINESS_UNITS[unitKey];
    if (!unit) {
      throw new Error(`Unknown business_unit "${unitKey}" — expected one of ${Object.keys(BUSINESS_UNITS).join(', ')}`);
    }

    const HUBSPOT_ACCESS_TOKEN = process.env.API_KEY;
    const SUBSKRIBE_API_KEY = process.env.SubskribeAPIKey;
    const ENTITY_ID = unit.entityId;
    const ORDER_OBJECT_TYPE = unit.orderObjectType;

    // ==================================================
    // INPUT
    // ==================================================
    const subscriptionId = event.inputFields.subskribe_subscription_id;

    if (!subscriptionId) {
      throw new Error('Missing subskribe_subscription_id');
    }

    console.log('==================================================');
    console.log(`STEP 1 — FIND EXISTING RENEWAL ORDER (${unitKey})`);
    console.log('==================================================');
    console.log('Subscription ID:', subscriptionId);

    // ==================================================
    // SEARCH HUBSPOT FOR RENEWAL ORDER
    // ==================================================
    console.log('Searching HubSpot for renewal order...');

    const searchResponse = await axios.post(
      `https://api.hubapi.com/crm/v3/objects/${ORDER_OBJECT_TYPE}/search`,
      {
        filterGroups: [
          {
            filters: [
              {
                propertyName: 'renewed_from_subscription',
                operator: 'EQ',
                value: subscriptionId
              }
            ]
          }
        ],
        properties: ['primary_order_id', 'hs_object_id'],
        limit: 1
      },
      {
        headers: {
          Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    const results = searchResponse.data.results || [];
    console.log('Search results count:', results.length);

    if (!results.length) {
      console.log('No renewal order found.');
      callback({ outputFields: { found_order: false } });
      return;
    }

    const orderRecord = results[0];
    const hubspotOrderRecordId = orderRecord.id;
    const renewalOrderId = orderRecord.properties.primary_order_id;

    if (!renewalOrderId) {
      throw new Error('primary_order_id missing from HubSpot order record');
    }

    console.log('Found renewal order:', renewalOrderId);

    // ==================================================
    // GET FULL ORDER FROM SUBSKRIBE
    // ==================================================
    console.log('Fetching full order from Subskribe...');

    const orderResponse = await axios.get(
      `https://api.app.subskribe.com/orders/${renewalOrderId}`,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': SUBSKRIBE_API_KEY,
          'X-Entity-Id': ENTITY_ID
        },
        timeout: 30000
      }
    );

    const order = orderResponse.data;
    console.log('Order retrieved successfully');

    // ==================================================
    // VALIDATE ORDER
    // ==================================================
    const status = order.status || '';
    const isDraft = status === 'DRAFT';

    // Executing a renewal creates the next subscription, and the workflow is
    // then re-enrolled against that one — but the HubSpot order record can
    // still point at this order. When the order renews some other
    // subscription, it has already been executed and there is nothing left
    // to rebuild.
    const renewsThisSubscription = !order.renewalForSubscriptionId
      || order.renewalForSubscriptionId === subscriptionId;

    const eligibleForRebuild = isDraft && renewsThisSubscription;

    console.log('==================================================');
    console.log('ORDER VALIDATION');
    console.log('==================================================');
    console.log({ status, isDraft, renewsThisSubscription, eligibleForRebuild });

    if (!renewsThisSubscription) {
      console.log(
        `${renewalOrderId} renews ${order.renewalForSubscriptionId}, not ${subscriptionId} — already executed, nothing to rebuild`
      );
    }

    // ==================================================
    // IMPORTANT CONTEXT FOR NEXT STEPS
    //
    // Term length is logged but is NOT an eligibility gate: step 2
    // rebuilds a multi-year / ramped order period by period.
    // ==================================================
    console.log('==================================================');
    console.log('ORDER CONTEXT');
    console.log('==================================================');
    console.log({
      orderId: order.id,
      accountId: order.accountId,
      renewalForSubscriptionId: order.renewalForSubscriptionId,
      opportunityId: order.sfdcOpportunityId,
      opportunityName: order.sfdcOpportunityName,
      ownerId: order.ownerId,
      termLength: order.termLength
        ? `${order.termLength.step}x${order.termLength.cycle}`
        : 'none',
      rampPeriods: Array.isArray(order.rampInterval) ? order.rampInterval.length : 1
    });

    // ==================================================
    // RETURN OUTPUTS
    // ==================================================
    callback({
      outputFields: {
        found_order: true,
        eligible_for_rebuild: eligibleForRebuild,
        renewal_order_id: renewalOrderId,
        hubspot_order_record_id: hubspotOrderRecordId,
        subscription_id: subscriptionId,
        order_status: status,
        opportunity_id: order.sfdcOpportunityId || '',
        opportunity_name: order.sfdcOpportunityName || '',
        account_id: order.accountId || '',
        renewal_for_subscription_id: order.renewalForSubscriptionId || ''
      }
    });

  } catch (error) {
    console.error('==================================================');
    console.error('STEP 1 FAILED');
    console.error('==================================================');
    console.error('Message:', error.message);

    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Response:', JSON.stringify(error.response.data, null, 2));
    }

    throw error;
  }
};
