#!/usr/bin/env node
// Pass 2 of the conversion pipeline: reads stage1_results.json (the
// transformed-OBJ staging manifest from batch_transform.py) and converts
// each staged OBJ to a binary GLB via obj2gltf's programmatic API, in a
// single Node process (avoids ~500 separate CLI/npx process spin-ups).
// Never silently skips: every OK-staged record gets an attempted
// conversion, and failures are recorded, not dropped.
import obj2gltf from "./node_modules/obj2gltf/lib/obj2gltf.js";
import fs from "fs";

const ROOT = "/home/user/Trigger-point-month";
const STAGING = "/tmp/claude-0/-home-user-Trigger-point-month/5969d0ff-834f-52df-b495-7ed480579d65/scratchpad/staged_obj";
const OUT_MUSCLES = `${ROOT}/trp-phase2/public/models/anatomy/muscles`;
const OUT_SKELETON = `${ROOT}/trp-phase2/public/models/anatomy/skeleton`;

const stage1 = JSON.parse(fs.readFileSync(`${STAGING}/stage1_results.json`, "utf8"));
const toConvert = stage1.filter((r) => r.stage1_status === "OK");

fs.mkdirSync(OUT_MUSCLES, { recursive: true });
fs.mkdirSync(OUT_SKELETON, { recursive: true });

const results = [];

function triangleCountOf(objPath) {
  const text = fs.readFileSync(objPath, "utf8");
  let count = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("f ")) count++;
  }
  return count;
}

async function run() {
  let i = 0;
  for (const r of toConvert) {
    i++;
    const outDir = r.structure_type === "muscle" ? OUT_MUSCLES : OUT_SKELETON;
    const outPath = `${outDir}/${r.fj_element_file_id}.glb`;
    try {
      const glb = await obj2gltf(r.staged_obj_path, { binary: true });
      fs.writeFileSync(outPath, glb);
      const stat = fs.statSync(outPath);
      results.push({
        fj_element_file_id: r.fj_element_file_id,
        english_name: r.english_name,
        structure_type: r.structure_type,
        source_package: r.source_package,
        source_obj_filename: r.source_obj_filename,
        staged_obj_path: r.staged_obj_path,
        output_glb_path: outPath.replace(ROOT + "/", ""),
        status: "OK",
        triangle_count: triangleCountOf(r.staged_obj_path),
        glb_size_bytes: stat.size,
      });
    } catch (err) {
      results.push({
        fj_element_file_id: r.fj_element_file_id,
        english_name: r.english_name,
        structure_type: r.structure_type,
        source_package: r.source_package,
        source_obj_filename: r.source_obj_filename,
        staged_obj_path: r.staged_obj_path,
        output_glb_path: null,
        status: "FAILED",
        error: String(err && err.message ? err.message : err),
      });
    }
    if (i % 50 === 0) console.log(`  ${i}/${toConvert.length}...`);
  }

  const ok = results.filter((r) => r.status === "OK");
  const failed = results.filter((r) => r.status === "FAILED");
  console.log(`Stage 2 (obj2gltf): ${ok.length} OK, ${failed.length} FAILED`);
  for (const f of failed) console.log("  FAILED:", f.fj_element_file_id, "-", f.error);

  fs.writeFileSync(`${STAGING}/stage2_results.json`, JSON.stringify(results, null, 2));
}

run();
