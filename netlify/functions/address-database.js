const { verifyToken, getCookie } = require("./auth");

const API_BASES = [
  "https://psgc.cloud/api/v1",
  "https://psgc.cloud/api/v2"
];

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

let cache = {
  loadedAt: 0,
  source: "",
  provinces: [],
  citiesMunicipalities: [],
  barangays: [],
  loading: null
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

function normalizeText(s) {
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

function unwrapList(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.data)) return json.data;
  if (json && Array.isArray(json.results)) return json.results;
  if (json && Array.isArray(json.items)) return json.items;
  if (json && json.data && Array.isArray(json.data.data)) return json.data.data;
  return [];
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
  return await res.json();
}

async function fetchList(path, maxPages = 80) {
  let lastError = null;

  for (const base of API_BASES) {
    const output = [];
    try {
      for (let page = 1; page <= maxPages; page++) {
        const sep = path.includes("?") ? "&" : "?";
        const url = `${base}${path}${sep}per_page=1000&page=${page}`;
        const json = await fetchJson(url);
        const list = unwrapList(json);

        if (!list.length && page === 1) break;
        output.push(...list);

        const hasNext =
          json && (
            json.next_page_url ||
            json.next ||
            json.nextPage ||
            (json.meta && json.meta.current_page && json.meta.last_page && json.meta.current_page < json.meta.last_page)
          );

        if (!hasNext && list.length < 1000) break;
      }

      if (output.length) return { source: base, data: output };
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError) throw lastError;
  return { source: "", data: [] };
}

function firstValue(item, keys) {
  for (const k of keys) {
    if (item && item[k] !== undefined && item[k] !== null && String(item[k]).trim() !== "") return item[k];
  }
  return "";
}

function cleanItems(list, type) {
  return (Array.isArray(list) ? list : []).map(item => ({
    code: firstValue(item, ["code", "psgc_code", "id"]),
    name: firstValue(item, ["name", "title", "label", "area_name", "psgc_name"]),
    type,
    regionCode: firstValue(item, ["region_code", "regionCode", "region"]),
    provinceCode: firstValue(item, ["province_code", "provinceCode", "province"]),
    cityMunicipalityCode: firstValue(item, ["city_municipality_code", "cityMunicipalityCode", "city_code", "municipality_code", "locality_code"]),
    raw: item
  })).filter(x => x.name);
}

async function loadDatabase(force = false) {
  const fresh = cache.loadedAt && (Date.now() - cache.loadedAt < CACHE_TTL_MS);
  if (!force && fresh && cache.citiesMunicipalities.length) return cache;
  if (cache.loading) return await cache.loading;

  cache.loading = (async () => {
    const provincesRes = await fetchList("/provinces", 30);
    const citiesRes = await fetchList("/cities-municipalities", 100);

    let barangaysRes = { source: "", data: [] };
    try {
      barangaysRes = await fetchList("/barangays", 100);
    } catch (e) {
      barangaysRes = { source: "", data: [] };
    }

    cache = {
      loadedAt: Date.now(),
      source: provincesRes.source || citiesRes.source || barangaysRes.source || "PSGC Cloud",
      provinces: cleanItems(provincesRes.data, "province"),
      citiesMunicipalities: cleanItems(citiesRes.data, "city_municipality"),
      barangays: cleanItems(barangaysRes.data, "barangay"),
      loading: null
    };

    return cache;
  })();

  return await cache.loading;
}

function searchList(list, query, limit = 25) {
  const q = normalizeText(query);
  const source = Array.isArray(list) ? list : [];
  if (!q) return source.slice(0, limit);

  return source
    .map(item => {
      const n = normalizeText(item.name);
      let score = 0;
      if (n === q) score = 1000;
      else if (n.startsWith(q)) score = 800;
      else if (n.includes(q)) score = 500;
      else {
        for (const part of q.split(" ").filter(Boolean)) {
          if (n.includes(part)) score += 30;
        }
      }
      return { item, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
    .slice(0, limit)
    .map(x => x.item);
}

function matchAddressText(text, db) {
  const q = normalizeText(text);

  let bestCity = null;
  let bestCityScore = 0;
  for (const city of db.citiesMunicipalities) {
    const n = normalizeText(city.name);
    let score = 0;
    if (q.includes(n)) score = 500 + n.length;
    else {
      for (const part of n.split(" ").filter(x => x.length > 2)) {
        if (q.includes(part)) score += 10;
      }
    }
    if (score > bestCityScore) {
      bestCity = city;
      bestCityScore = score;
    }
  }

  let bestBarangay = null;
  let bestBarangayScore = 0;
  for (const brgy of db.barangays) {
    const n = normalizeText(brgy.name);
    let score = 0;
    if (q.includes(n)) score = 500 + n.length;
    else {
      for (const part of n.split(" ").filter(x => x.length > 2)) {
        if (q.includes(part)) score += 12;
      }
    }
    if (bestCity && brgy.cityMunicipalityCode && bestCity.code && String(brgy.cityMunicipalityCode) === String(bestCity.code)) {
      score += 300;
    }
    if (score > bestBarangayScore) {
      bestBarangay = brgy;
      bestBarangayScore = score;
    }
  }

  let bestProvince = null;
  let bestProvinceScore = 0;
  for (const province of db.provinces) {
    const n = normalizeText(province.name);
    const score = q.includes(n) ? 500 + n.length : 0;
    if (score > bestProvinceScore) {
      bestProvince = province;
      bestProvinceScore = score;
    }
  }

  return {
    city: bestCity,
    barangay: bestBarangay,
    province: bestProvince,
    confidence: Math.min(100, Math.round((bestCityScore ? 35 : 0) + (bestBarangayScore ? 45 : 0) + (bestProvinceScore ? 20 : 0)))
  };
}

exports.handler = async function(event) {
  const token = getCookie(event);
  const user = verifyToken(token);
  if (!user) return jsonResponse(401, { ok:false, error:"Not logged in" });

  try {
    const method = event.httpMethod || "GET";
    const query = event.queryStringParameters || {};
    const db = await loadDatabase(query.force === "1" || query.force === "true");

    if (method === "POST") {
      const body = JSON.parse(event.body || "{}");
      const text = body.text || "";
      return jsonResponse(200, {
        ok: true,
        source: db.source,
        loadedAt: db.loadedAt,
        counts: {
          provinces: db.provinces.length,
          citiesMunicipalities: db.citiesMunicipalities.length,
          barangays: db.barangays.length
        },
        match: matchAddressText(text, db)
      });
    }

    const type = query.type || "all";
    const q = query.q || "";
    const limit = Math.min(Number(query.limit || 25), 100);

    const result = {
      ok: true,
      source: db.source,
      loadedAt: db.loadedAt,
      counts: {
        provinces: db.provinces.length,
        citiesMunicipalities: db.citiesMunicipalities.length,
        barangays: db.barangays.length
      }
    };

    if (type === "province" || type === "provinces") result.provinces = searchList(db.provinces, q, limit);
    else if (type === "city" || type === "cities" || type === "municipality" || type === "citiesMunicipalities") result.citiesMunicipalities = searchList(db.citiesMunicipalities, q, limit);
    else if (type === "barangay" || type === "barangays") result.barangays = searchList(db.barangays, q, limit);
    else {
      result.provinces = searchList(db.provinces, q, limit);
      result.citiesMunicipalities = searchList(db.citiesMunicipalities, q, limit);
      result.barangays = searchList(db.barangays, q, limit);
    }

    return jsonResponse(200, result);
  } catch (err) {
    return jsonResponse(500, {
      ok:false,
      error: err.message || "Address database failed"
    });
  }
};
