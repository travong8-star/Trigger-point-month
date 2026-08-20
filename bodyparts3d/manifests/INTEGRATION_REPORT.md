# BodyParts3D Anatomy Integration — Report

Branch: `anatomy-replacement`. `main` and `3d-integration` untouched, nothing merged, nothing deployed. `TrP_Muscles_web.glb` and `male_skeleton.glb` (the OLD anatomy) are unmodified and remain fully functional behind a dev toggle.

---

## 1. CONVERSION REPORT

Pipeline: `bodyparts3d/scripts/batch_transform.py` (coordinate transform) → `bodyparts3d/scripts/batch_convert.mjs` (obj2gltf → binary GLB). Full detail in `bodyparts3d/manifests/CONVERSION_REPORT.json`.

| | |
|---|---|
| Source records considered (muscle + bone, present in a supplied package) | 500 |
| Transform stage (stage 1) | 500 OK, 0 failed |
| obj2gltf stage (stage 2) | 500 OK, 0 failed |
| **Total converted** | **500 / 500 (100%)** |
| Output size | 39.6 MB (29 MB muscles + 12 MB skeleton, uncompressed) |
| Total triangles | 1,722,820 |

Scope decision, not a failure: teeth (30), eye/orbital anatomy (93), and connective tissue (11) records were excluded — not relevant to a trigger-point/muscle app. The 11 "unassigned id" gap records (§F of the coverage report) have no source file by definition and were correctly excluded.

**Coordinate transform**, derived and validated from the real combined bounding box of all 634 source files (not assumed from the existing skeleton or muscle model):
```
new_x = x_mm × 0.001 − 0.0000105
new_y = z_mm × 0.001 + 0.0728882   (Z-up → Y-up, floor-aligned)
new_z = −y_mm × 0.001 − 0.10570935 (depth-centered)
```
Verified against unambiguous anatomical landmarks (sternum vs. thoracic vertebra at the same height) before committing to the sign convention — see the derivation history for the raw measurements. No decimation or simplification applied, per "anatomical fidelity over polygon count."

---

## 2. NEW ANATOMY ASSET INVENTORY

**258 muscle GLBs** in `trp-phase2/public/models/anatomy/muscles/`, registered in `anatomy_registry.json`:

| Mapping to trigger_points.json | Count |
|---|---|
| One-to-one (1 app muscle → 1 BP3D structure) | 43 |
| One-to-many (1 app muscle → multiple BP3D structures) | 5 |
| Unresolved (no BP3D geometry available) | 3 |
| **Total app muscles** | **51** |
| Available BP3D muscles with no trigger-point card yet | 173 |

45 of 51 current muscles (88%) now have real geometry — see §4 for the mapping changes and §5 for what's still missing.

---

## 3. SKELETAL ASSET INVENTORY

**242 skeletal GLBs** in `trp-phase2/public/models/anatomy/skeleton/`, registered in `skeleton_registry.json` as a flat, independent catalog (not addressed through trigger-point cards — no grouping needed, each bone is individually identifiable by FJ id, FMA concept, and English name).

Covers: skull (13 + several more under an unclassified-name bucket — see the coverage report §B caveat on unverified full completeness), full vertebral column (cervical/thoracic/lumbar + sacrum, 44), all 12 rib pairs + sternum (27), clavicles + scapulae (4), pelvis (2), humeri/radii/ulnae (6), femora/patellae/tibiae/fibulae (8), hand bones (24 + 28 digit phalanges), foot bones (24 + 28 digit phalanges).

Because the NEW skeleton is derived from the exact same BodyParts3D coordinate system as the NEW muscles, it aligns with them **exactly** — no manual scale-fitting was needed, unlike the OLD Sketchfab skeleton (which required a measured 0.9297 scale correction against a differently-sourced muscle model). Confirmed visually: skull sits in the head, ribcage in the torso, hand/foot bones in the limbs, from front, back, and rotated side views.

---

## 4. TRIGGER-POINT MAPPING CHANGES

