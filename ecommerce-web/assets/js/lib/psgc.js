// assets/js/lib/psgc.js
// Thin client for the public PSGC Cloud API (Philippine Standard Geographic
// Code — regions, provinces, cities/municipalities, barangays). No API key
// required. Docs: https://psgc.cloud/api-docs/v2
//
// NOTE (Aug 2026): PSGC Cloud's own docs describe a `/api/v1/...` hierarchy
// that is documented but 404s on the live server — it isn't actually
// deployed. `/api/v2` is the real, working versioned API; every list
// response is wrapped as `{ "data": [...] }`.
//
// NOTE on NCR (and similar regions): the PSGC has no province tier for
// Metro Manila — Manila, Quezon City, Makati, etc. sit directly under the
// region. So getProvinces() legitimately returns an EMPTY array for NCR's
// region code. Callers should treat "no provinces for this region" as
// normal, not an error, and go straight from region to city/municipality
// (pass provinceName = null/undefined to getCitiesMunicipalities()).
//
// Implementation note: rather than depend on the documented nested
// `/regions/{region}/provinces` and `/provinces/{province}/cities-
// municipalities` endpoints (which I could not independently verify live),
// this fetches the full `/provinces` and `/cities-municipalities` lists —
// both confirmed working — once each, caches them, and filters client-side
// by the `region` / `province` name fields already present on every row.
// Barangays are the one exception: the full barangay list 500s (42k+ rows
// is too much for the API to return at once), so getBarangays() always
// scopes to a single city/municipality via the nested endpoint.

const BASE = "https://psgc.cloud/api/v2";

const cache = new Map();

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`PSGC request failed (${res.status})`);
  const json = await res.json();
  // v2 wraps list endpoints as { data: [...] }; fall back to a bare array
  // just in case a future version drops the wrapper.
  return Array.isArray(json) ? json : json.data || [];
}

async function listCached(url) {
  if (cache.has(url)) return cache.get(url);

  const promise = getJson(url);
  cache.set(url, promise);
  try {
    return await promise;
  } catch (err) {
    cache.delete(url); // don't cache failures — allow retry
    throw err;
  }
}

/**
 * All regions, sorted in PSA administrative order (by PSGC region code),
 * not alphabetically. Region names are Roman numerals ("Region IX", "Region
 * V"), which sort wrong as plain text (localeCompare puts "IX" before "V"
 * since it compares "I" vs "V" letter-by-letter). The code field is a
 * fixed-width zero-padded numeric string, so a plain string comparison on
 * it gives the correct numeric/administrative order.
 */
export async function getRegions() {
  const items = await listCached(`${BASE}/regions`);
  return [...items].sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Provinces under a given region, sorted alphabetically.
 * Returns an empty array for regions with no province tier (e.g. NCR) —
 * that's expected, not an error.
 */
export async function getProvinces(regionName) {
  if (!regionName) return [];
  const all = await listCached(`${BASE}/provinces`);
  return all
    .filter((p) => p.region === regionName)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Cities & municipalities, sorted alphabetically.
 * Pass provinceName when the region has provinces; pass it as null/undefined
 * for regions without one (NCR) to get every city directly under the region.
 *
 * NCR quirk: NCR has no *province* tier, but its cities are still grouped
 * under four legacy "districts" (e.g. "NCR, Third District") per PD 921,
 * and that value lands in each row's `province` field even though
 * getProvinces() correctly returns no real provinces for NCR. So when the
 * caller has no provinceName (province-less region), filter on region alone
 * — do NOT also require an empty `province` field, or every NCR city gets
 * filtered out.
 */
export async function getCitiesMunicipalities(regionName, provinceName) {
  if (!regionName) return [];
  const all = await listCached(`${BASE}/cities-municipalities`);
  const filtered = provinceName
    ? all.filter((c) => c.province === provinceName)
    : all.filter((c) => c.region === regionName);
  return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
}

/** Barangays under a given city/municipality code, sorted alphabetically. */
export async function getBarangays(cityMunicipalityCode) {
  if (!cityMunicipalityCode) return [];
  const items = await listCached(`${BASE}/cities-municipalities/${cityMunicipalityCode}/barangays`);
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}