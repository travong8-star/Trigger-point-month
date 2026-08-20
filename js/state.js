// Interaction/logic layer. Framework-agnostic — knows nothing about the DOM.
// Owns navigation state and the free/paid gating rule.

// Gating config: which regions are unlocked in the free tier.
// Change this list (or swap for a server-driven flag later) to move the
// free/paid line without touching any rendering or data code.
export const FREE_REGIONS = ["Head & Neck"];

// Dev/preview override: ?preview=all unlocks everything for this page load
// only (no persistence, so it can't be mistaken for a real entitlement).
// Useful for reviewing paid content locally without touching FREE_REGIONS.
const DEV_UNLOCK =
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).get("preview") === "all";

export function isRegionLocked(regionName) {
  if (DEV_UNLOCK) return false;
  return !FREE_REGIONS.includes(regionName);
}

export function isPointLocked(point) {
  return isRegionLocked(point.region);
}

// View states: "home" -> "region" -> "point"
const listeners = new Set();

let state = {
  view: "home",
  region: null,
  pointId: null,
};

function setState(patch) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn(state));
}

export function getState() {
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function selectRegion(regionName) {
  setState({ view: "region", region: regionName, pointId: null });
}

export function selectPoint(pointId) {
  setState({ view: "point", pointId: Number(pointId) });
}

export function goHome() {
  setState({ view: "home", region: null, pointId: null });
}

export function goBackToRegion() {
  setState({ view: "region", pointId: null });
}
