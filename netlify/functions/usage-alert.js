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

function updateOnlineUser(info) {
  cleanupOnlineUsers();
  const key = info.sessionId || info.user || info.ip || ("anon-" + Math.random().toString(36).slice(2));
  onlineUsers.set(key, {
    user: info.user || "Unknown",
    sessionId: info.sessionId || key,
    ip: info.ip || "",
    browser: info.browser || "",
    lastAction: info.action || "open",
    lastSeen: Date.now()
  });
  cleanupOnlineUsers();
  return onlineUsers.size;
}

function getOnlineSummary() {
  cleanupOnlineUsers();
  return {
    onlineCount: onlineUsers.size,
    users: Array.from(onlineUsers.values()).map(u => ({
      user: u.user,
      sessionId: u.sessionId,
      ip: u.ip,
      lastAction: u.lastAction,
      lastSeen: u.lastSeen
    }))
  };
}

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

function normalizeHeaders(headers = {}) {
  const h = {};
  for (const [k, v] of Object.entries(headers || {})) {
    h[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v || "");
  }
  return h;
}

function pickClientIp(headers = {}) {
  const h = normalizeHeaders(headers);
  const candidates = [
    h["x-nf-client-connection-ip"],
    h["client-ip"],
    h["x-forwarded-for"],
    h["x-real-ip"],
    h["cf-connecting-ip"],
    h["fastly-client-ip"]
  ].filter(Boolean);

  for (const raw of candidates) {
    const first = String(raw).split(",")[0].trim();
    if (first) return first;
  }

  return "";
}

function shorten(text, max = 900) {
  text = String(text || "");
  return text.length > max ? text.slice(0, max - 3) + "..." : text;
}

function getPhilippinesTime() {
  return new Date().toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });
}

async function postDiscord(payload) {
  const webhook = process.env.DISCORD_WEBHOOK_URL || "";
  if (!webhook) return false;

  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  return res.ok;
}

exports.handler = async function(event) {
  const token = getCookie(event);
  const user = verifyToken(token);

  if (!user) {
    return jsonResponse(401, { ok:false, error:"Not logged in" });
  }

  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { ok:false, error:"POST only" });
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const action = String(body.action || "open").toLowerCase();
    const page = String(body.page || "Waybill Editor");
    const sessionId = String(body.sessionId || "");
    const browser = String(body.browser || "");
    const platform = String(body.platform || "");
    const timezone = String(body.timezone || "");
    const screenSize = String(body.screenSize || "");
    const href = String(body.href || "");
    const ip = pickClientIp(event.headers);
    const ua = event.headers["user-agent"] || event.headers["User-Agent"] || "";
    const onlineCount = updateOnlineUser({
      user: user.u || "Unknown",
      sessionId,
      ip,
      browser: browser || ua,
      action
    });
    const onlineSummary = getOnlineSummary();

    const actionTitle =
      action === "active" ? "🟢 ACTIVE USER" :
      action === "download" ? "⬇️ DOWNLOAD ACTION" :
      action === "apply" ? "✅ APPLY ACTION" :
      action === "logout" ? "🚪 LOGOUT / LEFT PAGE" :
      "👀 WEBSITE OPENED";

    const color =
      action === "active" ? 5763719 :
      action === "download" ? 3447003 :
      action === "apply" ? 15844367 :
      action === "logout" ? 10038562 :
      3066993;

    const payload = {
      username: "WEBSITE ACTIVITY",
      content: actionTitle,
      embeds: [
        {
          title: actionTitle,
          color,
          fields: [
            { name: "User", value: shorten(user.u || "Unknown", 200), inline: true },
            { name: "Time PH", value: getPhilippinesTime(), inline: true },
            { name: "Action", value: shorten(action, 100), inline: true },
            { name: "Online Now", value: String(onlineCount), inline: true },
            { name: "Page", value: shorten(page, 200), inline: true },
            { name: "Session ID", value: shorten(sessionId || "N/A", 120), inline: true },
            { name: "IP", value: shorten(ip || "Not captured", 120), inline: true },
            { name: "Browser", value: shorten(browser || ua || "Not captured", 900), inline: false },
            { name: "Platform", value: shorten(platform || "Not captured", 200), inline: true },
            { name: "Timezone", value: shorten(timezone || "Not captured", 200), inline: true },
            { name: "Screen", value: shorten(screenSize || "Not captured", 200), inline: true },
            { name: "URL", value: shorten(href || "N/A", 900), inline: false },
            { name: "Online Users", value: shorten(onlineSummary.users.map(u => `${u.user} (${u.sessionId})`).join("\n") || "None", 900), inline: false }
          ],
          footer: {
            text: "One Discord message = one tracked activity. Count messages to know usage."
          },
          timestamp: new Date().toISOString()
        }
      ]
    };

    const sent = await postDiscord(payload);

    return jsonResponse(200, {
      ok: true,
      sent,
      action,
      note: sent ? "Discord activity alert sent." : "No DISCORD_WEBHOOK_URL set.",
      onlineCount,
      onlineUsers: onlineSummary.users
    });
  } catch (err) {
    return jsonResponse(500, {
      ok:false,
      error: err.message || "Usage alert failed"
    });
  }
};
