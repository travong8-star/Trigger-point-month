// Visual skin layer. Pure DOM rendering from data it's handed — no fetching,
// no state ownership. This is the layer that gets swapped out later when the
// region blocks become a polished anatomical illustration.

const STAN_STORE_URL = "https://stan.store/VitalEssence_Mt";

function el(html) {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

export function renderDisclaimer(container, disclaimerText) {
  container.textContent = disclaimerText;
}

export function renderHome(container, { regionNames, isRegionLocked, getRegionCount, onSelectRegion }) {
  container.innerHTML = "";

  const title = el(`<h1 class="screen-title">Select a region</h1>`);
  const subtitle = el(`<p class="screen-subtitle">Tap a body region to see its trigger points.</p>`);
  const grid = el(`<div class="region-grid"></div>`);

  regionNames.forEach((name) => {
    const locked = isRegionLocked(name);
    const count = getRegionCount(name);
    const block = el(`
      <button class="region-block ${locked ? "locked" : ""}" type="button">
        <span class="region-name">${name}</span>
        <span class="region-count">${count} point${count === 1 ? "" : "s"}${locked ? " · Premium" : ""}</span>
      </button>
    `);
    block.addEventListener("click", () => onSelectRegion(name));
    grid.appendChild(block);
  });

  container.append(title, subtitle, grid);
}

export function renderRegionList(container, { regionName, points, isPointLocked, onSelectPoint, onBack }) {
  container.innerHTML = "";

  const backRow = el(`<div class="back-row"><button class="back-btn" type="button">&larr; All regions</button></div>`);
  backRow.querySelector(".back-btn").addEventListener("click", onBack);

  const title = el(`<h1 class="screen-title">${regionName}</h1>`);
  const subtitle = el(`<p class="screen-subtitle">${points.length} trigger point${points.length === 1 ? "" : "s"} in this region.</p>`);
  const list = el(`<div class="point-list"></div>`);

  points.forEach((point) => {
    const locked = isPointLocked(point);
    const flags = [];
    if (point.caution) flags.push(`<span class="badge caution">Caution</span>`);
    if (locked) flags.push(`<span class="badge locked">Premium</span>`);

    const row = el(`
      <button class="point-row" type="button">
        <span class="point-main">
          <span class="point-muscle">${point.muscle}</span>
          <span class="point-trp">${point.trp}</span>
        </span>
        <span class="point-flags">${flags.join("")}</span>
      </button>
    `);
    row.addEventListener("click", () => onSelectPoint(point.id));
    list.appendChild(row);
  });

  container.append(backRow, title, subtitle, list);
}

function field(label, value) {
  return el(`
    <div class="field">
      <div class="field-label">${label}</div>
      <div class="field-value">${value}</div>
    </div>
  `);
}

export function renderPointDetail(container, { point, locked, onBack }) {
  container.innerHTML = "";

  const backRow = el(`<div class="back-row"><button class="back-btn" type="button">&larr; ${point.region}</button></div>`);
  backRow.querySelector(".back-btn").addEventListener("click", onBack);

  if (locked) {
    const card = el(`
      <div class="paywall-card">
        <div class="paywall-title">${point.muscle} — ${point.trp}</div>
        <div class="paywall-copy">This point's location, referral pattern, protocol, and stretch are part of the full 100-point tool.</div>
        <a class="paywall-cta" href="${STAN_STORE_URL}" target="_blank" rel="noopener noreferrer">Unlock full map</a>
      </div>
    `);
    container.append(backRow, card);
    return;
  }

  const card = el(`<div class="detail-card"></div>`);
  const cardTag = el(`<div class="card-tag">Card ${point.card}</div>`);
  const h1 = el(`<h1>${point.muscle}</h1>`);
  const trpLabel = el(`<div class="trp-label">${point.trp} · ${point.region}</div>`);

  card.append(cardTag, h1, trpLabel);

  if (point.caution) {
    card.appendChild(el(`
      <div class="caution-box">
        <span class="caution-icon">⚠️</span>
        <span class="caution-text">
          <span class="caution-label">Caution</span>
          ${point.caution_note}
        </span>
      </div>
    `));
  }

  card.append(
    field("Location", point.location),
    field("Referral pattern", point.referral),
    field("Protocol", point.protocol),
    field("Stretch / reassess", point.stretch)
  );

  container.append(backRow, card);
}
