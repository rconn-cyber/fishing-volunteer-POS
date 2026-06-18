/**
 * sync-cognito-boats.js
 * Netlify Function for rough-riders-fishing-scoring repo
 *
 * Fetches all boat entries from Cognito Form 187 and upserts them
 * into the Supabase public.boats table used by the scoring app.
 *
 * Called by the Admin panel "Sync from Cognito" button.
 *
 * POST /.netlify/functions/sync-cognito-boats
 *
 * Returns:
 *   { success: true, upserted: N, skipped: N, syncedAt: "ISO" }
 *
 * Env vars required (Netlify site settings for rough-riders-fishing-scoring):
 *   COGNITO_API_KEY       — already set
*    SUPABASE_URL          — set in Netlify environment variables
 *   SUPABASE_SERVICE_KEY  — service_role secret key
 */

const https = require('https');

const FORM      = '_2026RoughRidersCharityFishingTournamentEntry';
const MAX_ENTRY = 100;   // fetch up to 100 to catch future registrations
const BATCH     = 10;

// ── Cognito ───────────────────────────────────────────────────────────────────

function cognitoGet(apiKey, path) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'www.cognitoforms.com',
      path:     `/api/${path}`,
      method:   'GET',
      headers:  { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: null }); }
      });
    });
    req.on('error', () => resolve({ status: 0, body: null }));
    req.end();
  });
}

function mapEntry(e) {
  const ci  = e.ContactInformation || {};
  const td  = ci.TournamentDivision || {};
  const name = (ci.Name && ci.Name.FirstAndLast) || ci.CaptainName || '';
  const team = ci.TeamName || '';

  const paidDivs = Array.isArray(td.Divisions)     ? td.Divisions     : [];
  const compDivs = Array.isArray(td.DivisionsComp) ? td.DivisionsComp : [];
  const allDivs  = [...new Set([...paidDivs, ...compDivs])].filter(d =>
    ['Inshore','Offshore','Tarpon'].includes(d)
  );

  const idRaw = e.Id || '';
  const idNum = idRaw.includes('-') ? parseInt(idRaw.split('-')[1]) : parseInt(idRaw);

  // Roster name: team name if meaningful, else captain name
  let rosterName = '';
  if (team && team !== 'No Boat, Just Tickets') rosterName = team;
  else if (name) rosterName = name;

  return {
    cognitoId: idNum,
    rosterName: rosterName.trim(),
    divisions:  allDivs,
    email:      ci.Email || '',
    phone:      ci.Phone || '',
    isBoat:     !!e.AreYouEnteringABoat,
  };
}

// ── Supabase ──────────────────────────────────────────────────────────────────

function supabaseUpsert(supabaseUrl, serviceKey, rows) {
  return new Promise((resolve) => {
    const body = JSON.stringify(rows);
    const url  = new URL(`${supabaseUrl}/rest/v1/boats`);
    const options = {
      hostname: url.hostname,
     path: url.pathname + '?on_conflict=id',
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'apikey':          serviceKey,
        'Authorization':  `Bearer ${serviceKey}`,
        'Prefer':         'resolution=merge-duplicates,return=minimal',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data }));
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.write(body);
    req.end();
  });
}

function supabaseSaveSyncTime(supabaseUrl, serviceKey, syncedAt, count) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ key: 'cognito_last_sync', value: JSON.stringify({ syncedAt, count }) });
    const url  = new URL(`${supabaseUrl}/rest/v1/settings`);
    const options = {
      hostname: url.hostname,
      path:     url.pathname + '?on_conflict=key',
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'apikey':          serviceKey,
        'Authorization':  `Bearer ${serviceKey}`,
        'Prefer':         'resolution=merge-duplicates,return=minimal',
      },
    };
    const req = https.request(options, (res) => {
      res.on('data', () => {});
      res.on('end', () => resolve());
    });
    req.on('error', () => resolve());
    req.write(body);
    req.end();
  });
}

// ── Handler ───────────────────────────────────────────────────────────────────

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
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'POST only' }) };

  const COGNITO_KEY = process.env.COGNITO_API_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

  if (!COGNITO_KEY || !SUPABASE_URL || !SERVICE_KEY) {
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: 'Missing env vars' }) };
  }

  try {
    // 1. Fetch all Cognito entries in parallel batches
    const allEntries = [];
    for (let start = 1; start <= MAX_ENTRY; start += BATCH) {
      const ids = [];
      for (let i = start; i < start + BATCH && i <= MAX_ENTRY; i++) ids.push(i);
      const results = await Promise.all(
        ids.map(id => cognitoGet(COGNITO_KEY, `forms/${FORM}/entries/${id}`))
      );
      results.forEach(r => { if (r.status === 200 && r.body) allEntries.push(r.body); });
    }

    // 2. Filter to boat entries only and map to Supabase rows
    const boatRows = allEntries
      .map(mapEntry)
      .filter(e => e.isBoat && e.rosterName)
      .map((e, idx) => ({
        id:            `cognito-${String(e.cognitoId).padStart(3, '0')}`,
        name:          e.rosterName,
        divisions:     e.divisions,
        captain_email: e.email,
        captain_phone: e.phone,
        created_at:    '2026-06-16T00:00:00+00:00',  // fixed so walk-ups sort above
      }));

    if (boatRows.length === 0) {
      return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ success: true, upserted: 0, skipped: 0 }) };
    }

    // 3. Upsert into Supabase boats table
    const result = await supabaseUpsert(SUPABASE_URL, SERVICE_KEY, boatRows);
    if (!result.ok) {
      console.error('Supabase upsert error:', result.status, result.data);
      return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: 'Supabase upsert failed', detail: result.data }) };
    }

    // 4. Save last-sync timestamp to settings table
    const syncedAt = new Date().toISOString();
    await supabaseSaveSyncTime(SUPABASE_URL, SERVICE_KEY, syncedAt, boatRows.length);

    console.log(`Synced ${boatRows.length} boats from Cognito at ${syncedAt}`);
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ success: true, upserted: boatRows.length, syncedAt }),
    };

  } catch (err) {
    console.error('sync-cognito-boats error:', err);
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: err.message }) };
  }
};
