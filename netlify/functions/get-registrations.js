/**
 * get-registrations.js
 * Fetches entries 1-60 from Cognito Form 187 individually.
 * Uses GET /api/forms/{InternalName}/entries/{id} which is confirmed
 * to work (Entry Scope: Read = "Get Entry").
 * Runs requests in parallel batches for speed.
 */

const https = require('https');

const FORM = '_2026RoughRidersCharityFishingTournamentEntry';
const MAX_ENTRY = 60; // fetch IDs 1..60, skip 404s
const BATCH     = 10; // parallel requests at a time

function cognitoGet(path) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.COGNITO_API_KEY;
    if (!apiKey) { reject(new Error('COGNITO_API_KEY not set')); return; }
    const options = {
      hostname: 'www.cognitoforms.com',
      path: `/api/${path}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: null }); }
      });
    });
    req.on('error', () => resolve({ status: 0, body: null }));
    req.end();
  });
}

async function fetchEntry(id) {
  const r = await cognitoGet(`forms/${FORM}/entries/${id}`);
  if (r.status === 200 && r.body) return r.body;
  return null;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  const debug = event.queryStringParameters && event.queryStringParameters.debug === '1';

  try {
    // Test single entry fetch in debug mode
    if (debug) {
      const single = await cognitoGet(`forms/${FORM}/entries/1`);
      const single2 = await cognitoGet(`forms/${FORM}/entries/187-1`);
      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({
          debug: true,
          'entries/1': { status: single.status, bodyKeys: single.body ? Object.keys(single.body) : null },
          'entries/187-1': { status: single2.status, bodyKeys: single2.body ? Object.keys(single2.body) : null },
        }),
      };
    }

    // Fetch all entries in parallel batches
    const entries = [];
    for (let start = 1; start <= MAX_ENTRY; start += BATCH) {
      const ids = [];
      for (let i = start; i < start + BATCH && i <= MAX_ENTRY; i++) ids.push(i);
      const results = await Promise.all(ids.map(fetchEntry));
      results.forEach(e => { if (e) entries.push(mapEntry(e)); });
    }

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ entries, count: entries.length, fetchedAt: new Date().toISOString() }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: err.message }) };
  }
};

function mapEntry(e) {
  // Full entry shape (nested) from GET /entries/{id}
  const ci   = e.ContactInformation || {};
  const td   = ci.TournamentDivision || {};
  const name = (ci.Name && ci.Name.FirstAndLast) || ci.CaptainName || '';
  const team = ci.TeamName || '';
  const divs = Array.isArray(td.Divisions) ? td.Divisions.join(',') : '';
  const divsC = Array.isArray(td.DivisionsComp) ? td.DivisionsComp.join(',') : '';
  const twtI = Array.isArray(td.TWTInshore)  && td.TWTInshore.length  ? 'Inshore'  : '';
  const twtO = Array.isArray(td.TWTOffshore) && td.TWTOffshore.length ? 'Offshore' : '';
  const twtT = Array.isArray(td.TWTTarpon)   && td.TWTTarpon.length   ? 'Tarpon'   : '';
  const twt  = [twtI, twtO, twtT].filter(Boolean).join(',');
  const paid = (e.Order && e.Order.OrderAmount) || 0;
  // Entry id is like "187-1" — extract the number
  const idRaw = e.Id || '';
  const idNum = idRaw.includes('-') ? parseInt(idRaw.split('-')[1]) : idRaw;

  return {
    id:            idNum,
    name,
    teamName:      team,
    divisions:     divs,
    divisionsComp: divsC,
    twt,
    isBoat:        !!e.AreYouEnteringABoat,
    boatNumber:    e.BoatNumber || null,
    amountPaid:    paid,
    sponsor:       e.SponsorName || null,
    email:         ci.Email || '',
    phone:         ci.Phone || '',
  };
}

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };
}
