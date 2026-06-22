const { createToken, makeCookie } = require("./auth");
const querystring = require("querystring");

function pickClientIp(headers = {}) {
  const h = {};
  for (const [k, v] of Object.entries(headers || {})) {
    h[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : String(v || "");
  }

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

function shorten(text, max) {
  text = String(text || "");
  return text.length > max ? text.slice(0, max - 3) + "..." : text;
}

async function getApproxLocationFromIp(ip) {
  if (!ip) {
    return {
      text: "Not captured",
      note: "IP-based approximate location only.ISP/VPN/server."
    };
  }

  try {
    const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, { cache: "no-store" });
    if (!res.ok) throw new Error("IP lookup failed");
    const data = await res.json();

    const text = [data.city, data.region, data.country_name || data.country]
      .filter(Boolean)
      .join(", ") || "Not captured";

    return {
      text,
      note: "IP-based approximate location only.ISP/VPN/server."
    };
  } catch (e) {
    return {
      text: "Not captured",
      note: "IP-based approximate location only.ISP/VPN/server."
    };
  }
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


function dataUrlToBlob(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/png);base64,(.+)$/);
  if (!match) return null;
  const bytes = Buffer.from(match[2], "base64");
  return new Blob([bytes], { type: match[1] });
}

async function postDiscordPayload(webhook, payload, locationPicture,
    locationStatusText) {
  const blob = dataUrlToBlob(locationPicture);

  if (!blob) {
    await postDiscordPayload(webhook, payload, entry.locationPicture);
    return;
  }

  payload.embeds[0].image = { url: "attachment://location-status.png" };

  const form = new FormData();
  form.append("payload_json", JSON.stringify(payload));
  form.append("files[0]", blob, "location-status.png");

  await fetch(webhook, {
    method: "POST",
    body: form
  });
}


async function sendDiscordLoginNotification(entry) {
  const webhook = process.env.DISCORD_WEBHOOK_URL || "";
  if (!webhook) return;

  let gpsText = "N/A";
  if (entry.gpsStatus === "granted") {
    gpsText = `Lat: ${entry.gpsLatitude}, Lng: ${entry.gpsLongitude}`;
    if (entry.gpsAccuracy) gpsText += ` | Accuracy: ~${entry.gpsAccuracy}m`;
    gpsText += "\nSource: Browser permission-based geolocation";
  } else if (entry.gpsNote) {
    gpsText = entry.gpsNote;
  }

  const payload = {
    username: "LOGIN ALERT!!!",
    content: "🔐 LOGIN!",
    embeds: [
      {
        title: "Successful Login",
        color: 3066993,
        fields: [
          { name: "User / Pangalan", value: shorten(entry.username, 200) || "Unknown", inline: true },
          { name: "Oras", value: shorten(entry.loginTime, 200), inline: true },
          { name: "Browser", value: shorten(entry.browser || "Not captured", 100), inline: true },
          { name: "Platform", value: shorten(entry.platform || "Not captured", 100), inline: true },
          { name: "Timezone", value: "Philippines UTC+8 / Asia/Manila", inline: true },
          { name: "Detected Timezone", value: shorten(entry.detectedTimezone || "Not captured", 100), inline: true },
          { name: "IP-based Approx Location", value: shorten(entry.locationText || "Not captured", 250), inline: false },
          { name: "Location Note", value: shorten(entry.locationNote || "IP-based approximate location only.", 500), inline: false },
          { name: "Location Status Text", value: shorten(entry.locationStatusText || "Not captured", 800), inline: false },
          { name: "Browser Location Permission", value: shorten(gpsText, 600), inline: false },
          { name: "IP", value: shorten(entry.ip || "Not captured", 100), inline: true },
          { name: "Raw Browser Info", value: shorten(entry.rawBrowserInfo || entry.userAgent || "Not captured", 900), inline: false }
        ],
        footer: { text: "Location is for security log only. IP-based location can be wrong; browser geolocation requires permission." },
        timestamp: new Date().toISOString()
      }
    ]
  };

  try {
    await fetch(webhook, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.warn("Discord webhook failed:", err.message);
  }
}

exports.handler = async function(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 302, headers: { Location: "/login" }, body: "" };
  }

  const body = querystring.parse(event.body || "");
  const username = String(body.username || "Unknown").trim();
  const password = String(body.password || "");
  const appPassword = process.env.APP_PASSWORD || "";
  const locationPicture = String(body.location_picture || "");
  const locationStatusText = String(body.location_status_text || "");

  if (!appPassword || password !== appPassword) {
    return { statusCode: 302, headers: { Location: "/login?error=1" }, body: "" };
  }

  const token = createToken(username);
  const ip = pickClientIp(event.headers);
  const approx = await getApproxLocationFromIp(ip);

  await sendDiscordLoginNotification({
    username,
    ip,
    loginTime: getPhilippinesTime(),
    browser: String(body.browser || ""),
    platform: String(body.platform || ""),
    detectedTimezone: String(body.detected_timezone || ""),
    rawBrowserInfo: String(body.raw_browser_info || event.headers["user-agent"] || ""),
    userAgent: event.headers["user-agent"] || "",
    locationText: approx.text,
    locationNote: approx.note,
    gpsStatus: String(body.gps_status || "N/A"),
    gpsLatitude: String(body.gps_latitude || ""),
    gpsLongitude: String(body.gps_longitude || ""),
    gpsAccuracy: String(body.gps_accuracy || ""),
    gpsNote: String(body.gps_note || "N/A"),
    locationPicture
  });

  return {
    statusCode: 302,
    headers: {
      "Set-Cookie": makeCookie(token),
      "Location": "/"
    },
    body: ""
  };
};
