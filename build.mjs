// Combined build: copies the build-less static PWA (root) into dist/ as-is,
// then builds the trp-phase2 Vite 3D app and places its output under
// dist/3d/, so one deployment serves both experiences ("/" and "/3d").
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const staticEntries = [
  "index.html",
  "css",
  "js",
  "icons",
  "manifest.json",
  "service-worker.js",
  "trigger_points.json",
];
for (const entry of staticEntries) {
  cpSync(path.join(root, entry), path.join(dist, entry), { recursive: true });
}

execSync("npm install && npm run build", {
  cwd: path.join(root, "trp-phase2"),
  stdio: "inherit",
});

cpSync(path.join(root, "trp-phase2", "dist"), path.join(dist, "3d"), {
  recursive: true,
});

console.log("Combined build complete -> dist/ (root PWA + /3d 3D viewer)");
