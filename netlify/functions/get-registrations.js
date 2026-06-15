/**
 * get-registrations.js
 * Fetches all entries from Cognito Form 187 (2026 Fishing Tournament)
 * and returns a clean roster for the registration table app.
 * Also fetches add-on form 210 entries.
 *
 * GET /.netlify/functions/get-registrations
 */

const https = require('https');

function cognitoGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.cognitoforms.com',
      path: `/api/1/${path}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.COGNITO_API_KEY}`,
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON: ' + data.substring(0, 200))); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

exports.handler = async function () {
  try {
    // Fetch all entries from main form 187 (view 187-1 = All Entries)
    const data = await cognitoGet('forms/187/views/187-1/entries?take=200');

    const entries = (data.entries || data || []).map(e => ({
      id:          e.Id,
      entryNum:    e.Id,                                          // Cognito entry number
      name:        e.ContactInformation_Name || '',
      teamName:    e.ContactInformation_TeamName || '',
      divisions:   e.ContactInformation_TournamentDivision_Divisions || '',
      divisionsComp: e.ContactInformation_TournamentDivision_DivisionsComp || '',
      isBoat:      e.AreYouEnteringABoat === 'Yes',
      boatNumber:  e.BoatNumber || null,
      amountPaid:  e.Order_OrderAmount || 0,
      sponsor:     e.SponsorName || null,
      checkedIn:   false,                                         // managed client-side
    }));

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ entries, fetchedAt: new Date().toISOString() }),
    };
  } catch (err) {
    console.error('Cognito fetch error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
