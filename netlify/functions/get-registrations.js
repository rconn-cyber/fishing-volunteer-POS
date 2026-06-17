/**
 * get-registrations.js  v4
 * ES5-compatible. No spread, no async/await, no template literals, no URL().
 * Fetches Cognito Form 187 entries + merges boat_number from Supabase boats table.
 */

'use strict';

var https = require('https');

var FORM             = '_2026RoughRidersCharityFishingTournamentEntry';
var MAX_ENTRY        = 150;
var BATCH            = 15;
var CONSECUTIVE_MISS = 5;

function cognitoGet(path, apiKey) {
  return new Promise(function(resolve) {
    var options = {
      hostname: 'www.cognitoforms.com',
      path: '/api/' + path,
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
    };
    var req = https.request(options, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: null }); }
      });
    });
    req.on('error', function() { resolve({ status: 0, body: null }); });
    req.end();
  });
}

function supabaseGet(supabaseUrl, serviceKey, path) {
  return new Promise(function(resolve) {
    var hostname = supabaseUrl.replace('https://', '').replace('http://', '').split('/')[0];
    var options = {
      hostname: hostname,
      path: path,
      method: 'GET',
      headers: {
        'apikey': serviceKey,
        'Authorization': 'Bearer ' + serviceKey,
        'Content-Type': 'application/json',
      },
    };
    var req = https.request(options, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: [] }); }
      });
    });
    req.on('error', function() { resolve({ status: 0, body: [] }); });
    req.end();
  });
}

function fetchEntry(id, apiKey) {
  return cognitoGet('forms/' + FORM + '/entries/' + id, apiKey).then(function(r) {
    return { id: id, status: r.status, entry: (r.status === 200 && r.body) ? r.body : null };
  });
}

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };
}

function respond(statusCode, body) {
  return { statusCode: statusCode, headers: corsHeaders(), body: JSON.stringify(body) };
}

// Fetch boat numbers from Supabase — returns a map of { captainNameLower: boatNumber }
function fetchBoatNumbers(supabaseUrl, serviceKey) {
  if (!supabaseUrl || !serviceKey) return Promise.resolve({});
  return supabaseGet(supabaseUrl, serviceKey, '/rest/v1/boats?select=name,boat_number&boat_number=not.is.null').then(function(r) {
    var map = {};
    if (!Array.isArray(r.body)) return map;
    r.body.forEach(function(b) {
      if (b.name && b.boat_number) {
        // Index by lowercase boat name for fuzzy matching
        map[b.name.toLowerCase()] = b.boat_number;
      }
    });
    return map;
  }).catch(function() { return {}; });
}

// Try to find boat number by matching captain name or team name against Supabase boat names
function lookupBoatNumber(entry, boatMap) {
  // First try Cognito BoatNumber field directly
  if (entry.boatNumber) return entry.boatNumber;
  if (!boatMap || Object.keys(boatMap).length === 0) return null;

  var namesToTry = [
    entry.name,
    entry.teamName,
  ].filter(Boolean);

  for (var i = 0; i < namesToTry.length; i++) {
    var n = namesToTry[i].toLowerCase();
    // Exact match
    if (boatMap[n]) return boatMap[n];
    // Partial match — check if any boat name contains the captain last name
    var parts = n.split(/\s+/);
    var lastName = parts[parts.length - 1];
    if (lastName && lastName.length > 3) {
      var keys = Object.keys(boatMap);
      for (var j = 0; j < keys.length; j++) {
        if (keys[j].indexOf(lastName) !== -1) return boatMap[keys[j]];
      }
    }
  }
  return null;
}

