const { clearCookie } = require("./auth");

exports.handler = async function() {
  return {
    statusCode: 302,
    headers: {
      "Set-Cookie": clearCookie(),
      "Location": "/login"
    },
    body: ""
  };
};
