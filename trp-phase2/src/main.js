import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import crosswalk from './data/muscle_crosswalk.json';
import anatomyRegistry from './data/anatomy/anatomy_registry.json';
import skeletonRegistry from './data/anatomy/skeleton_registry.json';

// ── OLD anatomy resolver: mesh node → muscle → trigger point ──
// GLTFLoader renames every node via PropertyBinding.sanitizeNodeName (strips
// "[]. :/" so it can double as an animation-track path), so "Foo_muscle.l"
// becomes "Foo_musclel" by the time it reaches the scene graph. The
// crosswalk was authored against the raw glTF names, so keys must be
// sanitized the same way to line up with mesh.name at runtime.
const nodeToMuscle = new Map();
crosswalk.muscles.forEach((muscle) => {
  muscle.nodes.forEach((nodeName) =>
    nodeToMuscle.set(THREE.PropertyBinding.sanitizeNodeName(nodeName), muscle)
  );
});

// trigger_points.json has exactly one authored copy in the repo (site
// root); public/trigger_points.json here is a symlink to it, not a second
// copy (see CLAUDE.md: "the only module allowed to touch trigger_points.json
// directly"). Fetched via BASE_URL rather than a hardcoded root path so
// this resolves correctly both standalone (npm run dev, base "/") and
// inside the combined build (base "/3d/") without special-casing either.
let idToPoint = new Map();
fetch(`${import.meta.env.BASE_URL}trigger_points.json`)
  .then((res) => res.json())
  .then((trpData) => {
    idToPoint = new Map(trpData.points.map((p) => [p.id, p]));
  })
  .catch((err) => console.error('Failed to load trigger_points.json:', err));

// ── Scene ──
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);

// ── Camera ──
const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.01,
  10
);
// Start anterior, slightly above waist, comfortable distance
camera.position.set(0, 1.15, 2.2);

// ── Renderer ──
const canvas = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

// ── Lights ──
const ambient = new THREE.AmbientLight(0xffffff, 0.55);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
keyLight.position.set(1.5, 2.5, 1.5);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xffffff, 0.35);
fillLight.position.set(-1.5, 1.5, 1.0);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0xffffff, 0.25);
rimLight.position.set(0, 2.0, -2.0);
scene.add(rimLight);

// ── Controls ──
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.05, 0);   // approximate center of torso
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 0.6;
controls.maxDistance = 3.5;
controls.maxPolarAngle = Math.PI * 0.85; // don't go below ground
controls.update();

// ── Ground reference (subtle) ──
const groundGeo = new THREE.PlaneGeometry(4, 4);
const groundMat = new THREE.MeshBasicMaterial({
  color: 0xf3f4f6,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.6
});
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = 0;
scene.add(ground);

// ── Raycaster state ──
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

// ── Detail panel ──
// Unchanged from before this integration: both OLD and NEW anatomy tag
// their meshes with the same userData.appMuscle shape ({muscle, cards}),
// so this panel code doesn't need to know which anatomy is active.
const panelEl = document.getElementById('detail-panel');
const panelContentEl = document.getElementById('panel-content');
const panelCloseEl = document.getElementById('panel-close');
const HIGHLIGHT_COLOR = new THREE.Color(0x0d9488);
let highlightedMesh = null;

function clearHighlight() {
  if (!highlightedMesh) return;
  highlightedMesh.material.emissive.copy(highlightedMesh.userData.baseEmissive);
  highlightedMesh = null;
}

function setHighlight(mesh) {
  clearHighlight();
  mesh.material.emissive.copy(HIGHLIGHT_COLOR);
  highlightedMesh = mesh;
}

function fieldHtml(label, value) {
  return `
    <div class="panel-field">
      <div class="panel-field-label">${label}</div>
      <div class="panel-field-value">${value}</div>
    </div>
  `;
}

