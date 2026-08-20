# Performance remediation report — regional lazy loading

Branch: `anatomy-replacement`. Supersedes the "Known limitations" performance
findings in `INTEGRATION_REPORT.md` with a fix, not just a diagnosis. This
report does not merge, deploy, or touch `main`/`3d-integration` — per
instruction, that stays out of scope pending review.

---

## A. Root cause of the slow loading

The integration report documented: loading the 242-file BodyParts3D skeleton
*after* muscles were already rendering took ~44s, improved to ~11s by a
render-throttle stopgap, with `Failed to fetch` errors reproduced twice under
heavy back-to-back loading (e.g. toggling skeleton right after switching
anatomy mode, which ran two independent 12-file concurrency pools at once).

This session's profiling (Task 7, carried into this remediation) had already
ruled out network transfer (~30ms/file) and per-mesh material/shader count
(tested directly by sharing materials — no improvement) as the cause, and
identified the real mechanism as **main-thread contention**: WebGL rendering
competes with fetch/parse/scene-graph callbacks for the same JS event loop,
and this specific sandboxed test environment renders WebGL via **SwiftShader
(software/CPU-emulated rendering)**, not a real GPU — confirmed via
`WEBGL_debug_renderer_info` (`unmaskedRenderer: "ANGLE (..., SwiftShader
Device ...)"`).

This remediation reproduced and sharpened that finding: a raw `fetch()`-only
test (no GLTFLoader parsing, no scene graph, no material work — just
downloading bytes) against the same 242 skeleton files, run *after* ~85
muscle meshes were already rendering, took **32–34 seconds**. The same 242
files fetched with `curl` at the same concurrency, bypassing the browser
entirely, took **0.5 seconds** (12MB total). That 60x gap is not explainable
by network or file size — it is Chromium's main thread being starved by
software-rendered draw calls, leaving little room to service fetch/promise
callbacks. The *architectural* problem (too many files requested in one
burst) is real and worth fixing on any hardware, especially mobile; the
*absolute* 44s/11s/32s numbers are specific to this sandbox's software
renderer and should not be read as production numbers (see Section E).

The `Failed to fetch` errors specifically came from **overlapping bulk
loads**: each bulk load (`loadWithConcurrency`) spun up its own independent
12-worker pool, so two loads running at once (skeleton toggle + anatomy mode
switch) could push simultaneous in-flight fetches to 24+ with no shared
ceiling.

## B. Architecture chosen

Smallest change that addresses both the stall and the failures, layered on
top of the existing render-throttle mitigation (kept, not replaced):

