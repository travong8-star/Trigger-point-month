#!/usr/bin/env python3
"""
Pass 1 of the conversion pipeline: reads bodyparts3d_asset_manifest.json,
locates each convertible source OBJ (muscle + bone records that are actually
present in a supplied package -- excludes teeth/eye/connective-tissue/
unassigned-id records, a deliberate first-implementation scope decision),
applies the validated coordinate transform, and writes the transformed OBJ
into a staging directory for pass 2 (Node/obj2gltf) to convert to GLB.

Never silently skips: any record that should be convertible but whose
source file can't be found is recorded as a failure, not dropped.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from transform_obj import transform_obj

ROOT = "/home/user/Trigger-point-month"
MANIFEST = f"{ROOT}/bodyparts3d/manifests/bodyparts3d_asset_manifest.json"
STAGING = "/tmp/claude-0/-home-user-Trigger-point-month/5969d0ff-834f-52df-b495-7ed480579d65/scratchpad/staged_obj"

SOURCE_DIRS = {
    "Send_to_Chat.zip": f"{ROOT}/bodyparts3d/source_objs/leg_teeth_eye",
    "BodyParts3D_muscle_block_FJ1443-FJ1601.zip": f"{ROOT}/bodyparts3d/source_objs/muscle_block",
    "BodyParts3D_skeleton_block_FJ3130-3395_curated.zip": f"{ROOT}/bodyparts3d/source_objs/skeleton_block",
}

def main():
    manifest = json.load(open(MANIFEST))
    records = manifest["records"]

    os.makedirs(f"{STAGING}/muscles", exist_ok=True)
    os.makedirs(f"{STAGING}/skeleton", exist_ok=True)

    results = []
    for r in records:
        if r["structure_type"] not in ("muscle", "bone"):
            continue  # teeth/eye/connective-tissue/unassigned -- out of scope for this pass, not a failure
        if r["availability_status"] != "present_in_supplied_package":
            continue  # e.g. the 11 unassigned-id gap records -- nothing to convert

        src_dir = SOURCE_DIRS.get(r["source_package"])
        if src_dir is None:
            results.append({**r, "stage1_status": "FAILED", "stage1_reason": f"unknown source_package '{r['source_package']}'"})
            continue

        src_path = f"{src_dir}/{r['source_obj_filename']}"
        if not os.path.isfile(src_path):
            results.append({**r, "stage1_status": "FAILED", "stage1_reason": f"source file not found: {src_path}"})
            continue

        subdir = "muscles" if r["structure_type"] == "muscle" else "skeleton"
        dst_path = f"{STAGING}/{subdir}/{r['fj_element_file_id']}.obj"
        try:
            stats = transform_obj(src_path, dst_path)
        except Exception as e:
            results.append({**r, "stage1_status": "FAILED", "stage1_reason": f"transform error: {e}"})
            continue

        results.append({**r, "stage1_status": "OK", "staged_obj_path": dst_path, **stats})

    ok = [r for r in results if r["stage1_status"] == "OK"]
    failed = [r for r in results if r["stage1_status"] == "FAILED"]
    print(f"Stage 1 (transform): {len(ok)} OK, {len(failed)} FAILED, {len(results)} total considered")
    for f in failed:
        print("  FAILED:", f.get("fj_element_file_id"), "-", f.get("stage1_reason"))

    with open(f"{STAGING}/stage1_results.json", "w") as f:
        json.dump(results, f, indent=2)

if __name__ == "__main__":
    main()
