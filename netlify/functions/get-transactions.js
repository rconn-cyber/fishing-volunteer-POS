/**
 * get-transactions.js  v1
 * Netlify Function — fetches today's POS transactions from Supabase.
 *
 * GET /api/get-transactions
 * Optional query params:
 *   ?date=2026-06-19        — specific date (defaults to today)
 *   ?operator=Robin         — filter by operator
 *
 * Returns all pos_transactions for the requested date, newest first.
 *
 * Env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 */

const https = require('https');

function supabaseGet(supabaseUrl, serviceKey, table, params) {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams(params).toString();
    const path = `/rest/v1/${table}?${qs}`;
    const options = {
      hostname: new URL(supabaseUrl).hostname,
      path,
      method: 'GET',
      headers: {
        'apikey':        serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type':  'application/json',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, data: parsed, status: res.statusCode });
        } catch {
          resolve({ ok: false, data, status: res.statusCode });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders(), body: '' };

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ success: false, error: 'Server config error' }) };
  }

  const qp = event.queryStringParameters || {};

  // Default to today in ET (tournament is in Treasure Island, FL)
  const dateStr = qp.date || new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  // Build Supabase filter: created_at >= date 00:00 AND < date+1 00:00
  const dayStart = `${dateStr}T00:00:00`;
  const dayEnd   = new Date(new Date(dateStr).getTime() + 86400000)
                    .toISOString().split('T')[0] + 'T00:00:00';

  const params = {
    'created_at': `gte.${dayStart}`,
    'order':      'created_at.desc',
    'limit':      '500',
  };

  // Supabase PostgREST needs both filters — add lt separately in the path
  const qs = `created_at=gte.${dayStart}&created_at=lt.${dayEnd}&order=created_at.desc&limit=500`
           + (qp.operator ? `&operator_name=eq.${encodeURIComponent(qp.operator)}` : '');

  const path = `/rest/v1/pos_transactions?${qs}`;

  const result = await new Promise((resolve, reject) => {
    const options = {
      hostname: new URL(SUPABASE_URL).hostname,
      path,
      method: 'GET',
      headers: {
        'apikey':        SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type':  'application/json',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ ok: res.statusCode < 300, data: JSON.parse(data), status: res.statusCode }); }
        catch { resolve({ ok: false, data, status: res.statusCode }); }
      });
    });
    req.on('error', reject);
    req.end();
  });

  if (!result.ok) {
    console.error('get-transactions error:', JSON.stringify(result.data));
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({ success: false, error: 'Failed to fetch transactions', detail: result.data }),
    };
  }

  return {
    statusCode: 200,
    headers: corsHeaders(),
    body: JSON.stringify({ success: true, transactions: Array.isArray(result.data) ? result.data : [], date: dateStr }),
  };
};
