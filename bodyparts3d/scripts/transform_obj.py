#!/usr/bin/env python3
"""
Applies the BodyParts3D -> app coordinate transform to a single OBJ file's
vertex positions and normals, writing a new OBJ (faces/texcoords untouched).

Derived and validated against the real combined bounding box of all 634
supplied source files (see bodyparts3d/manifests/ investigation):
  - BodyParts3D: millimeters, Z-up, Y increasing = posterior.
  - App convention (trp-phase2 crosswalk axes): meters, Y-up, +Z = anterior,
    origin at floor level, roughly centered left/right and front/back.

Transform per vertex (x, y, z) in raw mm:
  new_x = x * SCALE + X_CENTER_OFFSET
  new_y = z * SCALE + FLOOR_OFFSET
  new_z = -y * SCALE + Z_CENTER_OFFSET

Normals use the same axis remap (rotation only -- no scale, no translation).
"""
import re
import sys

SCALE = 0.001
FLOOR_OFFSET = 0.0728882      # shifts lowest point (right calcaneus, heel) to Y=0
X_CENTER_OFFSET = -0.0000105  # combined bbox was already ~centered on X
Z_CENTER_OFFSET = -0.10570935 # centers combined front-back depth range on Z=0

V_RE = re.compile(r"^v\s+([-\d.eE]+)\s+([-\d.eE]+)\s+([-\d.eE]+)")
VN_RE = re.compile(r"^vn\s+([-\d.eE]+)\s+([-\d.eE]+)\s+([-\d.eE]+)")

def transform_position(x, y, z):
    return (
        x * SCALE + X_CENTER_OFFSET,
        z * SCALE + FLOOR_OFFSET,
        -y * SCALE + Z_CENTER_OFFSET,
    )

def transform_normal(x, y, z):
    return (x, z, -y)

def transform_obj(src_path, dst_path):
    v_count = 0
    vn_count = 0
    f_count = 0
    with open(src_path, "r", errors="replace") as fin, open(dst_path, "w") as fout:
        for line in fin:
            m = V_RE.match(line)
            if m:
                x, y, z = (float(g) for g in m.groups())
                nx, ny, nz = transform_position(x, y, z)
                fout.write(f"v {nx:.6f} {ny:.6f} {nz:.6f}\n")
                v_count += 1
                continue
            m = VN_RE.match(line)
            if m:
                x, y, z = (float(g) for g in m.groups())
                nx, ny, nz = transform_normal(x, y, z)
                fout.write(f"vn {nx:.6f} {ny:.6f} {nz:.6f}\n")
                vn_count += 1
                continue
            if line.startswith("f "):
                f_count += 1
            fout.write(line)
    return {"vertices": v_count, "normals": vn_count, "faces": f_count}

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("usage: transform_obj.py <src.obj> <dst.obj>", file=sys.stderr)
        sys.exit(1)
    stats = transform_obj(sys.argv[1], sys.argv[2])
    print(stats)
