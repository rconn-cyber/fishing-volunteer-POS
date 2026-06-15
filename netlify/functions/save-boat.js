/**
 * save-boat.js  v2
 * Netlify Function — persists an onsite walk-up boat to Supabase.
 *
 * Writes to TWO tables:
 *   1. public.boats  — scoring app's existing table (name, divisions[], captain_email, captain_phone)
 *                      so the boat appears immediately in the scoring app roster
 *   2. public.boat_registrations — new detailed table with TWT, payment, extras, etc.
 *
 * Env vars (set in Netlify for fishing-volunteer-POS site):
 *   SUPABASE_URL          https://qyoqyeaqacdjstvkonwx.supabase.co
 *   SUPABASE_SERVICE_KEY  <service_role secret key>
 */

const https = require('https');

function supabasePost(supabaseUrl, serviceKey, table, body, upsert = false) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const path = `/rest/v1/${table}${upsert ? '?on_conflict=captain_name,source' : ''}`;
    const options = {
      hostname: new URL(supabaseUrl).hostname,
      path,
      method: 'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        'apikey':          serviceKey,
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
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, data: parsed, status: res.statusCode });
        } catch {
          resolve({ ok: false, data: data, status: res.statusCode });
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
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'Method not allowed' }) };

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
    captainName, captainEmail, captainPhone, memberNumber, boatName,
    divInshore, divOffshore, divTarpon,
    twtInshore, twtOffshore, twtTarpon,
    amountPaid, paymentMethod, stripePaymentId, extrasJson,
  } = body;

  if (!captainName) {
    return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ success: false, error: 'captainName required' }) };
  }

  // Build divisions array (scoring app format)
  const divisionsArr = [];
  if (divInshore)  divisionsArr.push('Inshore');
  if (divOffshore) divisionsArr.push('Offshore');
  if (divTarpon)   divisionsArr.push('Tarpon');

  // Build TWT csv (detailed table format)
  const twtParts = [];
  if (twtInshore  && divInshore)  twtParts.push('Inshore');
  if (twtOffshore && divOffshore) twtParts.push('Offshore');
  if (twtTarpon   && divTarpon)   twtParts.push('Tarpon');

  // ── 1. Write to scoring app's boats table ──────────────────────────────────
  // boat_name is the vessel name; captainName is the captain
  // The scoring app uses "name" as the display name in the roster —
  // use boat name if provided, otherwise captain name
  const rosterName = (boatName && boatName.trim()) ? boatName.trim() : captainName.trim();

  const scoringBoatRow = {
    id:            `onsite-${Date.now()}`,
    name:          rosterName,
    divisions:     divisionsArr,
    captain_email: captainEmail  ? captainEmail.trim()  : '',
    captain_phone: captainPhone  ? captainPhone.trim()  : '',
  };

  const scoringResult = await supabasePost(SUPABASE_URL, SERVICE_KEY, 'boats', scoringBoatRow);
  if (!scoringResult.ok) {
    console.error('boats table insert error:', JSON.stringify(scoringResult.data));
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ success: false, error: 'Failed to save to scoring roster', detail: scoringResult.data }),
    };
  }

  const insertedId = Array.isArray(scoringResult.data) && scoringResult.data[0]
    ? scoringResult.data[0].id : scoringBoatRow.id;

  // ── 2. Write to detailed boat_registrations table (fire-and-forget) ─────────
  const detailRow = {
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
    divisions_csv:     divisionsArr.join(',') || null,
    twt_csv:           twtParts.join(',')     || null,
    amount_paid:       typeof amountPaid === 'number' ? amountPaid : null,
    payment_method:    paymentMethod   || null,
    stripe_payment_id: stripePaymentId || null,
    extras_json:       extrasJson      || null,
    scoring_boat_id:   insertedId,     // link back to scoring app row
  };

  // Non-fatal — don't block the response if this fails
  supabasePost(SUPABASE_URL, SERVICE_KEY, 'boat_registrations', detailRow)
    .then(r => { if (!r.ok) console.warn('boat_registrations insert warning:', JSON.stringify(r.data)); })
    .catch(err => console.warn('boat_registrations insert error (non-fatal):', err.message));

  console.log(`Onsite boat saved: "${rosterName}" → ${insertedId}`);
  return {
    statusCode: 200,
    headers: corsHeaders(),
    body: JSON.stringify({ success: true, id: insertedId, rosterName }),
  };
};
