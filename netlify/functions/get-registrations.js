/**
 * get-registrations.js
 * Fetches entries 1-100 from Cognito Form 187 individually.
 */

const https = require('https');

const FORM = '_2026RoughRidersCharityFishingTournamentEntry';
const MAX_ENTRY = 100;
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

  // ── Extract ticket quantities from WeekendEventTickets ──────
  // Read directly from structured Cognito fields (most reliable).
  const wet  = e.WeekendEventTickets || {};
  const cap2 = wet.CaptainsMeeting2  || {};
  const pool2= wet.PoolParty2        || {};
  const ban2 = wet.AwardsBanquet2    || {};
  const all2 = wet.AllAccess         || {};

  const tickets = {
    cap:  parseInt(cap2.CaptainsMeetingTicketsQuantity2000)  || 0,
    pool: parseInt(pool2.PoolPartyTicketsQuantity2000)       || 0,
    ban:  parseInt(ban2.AwardsBanquetTicketsQuantity)        || 0,
    all:  parseInt(all2.AllAccessWristbandsQuantity9000)     || 0,
  };

  // Each boat entry includes 1 captain's meeting ticket (baked into entry fee).
  // Subtract it so POS only shows EXTRA pre-purchased tickets.
  const isBoat = !!e.AreYouEnteringABoat;
  if (isBoat && tickets.cap > 0) {
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
