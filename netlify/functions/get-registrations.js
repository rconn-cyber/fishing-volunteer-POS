const https = require('https');

function cognitoGet(path) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.COGNITO_API_KEY;
    if (!apiKey) { reject(new Error('COGNITO_API_KEY not set')); return; }
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
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data.substring(0, 500) }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  const debug = event.queryStringParameters && event.queryStringParameters.debug === '1';

  try {
    // Try multiple endpoint patterns to find what works with API key auth
    const endpoints = [
      'forms/187/entries?take=200',
      'forms/187/entries',
      'forms/187/entries?$top=200',
    ];

    if (debug) {
      // In debug mode, try all endpoints and return results
      const results = {};
      for (const ep of endpoints) {
        try {
          results[ep] = await cognitoGet(ep);
        } catch(e) {
          results[ep] = { error: e.message };
        }
      }
      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({ debug: true, results }),
      };
    }

    // Normal mode — use direct entries endpoint
    const result = await cognitoGet('forms/187/entries?take=200');
    const raw = result.body;

    let list;
    if (Array.isArray(raw)) {
      list = raw;
    } else if (raw && Array.isArray(raw.entries)) {
      list = raw.entries;
    } else if (raw && raw.Type === 'ResourceNotFound') {
      throw new Error('Cognito: Resource not found — check API key permissions');
    } else if (raw && typeof raw === 'object') {
      const arr = Object.values(raw).find(v => Array.isArray(v));
      list = arr || [];
    } else {
      throw new Error('Unexpected response: ' + JSON.stringify(raw).substring(0, 200));
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

function mapEntry(e) {
  const name  = e.ContactInformation_Name || '';
  const team  = e.ContactInformation_TeamName || '';
  const divs  = e.ContactInformation_TournamentDivision_Divisions || '';
  const divsC = e.ContactInformation_TournamentDivision_DivisionsComp || '';
  const isBoat = e.AreYouEnteringABoat === 'Yes' || e.AreYouEnteringABoat === true;
  const paid  = e.Order_OrderAmount != null ? e.Order_OrderAmount : 0;
  const twt   = [
    e.ContactInformation_TournamentDivision_TWTInshore  || '',
    e.ContactInformation_TournamentDivision_TWTOffshore || '',
    e.ContactInformation_TournamentDivision_TWTTarpon   || '',
  ].filter(Boolean).join(',');

  return {
    id: e.Id || '',
    name, teamName: team,
    divisions: divs, divisionsComp: divsC, twt,
    isBoat, boatNumber: e.BoatNumber || null,
    amountPaid: paid, sponsor: e.SponsorName || null,
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