exports.handler = function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return Promise.resolve({ statusCode: 200, headers: corsHeaders(), body: '' });
  }

  var apiKey      = process.env.COGNITO_API_KEY;
  var supabaseUrl = process.env.SUPABASE_URL;
  var serviceKey  = process.env.SUPABASE_SERVICE_KEY;

  if (!apiKey) {
    return Promise.resolve(respond(500, { error: 'COGNITO_API_KEY not set' }));
  }

  var qp    = event.queryStringParameters || {};
  var debug = qp.debug === '1';
  var t0    = Date.now();

  if (debug) {
    var debugId = parseInt(qp.id || '1', 10);
    return cognitoGet('forms/' + FORM + '/entries/' + debugId, apiKey).then(function(r) {
      return respond(200, { debug: true, id: debugId, status: r.status, body: r.body });
    });
  }

  var entries         = [];
  var consecutiveMiss = 0;
  var start           = 1;

  function nextBatch() {
    if (start > MAX_ENTRY || consecutiveMiss >= CONSECUTIVE_MISS) {
      return Promise.resolve(null);
    }
    if (Date.now() - t0 > 8000) {
      return Promise.resolve(null);
    }

    var ids = [];
    for (var i = start; i < start + BATCH && i <= MAX_ENTRY; i++) { ids.push(i); }
    start += BATCH;

    return Promise.all(ids.map(function(id) { return fetchEntry(id, apiKey); })).then(function(results) {
      for (var j = 0; j < results.length; j++) {
        var r = results[j];
        if (r.entry) { entries.push(mapEntry(r.entry)); consecutiveMiss = 0; }
        else if (r.status === 404) { consecutiveMiss++; }
      }
      return nextBatch();
    });
  }

  // Run Cognito fetch and Supabase boat lookup in parallel
  return Promise.all([
    nextBatch(),
    fetchBoatNumbers(supabaseUrl, serviceKey),
  ]).then(function(results) {
    var boatMap = results[1] || {};

    // Merge boat numbers into entries
    entries.forEach(function(entry) {
      if (!entry.boatNumber) {
        entry.boatNumber = lookupBoatNumber(entry, boatMap);
      }
    });

    var hdrs = corsHeaders();
    hdrs['Cache-Control'] = 'public, max-age=30, stale-while-revalidate=60';
    return {
      statusCode: 200,
      headers: hdrs,
      body: JSON.stringify({
        entries: entries,
        count: entries.length,
        fetchedAt: new Date().toISOString(),
        elapsedMs: Date.now() - t0,
      }),
    };
  }).catch(function(err) {
    return respond(500, { error: err.message || 'Unknown error' });
  });
};

function mapEntry(e) {
  var ci   = e.ContactInformation || {};
  var td   = ci.TournamentDivision || {};
  var name = (ci.Name && ci.Name.FirstAndLast) || ci.CaptainName || '';
  var team = ci.TeamName || '';
  var divs = Array.isArray(td.Divisions)     ? td.Divisions.join(',')     : '';
  var divsC= Array.isArray(td.DivisionsComp) ? td.DivisionsComp.join(',') : '';
  var twtI = (Array.isArray(td.TWTInshore)  && td.TWTInshore.length)  ? 'Inshore'  : '';
  var twtO = (Array.isArray(td.TWTOffshore) && td.TWTOffshore.length) ? 'Offshore' : '';
  var twtT = (Array.isArray(td.TWTTarpon)   && td.TWTTarpon.length)   ? 'Tarpon'   : '';
  var twt  = [twtI, twtO, twtT].filter(Boolean).join(',');
  var paid = (e.Order && e.Order.OrderAmount) || 0;
  var idRaw = e.Id || '';
  var idNum = (idRaw.indexOf('-') !== -1) ? parseInt(idRaw.split('-')[1], 10) : idRaw;
  var wet  = e.WeekendEventTickets || {};
  var cap2 = wet.CaptainsMeeting2  || {};
  var pool2= wet.PoolParty2        || {};
  var ban2 = wet.AwardsBanquet2    || {};
  var all2 = wet.AllAccess         || {};
  var tickets = {
    cap:  parseInt(cap2.CaptainsMeetingTicketsQuantity2000,  10) || 0,
    pool: parseInt(pool2.PoolPartyTicketsQuantity2000,       10) || 0,
    ban:  parseInt(ban2.AwardsBanquetTicketsQuantity,        10) || 0,
    all:  parseInt(all2.AllAccessWristbandsQuantity9000,     10) || 0,
  };
  return {
    id: idNum, name: name, teamName: team, divisions: divs, divisionsComp: divsC,
    twt: twt, tickets: tickets, isBoat: !!e.AreYouEnteringABoat,
    boatNumber: e.BoatNumber || null,
    boatName: e.BoatNumber || null,
    amountPaid: paid, sponsor: e.SponsorName || null,
    email: ci.Email || '', phone: ci.Phone || '',
  };
}
