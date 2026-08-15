import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import crosswalk from './data/muscle_crosswalk.json';

// ── Mesh node → muscle → trigger point resolver ──
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

// trigger_points.json is the single canonical copy served from the site
// root (see CLAUDE.md: "the only module allowed to touch trigger_points.json
// directly" — here that's this fetch, not a bundled/duplicated copy).
let idToPoint = new Map();
fetch('/trigger_points.json')
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
let modelScene = null;
const clickableMeshes = [];

// ── Detail panel ──
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

  panelContentEl.innerHTML = `
    <div class="panel-muscle">${muscle.muscle}</div>
    ${points.map(trpBlockHtml).join('')}
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

// ── Load GLB ──
const loader = new GLTFLoader();
const loadingEl = document.getElementById('loading');
const hintEl = document.getElementById('hint');

loader.load(
  `${import.meta.env.BASE_URL}models/TrP_Muscles_web.glb`,
  (gltf) => {
    modelScene = gltf.scene;

    modelScene.traverse((o) => {
      if (o.isMesh) {
        // Mandatory: compute normals (stripped from GLB to save payload)
        o.geometry.computeVertexNormals();

        // Clone material so we can highlight individually later
        const orig = o.material;
        o.material = orig.clone();
        o.material.side = THREE.DoubleSide;

        // Store original color for restore
        o.userData.baseColor = o.material.color.clone();
        o.userData.baseEmissive = o.material.emissive
          ? o.material.emissive.clone()
          : new THREE.Color(0x000000);

        clickableMeshes.push(o);
      }
    });

    scene.add(modelScene);

    if (loadingEl) loadingEl.style.display = 'none';
    console.log(`Loaded ${clickableMeshes.length} clickable meshes`);

    // Show hint briefly
    if (hintEl) {
      hintEl.classList.add('visible');
      setTimeout(() => hintEl.classList.remove('visible'), 4000);
    }
  },
  (progress) => {
    if (progress.total > 0 && loadingEl) {
      const pct = Math.round((progress.loaded / progress.total) * 100);
      loadingEl.textContent = `Loading model… ${pct}%`;
    }
  },
  (err) => {
    console.error('GLB load failed:', err);
    if (loadingEl) {
      loadingEl.innerHTML = 'Failed to load 3D model.<br>Place <code>TrP_Muscles_web.glb</code> in <code>public/models/</code> and refresh.';
      loadingEl.style.color = '#dc2626';
    }
  }
);

// ── Interaction: raycast on pointer down ──
function getPointerPos(event) {
  const x = event.touches ? event.touches[0].clientX : event.clientX;
  const y = event.touches ? event.touches[0].clientY : event.clientY;
  return {
    x: (x / window.innerWidth) * 2 - 1,
    y: -(y / window.innerHeight) * 2 + 1
  };
}

function onCanvasClick(event) {
  if (!modelScene) return;

  const pos = getPointerPos(event);
  pointer.set(pos.x, pos.y);

  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(clickableMeshes, false);

  if (hits.length === 0) {
    closePanel();
    return;
  }

  const mesh = hits[0].object;
  const muscle = nodeToMuscle.get(mesh.name);

  if (!muscle) {
    console.warn('No muscle_crosswalk entry for node:', mesh.name);
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

// ── Resize ──
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Animation loop ──
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

