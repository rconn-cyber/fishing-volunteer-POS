// netlify/functions/_cors.js  — shared CORS helper for all functions
// Usage in any function:
//   const { corsHeaders, handlePreflight } = require('./_cors');
//
//   exports.handler = async (event) => {
//     const preflight = handlePreflight(event);
//     if (preflight) return preflight;
//     // ... your logic ...
//     return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(data) };
//   };

const ALLOWED_ORIGIN = 'https://rr-volunteer-pos.netlify.app';

const corsHeaders = {
  'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Vary': 'Origin',
};

function handlePreflight(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }
  return null;
}

module.exports = { corsHeaders, handlePreflight };
