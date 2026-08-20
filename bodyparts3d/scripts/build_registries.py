#!/usr/bin/env python3
"""
Builds anatomy_registry.json (muscles) and skeleton_registry.json from the
successful conversions in CONVERSION_REPORT.json, cross-referenced with
trigger_points.json for card ids.

muscle_crosswalk.json (the OLD anatomy's node-name-in-one-GLB addressing
scheme) is NOT modified -- it doesn't apply to the new one-GLB-per-structure
layer, and nothing here requires changing it (req #12: "extend only where
necessary" -- it wasn't necessary).

One app muscle can map to multiple BodyParts3D structures (req #14, the
erector spinae example). Where the coverage report already established the
mapping (Suboccipitals -> 4 BP3D muscles, matched automatically via the
manifest's current_application_mapping) that's used directly; erector
spinae's 3-card split by spinal level is the one manually-authored grouping,
documented inline below with its reasoning.
"""
import json
from collections import defaultdict

ROOT = "/home/user/Trigger-point-month"
CONVERSION_REPORT = f"{ROOT}/bodyparts3d/manifests/CONVERSION_REPORT.json"
TRIGGER_POINTS = f"{ROOT}/trigger_points.json"
OUT_DIR = f"{ROOT}/trp-phase2/src/data/anatomy"

conv = json.load(open(CONVERSION_REPORT))
conversions = [c for c in conv["conversions"] if c["status"] == "OK"]
tp = json.load(open(TRIGGER_POINTS))

# current_application_mapping isn't in CONVERSION_REPORT (it only carries
# converter-relevant fields) -- re-pull it from the asset manifest by fj id.
asset_manifest = json.load(open(f"{ROOT}/bodyparts3d/manifests/bodyparts3d_asset_manifest.json"))
by_fj = {r["fj_element_file_id"]: r for r in asset_manifest["records"]}

def glb_web_path(rec):
    # Path as the app will fetch it: /models/anatomy/... relative to trp-phase2's BASE_URL.
    sub = "muscles" if rec["structure_type"] == "muscle" else "skeleton"
    return f"models/anatomy/{sub}/{rec['fj_element_file_id']}.glb"

def side_of(fj_id):
    r = by_fj.get(fj_id, {})
    lat = r.get("laterality")
    if lat == "right":
        return "right"
    if lat == "left":
        return "left"
    return "midline"

# ---------------------------------------------------------------
# Card lookup: app muscle name -> {region, card_ids}
# ---------------------------------------------------------------
app_muscle_cards = {}
for p in tp["points"]:
    key = p["muscle"]
    app_muscle_cards.setdefault(key, {"region": p["region"], "card_ids": []})
    app_muscle_cards[key]["card_ids"].append(p["id"])
for v in app_muscle_cards.values():
    v["card_ids"] = sorted(set(v["card_ids"]))

# ---------------------------------------------------------------
# Group converted muscle files by their current_application_mapping
# ---------------------------------------------------------------
muscle_conv = [c for c in conversions if c["structure_type"] == "muscle"]
by_app_muscle = defaultdict(list)
unmapped = []
for c in muscle_conv:
    rec = by_fj.get(c["fj_element_file_id"], {})
    mapping = rec.get("current_application_mapping")
    if mapping:
        by_app_muscle[mapping["muscle"]].append(c)
    else:
        unmapped.append(c)

# Manual one-to-many grouping: erector spinae, by spinal level. BP3D provides
# the real anatomical subdivisions (iliocostalis/longissimus/spinalis); the
# app's 3 generic cards are a clinical "upper/mid/lower back" framing with no
# 1:1 BP3D equivalent (see coverage report section D). Grouped by spinal
# level as the closest reasonable clinical<->anatomical correspondence.
ERECTOR_SPINAE_LEVELS = {
    "Erector spinae (Upper)": ["iliocostalis cervicis", "longissimus capitis", "longissimus cervicis"],
    "Erector spinae (Mid)": ["iliocostalis thoracis", "longissimus thoracis", "spinalis thoracis", "spinalis"],
    "Erector spinae (Lower)": ["iliocostalis lumborum"],
}
def strip_side(name):
    return name.replace("Right ", "").replace("Left ", "").replace("right ", "").replace("left ", "").strip().lower()

name_to_convs = defaultdict(list)
for c in unmapped:
    name_to_convs[strip_side(c["english_name"])].append(c)

erector_spinae_used_fjs = set()
for app_name, bp3d_names in ERECTOR_SPINAE_LEVELS.items():
    for bp3d_name in bp3d_names:
        for c in name_to_convs.get(bp3d_name, []):
            by_app_muscle[app_name].append(c)
            erector_spinae_used_fjs.add(c["fj_element_file_id"])

unmapped = [c for c in unmapped if c["fj_element_file_id"] not in erector_spinae_used_fjs]

# ---------------------------------------------------------------
# Build muscle registry entries
# ---------------------------------------------------------------
def slugify(name):
    return name.lower().replace(" ", "-").replace("(", "").replace(")", "")