function trpBlockHtml(point) {
  const caution = point.caution
    ? `<div class="panel-caution"><span>⚠️</span><span><strong>Caution</strong> — ${point.caution_note}</span></div>`
    : '';
  return `
    <div class="panel-trp-block">
      <div class="panel-trp-label">${point.trp} · ${point.region}</div>
      ${caution}
      ${fieldHtml('Location', point.location)}
      ${fieldHtml('Referral pattern', point.referral)}
      ${fieldHtml('Protocol', point.protocol)}
      ${fieldHtml('Stretch / reassess', point.stretch)}
    </div>
  `;
}

function openPanelForMuscle(muscle) {
  const points = (muscle.cards || [])
    .map((id) => idToPoint.get(id))
    .filter(Boolean);

  // Clickable meshes can exist ahead of their trigger-point data (e.g. a
  // newly-mapped muscle whose card hasn't been authored yet) — say so
  // rather than rendering a muscle name with nothing underneath it.
  const body = points.length
    ? points.map(trpBlockHtml).join('')
    : `<div class="panel-empty">Trigger point data for this muscle is coming soon.</div>`;

  panelContentEl.innerHTML = `
    <div class="panel-muscle">${muscle.muscle}</div>
    ${body}
  `;
  panelEl.classList.add('open');
  panelEl.setAttribute('aria-hidden', 'false');
}

function closePanel() {
  panelEl.classList.remove('open');
  panelEl.setAttribute('aria-hidden', 'true');
  clearHighlight();
}

panelCloseEl.addEventListener('click', closePanel);

// ── Anatomy layer state ──
// Two parallel, independently-loaded groups. Only one is visible/clickable
// at a time (anatomyMode), toggled by the dev switch below. NEW is the
// default per the review requirements; OLD stays fully intact and
// recoverable, not deleted or modified.
const loadingEl = document.getElementById('loading');
const hintEl = document.getElementById('hint');
const bgProgressEl = document.getElementById('bg-progress');

const oldGroup = new THREE.Group();
const newGroup = new THREE.Group();
const newSkeletonGroup = new THREE.Group();
scene.add(oldGroup, newGroup, newSkeletonGroup);
oldGroup.visible = false;
newGroup.visible = false; // becomes true once the first anatomy region loads
newSkeletonGroup.visible = false;

let oldClickable = [];
let newClickable = [];
let oldLoaded = false;

let anatomyMode = 'new';

function activeClickable() {
  return anatomyMode === 'old' ? oldClickable : newClickable;
}

function prepareMeshMaterial(mesh, tint) {
  mesh.geometry.computeVertexNormals();
  const orig = mesh.material;
  mesh.material = orig.isMeshStandardMaterial
    ? orig.clone()
    : new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.05 });
  mesh.material.color.set(tint);
  mesh.material.side = THREE.DoubleSide;
  mesh.userData.baseColor = mesh.material.color.clone();
  mesh.userData.baseEmissive = mesh.material.emissive
    ? mesh.material.emissive.clone()
    : new THREE.Color(0x000000);
}

// ── Shared loading infrastructure ──
// Every GLB load in this file -- OLD's single merged file, NEW's
// per-structure muscle files, NEW's per-bone skeleton files -- goes
// through these two primitives:
//
//  - glbSemaphore: one global concurrency limiter. Previously each bulk
//    load spun up its own independent N-worker pool, so overlapping loads
//    (toggling skeleton right after the initial muscle load, or switching
//    anatomy mode mid-load) could stack multiple pools at once with no
//    shared ceiling. That overlap is what produced the reproduced
//    "Failed to fetch" errors under heavy back-to-back loading. One
//    shared limiter makes total simultaneous in-flight fetches
//    structurally bounded no matter how many logical loaders are active.
//  - loadGlbCached: a path-keyed promise cache. Dedupes duplicate/racing
//    requests for the same asset, and is the single point a failed fetch
//    is recorded (loadFailures) and swallowed to `null` rather than
//    thrown, so one bad asset never aborts a whole batch.
const GLB_CONCURRENCY = 12;

