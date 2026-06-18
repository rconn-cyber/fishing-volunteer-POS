const { createClient } = require("@supabase/supabase-js");
const sb = createClient(
  "https://qyoqyeaqacdjstvkonwx.supabase.co",
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async function(event) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  try {
    var body = JSON.parse(event.body);
    var { cognitoEntryId, divisions } = body;
    if (!cognitoEntryId) return { statusCode: 400, body: JSON.stringify({ success: false, error: "Missing cognitoEntryId" }) };
    var { error } = await sb
      .from("boats")
      .update({ divisions: divisions })
      .eq("id", "cognito-" + cognitoEntryId.toString().padStart(3, "0"));
    if (error) throw error;
    return { statusCode: 200, headers: {"Content-Type":"application/json"}, body: JSON.stringify({ success: true }) };
  } catch(err) {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
