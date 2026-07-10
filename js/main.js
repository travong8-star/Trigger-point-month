// Wiring layer: connects data.js (data) + state.js (logic) + render.js (skin).

import { Data } from "./data.js";
import * as State from "./state.js";
import { renderHome, renderRegionList, renderPointDetail, renderDisclaimer } from "./render.js";

const appEl = document.getElementById("app");
const disclaimerEl = document.getElementById("disclaimer");
const homeBtn = document.getElementById("home-btn");

homeBtn.addEventListener("click", () => State.goHome());

function draw() {
  const s = State.getState();

  if (s.view === "home") {
    renderHome(appEl, {
      regionNames: Data.getRegionNames(),
      isRegionLocked: State.isRegionLocked,
      getRegionCount: (name) => Data.getPointsByRegion(name).length,
      onSelectRegion: State.selectRegion,
    });
    return;
  }

  if (s.view === "region") {
    renderRegionList(appEl, {
      regionName: s.region,
      points: Data.getPointsByRegion(s.region),
      isPointLocked: State.isPointLocked,
      onSelectPoint: State.selectPoint,
      onBack: State.goHome,
    });
    return;
  }

  if (s.view === "point") {
    const point = Data.getPointById(s.pointId);
    renderPointDetail(appEl, {
      point,
      locked: State.isPointLocked(point),
      onBack: State.goBackToRegion,
    });
    return;
  }
}

async function init() {
  await Data.load();
  renderDisclaimer(disclaimerEl, Data.getMeta().disclaimer);
  State.subscribe(draw);
  draw();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {
      // Offline caching is a nice-to-have; don't block the app on it.
    });
  }
}

init();