class Semaphore {
  constructor(limit) {
    this.limit = limit;
    this.active = 0;
    this.queue = [];
  }
  acquire() {
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve)).then(() => {
      this.active++;
    });
  }
  release() {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
  async run(fn) {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
const glbSemaphore = new Semaphore(GLB_CONCURRENCY);

const assetCache = new Map();
const loadFailures = [];
// Exposed unconditionally (negligible cost -- a handful of arrays/Maps)
// so a failed optional asset is inspectable via the browser console or a
// Playwright test in any build, not just dev. Never read by the app
// itself.
window.__anatomyDebug = {
  loadFailures,
  isMuscleRegionsFullyLoaded: () => newMuscleLoader.isFullyLoaded(),
  isSkeletonRegionsFullyLoaded: () => newSkeletonLoader.isFullyLoaded(),
  clickableCount: () => newClickable.length,
};

function loadGlbCached(loader, path) {
  if (assetCache.has(path)) return assetCache.get(path);
  const promise = glbSemaphore
    .run(() => loader.loadAsync(`${import.meta.env.BASE_URL}${path}`))
    .catch((err) => {
      loadFailures.push({ path, error: String((err && err.message) || err), time: Date.now() });
      console.error(`[anatomy] failed to load ${path}:`, err);
      return null;
    });
  assetCache.set(path, promise);
  return promise;
}

// Throttles the render loop (see animate()) while any bulk region load is
// in flight -- kept from the original mitigation. It alone took the
// 242-file skeleton load from ~44s to ~11s by freeing the main thread
// from competing with rendering every frame; regional loading below is
// what removes the remaining stall and the fetch failures.
let bulkLoadDepth = 0;

function showBgProgress(text) {
  if (!bgProgressEl) return;
  bgProgressEl.textContent = text;
  bgProgressEl.classList.add('visible');
}
function hideBgProgress() {
  if (!bgProgressEl) return;
  bgProgressEl.classList.remove('visible');
}

// ── Regional loading taxonomy ──
// 7 loading regions (see bodyparts3d/scripts/assign_regions.py), used to
// break both the muscle set and the skeleton set into progressively
// loaded waves instead of one all-at-once burst. Order is loading
// priority: torso first (visually central, always in frame, largest
// coherent mass), then the rest.
const REGION_PRIORITY = [
  'torso', 'head-neck', 'hip-pelvis', 'shoulder-arm',
  'thigh', 'lower-leg-foot', 'forearm-hand',
];

// anatomyRegistry.muscles (the 51 app-carded entries) is always indexed.
// UNCARDED_EXTRA_REGIONS additionally pulls in available_extra_not_yet_carded
// entries for the listed regions -- real BodyParts3D muscles that are
// already converted but have no trigger_points.json card yet. They're
// still fully clickable: openPanelForMuscle's existing "Trigger point
// data for this muscle is coming soon" fallback (empty cards array)
// already handles them with no changes. Scoped to torso only for now --
// that's where the gap between true anatomical geometry (thin, precise,
// real gaps between individual muscles) and the small carded set was
// visually severe (compared side-by-side against OLD anatomy, which
// masks the same small card count with broader/stylized muscle shapes).
// Other regions' extras remain dormant in the registry until requested.
const UNCARDED_EXTRA_REGIONS = new Set(['torso']);

function indexMusclesByRegion() {
  const byRegion = new Map(REGION_PRIORITY.map((r) => [r, []]));
  anatomyRegistry.muscles.forEach((entry) => {
    entry.bodyparts3d_structures.forEach((structure) => {
      const list = byRegion.get(structure.load_region);
      if (!list) {
        console.warn('[NEW anatomy] structure has no known load_region, skipped:', structure.bodyparts3d_name);
        return;
      }
      Object.values(structure.sides).forEach((side) => {
        list.push({
          path: side.glb_asset,
          appMuscle: { muscle: entry.app_muscle_name, cards: entry.trigger_point_card_ids },
        });
      });
    });
  });

  anatomyRegistry.available_extra_not_yet_carded
    .filter((extra) => UNCARDED_EXTRA_REGIONS.has(extra.load_region))
    .forEach((extra) => {
      const list = byRegion.get(extra.load_region);
      if (!list) {
        console.warn('[NEW anatomy] uncarded extra has no known load_region, skipped:', extra.english_name);
        return;
      }
      list.push({
        path: extra.glb_asset,
        appMuscle: { muscle: extra.english_name, cards: [] },
      });
    });

  return byRegion;
}

function indexSkeletonByRegion() {
  const byRegion = new Map(REGION_PRIORITY.map((r) => [r, []]));
  skeletonRegistry.structures.forEach((s) => {
    const list = byRegion.get(s.load_region);
    if (!list) {
      console.warn('[NEW skeleton] bone has no known load_region, skipped:', s.english_name);
      return;
    }
    list.push({ path: s.glb_asset });
  });
  return byRegion;
}

const muscleRegionIndex = indexMusclesByRegion();
const skeletonRegionIndex = indexSkeletonByRegion();

// Builds a region-aware loader. loadRegion(name) returns a promise that
// resolves once that region's own files are done, but the FIRST call to
// loadRegion (for any region) submits every file from every region to
// loadGlbCached/glbSemaphore immediately, in REGION_PRIORITY order --
// dispatchAll() below, not a per-region loop.
//
// An earlier version processed regions strictly sequentially (fully
// drain region N via Promise.all before even submitting region N+1's
// files). That produced a real regression under measurement: small
// regions (e.g. 2-file hip-pelvis skeleton) only use 2 of the 12
// concurrency slots for their whole wave, leaving the rest idle instead
// of already pulling ahead on the next region -- total 242-file skeleton
// time went from ~11s (flat single pool) to ~14.4s (strict sequential
// regions). Submitting everything up front lets the shared semaphore's
// FIFO queue keep all 12 workers continuously busy across region
// boundaries while still resolving earlier regions first, since their
// files were queued first.
function makeRegionLoader(regionIndex, onAssetLoaded) {
  const state = new Map(REGION_PRIORITY.map((r) => [r, 'unloaded']));
  const regionTotals = new Map(REGION_PRIORITY.map((r) => [r, (regionIndex.get(r) || []).length]));
  const regionCompleted = new Map(REGION_PRIORITY.map((r) => [r, 0]));
  const regionProgressCb = new Map();
  const regionDeferreds = new Map(
    REGION_PRIORITY.map((r) => {
      let resolve;
      const promise = new Promise((res) => { resolve = res; });
      return [r, { promise, resolve }];
    })
  );

  let dispatched = false;
  function dispatchAll() {
    if (dispatched) return;
    dispatched = true;
    const totalItems = REGION_PRIORITY.reduce((sum, r) => sum + regionTotals.get(r), 0);
    if (totalItems === 0) return;
    const loader = new GLTFLoader();
    bulkLoadDepth++;
    let remaining = totalItems;
    REGION_PRIORITY.forEach((region) => {
      const items = regionIndex.get(region) || [];
      if (items.length === 0) {
        state.set(region, 'loaded');
        regionDeferreds.get(region).resolve();
        return;
      }
      state.set(region, 'loading');
      items.forEach((item) => {
        loadGlbCached(loader, item.path).then((gltf) => {
          if (gltf) onAssetLoaded(gltf, item); // failure already recorded in loadFailures otherwise
          const done = regionCompleted.get(region) + 1;
          regionCompleted.set(region, done);
          const cb = regionProgressCb.get(region);
          if (cb) cb(done, regionTotals.get(region));
          if (done >= regionTotals.get(region)) {
            state.set(region, 'loaded');
            regionDeferreds.get(region).resolve();
          }
          remaining--;
          if (remaining === 0) bulkLoadDepth--;
        });
      });
    });
  }

  function loadRegion(region, { onFileProgress } = {}) {
    if (onFileProgress) regionProgressCb.set(region, onFileProgress);
    dispatchAll();
    return regionDeferreds.get(region).promise;
  }

  function isFullyLoaded() {
    return REGION_PRIORITY.every((r) => state.get(r) === 'loaded');
  }

  return { loadRegion, isFullyLoaded };
}

// NEW anatomy: BodyParts3D, one GLB per structure, registry-driven. Each
// structure's identity is known at load time from anatomy_registry.json,
// so there's no name-sanitizing/crosswalk lookup step the way OLD's
// single-file model needs -- the loader just tags userData.appMuscle
// directly per file.
const newMuscleLoader = makeRegionLoader(muscleRegionIndex, (gltf, item) => {
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    prepareMeshMaterial(o, 0xa8615f);
    o.userData.appMuscle = item.appMuscle;
    newClickable.push(o);
  });
  newGroup.add(gltf.scene);
});

