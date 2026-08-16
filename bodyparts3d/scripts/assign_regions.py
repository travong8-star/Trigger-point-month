#!/usr/bin/env python3
"""
Assigns each muscle/skeleton registry entry to one of 7 anatomical LOADING
regions (a performance/loading grouping -- distinct from, and finer than,
trigger_points.json's 5 clinical UI regions):

  head-neck, torso, shoulder-arm, forearm-hand, hip-pelvis, thigh, lower-leg-foot

Adds "load_region" to every entry in anatomy_registry.json (per structure,
since a one-to-many app muscle's parts could in principle span regions --
none currently do, but the field lives at the structure level for
correctness) and skeleton_registry.json (per bone). Never leaves an entry
unassigned -- anything that doesn't match a rule is printed loudly rather
than silently defaulted.
"""
import json, re

ROOT = "/home/user/Trigger-point-month"
ANATOMY = f"{ROOT}/trp-phase2/src/data/anatomy/anatomy_registry.json"
SKELETON = f"{ROOT}/trp-phase2/src/data/anatomy/skeleton_registry.json"

def rx(*words):
    return re.compile(r"\b(" + "|".join(words) + r")\b", re.IGNORECASE)

# ---------------------------------------------------------------
# Muscle region rules, checked in order, first match wins.
# ---------------------------------------------------------------
MUSCLE_RULES = [
    ("head-neck", rx("scalenus anterior", "scalenus medius", "scalenus posterior", "scalene",
                      "sternocleidomastoid", "splenius", "obliquus capitis",
                      "rectus capitis", "levator scapulae", "masseter", "temporalis",
                      "digastric", "geniohyoid", "longus capitis", "longus colli",
                      "mylohyoid", "omohyoid", "platysma", "sternohyoid", "sternothyroid",
                      "stylohyoid", "thyrohyoid", "trapezius")),
    ("shoulder-arm", rx("supraspinatus", "infraspinatus", "teres minor", "teres major",
                         "subscapularis", "deltoid", "brachialis", "triceps brachii",
                         "biceps brachii", "coracobrachialis", "brachioradialis", "anconeus")),
    ("forearm-hand", rx("supinator", "carpi", "pronator", "palmaris", "digitorum superficialis",
                         "digitorum profundus", "digiti minimi$", "digiti minimi of.*hand",
                         "digiti minimi brevis of.*hand", "pollicis", "interosse.*hand",
                         "lumbrical.*hand", "of.*hand", "of.*wrist", "retinaculum",
                         "extensor digitorum$", "extensor indicis")),
    ("torso", rx("pectoralis", "rhomboid", "serratus anterior", "diaphragm", "iliocostalis",
                  "longissimus", "spinalis", "semispinalis", "interspinal", "rotator(?! cuff)",
                  "intertransversari", "subclavius", "transversus thoracis", "intercostal",
                  "external oblique", "serratus posterior", "latissimus", "levatores costarum",
                  "perineum", "perineal", "coccygeus", "iliococcygeus", "pubococcygeus",
                  "puborectalis", "levator ani")),
    ("hip-pelvis", rx("gluteus", "piriformis", "psoas", "iliacus", "tensor fasciae latae",
                       "obturator", "gemellus", "quadratus femoris", "pectineus")),
    ("thigh", rx("adductor (longus|brevis|magnus|minimus)", "gracilis", "sartorius",
                  "rectus femoris", "vastus", "semitendinosus", "semimembranosus",
                  "biceps femoris")),
    ("lower-leg-foot", rx("gastrocnemius", "soleus", "tibialis", "fibularis", "popliteus",
                           "plantaris", "digitorum longus", "digitorum brevis", "hallucis",
                           "flexor accessorius", "digiti minimi of.*foot", "digiti minimi brevis of.*foot",
                           "interosseous.*foot", "interosseous.*leg", "lumbrical.*foot",
                           "fascia lata", "long plantar ligament", "of.*foot", "calcaneal tendon")),
]

# Plain substring checks (no word-boundary) for compound anatomical terms
# with multiple grammatical suffixes (interspinalis/interspinales,
# intertransversarius/intertransversarii) -- \b-wrapped fragments kept
# truncating these (matched the "scalen"/"triquetr" bug pattern above).
TORSO_SUBSTRINGS = ["interspinal", "intertransversari"]

