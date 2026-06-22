const { verifyToken, getCookie } = require("./auth");

const PSGC_BASE = "https://psgc.cloud/api/v2";
let cache = {
  cities: null,
  barangaysByCity: new Map(),
  loadedAt: 0
};

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

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\bcity of\b/g, "")
    .replace(/\bbrgy\.?\b/g, "barangay")
    .replace(/\bbgy\.?\b/g, "barangay")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clean(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function scoreContains(textNorm, name) {
  const n = normalize(name);
  if (!n) return 0;
  if (textNorm === n) return 1000;
  if (textNorm.includes(" " + n + " ") || textNorm.startsWith(n + " ") || textNorm.endsWith(" " + n)) return 500 + n.length;
  const words = n.split(" ").filter(w => w.length > 2);
  let score = 0;
  for (const w of words) if (textNorm.includes(w)) score += 20 + w.length;
  return score;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!res.ok) throw new Error(`PSGC request failed: ${res.status}`);

  const json = await res.json();

  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.data)) return json.data;
  if (json && Array.isArray(json.results)) return json.results;
  if (json && Array.isArray(json.items)) return json.items;
  if (json && json.data && Array.isArray(json.data.data)) return json.data.data;

  return [];
}

async function getCities() {
  if (Array.isArray(cache.cities)) return cache.cities;
  const cities = await fetchJson(`${PSGC_BASE}/cities-municipalities`);
  cache.cities = Array.isArray(cities) ? cities : [];
  return cache.cities;
}

async function getBarangaysForCity(city) {
  const key = city.code || city.name;
  if (cache.barangaysByCity.has(key)) return cache.barangaysByCity.get(key);
  const brgys = await fetchJson(`${PSGC_BASE}/cities-municipalities/${encodeURIComponent(city.code || city.name)}/barangays`);
  const list = Array.isArray(brgys) ? brgys : [];
  cache.barangaysByCity.set(key, list);
  return list;
}

function extractBarangayNumber(text) {
  const m = String(text || "").match(/\b(?:barangay|brgy\.?|bgy\.?)\s*(\d+[a-z]?)\b/i);
  return m ? m[1].toLowerCase() : "";
}

function extractZipCode(text) {
  const m = String(text || "").match(/\b(\d{4})\b(?!.*\b\d{4}\b)/);
  return m ? m[1] : "";
}

