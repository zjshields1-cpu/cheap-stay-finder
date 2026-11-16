"""Build the ski lift and ski area tiles the planner loads.

Input (download first, see README):
  lifts.geojson, ski_areas.geojson from https://tiles.openskimap.org/geojson/
  (OpenSkiMap, derived from OpenStreetMap, ODbL)

Outputs:
  data/ski/lifts/<lat>_<lon>.js    lifts whose bottom station falls in that 0.5-degree tile
  data/ski/areas/<lat>_<lon>.js    named ski areas in 2-degree tiles (tile index = floor(coord / size))

Lift rows: [name, type, status, baseLat, baseLon, baseElevM, topLat, topLon, topElevM, skiAreaName]
Area rows: [name, lat, lon, status, activities, lifts, downhillKm, minElevM, maxElevM, website, [minLat,minLon,maxLat,maxLon] or null]

Usage: python tools/build_ski.py <input_dir> <data_dir>
"""
import json
import math
import shutil
import sys
from collections import defaultdict
from pathlib import Path

src, out = Path(sys.argv[1]), Path(sys.argv[2]) / "ski"
shutil.rmtree(out, ignore_errors=True)


def write_js(path, prefix, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(prefix)
        json.dump(obj, f, separators=(",", ":"), ensure_ascii=False)
        f.write(";\n")


r5 = lambda v: round(v, 4)  # ~10 m, plenty for distances
LIFT_TILE, AREA_TILE = 0.5, 2  # degrees; small tiles keep each download small
r0 = lambda v: None if v is None else round(v)

# ---------- Lifts ----------
SKIP_STATUS = {"abandoned", "disused", "proposed", "planned"}
lift_tiles = defaultdict(list)
n_lifts = 0
for f in json.load(open(src / "lifts.geojson", encoding="utf-8"))["features"]:
    p, g = f["properties"], f["geometry"]
    if p.get("status") in SKIP_STATUS or not g or g["type"] != "LineString" or len(g["coordinates"]) < 2:
        continue
    a, b = g["coordinates"][0], g["coordinates"][-1]
    ea = a[2] if len(a) > 2 else None
    eb = b[2] if len(b) > 2 else None
    # Bottom station = the lower end (OSM usually draws lifts bottom → top, elevation settles it)
    if ea is not None and eb is not None and eb < ea:
        a, b, ea, eb = b, a, eb, ea
    area = next((s["properties"].get("name") for s in (p.get("skiAreas") or []) if s["properties"].get("name")), None)
    row = [p.get("name"), p.get("liftType"), p.get("status"), r5(a[1]), r5(a[0]), r0(ea), r5(b[1]), r5(b[0]), r0(eb), area]
    lift_tiles[f"{math.floor(a[1] / LIFT_TILE)}_{math.floor(a[0] / LIFT_TILE)}"].append(row)
    n_lifts += 1

for t, rows in lift_tiles.items():
    write_js(out / "lifts" / f"{t}.js", f"(window.CSF_LIFTS=window.CSF_LIFTS||{{}})['{t}']=", rows)

# ---------- Ski areas ----------
def bounds(geom):
    if geom["type"] == "Point":
        return None
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    pts = [pt for poly in polys for ring in poly for pt in ring]
    return [r5(min(p[1] for p in pts)), r5(min(p[0] for p in pts)), r5(max(p[1] for p in pts)), r5(max(p[0] for p in pts))]


def downhill_km(stats):
    dh = (((stats or {}).get("runs") or {}).get("byActivity") or {}).get("downhill") or {}
    total = 0.0
    for v in (dh.get("byDifficulty") or {}).values():
        if isinstance(v, dict):
            total += v.get("lengthInKm") or 0
    return round(total, 1) or None


area_tiles = defaultdict(list)
n_areas = 0
for f in json.load(open(src / "ski_areas.geojson", encoding="utf-8"))["features"]:
    p, g = f["properties"], f["geometry"]
    name = p.get("name")
    if not name or p.get("status") in SKIP_STATUS:
        continue
    center = (p.get("viewportHint") or {}).get("center")
    if not center:
        if g["type"] != "Point":
            continue
        center = g["coordinates"]
    stats = p.get("statistics") or {}
    lifts = sum((stats.get("lifts") or {}).get("byType", {}).get(k, {}).get("count", 0)
                for k in (stats.get("lifts") or {}).get("byType", {}))
    row = [name, r5(center[1]), r5(center[0]), p.get("status"), ",".join(p.get("activities") or []),
           lifts or None, downhill_km(stats), r0(stats.get("minElevation")), r0(stats.get("maxElevation")),
           (p.get("websites") or [None])[0], bounds(g)]
    area_tiles[f"{math.floor(center[1] / AREA_TILE)}_{math.floor(center[0] / AREA_TILE)}"].append(row)
    n_areas += 1

for t, rows in area_tiles.items():
    write_js(out / "areas" / f"{t}.js", f"(window.CSF_SKIAREAS=window.CSF_SKIAREAS||{{}})['{t}']=", rows)

print(f"lifts {n_lifts} in {len(lift_tiles)} tiles; ski areas {n_areas} in {len(area_tiles)} tiles")
