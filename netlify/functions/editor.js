const fs = require("fs");
const path = require("path");
const { verifyToken, getCookie } = require("./auth");

exports.handler = async function(event) {
  const token = getCookie(event);
  const user = verifyToken(token);

  if (!user) {
    return {
      statusCode: 302,
      headers: { Location: "/login" },
      body: ""
    };
  }

  const filePath = path.join(process.cwd(), "private", "editor.html");
  const html = fs.readFileSync(filePath, "utf8");

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
      "Pragma": "no-cache",
      "Expires": "0"
    },
    body: html
  };
};
