/**
 * create-charge.js
 * Netlify Function — creates a Stripe PaymentIntent for the volunteer POS.
 *
 * POST /api/create-charge
 * Body (JSON):
 *   amount        number   Total in dollars (e.g. 500.00)
 *   paymentMethod string   Stripe PaymentMethod ID from Stripe.js (pm_xxx)
 *   customer      string   Full name of buyer
 *   memberNo      string   RR member number, or "999999" for non-member
 *   contact       string   Email or phone (optional)
 *   qboAcct       string   QBO account string (e.g. "4301 Fundraising Registration Revenue")
 *   qboClass      string   QBO class string (e.g. "Fundraising:Fishing Tournament")
 *   memo          string   Full memo for QBO staging app
 *   txMode        string   "New Boat Registration" | "Add-On (Existing Reg)"
 *   lineItems     array    [{ name, amount }] — line items for receipt
 *
 * Returns:
 *   { success, clientSecret, paymentIntentId, stripeCustomerId }
 *   or { error }
 *
 * All QBO metadata is stored in Stripe metadata fields so the staging app
 * at qbo-import-trans.netlify.app can read them on export.
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async function (event) {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const {
    amount,
    paymentMethod,
    customer,
    memberNo,
    contact,
    qboAcct,
    qboClass,
    memo,
    txMode,
    lineItems,
  } = body;

  // ── Validation ────────────────────────────────────────────
  if (!amount || typeof amount !== 'number' || amount <= 0) {
    return respond(400, { error: 'Invalid amount' });
  }
  if (!paymentMethod || !paymentMethod.startsWith('pm_')) {
    return respond(400, { error: 'Missing or invalid paymentMethod' });
  }
  if (!customer) {
    return respond(400, { error: 'Customer name is required' });
  }

  const amountCents = Math.round(amount * 100);

  // ── Build Stripe metadata for QBO staging app ─────────────
  // The staging app reads these fields when importing Stripe CSV exports.
  // Keys match what the staging app expects (customer_name, member_no, etc.)
  const metadata = {
    customer_name:  customer,
    member_no:      memberNo || '999999',
    qbo_account:    qboAcct  || '4301 Fundraising Registration Revenue',
    qbo_class:      qboClass || 'Fundraising:Fishing Tournament',
    memo:           memo     || '31st Annual Fishing Tournament — POS',
    tx_mode:        txMode   || 'POS Transaction',
    event:          '31st Annual Rough Riders Fishing Tournament',
    event_date:     '2026-06-19',
    source:         'volunteer-pos',
  };

  // Truncate memo to Stripe's 500-char metadata limit
  if (metadata.memo.length > 500) {
    metadata.memo = metadata.memo.substring(0, 497) + '...';
  }

  // ── Statement descriptor (max 22 chars, no special chars) ─
  const descriptor = 'RR FISHING TOURN';

  // ── Description visible in Stripe dashboard ───────────────
  const description = [
    txMode || 'Fishing Tournament',
    customer,
    memberNo && memberNo !== '999999' ? 'Member #' + memberNo : 'Non-Member',
    '$' + amount.toFixed(2),
  ].join(' · ');

  try {
    // ── Create or find Stripe customer ───────────────────────
    // We search by email if provided, otherwise create anonymous.
    let stripeCustomerId = null;
    const emailMatch = contact && contact.includes('@') ? contact.trim() : null;

    if (emailMatch) {
      const existing = await stripe.customers.list({ email: emailMatch, limit: 1 });
      if (existing.data.length > 0) {
        stripeCustomerId = existing.data[0].id;
        // Update name/metadata on existing customer
        await stripe.customers.update(stripeCustomerId, {
          name: customer,
          metadata: { member_no: memberNo || '999999' },
        });
      } else {
        const newCustomer = await stripe.customers.create({
          name: customer,
          email: emailMatch,
          phone: null,
          metadata: { member_no: memberNo || '999999', source: 'volunteer-pos' },
        });
        stripeCustomerId = newCustomer.id;
      }
    }

    // ── Create PaymentIntent ──────────────────────────────────
    const piParams = {
      amount:               amountCents,
      currency:             'usd',
      payment_method:       paymentMethod,
      confirm:              true,           // charge immediately
      return_url:           'https://rr-volunteer-pos.netlify.app/', // required for some 3DS cards
      description:          description,
      statement_descriptor: descriptor,
      metadata:             metadata,
      receipt_email:        emailMatch || undefined,
    };

    if (stripeCustomerId) {
      piParams.customer = stripeCustomerId;
    }

    const pi = await stripe.paymentIntents.create(piParams);

    // ── Handle 3DS / requires_action ─────────────────────────
    if (pi.status === 'requires_action' || pi.status === 'requires_source_action') {
      return respond(200, {
        success:         false,
        requiresAction:  true,
        clientSecret:    pi.client_secret,
        paymentIntentId: pi.id,
      });
    }

    if (pi.status !== 'succeeded') {
      return respond(402, {
        error: 'Payment not completed. Status: ' + pi.status,
      });
    }

    return respond(200, {
      success:          true,
      paymentIntentId:  pi.id,
      stripeCustomerId: stripeCustomerId,
      amount:           amount,
      last4:            pi.payment_method_details?.card?.last4 || null,
      brand:            pi.payment_method_details?.card?.brand || null,
    });

  } catch (err) {
    console.error('Stripe error:', err);

    // Return Stripe's user-facing error message when available
    const userMsg = err.type === 'StripeCardError'
      ? err.message
      : 'Payment processing error. Please try again.';

    return respond(err.statusCode || 500, { error: userMsg, code: err.code });
  }
};

// ── Helpers ───────────────────────────────────────────────
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type':                 'application/json',
  };
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify(body),
  };
}
