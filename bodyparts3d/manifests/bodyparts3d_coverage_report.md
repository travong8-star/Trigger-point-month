# BodyParts3D Coverage Report

Generated from three real, now-supplied OBJ packages, cross-referenced against the BodyParts3D metadata files. This supersedes the earlier metadata-only extraction manifests — everything below reflects files actually present, not predicted.

**Packages inventoried:**
| Package | FJ range | Files | Content |
|---|---|---|---|
| `Send_to_Chat.zip` | FJ1252–1442 | 183 base + 59 mirrored (`M`) = 242 | Teeth, eye/orbital anatomy, right lower-limb myology |
| `BodyParts3D_muscle_block_FJ1443-FJ1601.zip` | FJ1443–1601 | 150 (of 159 requested) | Torso/shoulder/arm/forearm/hand/deep-neck muscles |
| `BodyParts3D_skeleton_block_FJ3130-3395_curated.zip` | FJ3130–3395 | 242 (curated) | Skeleton |
| **Total** | | **634 files** | |

A data-quality note surfaced while building this: the muscle package's own bundled manifest had a parser fallback bug — for OBJ files whose header `English name` field was blank (13 files, e.g. `FJ1451`, `FJ1543`), it substituted the file's `Bounds(mm)` comment line as if it were the name. Caught and corrected by resolving those 13 directly against `isa_element_parts.txt`/`partof_element_parts.txt` instead — none were left mislabeled in the final manifest.

**Addendum (found while building the anatomy registry):** the same naive-substring bug pattern documented in §B also affected `match_current_app` in the generator script — `"brachialis" in "coracobrachialis"` wrongly attached Coracobrachialis to the app's "Brachialis" card as a false one-to-many split. Fixed with word-boundary matching (`\bbrachialis\b`, which correctly matches inside "long head of biceps femoris" but not inside the fused word "coracobrachialis") and the manifest regenerated. The headline counts in this report (45 matched / 6 missing) were already correct and are unchanged; only the specific structures attached to "Brachialis" and "Biceps femoris"/"Gastrocnemius" (which had briefly regressed to *not* matching during the fix, from an over-corrected exact-match attempt, then were restored) were affected mid-process. Final state verified directly against the manifest before proceeding.

---

## A. COMPLETE MUSCLE COVERAGE

**258 muscle file instances, 178 distinct muscles** (both sides collapsed) across `Send_to_Chat.zip` + the muscle block.

Important asymmetry in the muscle block specifically: of its 125 distinct structures, only **20 have both right and left present**; **87 are right-side only** and 4 left-side only (14 are genuinely midline/unpaired, e.g. diaphragm-adjacent structures, linea alba). This is a real limitation, not a data-quality bug — the archive was extracted by exact numeric FJ id in the requested range, and this dataset represents most bilateral muscle pairs as `FJ####` (right) + `FJ####M` (left mirror); the `M`-suffixed mirrors were not part of this pull. The metadata confirms the missing left meshes exist in the full database (e.g. `FJ1443M` = left vastus medialis) — they just weren't included in this specific extraction.

The leg block in `Send_to_Chat.zip` does **not** have this problem — all 60 of its structures were pulled with full right+left (`M`) pairs already.

## B. COMPLETE SKELETAL COVERAGE

**242 curated skeleton files**, all bone/cartilage (verified — zero muscle contamination after fixing a classification bug described below):

| Category | Count |
|---|---|
| Vertebral column (cervical/thoracic/lumbar vertebrae, incl. atlas/axis) | 44 |
| Bone/cartilage with names outside this report's keyword list (see below) | 34 |
| Hand digit bones (phalanges) | 28 |
| Foot digit bones (phalanges) | 28 |
| Thorax (ribs, sternum parts) | 27 |
| Hand (carpals, metacarpals) | 24 |
| Foot (tarsals, metatarsals) | 24 |
| Skull | 13 |
| Lower limb long bones (femur, patella, tibia, fibula) | 8 |
| Upper limb long bones (humerus, radius, ulna) | 6 |
| Shoulder girdle (clavicle, scapula) | 4 |
| Pelvic girdle (hip bone) | 2 |

