const { verifyToken, getCookie } = require("./auth");

function jsonResponse(statusCode, data) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(data)
  };
}

exports.handler = async function(event) {
  const token = getCookie(event);
  const user = verifyToken(token);

  if (!user) {
    return jsonResponse(401, { ok:false, error:"Not logged in" });
  }

  return jsonResponse(200, {
    ok: true,
    note: "Deploy-safe version: no external npm dependencies. Existing frontend PDF importer remains active. Backend PDF parser can be added after Netlify install logs are fixed.",
    data: {}
  });
};
