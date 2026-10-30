"""Build the static flight data the site loads.

Inputs (download first, see README):
  t6.json       US DOT Consumer Airfare Report, Table 6 (data.transportation.gov, yj5y-b2ir), last 4 quarters
  t1a.json      US DOT Consumer Airfare Report, Table 1a (data.transportation.gov, tfrh-tu9e), airport columns
  airports.csv  OurAirports (public domain), https://davidmegginson.github.io/ourairports-data/airports.csv

Outputs:
  data/cities.js            US DOT city markets (airports + coordinates)
  data/fares/<city id>.js   Typical one-way fares for every route touching that city
  data/airports/<tile>.js   Airports with scheduled service, in 10-degree lat/lon tiles

Usage: python tools/build_airfares.py <input_dir> <output_dir>
"""
import csv
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

src, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)

# ---------- Airports ----------
airports = {}
world = []
with open(src / "airports.csv", encoding="utf-8") as f:
    for r in csv.DictReader(f):
        code = r["iata_code"].strip()
        if not code or r["scheduled_service"] != "yes":
            continue
        if r["type"] not in ("large_airport", "medium_airport", "small_airport"):
            continue
        a = {
            "c": code, "n": r["name"], "lat": round(float(r["latitude_deg"]), 4), "lon": round(float(r["longitude_deg"]), 4),
            "cc": r["iso_country"], "reg": r["iso_region"], "city": r["municipality"],
            "t": {"large_airport": 3, "medium_airport": 2, "small_airport": 1}[r["type"]],
        }
        airports[code] = a
        # Small airports only for the US, where DOT fares can still apply
        if a["t"] >= 2 or a["cc"] == "US":
            world.append([a["c"], a["n"], a["lat"], a["lon"], a["cc"], a["t"]])

# ---------- City markets -> airports ----------
t6 = json.load(open(src / "t6.json"))
t1a = json.load(open(src / "t1a.json"))

market_airports = defaultdict(set)
market_name = {}
for r in t1a:
    for i in ("1", "2"):
        market_airports[r[f"citymarketid_{i}"]].add(r[f"airport_{i}"])
        market_name[r[f"citymarketid_{i}"]] = r[f"city{i}"]
for r in t6:
    for i in ("1", "2"):
        market_name[r[f"citymarketid_{i}"]] = r[f"city{i}"]

by_city = defaultdict(list)
for a in airports.values():
    if a["cc"] == "US":
        by_city[(a["city"].lower(), a["reg"])].append(a["c"])

def norm(s):
    return re.sub(r"\bsaint\b", "st", s.lower().replace(".", "")).strip()

def name_matches(market):
    m = re.match(r"^(.*?),\s*([A-Z]{2})", market_name[market])
    if not m:
        return set()
    names, st = m.group(1), m.group(2)
    parts = [p.strip() for p in re.split(r"/|-", names) if p.strip()]
    found = set()
    for n in parts:
        found.update(by_city.get((n.lower(), f"US-{st}"), []))
    if not found:
        # Looser pass: the city name appears in the airport's town or name (e.g. "Wilkes-Barre/Scranton Intl")
        for a in airports.values():
            if a["reg"] == f"US-{st}" and a["t"] >= 1 and any(
                    norm(n) and (norm(n) in norm(a["city"]) or norm(n) in norm(a["n"])) for n in parts):
                found.add(a["c"])
    return found

cities = {}
unmatched = []
for mid in market_name:
    codes = {c for c in market_airports.get(mid, set()) | name_matches(mid) if c in airports}
    if not codes:
        unmatched.append(market_name[mid])
        continue
    pts = [airports[c] for c in codes]
    cities[mid] = {
        "n": re.sub(r"\s*\(Metropolitan Area\)", "", market_name[mid]),
        "ap": sorted(codes, key=lambda c: -airports[c]["t"]),
        "lat": round(sum(p["lat"] for p in pts) / len(pts), 4),
        "lon": round(sum(p["lon"] for p in pts) / len(pts), 4),
    }

# ---------- Fares per city pair ----------
fares = defaultdict(lambda: {"q": []})
for r in t6:
    a, b = sorted([r["citymarketid_1"], r["citymarketid_2"]])
    if a not in cities or b not in cities:
        continue
    p = fares[f"{a}-{b}"]
    p["mi"] = int(r["nsmiles"])
    p["q"].append([f"{r['year']}Q{r['quarter']}", round(float(r["fare"])), round(float(r["fare_low"])),
                   r["carrier_low"], round(float(r["passengers"]))])
for p in fares.values():
    p["q"].sort()

quarters = sorted({f"{r['year']}Q{r['quarter']}" for r in t6})

import math
import shutil

def write_js(path, statement_prefix, obj):
    # Shipped as small scripts that register data on a global, so they load with a <script> tag anywhere
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(statement_prefix)
        json.dump(obj, f, separators=(",", ":"), ensure_ascii=False)
        f.write(";\n")

for d in ("fares", "airports"):
    shutil.rmtree(out / d, ignore_errors=True)

# Index of city markets (small; loaded first)
write_js(out / "cities.js", "window.CSF_CITIES=", {
    "source": "US DOT Consumer Airfare Report, Table 6 (data.transportation.gov dataset yj5y-b2ir)",
    "note": "Average one-way fares; q rows are [quarter, average fare, lowest-fare carrier's average, that carrier, passengers/day]",
    "quarters": quarters,
    "cities": cities,
})

# One file per city: every route that touches it, keyed by the other city's id
per_city = defaultdict(dict)
for key, p in fares.items():
    a, b = key.split("-")
    per_city[a][b] = p
    per_city[b][a] = p
for cid, routes in per_city.items():
    write_js(out / "fares" / f"{cid}.js", f"(window.CSF_FARES=window.CSF_FARES||{{}})['{cid}']=", routes)

# Airports in 10-degree tiles, so the page only loads the tiles near a trip
TILE = 10
tiles = defaultdict(list)
for a in world:
    tiles[f"{math.floor(a[2] / TILE)}_{math.floor(a[3] / TILE)}"].append(a)
for t, items in tiles.items():
    write_js(out / "airports" / f"{t}.js", f"(window.CSF_AP=window.CSF_AP||{{}})['{t}']=", items)

print(f"quarters {quarters}; cities {len(cities)} (unmatched {len(unmatched)}); pairs {len(fares)}; airports {len(world)} in {len(tiles)} tiles")
print("unmatched sample:", unmatched[:15])
