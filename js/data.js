// Data layer. The only module allowed to touch trigger_points.json directly.
// Loads once, caches in memory, exposes read-only accessors.

const DATA_URL = "trigger_points.json";

let dataset = null;
let loadPromise = null;

async function load() {
  if (dataset) return dataset;
  if (!loadPromise) {
    loadPromise = fetch(DATA_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load ${DATA_URL}: ${res.status}`);
        return res.json();
      })
      .then((json) => {
        dataset = json;
        return dataset;
      });
  }
  return loadPromise;
}

function requireData() {
  if (!dataset) throw new Error("Data not loaded yet — call load() first.");
  return dataset;
}

function getMeta() {
  return requireData().meta;
}

function getRegionNames() {
  return Object.keys(requireData().regions);
}

function getPointsByRegion(regionName) {
  const data = requireData();
  const ids = data.regions[regionName] || [];
  const idSet = new Set(ids);
  return data.points.filter((p) => idSet.has(p.id));
}

function getPointById(id) {
  return requireData().points.find((p) => p.id === Number(id)) || null;
}

function getReferralIndex() {
  return requireData().referral_index;
}

function getAllPoints() {
  return requireData().points;
}

export const Data = {
  load,
  getMeta,
  getRegionNames,
  getPointsByRegion,
  getPointById,
  getReferralIndex,
  getAllPoints,
};
