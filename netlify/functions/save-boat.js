/**
 * save-boat.js
 * Netlify Function — persists an onsite walk-up boat registration to Supabase.
 *
 * Called from the Volunteer POS (fishing-volunteer-POS repo) immediately
 * after finalize() succeeds (cash or card).
 *
 * POST /.netlify/functions/save-boat
 * Body (JSON):
 *   captainName     string   Full name (required)
 *   captainEmail    string   Email or phone/email field value
 *   captainPhone    string   Phone
 *   memberNumber    string   RR member # or "999999"
 *   boatName        string   Boat name (may be empty)
 *   divInshore      boolean
 *   divOffshore     boolean
 *   divTarpon       boolean
 *   twtInshore      boolean
 *   twtOffshore     boolean
 *   twtTarpon       boolean
 *   amountPaid      number   Dollar total
 *   paymentMethod   string   "card" | "cash"
 *   stripePaymentId string   PaymentIntent ID (card only)
 *   extrasJson      object   { dinner, tshirt, bait, cooler, photos, pool, raff_ff, raff_yeti }
 *
 * Returns:
 *   { success: true, id: "<uuid>" }
 *   or { success: false, error: "..." }
 *
 * Env vars required (set in Netlify UI for fishing-volunteer-POS site):
 *   SUPABASE_URL          https://qyoqyeaqacdjstvkonwx.supabase.co
 *   SUPABASE_SERVICE_KEY  <service_role secret key>
 */

const https = require('https');

function supabaseInsert(url, serviceKey, row) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(row);
    const parsedUrl = new URL(`${url}/rest/v1/boats`);
    const options = {
      hostname: parsedUrl.hostname,
      path:     parsedUrl.pathname + '?select=id',
      method:   'POST',
      headers: {
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(body),
        'apikey':         serviceKey,
        'Authorization':  `Bearer ${serviceKey}`,
        'Prefer':         'return=representation',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ ok: true, data: parsed });
          } else {
            resolve({ ok: false, error: parsed });
          }
        } catch (e) {
          resolve({ ok: false, error: data });
        }
      });
    });
    req.on('error', reject);
    req.write(body);
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
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const SUPABASE_URL  = process.env.SUPABASE_URL;
  const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ success: false, error: 'Server config error' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ success: false, error: 'Invalid JSON' }) }; }

  const {
    captainName, captainEmail, captainPhone, memberNumber, boatName,
    divInshore, divOffshore, divTarpon,
    twtInshore, twtOffshore, twtTarpon,
    amountPaid, paymentMethod, stripePaymentId, extrasJson,
  } = body;

  if (!captainName) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ success: false, error: 'captainName required' }) };
  }

  // Build CSV helpers
  const divParts = [];
  if (divInshore)  divParts.push('Inshore');
  if (divOffshore) divParts.push('Offshore');
  if (divTarpon)   divParts.push('Tarpon');

  const twtParts = [];
  if (twtInshore  && divInshore)  twtParts.push('Inshore');
  if (twtOffshore && divOffshore) twtParts.push('Offshore');
  if (twtTarpon   && divTarpon)   twtParts.push('Tarpon');

  const row = {
    source:            'onsite',
    cognito_entry_id:  null,
    captain_name:      captainName.trim(),
    captain_email:     captainEmail  ? captainEmail.trim()  : null,
    captain_phone:     captainPhone  ? captainPhone.trim()  : null,
    member_number:     memberNumber  ? memberNumber.trim()  : '999999',
    boat_name:         boatName      ? boatName.trim()      : null,
    boat_number:       null,
    div_inshore:       !!divInshore,
    div_offshore:      !!divOffshore,
    div_tarpon:        !!divTarpon,
    twt_inshore:       !!(twtInshore  && divInshore),
    twt_offshore:      !!(twtOffshore && divOffshore),
    twt_tarpon:        !!(twtTarpon   && divTarpon),
    divisions_csv:     divParts.join(',')  || null,
    twt_csv:           twtParts.join(',')  || null,
    amount_paid:       typeof amountPaid === 'number' ? amountPaid : null,
    payment_method:    paymentMethod || null,
    stripe_payment_id: stripePaymentId || null,
    extras_json:       extrasJson || null,
  };

  try {
    const result = await supabaseInsert(SUPABASE_URL, SERVICE_KEY, row);
    if (!result.ok) {
      console.error('Supabase insert error:', JSON.stringify(result.error));
      return {
        statusCode: 500,
        headers: corsHeaders(),
        body: JSON.stringify({ success: false, error: 'Database error', detail: result.error }),
      };
    }
    const insertedId = Array.isArray(result.data) && result.data[0] ? result.data[0].id : null;
    console.log(`Saved onsite boat: ${captainName} → ${insertedId}`);
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ success: true, id: insertedId }),
    };
  } catch (err) {
    console.error('save-boat error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
};
