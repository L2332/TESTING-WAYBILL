const { verifyToken, getCookie } = require("./auth");

exports.handler = async function(event) {
  const token = getCookie(event);
  const user = verifyToken(token);

  return {
    statusCode: user ? 200 : 401,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
      "Pragma": "no-cache",
      "Expires": "0"
    },
    body: JSON.stringify({
      ok: !!user,
      t: Date.now()
    })
  };
};