const newSkeletonLoader = makeRegionLoader(skeletonRegionIndex, (gltf) => {
  gltf.scene.traverse((o) => {
    if (o.isMesh) {
      o.material = new THREE.MeshStandardMaterial({ color: 0xd9d3c7, roughness: 0.7, metalness: 0.05 });
      o.material.side = THREE.DoubleSide;
    }
  });
  newSkeletonGroup.add(gltf.scene);
});

// The remaining regions' files are already in flight by the time this is
// called (dispatchAll() inside makeRegionLoader queued everything on the
// very first loadRegion() call) -- this just watches their promises to
// drive the non-blocking progress pill, it doesn't trigger any loading.
function watchRemainingRegionsForProgress(loader, regions, labelPrefix) {
  if (regions.length === 0) return;
  let done = 0;
  showBgProgress(`${labelPrefix}… 0/${regions.length}`);
  Promise.all(
    regions.map((region) =>
      loader.loadRegion(region).then(() => {
        done++;
        showBgProgress(`${labelPrefix}… ${done}/${regions.length}`);
      })
    )
  ).then(() => hideBgProgress());
}

// ── OLD anatomy: single merged GLB, node-name → crosswalk resolution ──
let oldAnatomyPromise = null;
function loadOldAnatomy() {
  if (oldAnatomyPromise) return oldAnatomyPromise;
  const loader = new GLTFLoader();
  oldAnatomyPromise = loadGlbCached(loader, 'models/TrP_Muscles_web.glb').then((gltf) => {
    if (!gltf) throw new Error('OLD anatomy failed to load');
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      prepareMeshMaterial(o, 0xa8615f);
      const muscle = nodeToMuscle.get(o.name);
      o.userData.appMuscle = muscle || null;
      if (muscle) oldClickable.push(o);
    });
    oldGroup.add(gltf.scene);
    oldLoaded = true;
    console.log(`[OLD anatomy] Loaded ${oldClickable.length} clickable meshes`);
  });
  return oldAnatomyPromise;
}

