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

const oldGroup = new THREE.Group();
const newGroup = new THREE.Group();
scene.add(oldGroup, newGroup);
oldGroup.visible = false;
newGroup.visible = false; // becomes true once the initial load completes

let oldClickable = [];
let newClickable = [];
let oldLoaded = false;
let newLoaded = false;
let oldLoading = false;

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

// ── OLD anatomy: single merged GLB, node-name → crosswalk resolution ──
function loadOldAnatomy() {
  if (oldLoaded || oldLoading) return Promise.resolve();
  oldLoading = true;
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    loader.load(
      `${import.meta.env.BASE_URL}models/TrP_Muscles_web.glb`,
      (gltf) => {
        gltf.scene.traverse((o) => {
          if (!o.isMesh) return;
          prepareMeshMaterial(o, 0xa8615f);
          const muscle = nodeToMuscle.get(o.name);
          o.userData.appMuscle = muscle || null;
          if (muscle) oldClickable.push(o);
        });
        oldGroup.add(gltf.scene);
        oldLoaded = true;
        oldLoading = false;
        console.log(`[OLD anatomy] Loaded ${oldClickable.length} clickable meshes`);
        resolve();
      },
      undefined,
      (err) => {
        oldLoading = false;
        console.error('[OLD anatomy] GLB load failed:', err);
        reject(err);
      }
    );
  });
}

// ── NEW anatomy: BodyParts3D, one GLB per structure, registry-driven ──
// Each structure's identity is known at load time from anatomy_registry.json
// (built from the validated BodyParts3D asset manifest), so there's no
// name-sanitizing/crosswalk lookup step the way the OLD single-file model
// needs -- the loader just tags userData.appMuscle directly per file.
//
// Measured while testing: loading N more files while several hundred
// meshes are already in the scene took 10-40x longer than the initial
// cold load of the same N files (44s to add 242 skeleton files after 500
// muscles were already rendering, vs 1.7s to load those 500 from empty).
// The render loop competes with fetch/parse callbacks for the main thread
// every frame once draw-call count is high. bulkLoadDepth throttles
// rendering to ~10fps for the duration of a bulk load (see animate())
// instead of the full 60fps, freeing most of the main thread for loading
// without freezing the picture. This is a stopgap, not the real fix --
// true regional lazy-loading / geometry batching is deferred per the
// stated priority (working integration first).
let bulkLoadDepth = 0;

async function loadWithConcurrency(tasks, limit) {
  bulkLoadDepth++;
  let i = 0;
  let completed = 0;
  const total = tasks.length;
  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      try {
        await tasks[idx]();
      } catch (err) {
        console.error('[NEW anatomy] a load task failed:', err);
      }
      completed++;
      if (loadingEl && anatomyMode === 'new' && !newLoaded) {
        loadingEl.textContent = `Loading anatomy… ${completed}/${total}`;
      }
    }
  }
  try {
    await Promise.all(Array.from({ length: limit }, worker));
  } finally {
    bulkLoadDepth--;
  }
}

