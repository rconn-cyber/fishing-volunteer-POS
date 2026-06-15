const https = require('https');

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
        catch (e) { resolve({ status: res.statusCode, body: data.substring(0, 500) }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Form 187 InternalName = _2026RoughRidersCharityFishingTournamentEntry
const FORM_NAME = '_2026RoughRidersCharityFishingTournamentEntry';

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }

  const debug = event.queryStringParameters && event.queryStringParameters.debug === '1';

  try {
    if (debug) {
      const results = {};
      const paths = [
        `forms/${FORM_NAME}/entries?take=5`,
        `forms/${FORM_NAME}/entries`,
        // Also try the org-scoped path some Cognito plans use
        `forms/187/entries?take=5`,
      ];
      for (const p of paths) {
        try { results[p] = await cognitoGet(p); }
        catch(e) { results[p] = { error: e.message }; }
      }
      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({ debug: true, formName: FORM_NAME, results }),
      };
    }

    // Fetch all entries using InternalName
    const result = await cognitoGet(`forms/${FORM_NAME}/entries?take=200`);

    if (result.status !== 200) {
      throw new Error('Cognito ' + result.status + ': ' + JSON.stringify(result.body).substring(0, 200));
    }

    const raw = result.body;
    const list = Array.isArray(raw) ? raw
               : Array.isArray(raw.entries) ? raw.entries
               : [];

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        entries: list.map(mapEntry),
        count: list.length,
        fetchedAt: new Date().toISOString()
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

function mapEntry(e) {
  return {
    id:           e.Id || '',
    name:         e.ContactInformation_Name || '',
    teamName:     e.ContactInformation_TeamName || '',
    divisions:    e.ContactInformation_TournamentDivision_Divisions || '',
    divisionsComp:e.ContactInformation_TournamentDivision_DivisionsComp || '',
    twt: [
      e.ContactInformation_TournamentDivision_TWTInshore  || '',
      e.ContactInformation_TournamentDivision_TWTOffshore || '',
      e.ContactInformation_TournamentDivision_TWTTarpon   || '',
    ].filter(Boolean).join(','),
    isBoat:       e.AreYouEnteringABoat === 'Yes' || e.AreYouEnteringABoat === true,
    boatNumber:   e.BoatNumber || null,
    amountPaid:   e.Order_OrderAmount || 0,
    sponsor:      e.SponsorName || null,
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
