const { verifyToken, getCookie } = require("./auth");

const ONLINE_TTL_MS = 2 * 60 * 1000;
const onlineUsers = global.__WAYBILL_ONLINE_USERS__ || new Map();
global.__WAYBILL_ONLINE_USERS__ = onlineUsers;

function cleanupOnlineUsers() {
  const now = Date.now();
  for (const [id, info] of onlineUsers.entries()) {
    if (!info || !info.lastSeen || now - info.lastSeen > ONLINE_TTL_MS) {
      onlineUsers.delete(id);
    }
  }
}

exports.handler = async function(event) {
  const token = getCookie(event);
  const user = verifyToken(token);

  if (!user) {
    return {
      statusCode: 401,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      body: JSON.stringify({ ok:false, error:"Not logged in" })
    };
  }

  cleanupOnlineUsers();

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body: JSON.stringify({
      ok: true,
      onlineCount: onlineUsers.size,
      users: Array.from(onlineUsers.values()).map(u => ({
        user: u.user,
        sessionId: u.sessionId,
        ip: u.ip,
        lastAction: u.lastAction,
        lastSeen: u.lastSeen
      })),
      note: "Approximate online count. A user is counted online if they sent activity within the last 2 minutes."
    })
  };
};