muscle_entries = []
for app_name, convs in sorted(by_app_muscle.items()):
    cards = app_muscle_cards.get(app_name, {"region": None, "card_ids": []})
    # group this app muscle's file instances by distinct BP3D structure name (collapsing sides)
    by_structure = defaultdict(dict)
    for c in convs:
        base_name = strip_side(c["english_name"])
        rec = by_fj.get(c["fj_element_file_id"], {})
        side = side_of(c["fj_element_file_id"])
        by_structure[base_name][side] = {
            "fj_element_file_id": c["fj_element_file_id"],
            "fma_concept_id": rec.get("fma_concept_id"),
            "glb_asset": glb_web_path({"structure_type": "muscle", "fj_element_file_id": c["fj_element_file_id"]}),
            "triangle_count": c["triangle_count"],
            "glb_size_bytes": c["glb_size_bytes"],
        }
    structures = [{"bodyparts3d_name": name, "sides": sides} for name, sides in sorted(by_structure.items())]
    muscle_entries.append({
        "app_muscle_id": slugify(app_name),
        "app_muscle_name": app_name,
        "region": cards["region"],
        "trigger_point_card_ids": cards["card_ids"],
        "mapping_type": "one_to_one" if len(structures) == 1 else "one_to_many",
        "bodyparts3d_structures": structures,
    })

# Muscles that ARE mapped to trigger_points.json but have NO BodyParts3D geometry at all
resolved_names = set(app_muscle_cards.keys())
mapped_names = set(by_app_muscle.keys())
for missing_name in sorted(resolved_names - mapped_names):
    cards = app_muscle_cards[missing_name]
    reason = "unresolved_external_source_required"
    note = None
    if missing_name in ("Masseter", "Temporalis"):
        note = "Absent from all supplied BodyParts3D metadata (isa_*/partof_*) -- not fabricated, not inferred from another id. Requires a different source."
    elif missing_name == "Diaphragm":
        note = "Known FJ id (FJ3131) exists in the metadata but that OBJ was not included in either supplied archive block. A single targeted file pull would close this, not a search problem."
    muscle_entries.append({
        "app_muscle_id": slugify(missing_name),
        "app_muscle_name": missing_name,
        "region": cards["region"],
        "trigger_point_card_ids": cards["card_ids"],
        "mapping_type": "unresolved",
        "bodyparts3d_structures": [],
        "note": note,
    })

# BP3D muscles available but not yet referenced by any trigger_points.json card
extra_entries = []
for c in unmapped:
    rec = by_fj.get(c["fj_element_file_id"], {})
    extra_entries.append({
        "fj_element_file_id": c["fj_element_file_id"],
        "english_name": c["english_name"],
        "fma_concept_id": rec.get("fma_concept_id"),
        "side": side_of(c["fj_element_file_id"]),
        "glb_asset": glb_web_path({"structure_type": "muscle", "fj_element_file_id": c["fj_element_file_id"]}),
    })

anatomy_registry = {
    "registry_type": "anatomy_registry",
    "description": "Maps application trigger-point muscles to their BodyParts3D anatomical structure(s) and GLB asset(s). One app muscle can reference multiple anatomically-distinct BodyParts3D structures (mapping_type: one_to_many) -- see erector spinae.",
    "source_conversion_report": "bodyparts3d/manifests/CONVERSION_REPORT.json",
    "muscles": sorted(muscle_entries, key=lambda m: (m["region"] or "zzz", m["trigger_point_card_ids"][0] if m["trigger_point_card_ids"] else 999)),
    "available_extra_not_yet_carded": sorted(extra_entries, key=lambda e: e["english_name"]),
}

with open(f"{OUT_DIR}/anatomy_registry.json", "w") as f:
    json.dump(anatomy_registry, f, indent=2)

# ---------------------------------------------------------------
# Skeleton registry: flat catalog, independently identifiable per bone
# ---------------------------------------------------------------
skeleton_conv = [c for c in conversions if c["structure_type"] == "bone"]
skeleton_entries = []
for c in skeleton_conv:
    rec = by_fj.get(c["fj_element_file_id"], {})
    skeleton_entries.append({
        "fj_element_file_id": c["fj_element_file_id"],
        "english_name": c["english_name"],
        "fma_concept_id": rec.get("fma_concept_id"),
        "bodyparts3d_representation_id": rec.get("bodyparts3d_representation_id"),
        "side": side_of(c["fj_element_file_id"]),
        "anatomical_category": rec.get("anatomical_category"),
        "glb_asset": glb_web_path({"structure_type": "bone", "fj_element_file_id": c["fj_element_file_id"]}),
        "triangle_count": c["triangle_count"],
        "glb_size_bytes": c["glb_size_bytes"],
    })

skeleton_registry = {
    "registry_type": "skeleton_registry",
    "description": "Independent catalog of every converted BodyParts3D skeletal structure. Separate from the muscle registry since bones aren't addressed through trigger-point cards.",
    "source_conversion_report": "bodyparts3d/manifests/CONVERSION_REPORT.json",
    "structures": sorted(skeleton_entries, key=lambda s: s["fj_element_file_id"]),
}

with open(f"{OUT_DIR}/skeleton_registry.json", "w") as f:
    json.dump(skeleton_registry, f, indent=2)

print("Muscle registry entries:", len(muscle_entries))
print("  one_to_one:", len([m for m in muscle_entries if m["mapping_type"] == "one_to_one"]))
print("  one_to_many:", len([m for m in muscle_entries if m["mapping_type"] == "one_to_many"]))
print("  unresolved:", len([m for m in muscle_entries if m["mapping_type"] == "unresolved"]))
print("Extra (uncarded) BP3D muscles:", len(extra_entries))
print("Skeleton registry entries:", len(skeleton_entries))