// ── Interaction: raycast on click ──
function getPointerPos(event) {
  const x = event.touches ? event.touches[0].clientX : event.clientX;
  const y = event.touches ? event.touches[0].clientY : event.clientY;
  return {
    x: (x / window.innerWidth) * 2 - 1,
    y: -(y / window.innerHeight) * 2 + 1
  };
}

function onCanvasClick(event) {
  const pos = getPointerPos(event);
  pointer.set(pos.x, pos.y);

  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(activeClickable(), false);

  if (hits.length === 0) {
    closePanel();
    return;
  }

  const mesh = hits[0].object;
  const muscle = mesh.userData.appMuscle;

  if (!muscle) {
    console.warn('No app muscle tagged for mesh:', mesh.name);
    closePanel();
    return;
  }

  setHighlight(mesh);
  openPanelForMuscle(muscle);
}

// Bound to the canvas (not window) so taps on the header, hint, or detail
// panel don't raycast into whatever 3D geometry sits behind them. A click
// (rather than pointerdown) so dragging to orbit the model never registers
// as a mesh selection.
canvas.addEventListener('click', onCanvasClick);

// ── Skeleton overlay (reference layer, not clickable) ──
// OLD mode keeps its existing Sketchfab skeleton unchanged. NEW mode gets
// its own BodyParts3D skeleton (skeleton_registry.json), loaded region by
// region on first toggle instead of all 242 files at once. Both are
// mutually exclusive -- only the active anatomy mode's skeleton is shown.
const SKELETON_SCALE = 1.61726744 / 1.7395376; // OLD skeleton only; NEW skeleton is already in the app's coordinate convention
const skeletonToggleEl = document.getElementById('skeleton-toggle');
let oldSkeletonScene = null;
let oldSkeletonPromise = null;
let skeletonVisible = false;
let skeletonToggleBusy = false;

