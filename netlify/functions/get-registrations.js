const https = require('https');

// Org slug from Admin links: _1stUSVolunteerCavalryRegimentRoughRidersInc
const ORG  = '_1stUSVolunteerCavalryRegimentRoughRidersInc';
const FORM = '_2026RoughRidersCharityFishingTournamentEntry';

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
        catch (e) { resolve({ status: res.statusCode, body: data.substring(0, 300) }); }
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
    if (debug) {
      const results = {};
      const paths = [
        // Org-scoped paths (from admin URL pattern)
        `${ORG}/forms/187/entries?take=3`,
        `${ORG}/forms/${FORM}/entries?take=3`,
        // Without org prefix but with InternalName
        `forms/${FORM}/entries?take=3`,
        // Lowered
        `forms/${FORM.toLowerCase()}/entries?take=3`,
      ];
      for (const p of paths) {
        try { results[p] = await cognitoGet(p); }
        catch(e) { results[p] = { error: e.message }; }
      }
      return {
        statusCode: 200,
        headers: corsHeaders(),
        body: JSON.stringify({ debug: true, results }),
      };
    }

    // Try org-scoped path first (most likely correct based on admin URL pattern)
    let result = await cognitoGet(`${ORG}/forms/187/entries?take=200`);
    if (result.status === 404) {
      result = await cognitoGet(`forms/${FORM}/entries?take=200`);
    }
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
      body: JSON.stringify({ entries: list.map(mapEntry), count: list.length, fetchedAt: new Date().toISOString() }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: err.message }) };
  }
};

function mapEntry(e) {
  return {
    id:            e.Id || '',
    name:          e.ContactInformation_Name || '',
    teamName:      e.ContactInformation_TeamName || '',
    divisions:     e.ContactInformation_TournamentDivision_Divisions || '',
    divisionsComp: e.ContactInformation_TournamentDivision_DivisionsComp || '',
    twt: [
      e.ContactInformation_TournamentDivision_TWTInshore  || '',
      e.ContactInformation_TournamentDivision_TWTOffshore || '',
      e.ContactInformation_TournamentDivision_TWTTarpon   || '',
    ].filter(Boolean).join(','),
    isBoat:     e.AreYouEnteringABoat === 'Yes' || e.AreYouEnteringABoat === true,
    boatNumber: e.BoatNumber || null,
    amountPaid: e.Order_OrderAmount || 0,
    sponsor:    e.SponsorName || null,
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
