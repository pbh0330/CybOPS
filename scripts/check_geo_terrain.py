"""DEM sampler and terrain profile REPORT for a georeferenced scenario.

This is not a gate. It prints, it exits 0. Outage causes are authored values
(ADR-0003) and nothing here changes them; the report exists so a human can see
whether the authored story (ridge relay, valley entry) sits on the real relief.

Tiles: AWS Terrain Tiles, Terrarium PNG (elevation = R*256 + G + B/256 - 32768).
Cached under %TEMP%\\mccycop-dem so re-runs are offline.

Usage:
  python scripts/check_geo_terrain.py                         # report for tacnet-01
  python scripts/check_geo_terrain.py --scenario scenarios/tacnet-01/mission.json
  python scripts/check_geo_terrain.py --sample 5700,9600 4120,2140
"""
import argparse
import json
import math
import os
import sys
import urllib.request

from PIL import Image

TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
ZOOM = 12
CACHE = os.path.join(os.environ.get("TEMP", "."), "mccycop-dem")
_tiles = {}


def _tile(z, x, y):
    key = (z, x, y)
    if key in _tiles:
        return _tiles[key]
    os.makedirs(CACHE, exist_ok=True)
    fn = os.path.join(CACHE, f"{z}_{x}_{y}.png")
    try:
        if not os.path.exists(fn):
            urllib.request.urlretrieve(TILE_URL.format(z=z, x=x, y=y), fn)
        im = Image.open(fn).convert("RGB")
        _tiles[key] = im
        return im
    except Exception as e:
        try:
            os.remove(fn)
        except Exception:
            pass
        print(f"[skip] tile {z}/{x}/{y}: {type(e).__name__}: {e}")
        _tiles[key] = None
        return None


def elevation(lat, lon, z=ZOOM):
    n = 2 ** z
    xt = (lon + 180) / 360 * n
    lat_r = math.radians(lat)
    yt = (1 - math.log(math.tan(lat_r) + 1 / math.cos(lat_r)) / math.pi) / 2 * n
    xi, yi = int(xt), int(yt)
    im = _tile(z, xi, yi)
    if im is None:
        return float('nan')
    px = min(255, int((xt - xi) * 256))
    py = min(255, int((yt - yi) * 256))
    r, g, b = im.getpixel((px, py))
    return r * 256 + g + b / 256 - 32768


class Georef:
    """The scenario's own formula (geo.georef.formula), nothing else."""

    def __init__(self, georef):
        a = georef["anchor"]
        self.lat0, self.lon0 = float(a["lat"]), float(a["lon"])
        self.x0, self.y0 = float(a.get("x", 0)), float(a.get("y", 0))
        self.k = 111320 * math.cos(math.radians(self.lat0))

    def to_ll(self, x, y):
        return self.lat0 + (y - self.y0) / 111320, self.lon0 + (x - self.x0) / self.k


def position_at(asset, t):
    g = asset.get("geo") or {}
    if g.get("kind") == "fixed" or not g.get("segments"):
        return g.get("at")
    for s in g["segments"]:
        if s["from"] <= t < s["to"]:
            if s.get("mode") == "move" and s.get("to_at"):
                u = (t - s["from"]) / (s["to"] - s["from"]) if s["to"] > s["from"] else 0
                a, b = s["at"], s["to_at"]
                return {k: a[k] + (b[k] - a[k]) * u for k in ("x", "y", "z")}
            return s["at"]
    return None


def report(scenario_path):
    m = json.load(open(scenario_path, encoding="utf-8"))
    georef = (m.get("geo") or {}).get("georef")
    if not georef:
        print("no geo.georef in this scenario - nothing to sample")
        return
    gr = Georef(georef)
    assets = {a["id"]: a for a in m["assets"]}

    print(f"== asset z vs DEM  (anchor {gr.lat0}, {gr.lon0})")
    for a in m["assets"]:
        try:
            g = a.get("geo") or {}
            pts = [("at", g["at"])] if g.get("at") else []
            for s in g.get("segments", []):
                pts.append((f"{s['from']}-{s['to']} at", s["at"]))
                if s.get("to_at"):
                    pts.append((f"{s['from']}-{s['to']} to", s["to_at"]))
            for label, p in pts:
                try:
                    lat, lon = gr.to_ll(p["x"], p["y"])
                    dem = elevation(lat, lon)
                    dem_str = f"{dem:6.0f}" if not math.isnan(dem) else "   n/a"
                    flag = "" if math.isnan(dem) or abs(dem - p.get("z", 0)) <= 15 else "   <-- differs from DEM by >15 m"
                    print(f"  {a['id']:9s} {label:14s} x={p['x']:6.0f} y={p['y']:6.0f} z={p.get('z', 0):5.0f}  dem={dem_str}{flag}")
                except Exception as e:
                    print(f"  {a['id']:9s} {label:14s}: {type(e).__name__}: {e}")
        except Exception as e:
            print(f"[skip] {a['id']}: {type(e).__name__}: {e}")

    print("\n== terrain-caused link outages: elevation profile at the outage midpoint")
    for l in m.get("links", []):
        try:
            for o in l.get("outages", []):
                if o.get("cause") != "terrain":
                    continue
                try:
                    t = (o["from"] + o["to"]) / 2
                    pa, pb = position_at(assets[l["a"]], t), position_at(assets[l["b"]], t)
                    if not pa or not pb:
                        print(f"  {l['id']}: endpoint position undefined at t={t}")
                        continue
                    n = 40
                    ha, hb = pa["z"] + 2, pb["z"] + 2
                    blocked = 0
                    worst = 0.0
                    for i in range(1, n):
                        u = i / n
                        x, y = pa["x"] + (pb["x"] - pa["x"]) * u, pa["y"] + (pb["y"] - pa["y"]) * u
                        lat, lon = gr.to_ll(x, y)
                        ground = elevation(lat, lon)
                        los = ha + (hb - ha) * u
                        if not math.isnan(ground) and ground > los:
                            blocked += 1
                            worst = max(worst, ground - los)
                    verdict = "shadowed" if blocked else "clear"
                    print(f"  {l['id']:10s} t={t:5.1f} {l['a']}({pa['z']:.0f} m) -> {l['b']}({pb['z']:.0f} m): "
                          f"{verdict}, {blocked}/{n - 1} samples above LOS, max {worst:.0f} m   [authored: {o.get('note', '')}]")
                except Exception as e:
                    print(f"[skip] {l['id']}: {type(e).__name__}: {e}")
        except Exception as e:
            print(f"[skip] link {l.get('id', '?')}: {type(e).__name__}: {e}")
    print("\nreport only - causes are authored, this changes nothing (ADR-0003).")


def main():
    try:
        ap = argparse.ArgumentParser()
        ap.add_argument("--scenario", default=os.path.join(os.path.dirname(__file__), "..", "scenarios", "tacnet-01", "mission.json"))
        ap.add_argument("--sample", nargs="*", help='local-plane points "x,y"')
        args = ap.parse_args()
        if args.sample:
            m = json.load(open(args.scenario, encoding="utf-8"))
            gr = Georef(m["geo"]["georef"])
            for s in args.sample:
                x, y = (float(v) for v in s.split(","))
                lat, lon = gr.to_ll(x, y)
                dem = elevation(lat, lon)
                dem_str = f"{dem:.0f}" if not math.isnan(dem) else "n/a"
                print(f"x={x:.0f} y={y:.0f}  lat={lat:.5f} lon={lon:.5f}  z={dem_str}")
            return
        report(args.scenario)
    except Exception as e:
        print(f"[error] {type(e).__name__}: {e}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