function cleanBarangayDisplay(text, fallbackNumber) {
  if (fallbackNumber) return "Barangay " + fallbackNumber;
  return clean(String(text || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(?:Near|Beside|Behind|Back of|In front of|Front of|Landmark)\b.*$/i, " ")
    .replace(/\b(?:No\.?|#)\s*\d+[A-Za-z]?\b[,\s-]*/gi, " ")
    .replace(/\b(?:Street|St\.?|Road|Rd\.?|Avenue|Ave\.?|Highway|Hwy\.?)\b.*$/i, " ")
    .replace(/^[,\s.-]+|[,\s.-]+$/g, " "));
}

function extractBarangayPhrase(text) {
  const m = String(text || "").match(/\b(?:barangay|brgy\.?|bgy\.?)\s*([a-z0-9ñÑ .\-\/]+?)(?=\s+(?:city|province|metro manila|ncr|philippines|zip|\d{4})\b|,|$)/i);
  return m ? clean(m[1]) : "";
}

function chooseBestCity(text, cities) {
  const textNorm = ` ${normalize(text)} `;
  let best = null;
  let bestScore = 0;

  for (const city of (Array.isArray(cities) ? cities : [])) {
    const score = scoreContains(textNorm, city.name);
    if (score > bestScore) {
      best = city;
      bestScore = score;
    }
  }

  if (/\btondo\b/i.test(text)) {
    const manila = cities.find(c => normalize(c.name).includes("manila"));
    if (manila) return { city: manila, score: 999, overrideCityName: "Tondo" };
  }

  if (/\bbaclaran\b/i.test(text)) {
    const paranaque = cities.find(c => normalize(c.name).includes("paranaque"));
    if (paranaque) return { city: paranaque, score: 999, overrideCityName: "Paranaque City" };
  }

  return { city: best, score: bestScore, overrideCityName: "" };
}

function chooseBestBarangay(text, barangays) {
  const textNorm = ` ${normalize(text)} `;
  const brgyNum = extractBarangayNumber(text);
  const brgyPhrase = normalize(extractBarangayPhrase(text));

  let best = null;
  let bestScore = 0;

  for (const b of (Array.isArray(barangays) ? barangays : [])) {
    const nameNorm = normalize(b.name);
    let score = scoreContains(textNorm, b.name);

    if (brgyNum) {
      const numberPattern = new RegExp(`\\b(?:barangay\\s*)?${brgyNum}\\b`, "i");
      if (numberPattern.test(nameNorm)) score += 600;
      if (nameNorm === brgyNum || nameNorm === `barangay ${brgyNum}`) score += 800;
    }

    if (brgyPhrase && (nameNorm.includes(brgyPhrase) || brgyPhrase.includes(nameNorm))) {
      score += 450;
    }

    if (score > bestScore) {
      best = b;
      bestScore = score;
    }
  }

  return { barangay: best, score: bestScore };
}

function provinceNameFromCity(city) {
  if (!city || !city.province) return "";
  if (typeof city.province === "string") return city.province;
  return city.province.name || "";
}

function regionNameFromCity(city) {
  if (!city || !city.region) return "";
  if (typeof city.region === "string") return city.region;
  return city.region.name || "";
}

exports.handler = async function(event) {
  const token = getCookie(event);
  const user = verifyToken(token);
  if (!user) return jsonResponse(401, { ok:false, error:"Not logged in" });

  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { ok:false, error:"POST only" });
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const text = clean(body.text || "");
    if (!text) return jsonResponse(400, { ok:false, error:"Missing address text" });
    const zip = extractZipCode(text);

    const cities = await getCities();
    const cityPick = chooseBestCity(text, cities);

    if (!cityPick.city || cityPick.score < 10) {
      return jsonResponse(200, {
        ok: true,
        found: false,
        reason: "No city/municipality match found",
        input: text
      });
    }

    const barangays = await getBarangaysForCity(cityPick.city);
    const brgyPick = chooseBestBarangay(text, barangays);

    const officialCity = cityPick.city.name || "";
    const displayCity = cityPick.overrideCityName || officialCity.replace(/^City of\s+/i, "");
    const province = provinceNameFromCity(cityPick.city) || (regionNameFromCity(cityPick.city).includes("NCR") ? "Metro Manila" : "");
    const region = regionNameFromCity(cityPick.city) || "";

    let barangayName = brgyPick.barangay ? brgyPick.barangay.name : "";
    const santaMarcelaOverride = /\bSanta\s+Marcela\b/i.test(text);
    const brgyNum = extractBarangayNumber(text);
    if (santaMarcelaOverride) barangayName = "Santa Marcela";
    else if (brgyNum) barangayName = cleanBarangayDisplay(barangayName, brgyNum);

    return jsonResponse(200, {
      ok: true,
      found: true,
      confidence: Math.min(100, Math.round((cityPick.score >= 500 ? 45 : 25) + (brgyPick.score >= 500 ? 50 : brgyPick.score > 0 ? 25 : 0))),
      source: "PSGC Cloud API v2",
      input: text,
      official: {
        city_municipality: officialCity,
        barangay: brgyPick.barangay ? brgyPick.barangay.name : "",
        province,
        region
      },
      display: {
        city: displayCity,
        barangay: barangayName,
        province: province || (region.includes("NCR") ? "Metro Manila" : ""),
        region: region || "Philippines",
        zip
      },
      codes: {
        city_municipality: cityPick.city.code || "",
        barangay: brgyPick.barangay ? brgyPick.barangay.code : ""
      }
    });
  } catch (err) {
    return jsonResponse(500, {
      ok:false,
      error: err.message || "Address lookup failed"
    });
  }
};