function setXray(meshes, on) {
  meshes.forEach((mesh) => {
    mesh.material.transparent = on;
    mesh.material.opacity = on ? 0.35 : 1;
  });
}

function applySkeletonVisibility() {
  if (oldSkeletonScene) oldSkeletonScene.visible = anatomyMode === 'old' && skeletonVisible;
  newSkeletonGroup.visible = anatomyMode === 'new' && skeletonVisible;
  setXray(activeClickable(), skeletonVisible);
  skeletonToggleEl.classList.toggle('active', skeletonVisible);
}

function loadOldSkeleton() {
  if (oldSkeletonPromise) return oldSkeletonPromise;
  const skeletonLoader = new GLTFLoader();
  // The compressed skeleton GLB (gltf-transform --compress meshopt) needs
  // this decoder to read its geometry back out.
  skeletonLoader.setMeshoptDecoder(MeshoptDecoder);
  oldSkeletonPromise = loadGlbCached(skeletonLoader, 'models/male_skeleton.glb').then((gltf) => {
    if (!gltf) {
      console.error('[OLD skeleton] load failed');
      return;
    }
    oldSkeletonScene = gltf.scene;
    oldSkeletonScene.scale.setScalar(SKELETON_SCALE);
    oldGroup.add(oldSkeletonScene);
  });
  return oldSkeletonPromise;
}

// Loads the highest-priority skeleton region eagerly (so the toggle can
// flip from "Loading…" back to normal quickly), then fills in the rest
// of the regions in the background behind the shared bg-progress
// indicator. Idempotent -- safe to call on every toggle-on / mode switch.
async function ensureNewSkeletonReady() {
  const [firstRegion, ...restRegions] = REGION_PRIORITY;
  await newSkeletonLoader.loadRegion(firstRegion, {
    onFileProgress: (done, total) => {
      skeletonToggleEl.textContent = `Loading… ${done}/${total}`;
    },
  });
  watchRemainingRegionsForProgress(newSkeletonLoader, restRegions, 'Loading more skeleton');
}

skeletonToggleEl.addEventListener('click', async () => {
  if (skeletonToggleBusy) return;
  skeletonVisible = !skeletonVisible;
  if (skeletonVisible) {
    skeletonToggleBusy = true;
    skeletonToggleEl.textContent = 'Loading…';
    if (anatomyMode === 'old') await loadOldSkeleton();
    else await ensureNewSkeletonReady();
    skeletonToggleEl.textContent = 'Skeleton';
    skeletonToggleBusy = false;
  }
  applySkeletonVisibility();
});

