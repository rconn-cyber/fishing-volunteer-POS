/**
 * get-registrations.js  v2
 * Fetches entries from Cognito Form 187 individually.
 *
 * v2 changes vs v1:
 *  - Stops fetching after CONSECUTIVE_MISS consecutive 404s (early exit)
 *  - Reduced MAX_ENTRY to 150 (safety cap)
 *  - Larger batch size (15) to reduce round-trips
 *  - Returns partial results + timing metadata for debugging
 *  - Cache-Control header so browser/CDN can cache for 60s
 */

const https = require('https');

const FORM             = '_2026RoughRidersCharityFishingTournamentEntry';
const MAX_ENTRY        = 150;   // hard ceiling
const BATCH            = 15;   // parallel requests per round
const CONSECUTIVE_MISS = 5;    // stop after this many sequential 404s

function cognitoGet(path) {
  return new Promise((resolve) => {
    const apiKey = process.env.COGNITO_API_KEY;
    if (!apiKey) { resolve({ status: 0, body: null, error: 'COGNITO_API_KEY not set' }); return; }
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
    req.on('error', (err) => resolve({ status: 0, body: null, error: err.message }));
    req.end();
  });
}

async function fetchEntry(id) {
  const r = await cognitoGet(`forms/${FORM}/entries/${id}`);
  return { id, status: r.status, entry: (r.status === 200 && r.body) ? r.body : null };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  const qp    = event.queryStringParameters || {};
  const debug = qp.debug === '1';
  const t0    = Date.now();

  try {
    // ── Debug single-entry mode ──────────────────────────────────────────────
    if (debug) {
      const id    = parseInt(qp.id || '1');
      const single = await cognitoGet(`forms/${FORM}/entries/${id}`);
      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({ debug: true, id, status: single.status, body: single.body }),
      };
    }

    // ── Main fetch loop with early-exit ──────────────────────────────────────
    const entries       = [];
    let consecutiveMiss = 0;
    let fetched         = 0;

    for (let start = 1; start <= MAX_ENTRY; start += BATCH) {
      const ids = [];
      for (let i = start; i < start + BATCH && i <= MAX_ENTRY; i++) ids.push(i);

      const results = await Promise.all(ids.map(fetchEntry));
      fetched += ids.length;

      for (const r of results) {
        if (r.entry) {
          entries.push(mapEntry(r.entry));
          consecutiveMiss = 0;          // reset miss counter on any hit
        } else if (r.status === 404) {
          consecutiveMiss++;
        }
        // non-404 errors (timeout, 500) don't count as misses
      }

      // Stop early once we've seen CONSECUTIVE_MISS gaps in a row
      if (consecutiveMiss >= CONSECUTIVE_MISS) break;

      // Also stop if we're close to the 9-second mark (Netlify limit is 10s)
      if (Date.now() - t0 > 8500) break;
    }

    const elapsed = Date.now() - t0;
    console.log(`get-registrations: ${entries.length} entries in ${elapsed}ms (fetched IDs 1–${fetched})`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
      },
      body: JSON.stringify({
        entries,
        count:     entries.length,
        fetchedAt: new Date().toISOString(),
        elapsedMs: elapsed,
      }),
    };

  } catch (err) {
    console.error('get-registrations error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ error: err.message }),
    };
  }
};

// ── Entry mapper (unchanged from v1) ────────────────────────────────────────
function mapEntry(e) {
  const ci   = e.ContactInformation || {};
  const td   = ci.TournamentDivision || {};
  const name = (ci.Name && ci.Name.FirstAndLast) || ci.CaptainName || '';
  const team = ci.TeamName || '';
  const divs = Array.isArray(td.Divisions)     ? td.Divisions.join(',')     : '';
  const divsC= Array.isArray(td.DivisionsComp) ? td.DivisionsComp.join(',') : '';
  const twtI = Array.isArray(td.TWTInshore)  && td.TWTInshore.length  ? 'Inshore'  : '';
  const twtO = Array.isArray(td.TWTOffshore) && td.TWTOffshore.length ? 'Offshore' : '';
  const twtT = Array.isArray(td.TWTTarpon)   && td.TWTTarpon.length   ? 'Tarpon'   : '';
  const twt  = [twtI, twtO, twtT].filter(Boolean).join(',');
  const paid = (e.Order && e.Order.OrderAmount) || 0;
  const idRaw = e.Id || '';
  const idNum = idRaw.includes('-') ? parseInt(idRaw.split('-')[1]) : idRaw;

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

  const isBoat = !!e.AreYouEnteringABoat;

  return {
    id:            idNum,
    name,
    teamName:      team,
    divisions:     divs,
    divisionsComp: divsC,
    twt,
    tickets,
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
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };
}