function loadNewAnatomy() {
  if (newLoaded) return Promise.resolve();
  const glbLoader = new GLTFLoader();
  const tasks = [];

  anatomyRegistry.muscles.forEach((entry) => {
    entry.bodyparts3d_structures.forEach((structure) => {
      Object.values(structure.sides).forEach((side) => {
        tasks.push(() =>
          glbLoader.loadAsync(`${import.meta.env.BASE_URL}${side.glb_asset}`).then((gltf) => {
            gltf.scene.traverse((o) => {
              if (!o.isMesh) return;
              prepareMeshMaterial(o, 0xa8615f);
              o.userData.appMuscle = { muscle: entry.app_muscle_name, cards: entry.trigger_point_card_ids };
              newClickable.push(o);
            });
            newGroup.add(gltf.scene);
          })
        );
      });
    });
  });

  return loadWithConcurrency(tasks, 12).then(() => {
    newLoaded = true;
    console.log(`[NEW anatomy] Loaded ${newClickable.length} clickable meshes from ${tasks.length} files`);
  });
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
// its own BodyParts3D skeleton (242 files, skeleton_registry.json) instead
// of reusing the unrelated Sketchfab one. Both are lazy-loaded on first
// toggle and mutually exclusive -- only the active anatomy mode's skeleton
// is ever shown.
const SKELETON_SCALE = 1.61726744 / 1.7395376; // OLD skeleton only; NEW skeleton is already in the app's coordinate convention
const skeletonToggleEl = document.getElementById('skeleton-toggle');
let oldSkeletonScene = null;
let oldSkeletonLoading = false;
const newSkeletonGroup = new THREE.Group();
scene.add(newSkeletonGroup);
newSkeletonGroup.visible = false;
let newSkeletonLoaded = false;
let newSkeletonLoading = false;
let skeletonVisible = false;

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
  if (oldSkeletonScene || oldSkeletonLoading) return Promise.resolve();
  oldSkeletonLoading = true;
  const skeletonLoader = new GLTFLoader();
  // The compressed skeleton GLB (gltf-transform --compress meshopt) needs
  // this decoder to read its geometry back out.
  skeletonLoader.setMeshoptDecoder(MeshoptDecoder);
  return skeletonLoader.loadAsync(`${import.meta.env.BASE_URL}models/male_skeleton.glb`).then((gltf) => {
    oldSkeletonScene = gltf.scene;
    oldSkeletonScene.scale.setScalar(SKELETON_SCALE);
    oldGroup.add(oldSkeletonScene);
    oldSkeletonLoading = false;
  }).catch((err) => {
    oldSkeletonLoading = false;
    console.error('[OLD skeleton] load failed:', err);
  });
}

function loadNewSkeleton() {
  if (newSkeletonLoaded || newSkeletonLoading) return Promise.resolve();
  newSkeletonLoading = true;
  const skeletonLoader = new GLTFLoader();
  const tasks = skeletonRegistry.structures.map((s) => () =>
    skeletonLoader.loadAsync(`${import.meta.env.BASE_URL}${s.glb_asset}`).then((gltf) => {
      gltf.scene.traverse((o) => {
        if (o.isMesh) {
          o.material = new THREE.MeshStandardMaterial({ color: 0xd9d3c7, roughness: 0.7, metalness: 0.05 });
          o.material.side = THREE.DoubleSide;
        }
      });
      newSkeletonGroup.add(gltf.scene);
    })
  );
  return loadWithConcurrency(tasks, 12).then(() => {
    newSkeletonLoaded = true;
    newSkeletonLoading = false;
  });
}

skeletonToggleEl.addEventListener('click', async () => {
  if (oldSkeletonLoading || newSkeletonLoading) return;
  skeletonVisible = !skeletonVisible;
  if (skeletonVisible) {
    skeletonToggleEl.textContent = 'Loading…';
    if (anatomyMode === 'old') await loadOldSkeleton();
    else await loadNewSkeleton();
    skeletonToggleEl.textContent = 'Skeleton';
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
    skeletonToggleEl.textContent = 'Loading…';
    if (mode === 'old') await loadOldSkeleton();
    else await loadNewSkeleton();
    skeletonToggleEl.textContent = 'Skeleton';
  }

  // Re-apply skeleton/x-ray state for whichever anatomy is now active.
  applySkeletonVisibility();
}

anatomyToggleEl.addEventListener('click', () => {
  setAnatomyMode(anatomyMode === 'new' ? 'old' : 'new');
});

// ── Initial load: NEW anatomy by default ──
if (loadingEl) loadingEl.style.display = 'block';
loadNewAnatomy()
  .then(() => {
    newGroup.visible = true;
    if (loadingEl) loadingEl.style.display = 'none';
    if (hintEl) {
      hintEl.classList.add('visible');
      setTimeout(() => hintEl.classList.remove('visible'), 4000);
    }
  })
  .catch((err) => {
    console.error('[NEW anatomy] initial load failed:', err);
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
  // Throttle to ~10fps during bulk loads (see loadWithConcurrency) instead
  // of skipping rendering outright, so the view stays live, just choppier,
  // while most of the main thread goes to finishing the load faster.
  if (bulkLoadDepth > 0 && frameCount % 6 !== 0) return;
  renderer.render(scene, camera);
}
animate();
