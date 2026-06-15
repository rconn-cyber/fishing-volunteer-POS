/**
 * get-registrations.js
 * Fetches all entries from Cognito Form 187 (2026 Fishing Tournament)
 * using the direct entries endpoint (not the view endpoint).
 *
 * GET /.netlify/functions/get-registrations
 */

const https = require('https');

function cognitoGet(path) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.COGNITO_API_KEY;
    if (!apiKey) {
      reject(new Error('COGNITO_API_KEY environment variable not set'));
      return;
    }
    const options = {
      hostname: 'www.cognitoforms.com',
      path: `/api/1/${path}`,
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
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          reject(new Error('Cognito returned non-JSON (status ' + res.statusCode + '): ' + data.substring(0, 300)));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function mapEntry(e) {
  // Handle both flat (view) and nested (full entry) shapes
  const name    = e.ContactInformation_Name
               || (e.ContactInformation && e.ContactInformation.Name && e.ContactInformation.Name.FirstAndLast)
               || '';
  const team    = e.ContactInformation_TeamName
               || (e.ContactInformation && e.ContactInformation.TeamName)
               || '';
  const divs    = e.ContactInformation_TournamentDivision_Divisions
               || (e.ContactInformation && e.ContactInformation.TournamentDivision && Array.isArray(e.ContactInformation.TournamentDivision.Divisions)
                   ? e.ContactInformation.TournamentDivision.Divisions.join(',')
                   : '')
               || '';
  const divsComp = e.ContactInformation_TournamentDivision_DivisionsComp
               || (e.ContactInformation && e.ContactInformation.TournamentDivision && Array.isArray(e.ContactInformation.TournamentDivision.DivisionsComp)
                   ? e.ContactInformation.TournamentDivision.DivisionsComp.join(',')
                   : '')
               || '';
  const isBoat  = e.AreYouEnteringABoat === 'Yes' || e.AreYouEnteringABoat === true;
  const paid    = e.Order_OrderAmount != null ? e.Order_OrderAmount
               : (e.Order && e.Order.OrderAmount != null ? e.Order.OrderAmount : 0);
  const entryId = e.Id || (e.Entry && e.Entry.Number) || '';

  // Extract TWT from flat fields
  const twtInshore  = e.ContactInformation_TournamentDivision_TWTInshore  || '';
  const twtOffshore = e.ContactInformation_TournamentDivision_TWTOffshore || '';
  const twtTarpon   = e.ContactInformation_TournamentDivision_TWTTarpon   || '';
  const twt = [twtInshore, twtOffshore, twtTarpon].filter(Boolean).join(',');

  return {
    id:           entryId,
    name:         name,
    teamName:     team,
    divisions:    divs,
    divisionsComp: divsComp,
    twt:          twt,
    isBoat:       isBoat,
    boatNumber:   e.BoatNumber || null,
    amountPaid:   paid,
    sponsor:      e.SponsorName || null,
  };
}

exports.handler = async function (event) {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  // ?debug=1 returns raw Cognito response for troubleshooting
  const debug = event.queryStringParameters && event.queryStringParameters.debug === '1';

  try {
    // Try view endpoint first (187-1 = All Entries view, confirmed 49 entries via MCP)
    const raw = await cognitoGet('forms/187/views/187-1/entries?take=200');

    if (debug) {
      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({ debug: true, rawType: typeof raw, isArray: Array.isArray(raw), raw }),
      };
    }

    // Cognito view endpoint returns { entries: [...], requestId: "..." }
    let list;
    if (Array.isArray(raw)) {
      list = raw;
    } else if (raw && Array.isArray(raw.entries)) {
      list = raw.entries;
    } else if (raw && typeof raw === 'object' && !raw.error) {
      list = Object.values(raw).find(v => Array.isArray(v)) || [];
    } else if (raw && raw.error) {
      throw new Error('Cognito error: ' + raw.error + ' — ' + (raw.Message || ''));
    } else {
      throw new Error('Unexpected response: ' + JSON.stringify(raw).substring(0, 300));
    }

    const entries = list.map(mapEntry);

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ entries, count: entries.length, fetchedAt: new Date().toISOString() }),
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

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };
}
