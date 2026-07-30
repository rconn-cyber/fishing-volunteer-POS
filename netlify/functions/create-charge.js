// netlify/functions/create-charge.js  — with CORS restriction + server-side price validation

const Stripe = require('stripe');

// ── SERVER-SIDE PRICE LIST ────────────────────────────────────────────────────
// These are the ONLY prices the server will accept.
// The client sends an item key; the server looks up the price here.
// A crafted request with a fake price will always be rejected.
const PRICE_CATALOG = {
  // Boat & divisions
  'boat':            300_00,
  'division':        100_00,
  'twt':             100_00,
  // Weekend tickets
  'captains_mtg':     20_00,
  'pool_party':       20_00,
  'banquet':          60_00,
  'all_access':       90_00,
  // Raffle
  'raffle_5050':      20_00,
  'raffle_yeti':      20_00,
  // Auction items (keyed by stable ID, not price from client)
  'auction_tarpon':  500_00,
  'auction_cr':     1400_00,
  'auction_dove':   1850_00,
  'auction_safari': 3000_00,
  'auction_battery':1000_00,
};

const ALLOWED_ORIGIN = 'https://rr-volunteer-pos.netlify.app';

const corsHeaders = (origin) => ({
  'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Vary': 'Origin',
});

exports.handler = async (event) => {
  const origin = event.headers.origin || '';

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(origin), body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(origin), body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers: corsHeaders(origin), body: 'Invalid JSON' };
  }

  const { paymentMethodId, items, customerName, customerEmail } = body;

  if (!paymentMethodId || !Array.isArray(items) || items.length === 0) {
    return { statusCode: 400, headers: corsHeaders(origin), body: 'Missing required fields' };
  }

  // ── SERVER-SIDE PRICE CALCULATION ─────────────────────────────────────────
  // items = [{ key: 'boat', qty: 1 }, { key: 'division', qty: 2 }, ...]
  // We NEVER trust a price sent from the client.
  let totalCents = 0;
  const lineItems = [];

  for (const item of items) {
    const unitPrice = PRICE_CATALOG[item.key];
    if (unitPrice === undefined) {
      return { statusCode: 400, headers: corsHeaders(origin), body: `Unknown item key: ${item.key}` };
    }
    const qty = parseInt(item.qty, 10) || 1;
    if (qty < 1 || qty > 50) {
      return { statusCode: 400, headers: corsHeaders(origin), body: `Invalid quantity for ${item.key}` };
    }
    totalCents += unitPrice * qty;
    lineItems.push({ key: item.key, qty, unitPrice, subtotal: unitPrice * qty });
  }

  if (totalCents < 50) { // Stripe minimum
    return { statusCode: 400, headers: corsHeaders(origin), body: 'Total too low' };
  }

  // ── STRIPE CHARGE ─────────────────────────────────────────────────────────
  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalCents,
      currency: 'usd',
      payment_method: paymentMethodId,
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      description: `RR Fishing POS — ${customerName || 'Walk-up'}`,
      receipt_email: customerEmail || undefined,
      metadata: {
        customer_name: customerName || '',
        line_items: JSON.stringify(lineItems),
      },
    });

    return {
      statusCode: 200,
      headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        paymentIntentId: paymentIntent.id,
        amountCharged: totalCents,
        lineItems,
      }),
    };
  } catch (err) {
    console.error('Stripe error:', err.message);
    return {
      statusCode: 402,
      headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
};
