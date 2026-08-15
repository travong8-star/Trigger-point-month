import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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

// ── Load GLB ──
const loader = new GLTFLoader();
const loadingEl = document.getElementById('loading');
const hintEl = document.getElementById('hint');

loader.load(
  '/models/TrP_Muscles_web.glb',
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
    console.log(`[Step 1] Loaded ${clickableMeshes.length} clickable meshes`);
    console.log('[Step 1] Tap any muscle to see its node name logged below.');

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
    console.error('[Step 1] GLB load failed:', err);
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

function onPointerDown(event) {
  if (!modelScene) return;

  const pos = getPointerPos(event);
  pointer.set(pos.x, pos.y);

  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(clickableMeshes, false);

  if (hits.length > 0) {
    const hit = hits[0];
    const nodeName = hit.object.name;
    const meshIndex = clickableMeshes.indexOf(hit.object);

    console.log('═══════════════════════════════════════');
    console.log('Raycast hit:', nodeName);
    console.log('Mesh index in scene:', meshIndex);
    console.log('Distance:', hit.distance.toFixed(3), 'm');
    console.log('Point:', hit.point.x.toFixed(3), hit.point.y.toFixed(3), hit.point.z.toFixed(3));
    console.log('═══════════════════════════════════════');

    // Step 1 stops here — resolver wiring comes in Step 2/3
  }
}

window.addEventListener('pointerdown', onPointerDown);

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
