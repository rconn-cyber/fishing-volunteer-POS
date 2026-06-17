/**
 * save-transaction.js  v1
 * Netlify Function — persists every finalized POS transaction to Supabase.
 *
 * Writes to: public.pos_transactions
 *
 * POST body (JSON):
 *   operator_name   string   Who processed the sale
 *   buyer_name      string   Customer / captain name
 *   member_number   string   RR member # or "999999"
 *   tx_mode         string   "walkin" | "addon" | "checkin"
 *   payment_method  string   "cash" | "card"
 *   amount_paid     number   Total in dollars
 *   stripe_id       string   Stripe PaymentIntent ID (null for cash)
 *   line_items      array    [{ n: "item name", a: 20.00 }]
 *   contact         string   Email or phone (optional)
 *
 * Env vars (already set in Netlify for this site):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 */

const https = require('https');

function supabasePost(supabaseUrl, serviceKey, table, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const options = {
      hostname: new URL(supabaseUrl).hostname,
      path: `/rest/v1/${table}`,
      method: 'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        'apikey':          serviceKey,
        'Authorization':  `Bearer ${serviceKey}`,
        'Prefer':          'return=representation',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, data: parsed, status: res.statusCode });
        } catch {
          resolve({ ok: false, data, status: res.statusCode });
        }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders(), body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'Method not allowed' }) };

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ success: false, error: 'Server config error' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ success: false, error: 'Invalid JSON' }) }; }

  const {
    operator_name, buyer_name, member_number, tx_mode,
    payment_method, amount_paid, stripe_id, line_items, contact,
  } = body;

  if (!buyer_name) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ success: false, error: 'buyer_name required' }) };
  }

  const row = {
    operator_name:  operator_name  || 'Unknown',
    buyer_name:     buyer_name.trim(),
    member_number:  member_number  || '999999',
    tx_mode:        tx_mode        || 'unknown',
    payment_method: payment_method || 'unknown',
    amount_paid:    typeof amount_paid === 'number' ? amount_paid : null,
    stripe_id:      stripe_id      || null,
    line_items:     Array.isArray(line_items) ? line_items : [],
    contact:        contact        || null,
  };

  const result = await supabasePost(SUPABASE_URL, SERVICE_KEY, 'pos_transactions', row);

  if (!result.ok) {
    console.error('pos_transactions insert error:', JSON.stringify(result.data));
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ success: false, error: 'Failed to save transaction', detail: result.data }),
    };
  }

  const insertedId = Array.isArray(result.data) && result.data[0] ? result.data[0].id : null;
  console.log(`Transaction saved: "${buyer_name}" $${amount_paid} by ${operator_name} → id ${insertedId}`);

  return {
    statusCode: 200,
    headers: corsHeaders(),
    body: JSON.stringify({ success: true, id: insertedId }),
  };
};