The "34 outside keyword list" bucket is still real skeletal/cartilage content, just named in ways this report's classifier script didn't anticipate — includes **Atlas, Axis, Hyoid bone, Vomer**, left+right **costal cartilage** (ribs 1–7), left+right **inferior nasal concha / lacrimal bone / nasal bone / palatine bone**, **triquetral** (a carpal bone missed by the keyword list), sesamoid bones of the foot, and intervertebral discs. Every one of these is a genuine skeletal or cartilaginous structure, not a miscategorization — just not sorted into a named sub-bucket.

Full skull coverage (13 + several from the "34" bucket) looks substantially more complete than the metadata-only pass suggested it might be, but I have not individually cross-checked it against a canonical "all skull bones" checklist (e.g. confirming both temporal bones, both zygomatic bones, frontal bone, occipital bone, parietal bones, sphenoid, mandible, maxilla are *all* present) — worth a targeted follow-up if skull completeness matters for the first implementation.

**Bug caught and fixed while building this report:** the classifier script initially used naive substring matching (`"scapula" in name`) instead of word-boundary matching, which misclassified **"subscapularis"** (contains "scapula"), **"tensor fasciae latae"** (contains "fascia"), **"tibialis anterior"** (contains "tibia"), and **"fibularis longus/brevis/tertius"** (contains "fibula") as bones/connective-tissue instead of muscles — and separately, a doubled-backslash typo in the regex fix (`r"\\b"` instead of `r"\b"`) silently disabled word-boundary matching entirely on the first attempt, dumping 178 of 242 skeleton entries into "muscle" by default. Both were caught by inspecting the actual category counts rather than trusting the first run, and fixed before this report was written.

## C. TRIGGER-POINT MUSCLES AVAILABLE

**45 of the current app's 51 muscles (88%)** now have real, available BodyParts3D geometry:

| Region | Available | Total |
|---|---|---|
| Shoulder & Arm | Supraspinatus, Infraspinatus, Teres minor, Subscapularis, Deltoid (Anterior), Deltoid (Middle), Brachialis, Supinator, Triceps (Medial), Triceps (Lateral), Teres major | **11/11** |
| Hip & Pelvis | Gluteus medius, Gluteus maximus, Gluteus minimus, Piriformis, Psoas, Iliacus, TFL, Adductor longus, Gracilis, Sartorius | **10/10** |
| Legs & Feet | Rectus femoris, Vastus lateralis, Vastus medialis, Vastus intermedius, Semitendinosus, Semimembranosus, Biceps femoris, Gastrocnemius, Soleus, Tibialis anterior | **10/10** |
| Head & Neck | Anterior/Middle/Posterior scalenes, SCM, Splenius capitis, Suboccipitals, Upper trapezius, Levator scapulae | 8/10 |
| Torso & Back | Pectoralis major (Clavicular), Pectoralis major (Sternocostal), Pectoralis minor, Rhomboid major, Rhomboid minor, Serratus anterior | 6/10 |

Vastus medialis and Biceps femoris (now confirmed to have both a long-head *and* short-head mesh — the app currently uses one merged card) were the two gaps the original audit specifically flagged; both are closed.

## D. TRIGGER-POINT MUSCLES STILL MISSING

1. **Masseter** and **Temporalis** — confirmed absent from *all* supplied metadata (`isa_*`/`partof_*`), not just these packages. No concept containing "masseter" or "temporalis"/"temporal muscle" exists anywhere in the files provided across this entire investigation. Not fabricated; needs sourcing from elsewhere or a different metadata export.
2. **Diaphragm** — exists in the metadata at a known id (`FJ3131`, confirmed earlier), but that specific file was not included in either the muscle block (out of its FJ1443–1601 range) or the curated skeleton block (reasonably excluded as a soft-tissue organ, not skeletal). Still a real gap, but a known, addressable one — a single targeted file pull, not a search problem.
3. **Erector spinae (Upper/Mid/Lower)** — not a true gap, a granularity mismatch. BodyParts3D doesn't model a generic "upper/mid/lower erector spinae"; it provides the real anatomical subdivisions instead, and **all of them are now available**: iliocostalis (cervicis/thoracis/lumborum), longissimus (capitis/cervicis/thoracis), spinalis (+ spinalis thoracis), plus semispinalis (capitis/cervicis/thoracis) and interspinalis thoracis as close neighbors. Reassigning the app's 3 generic cards to specific real muscles (or expanding to 3+ cards) is a data-authoring decision, not a missing-mesh problem.