// ── OLD vs NEW anatomy dev switch ──
// Development-only comparison toggle. Defaults to NEW; OLD remains fully
// loadable/recoverable, never deleted.
const anatomyToggleEl = document.getElementById('anatomy-toggle');
const attributionEl = document.getElementById('attribution');
const ATTRIBUTION_NEW = attributionEl ? attributionEl.innerHTML : '';
const ATTRIBUTION_OLD = `
    3D anatomical meshes derived from <strong>Z-Anatomy</strong>,
    <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>.
    Modified: muscle subset extracted, converted to glTF, decimated for web delivery.
  `;

async function setAnatomyMode(mode) {
  if (mode === anatomyMode) return;
  closePanel();

  if (mode === 'old' && !oldLoaded) {
    anatomyToggleEl.textContent = 'Loading OLD…';
    anatomyToggleEl.disabled = true;
    await loadOldAnatomy();
    anatomyToggleEl.disabled = false;
  }

  anatomyMode = mode;
  oldGroup.visible = mode === 'old';
  newGroup.visible = mode === 'new';
  anatomyToggleEl.textContent = mode === 'old' ? 'Anatomy: OLD (Z-Anatomy)' : 'Anatomy: NEW (BodyParts3D)';
  anatomyToggleEl.classList.toggle('old-mode', mode === 'old');
  if (attributionEl) attributionEl.innerHTML = mode === 'old' ? ATTRIBUTION_OLD : ATTRIBUTION_NEW;

  // If skeleton x-ray was already on, the newly-active anatomy needs its
  // own skeleton loaded too -- otherwise switching modes silently leaves
  // muscles transparent with nothing visible underneath them.
  if (skeletonVisible) {
    skeletonToggleBusy = true;
    skeletonToggleEl.textContent = 'Loading…';
    if (mode === 'old') await loadOldSkeleton();
    else await ensureNewSkeletonReady();
    skeletonToggleEl.textContent = 'Skeleton';
    skeletonToggleBusy = false;
  }

  // Re-apply skeleton/x-ray state for whichever anatomy is now active.
  applySkeletonVisibility();
}

anatomyToggleEl.addEventListener('click', () => {
  setAnatomyMode(anatomyMode === 'new' ? 'old' : 'new');
});

// ── Initial load: NEW anatomy by default, region-by-region ──
// The highest-priority region (torso) loads eagerly and blocks the
// full-screen loading indicator; the remaining 6 regions then load
// progressively in the background through the same shared semaphore/
// cache, so the viewer becomes interactive after ~1 region's worth of
// files instead of waiting for the entire muscle set.
if (loadingEl) loadingEl.style.display = 'block';
const [firstMuscleRegion, ...restMuscleRegions] = REGION_PRIORITY;

newMuscleLoader
  .loadRegion(firstMuscleRegion, {
    onFileProgress: (done, total) => {
      if (loadingEl) loadingEl.textContent = `Loading anatomy… ${done}/${total}`;
    },
  })
  .then(() => {
    newGroup.visible = true;
    if (loadingEl) loadingEl.style.display = 'none';
    if (hintEl) {
      hintEl.classList.add('visible');
      setTimeout(() => hintEl.classList.remove('visible'), 4000);
    }
    console.log(`[NEW anatomy] Base region "${firstMuscleRegion}" ready, ${newClickable.length} clickable meshes so far`);
    watchRemainingRegionsForProgress(newMuscleLoader, restMuscleRegions, 'Loading more anatomy');
  })
  .catch((err) => {
    console.error('[NEW anatomy] initial region load failed:', err);
    if (loadingEl) {
      loadingEl.innerHTML = 'Failed to load anatomy model.';
      loadingEl.style.color = '#dc2626';
    }
  });

// ── Resize ──
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Animation loop ──
let frameCount = 0;
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  frameCount++;
  // Throttle to ~10fps during bulk loads (see makeRegionLoader) instead
  // of skipping rendering outright, so the view stays live, just choppier,
  // while most of the main thread goes to finishing the load faster.
  if (bulkLoadDepth > 0 && frameCount % 6 !== 0) return;
  renderer.render(scene, camera);
}
animate();