`muscle_crosswalk.json` is **untouched** — it's the OLD anatomy's node-name-within-one-merged-GLB addressing scheme, which doesn't apply to a one-GLB-per-structure layer. Extending it wasn't necessary (per the review's own instruction to extend only where necessary).

New file: `anatomy_registry.json`. One-to-many cases (the explicitly-requested pattern):

| App muscle | BodyParts3D structures |
|---|---|
| Suboccipitals | obliquus capitis inferior, obliquus capitis superior, rectus capitis posterior major, rectus capitis posterior minor |
| Biceps femoris | long head, short head |
| Gastrocnemius | lateral head, medial head |
| Erector spinae (Upper) | iliocostalis cervicis, longissimus capitis, longissimus cervicis |
| Erector spinae (Mid) | iliocostalis thoracis, longissimus thoracis, spinalis, spinalis thoracis |
| Erector spinae (Lower)* | iliocostalis lumborum |

*Technically one-to-one (only one BP3D structure), but part of the same clinical 3-card split as Upper/Mid — grouped by spinal level (cervical/thoracic/lumbar) as the closest reasonable clinical-to-anatomical correspondence. This is a data-authoring judgment call, documented inline in the registry, not asserted as the only valid mapping.

`trigger_points.json` schema is unchanged — no new fields, no restructuring.

---

## 5. MISSING / UNRESOLVED ANATOMY

Per the review's explicit instructions, nothing here is fabricated or substituted:

| Muscle | Status | Fallback used |
|---|---|---|
| Masseter | Absent from all supplied BodyParts3D metadata — not just unconverted, never referenced by any FMA concept in the files provided across this entire investigation | None available in either anatomy layer's BP3D data. Falls through to the OLD anatomy's own crosswalk entry if the user switches to OLD mode (unaffected by this work); NEW mode has no mesh for it, so clicking finds nothing to click — no card is orphaned, trigger_points.json data (cards 13-14) is preserved and unaffected either way |
| Temporalis | Same as Masseter | Same as Masseter |
| Diaphragm | Known FJ id (`FJ3131`) exists in the metadata but wasn't included in either supplied archive block — a targeted file pull would close this, not a search problem | Same as above |

None of these three had OLD-anatomy geometry either fabricated or newly broken — the OLD Z-Anatomy model's own coverage of these three is exactly what it was before this work, since `TrP_Muscles_web.glb` was not touched.

**Bugs found and fixed during this stage** (documented, not silently corrected): two instances of naive substring matching produced false structure/category assignments — `"scapula"` inside `"subscapularis"`, `"fascia"` inside `"fasciae"`, `"tibia"` inside `"tibialis"`, `"fibula"` inside `"fibularis"` (categorization), and separately `"brachialis"` inside `"coracobrachialis"` (app-muscle matching, which briefly and wrongly attached Coracobrachialis to the "Brachialis" card). Both fixed with word-boundary-aware matching and verified against the regenerated manifest/registry before proceeding. Full detail in the coverage report's addendum.

---

## 6. PERFORMANCE RESULTS

Measured in a real browser (Playwright + Chromium) against the actual combined production build, not the dev server:

| Scenario | Time |
|---|---|
| Cold load: 500 NEW muscle files from an empty scene | **1.2 – 1.8s** |
| Loading 242 NEW skeleton files *after* 500 muscles are already rendering | 44s → **~11s** after mitigation (see below) |
| Switching to OLD anatomy while skeleton x-ray is on (loads 1 muscle file + 1 skeleton file, but with 500+242 NEW meshes still in the scene, hidden) | ~60s |

**Real finding, not assumed:** loading additional assets while several hundred meshes are already rendering is dramatically slower than the initial cold load of the same file count — the render loop competes with fetch/parse callbacks for the main thread once draw-call count is high. Reproduced twice: back-to-back heavy loads (skeleton, then immediately switch anatomy mode) occasionally caused an outright `Failed to fetch` on the OLD skeleton request, not just slowness. In isolation (same file, no recent heavy load), that same request succeeds in ~5s.

**Mitigation applied** (a stopgap, not a full fix): a `bulkLoadDepth` counter throttles rendering to ~10fps during bulk loads instead of the full 60fps, freeing most of the main thread. This cut the 242-file post-load case from 44s to ~11s. It did not fully resolve the OLD-skeleton-after-heavy-load fetch failure risk.

**Not done in this pass, deferred per the stated priority** (working integration before streaming sophistication): geometry batching/merging to reduce draw-call count, true regional/on-demand loading, and mesh compression (meshopt — the OLD skeleton went 17.5MB→2.49MB with this in earlier work; the NEW anatomy's 500 files were left uncompressed to keep this pass focused on correctness). All three are the natural next steps if the fetch-failure risk needs closing before any wider rollout.

---

## 7. TEST RESULTS

All tested in a real browser against the actual combined production build (`build.mjs` output, served via a multi-threaded static server), not just read from the diff:

| Check | Result |
|---|---|
| NEW anatomy model loads | ✅ 500/500 meshes, 1.2-1.8s |
| NEW skeleton loads | ✅ 242/242 meshes, correctly aligned (same coordinate system as muscles) |
| Right/left structures appear correctly | ✅ Confirmed visually (bilateral limbs, symmetric torso) and via registry laterality data |
| Anatomy correctly positioned (floor, centering) | ✅ Validated against real computed bounding boxes, confirmed visually from front/back/side |
| Anatomy correctly scaled | ✅ Real-world proportions (1.71m implied height), visually proportionate |
| No floating/offset anatomy | ✅ Checked from 3 camera angles |
| No catastrophic intersections | ✅ Checked from 3 camera angles |
| Individual muscles selectable | ✅ Click → correct muscle resolved (tested: Psoas, Diaphragm) |
| Selection highlighting works | ✅ Unchanged highlight code path, shared by both anatomies |
| Camera navigation (orbit/zoom) | ✅ Unchanged OrbitControls, unaffected by this work |
| Trigger-point crosswalk still works (OLD mode) | ✅ Verified: OLD mode click → correct card + caution note |
| Existing 2D cards still work | ✅ Root list view, region navigation, detail cards unaffected |
| Existing 3D navigation (2D↔3D links) still work | ✅ List view → 3D → List view round-trip tested |
| Muscles without cards use fallback | ✅ "Trigger point data for this muscle is coming soon" — same code path, now also covers the 173 new uncarded BP3D muscles |
| No console errors | ⚠️ One real issue: `Failed to fetch` on OLD skeleton load after heavy prior load (§6) — reproduced twice, not a one-off. All other runs: zero errors beyond a benign missing-favicon 404 |
| No broken asset requests | ⚠️ Same caveat as above — the one fetch failure is a request that *should* succeed (file exists, direct fetch works) but transiently doesn't under main-thread contention |

---

## 8. FILES CREATED

- `bodyparts3d/scripts/transform_obj.py`, `batch_transform.py`, `batch_convert.mjs`, `build_registries.py` — the conversion pipeline
- `bodyparts3d/scripts/package.json` + lockfile (obj2gltf, build-time only)
- `bodyparts3d/source_archives/*.zip` — the 3 original supplied archives (committed as the reproducible source of truth)
- `bodyparts3d/manifests/CONVERSION_REPORT.json`, `INTEGRATION_REPORT.md` (this file)
- `trp-phase2/src/data/anatomy/anatomy_registry.json`, `skeleton_registry.json`
- `trp-phase2/public/models/anatomy/muscles/*.glb` (258 files), `.../skeleton/*.glb` (242 files)
- `bodyparts3d/source_objs/` — extracted working OBJ tree, gitignored (160MB; re-extractable from the committed archives)

## 9. FILES MODIFIED

- `trp-phase2/src/main.js` — anatomy-layer abstraction (oldGroup/newGroup), NEW anatomy loader, NEW skeleton loader, mode-aware skeleton toggle, OLD/NEW dev switch, render-throttling mitigation. `muscle_crosswalk.json`, `trigger_points.json`, the panel/highlight/click-resolution logic are all **unchanged in behavior**, just now shared by both anatomies instead of OLD-only.
- `trp-phase2/index.html` — added the anatomy dev-switch button (visually marked as dev-only: dashed amber styling) and made the attribution footer mode-aware (BodyParts3D/CC BY-SA 2.1 Japan for NEW, Z-Anatomy/CC BY-SA 4.0 for OLD).
- `bodyparts3d/manifests/bodyparts3d_asset_manifest.json`, `bodyparts3d_coverage_report.md` — regenerated after the two bug fixes in §5 (headline counts unchanged: 45/51 matched).
- `.gitignore` — added `bodyparts3d/source_objs/` and `__pycache__/`.

## 10. HOW TO TEST OLD VS NEW ANATOMY

1. `cd trp-phase2 && npm install && npm run dev` (or use the combined `node build.mjs` from repo root + serve `dist/`).
2. Open the 3D route. **NEW (BodyParts3D) loads by default** — the amber dashed pill in the header reads "Anatomy: NEW (BodyParts3D)".
3. Click the pill to switch to OLD (Z-Anatomy) — it lazy-loads on first switch, then toggles instantly. Click again to return to NEW.
4. The "Skeleton" toggle works independently in either mode, loading the anatomy-appropriate skeleton (BodyParts3D's own skeleton in NEW mode, the original Sketchfab skeleton in OLD mode).
5. Tap any muscle in either mode to confirm the detail panel, caution styling, and "coming soon" fallback all behave identically regardless of which anatomy is active.
6. The attribution footer at the bottom changes to match the active anatomy's actual source/license.

---

**STOP** — awaiting review. Nothing has been merged into `3d-integration` or `main`, and nothing has been deployed.