**127 other muscles are available in the packages but have no trigger_points.json card at all** — full forearm and hand intrinsic groups, the fibularis (peroneal) group, deep neck/hyoid muscles, additional deltoid/pectoralis/trapezius/triceps/biceps parts sibling to cards already in the app, and more. Complete list is in the manifest JSON (`trigger_point_relevance: "identified_as_missing_muscle_in_audit"` or `"available_extra_not_yet_carded"`).

## E. SKELETAL STRUCTURES STILL MISSING

Nothing from the originally-requested checklist (skull, vertebral column, ribs, sternum, clavicles, scapulae, pelvis, humeri, radii, ulnae, hand bones, femora, patellae, tibiae, fibulae, foot bones) is absent from the curated package at the category level — every category has at least some files present. Two caveats, not gaps:

- **Skull completeness is unverified**, not confirmed complete (see §B) — worth a targeted check before relying on it for a full cranial display.
- **Only 2 skeleton FJ ids were reported missing from the curated region** (`FJ3238`, `FJ3363`) — both confirmed to not exist anywhere in the metadata either (see §F), so nothing anatomical is actually absent because of them.

## F. THE NINE MISSING FJ IDs

`FJ1449, FJ1453, FJ1457, FJ1458, FJ1519, FJ1523, FJ1529, FJ1530, FJ1531` (plus `FJ3238` and `FJ3363` from the skeleton region) were checked against **every** supplied metadata file — `isa_element_parts.txt`, `partof_element_parts.txt` (which together reference 2,234 distinct FJ ids across the whole BodyParts3D concept space, not just this project's regions of interest).

**None of the 11 ids appear anywhere in the metadata at all** — not just missing from the source archive, but never referenced by any FMA concept in either the is-a or part-of hierarchy. This strongly indicates they are simply **unassigned numbers in BodyParts3D's ID sequence** (the same pattern already seen in the originally-supplied range: 8 similar gaps existed in FJ1252–1442 too, e.g. `FJ1303`, `FJ1307`). This is consistent with an incrementally-built database where some draft or superseded entries were deleted without renumbering everything after them.

**Conclusion: none of these 11 ids correspond to a real, needed anatomical structure.** Nothing is missing from the app because of them — they were never real files to begin with.

## G. RECOMMENDED NEXT IMPLEMENTATION STEP

Still no meshes converted or app code touched, per your instructions. When this moves to implementation, in priority order:

1. **Vastus medialis + biceps femoris short head** (closes the original audit's two Hip/Leg gaps) — trivial, single OBJ→GLB conversions, already have real files.
2. **Masseter, Temporalis, Diaphragm** — separate sourcing decision needed (masseter/temporalis: not in any supplied metadata at all; diaphragm: known id, just needs its own file pulled).
3. **Erector spinae card redesign** — a data/UX decision (how many cards, which real muscles) before any mesh work, since the mesh side is already fully available.
4. **Left-side gap in the muscle block** — 87 right-only muscles need either their `M`-suffix mirror pulled from the source archive, or a render-time mirror (flip geometry across the sagittal plane) if true per-mesh left/right data isn't worth re-extracting. Worth deciding which approach before converting anything, since it changes the pipeline.
5. Skull completeness check (§E) before committing to it as a display-ready cranial asset.

**STOP** — manifest and report generated and validated (bugs found during validation were fixed before this was written, not left in). No application code touched, no meshes converted, nothing deployed.