1. **`glbSemaphore`** — one global concurrency limiter (12), shared by
   *every* loader in the file (OLD's single GLB, NEW's per-structure
   muscles, NEW's per-bone skeleton). Structurally prevents the
   multi-pool-overlap that produced the fetch failures, regardless of how
   many logical loaders are "active" at once.
2. **`loadGlbCached`** — a path-keyed promise cache sitting in front of the
   semaphore. Dedupes concurrent/repeat requests for the same asset, and is
   the single place a failed fetch is recorded (`loadFailures`) and resolved
   to `null` instead of thrown, so one bad asset never aborts a batch.
3. **7-region loading taxonomy** (`bodyparts3d/scripts/assign_regions.py`,
   committed separately as Task 8) — every one of the 500 pipeline assets
   (of which the app currently loads 85 carded muscle files + 242 skeleton
   files) is tagged with one of: `head-neck`, `torso`, `shoulder-arm`,
   `forearm-hand`, `hip-pelvis`, `thigh`, `lower-leg-foot`.
4. **`makeRegionLoader`** — a continuously-fed priority queue. The first
   call to `loadRegion(name)` submits *every* file from *every* region to
   the semaphore/cache immediately, in priority order (torso first, then
   head-neck, hip-pelvis, shoulder-arm, thigh, lower-leg-foot,
   forearm-hand), and resolves each region's own promise as that region's
   files finish. An earlier version processed regions strictly sequentially
   (fully drain region N via `Promise.all` before submitting region N+1);
   measurement showed this stalls the pipeline at small-region boundaries
   (e.g. hip-pelvis skeleton has only 2 files, using 2 of 12 concurrency
   slots for that whole wave) — replaced with the single continuous queue
   so all 12 workers stay busy across region boundaries while priority
   order is still respected.
5. **Non-blocking progress UI** (`#bg-progress`) — a small pill, separate
   from the existing full-screen `#loading` overlay, shown while background
   regions continue loading after the viewer is already interactive.
6. **Dev/debug visibility** — `window.__anatomyDebug` exposes
   `loadFailures`, `isMuscleRegionsFullyLoaded()`,
   `isSkeletonRegionsFullyLoaded()`, `clickableCount()` in any build (not
   gated to dev-only, since it's a handful of arrays/closures and is
   directly useful for exactly this kind of failure investigation).

## C. Files changed

- `trp-phase2/src/main.js` — the loader rewrite (this report's subject).
- `trp-phase2/index.html` — added `#bg-progress` element + CSS.
- `bodyparts3d/scripts/assign_regions.py` (new), `anatomy_registry.json`,
  `skeleton_registry.json` — the region taxonomy (Task 8, committed
  separately, prerequisite data layer for this loader).

No changes to: `prepareMeshMaterial`, `onCanvasClick`, `openPanelForMuscle`,
`trpBlockHtml`/`fieldHtml`, highlight/panel logic, OLD anatomy's
crosswalk resolution, camera/OrbitControls setup, or the OLD/NEW dev toggle.

## D. Performance before (from `INTEGRATION_REPORT.md`)

| Measurement | Before |
|---|---|
| Cold load, 85 carded muscle files, empty scene | 1.2–1.8s |
| 242 skeleton files, loaded after muscles already rendering | 44s raw → ~11s after render-throttle mitigation |
| Switch to OLD anatomy while skeleton x-ray on | ~60s |
| `Failed to fetch` errors | Reproduced twice under heavy back-to-back loading |

## E. Performance after (measured this session, combined production build, same sandbox)

| Measurement | After |
|---|---|
| Time to base (torso) muscle region interactive | ~215–230ms |
| All 85 muscle files loaded (background-filled) | ~1.1–1.2s total from nav start |
| Time to skeleton toggle usable (torso region, 76 files) | ~7.1–7.6s |
| All 242 skeleton files loaded (background-filled) | ~14.4–14.7s total from toggle click |

**Environment caveat (read before comparing D and E):** every absolute
number above and in the original report — including the original 44s
finding — was gathered in this sandbox's software-rendered (SwiftShader)
Chromium, which this session's raw-fetch test showed can be ~60x slower
than the same request pattern outside the browser (32–34s in-browser vs
0.5s via `curl`, identical 242 files, identical server). These numbers are
**not representative of production** on Vercel with a real GPU-accelerated
browser. What *is* environment-independent, because it's a same-environment
relative comparison: the app now becomes interactive after loading ~1
region's worth of files instead of the entire set, and the skeleton toggle
shows a usable skeleton after its first region instead of blocking on all
242 files with nothing visible in the meantime.

## F. Fetch failures before

`Failed to fetch` reproduced twice under heavy back-to-back loading
(overlapping skeleton toggle + anatomy-mode switch), per
`INTEGRATION_REPORT.md`.

## G. Fetch failures after

**0** application-level load failures (`window.__anatomyDebug.loadFailures`)
across: normal initial load, background muscle fill, skeleton toggle +
background fill, and a rapid-toggle stress test built specifically to
reproduce the original overlap conditions (skeleton off → anatomy mode to
OLD → skeleton on → anatomy mode to NEW → skeleton off/on rapidly, no
pauses). Final state after the stress test: all 85 muscle meshes and all
242 skeleton files present and loaded, app fully responsive.

One caveat for transparency: Chromium's DevTools-protocol
`requestfailed`/`net::ERR_ABORTED` events *were* observed during the
legitimate heavy-concurrency phases (15–142 events depending on region
size, scaling with file count) — but **zero occurred during the stress
test** (nothing left to fetch, everything already cached), and every single
one of the events during normal loading corresponded to an asset that
ultimately loaded successfully (final clickable-mesh count = 85/85,
`isFullyLoaded()` = true for both loaders). This looks like Chromium's own
low-level connection-pool churn under N-way concurrency to one origin, not
a failure visible to the app or the user — `loadGlbCached`'s own failure
tracking, which is what the app and user actually experience, never
recorded one.

## H. How regional/lazy loading works

1. On page load, `newMuscleLoader.loadRegion('torso')` is called with an
   `onFileProgress` callback wired to the existing `#loading` overlay text.
   This is the *first* call to `loadRegion` on that loader, so it triggers
   `dispatchAll()`: every muscle file from every region (not just torso) is
   submitted to `loadGlbCached`/`glbSemaphore` at once, in region-priority
   order. Torso's 14 files are queued first, so they're serviced first by
   the semaphore's FIFO queue.
2. Once torso's files are done, `#loading` hides, `newGroup` becomes
   visible, and the app is interactive — with the other 6 regions' files
   already in flight in the background (they were queued at the same time,
   just later in FIFO order).
3. `watchRemainingRegionsForProgress` then just *watches* those already-
   dispatched region promises resolve, updating the small `#bg-progress`
   pill (`"Loading more anatomy… 3/6"`) until all 7 regions report loaded,
   then hides it. It does not trigger any new loading itself.
4. The skeleton toggle follows the identical pattern via a separate
   `newSkeletonLoader` instance (own `dispatchAll()`, own region state, but
   sharing the same global `glbSemaphore`): first click loads the torso
   skeleton region (76 files) before flipping the toggle to "on," then
   background-fills the rest.
5. Both loaders are idempotent — calling `loadRegion` again for an
   in-flight or already-loaded region returns the same promise rather than
   re-dispatching, so re-toggling skeleton, switching anatomy modes back
   and forth, etc. never re-fetches anything already cached.

## I. How individual muscle selection is preserved

Nothing about per-mesh selectability changed:

- Each BodyParts3D structure is still its own individual GLB file, loaded
  and added to the scene as its own `Object3D` — no geometry merging, no
  batching. Left/right sides remain separate files/meshes exactly as
  before.
- `mesh.userData.appMuscle = { muscle, cards }` is still set per-mesh at
  load time, same shape as before; `onCanvasClick`'s raycast against
  `activeClickable()` and the `openPanelForMuscle`/highlight logic are
  byte-for-byte unchanged from before this remediation.
- The only thing that changed is *when* a given file's mesh gets added to
  `newClickable`/`newGroup` (progressively, region by region, instead of
  all at once) — once added, it behaves identically to before. A tap on a
  region that hasn't loaded yet simply hits nothing (same as tapping empty
  space), which self-resolves within seconds as that region's files land.
- OLD anatomy's node-name/crosswalk resolution path is untouched in logic;
  it now routes through `loadGlbCached`/`glbSemaphore` for consistency
  (defense against overlap with NEW's background loading) but the
  traversal/tagging code is unchanged.

## J. Regression test results

All tests run via Playwright against the **combined production build**
(`node build.mjs` → `dist/`, served with `http-server`), not the Vite dev
server, to match how this would actually ship.

| Check | Result |
|---|---|
| `npm run build` (trp-phase2 standalone) | ✅ Clean, no errors |
| `node build.mjs` (combined root + `/3d`) | ✅ Clean, no errors |
| Click-to-select, NEW anatomy (49-point grid scan) | ✅ 10/49 points hit real geometry, all resolved to correct muscle names (Deltoid, Triceps, Pectoralis major, Iliacus, Vastus medialis, Rectus femoris, Rhomboid major, Adductor longus) across shoulder-arm/torso/hip-pelvis/thigh regions |
| Caution-note rendering | ✅ Psoas hit via targeted scan, caution block rendered "Caution — avoid deep unsafe pressure" |
| OLD anatomy mode switch + click-to-select | ✅ Switched to OLD, click resolved "Pectoralis major (Sternocostal)" via crosswalk |
| OLD skeleton toggle | ✅ Loads and displays without error through the new shared semaphore/cache path |
| Duplicate requests | ✅ 0 — unique URL count equals fetch count in every measured phase, including the stress test |
| App responsiveness after stress test | ✅ Canvas present, `document.readyState === 'complete'`, no crash |
| Pre-existing/unrelated 404 (favicon.ico, intermittent) | Observed in ~2 of 6 runs; `dist/` and `dist/3d/` confirmed to have no `favicon.ico`; unrelated to anatomy loading (no anatomy asset ever 404'd in any run), pre-existing, out of scope for this fix |

---

## Addendum: Draco / meshopt compression (requested consideration)

Measured, not adopted. Total anatomy asset payload is 41MB across all 500
files (12MB / 242 files for skeleton, 29MB / 258 files for muscles,
~50–114KB average per file). A `curl`-based fetch of the full 242-file
skeleton set at the same 12-way concurrency completed in 0.5s locally —
confirming (consistent with Task 7's original finding) that network
transfer was never the bottleneck. Compression would reduce these already-
small files further, but:

- It cannot address the actual bottleneck (main-thread rendering
  contention), which is orthogonal to file size.
- Draco/meshopt *decoding* is itself main-thread CPU work at parse time —
  adding it would add load to the exact resource (the main thread, under
  software rendering) that's already contended, a net negative for this
  specific problem.

Not introduced, per the explicit instruction not to add compression for
its own sake.