def region_for_muscle_name(name):
    nl = name.lower()
    if any(s in nl for s in TORSO_SUBSTRINGS):
        return "torso"
    for region, pattern in MUSCLE_RULES:
        if pattern.search(name):
            return region
    return None

anatomy = json.load(open(ANATOMY))
unassigned = []

for entry in anatomy["muscles"]:
    for structure in entry["bodyparts3d_structures"]:
        region = region_for_muscle_name(structure["bodyparts3d_name"])
        if region is None:
            # fall back to the app muscle's own name (covers one_to_one
            # entries whose bodyparts3d_name is oddly worded)
            region = region_for_muscle_name(entry["app_muscle_name"])
        if region is None:
            unassigned.append(("app", entry["app_muscle_name"], structure["bodyparts3d_name"]))
        structure["load_region"] = region

for extra in anatomy["available_extra_not_yet_carded"]:
    region = region_for_muscle_name(extra["english_name"])
    if region is None:
        unassigned.append(("extra", extra["english_name"], None))
    extra["load_region"] = region

# Unresolved (Masseter/Temporalis/Diaphragm) have no structures to tag, but
# they DO match MUSCLE_RULES by app_muscle_name (head-neck / torso) -- tag
# the entry itself for documentation even though there's nothing to load.
for entry in anatomy["muscles"]:
    if entry["mapping_type"] == "unresolved":
        entry["load_region_if_resolved"] = region_for_muscle_name(entry["app_muscle_name"])

json.dump(anatomy, open(ANATOMY, "w"), indent=2)

# ---------------------------------------------------------------
# Skeleton region rules
# ---------------------------------------------------------------
def region_for_bone(name, category):
    nl = name.lower()
    if re.search(r"\b(cervical|atlas|axis)\b", nl):
        return "head-neck"
    if re.search(r"\b(thoracic|lumbar|sacrum|rib|sternum|xiphoid|manubrium)\b", nl):
        return "torso"
    if category == "bone - skull" or re.search(r"\b(vomer|hyoid|nasal|lacrimal|palatine|zygomatic|mandible|maxilla|frontal|occipital|parietal|temporal|ethmoid|sphenoid)\b", nl):
        return "head-neck"
    if category == "bone - shoulder girdle" or re.search(r"\b(clavicle|scapula)\b", nl):
        return "shoulder-arm"
    if re.search(r"\bhumerus\b", nl):
        return "shoulder-arm"
    if re.search(r"\b(radius|ulna)\b", nl):
        return "forearm-hand"
    if category in ("bone - hand",) or "hand" in category or re.search(r"\b(carpal|metacarpal|capitate|hamate|lunate|pisiform|scaphoid|trapezium|trapezoid|triquetral)\b", nl):
        return "forearm-hand"
    if category == "bone - pelvic girdle" or re.search(r"\bhip bone\b|\bpelvis\b", nl):
        return "hip-pelvis"
    if re.search(r"\b(femur|patella)\b", nl):
        return "thigh"
    if re.search(r"\b(tibia|fibula)\b", nl):
        return "lower-leg-foot"
    if category in ("bone - foot",) or "foot" in category or "foot" in nl or re.search(r"\b(tarsal|metatarsal|calcaneus|talus|navicular|cuboid|cuneiform|toe|sesamoid)\b", nl):
        return "lower-leg-foot"
    if "intervertebral disk" in nl:
        return "torso"  # generic/unspecified-level disks default to torso (majority case)
    if "costal cartilage" in nl:
        return "torso"
    return None

skeleton = json.load(open(SKELETON))
for s in skeleton["structures"]:
    region = region_for_bone(s["english_name"], s["anatomical_category"])
    if region is None:
        unassigned.append(("bone", s["english_name"], s["fj_element_file_id"]))
    s["load_region"] = region

json.dump(skeleton, open(SKELETON, "w"), indent=2)

print(f"Unassigned: {len(unassigned)}")
for u in unassigned:
    print("  ", u)

from collections import Counter
muscle_region_counts = Counter(
    s["load_region"] for e in anatomy["muscles"] for s in e["bodyparts3d_structures"]
) + Counter(x["load_region"] for x in anatomy["available_extra_not_yet_carded"])
bone_region_counts = Counter(s["load_region"] for s in skeleton["structures"])

print("\nMuscle file instances per region:")
for r, c in muscle_region_counts.most_common():
    print(f"  {r}: {c}")
print("\nSkeleton file instances per region:")
for r, c in bone_region_counts.most_common():
    print(f"  {r}: {c}")
