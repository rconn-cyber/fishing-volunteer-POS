/**
 * get-registrations.js
 * Fetches entries 1-60 from Cognito Form 187 individually.
 */

const https = require('https');

const FORM = '_2026RoughRidersCharityFishingTournamentEntry';
const MAX_ENTRY = 80;
const BATCH     = 10;

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
    if (debug) {
      const single = await cognitoGet(`forms/${FORM}/entries/53`);
      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({
          debug: true,
          status: single.status,
          body: single.body,
        }),
      };
    }

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
  const idRaw = e.Id || '';
  const idNum = idRaw.includes('-') ? parseInt(idRaw.split('-')[1]) : idRaw;

  // ── Extract ticket quantities from Order.Items ──────────────
  // Each item has a Name and Quantity. Map known Cognito product names.
  const tickets = { cap: 0, pool: 0, ban: 0, all: 0 };
  const orderItems = (e.Order && Array.isArray(e.Order.Items)) ? e.Order.Items : [];
  orderItems.forEach(function(item) {
    const n = (item.Name || item.ProductName || item.Description || '').toLowerCase();
    const qty = parseInt(item.Quantity) || 1;
    if (n.includes("captain")) tickets.cap += qty;
    if (n.includes("pool"))    tickets.pool += qty;
    if (n.includes("banquet") || n.includes("award") || n.includes("dinner")) tickets.ban += qty;
    if (n.includes("all-access") || n.includes("all access")) tickets.all += qty;
  });
  // Each boat entry includes 1 captain's meeting ticket by default
  const isBoat = !!e.AreYouEnteringABoat;
  if (isBoat && tickets.cap > 0) {
    // The included ticket is baked into the entry fee — extras are above 1
    tickets.cap = Math.max(0, tickets.cap - 1);
  }

  return {
    id:            idNum,
    name,
    teamName:      team,
    divisions:     divs,
    divisionsComp: divsC,
    twt,
    tickets,       // { cap, pool, ban, all } — EXTRA tickets beyond what's included
    isBoat,
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
