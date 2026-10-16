"""Marked hiking trails of Israel, for the site's trail search (works offline, no outside service).

Reads an OpenStreetMap extract (.osm.pbf), takes every route relation with route=hiking or
route=foot, joins its ways into lines and writes:
  trails/index.json      one small entry per trail: id, name, colour, length (km), bounding box
  trails/<id>.json       the trail's lines (loaded only when the trail is picked)

Run (GitHub Actions does this, see .github/workflows/build-trails.yml):
  python tools/build_trails.py israel-and-palestine-latest.osm.pbf trails
Needs: pip install osmium shapely
"""
import json, math, os, sys
import osmium
from shapely.geometry import LineString, MultiLineString, mapping
from shapely.ops import linemerge, unary_union

BBOX = (34.2, 29.4, 35.95, 33.45)          # keep trails whose middle is in this box
COLORS = {"red", "blue", "green", "black", "orange", "yellow", "purple", "white", "brown"}


class Routes(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.routes, self.need = {}, set()

    def relation(self, r):
        if r.tags.get("route") not in ("hiking", "foot"):
            return
        ways = [m.ref for m in r.members if m.type == "w"]
        if not ways:
            return
        self.routes[r.id] = {"tags": {k: r.tags.get(k) for k in ("name", "name:he", "name:en", "osmc:symbol", "colour", "ref") if r.tags.get(k)},
                             "ways": ways}
        self.need.update(ways)


class Ways(osmium.SimpleHandler):
    def __init__(self, need):
        super().__init__()
        self.need, self.geom = need, {}

    def way(self, w):
        if w.id in self.need:
            try:
                self.geom[w.id] = [(n.lon, n.lat) for n in w.nodes]
            except osmium.InvalidLocationError:
                pass


def color_of(t):
    name = t.get("name:he") or t.get("name") or ""
    if "שביל ישראל" in name or "israel national trail" in (t.get("name:en") or "").lower():
        return "orange"
    c = (t.get("osmc:symbol") or "").split(":")[0].lower() or (t.get("colour") or "").lower()
    return c if c in COLORS else ""


def km(g):
    d = 0
    for line in g.geoms:
        c = list(line.coords)
        for (x1, y1), (x2, y2) in zip(c, c[1:]):
            d += math.hypot((x2 - x1) * math.cos(math.radians((y1 + y2) / 2)) * 111.32, (y2 - y1) * 110.57)
    return d


def main(pbf, out):
    r = Routes()
    r.apply_file(pbf)
    print("routes", len(r.routes), "ways needed", len(r.need), flush=True)
    w = Ways(r.need)
    w.apply_file(pbf, locations=True)
    os.makedirs(out, exist_ok=True)
    for f in os.listdir(out):
        os.remove(os.path.join(out, f))
    index = []
    for rid, R in r.routes.items():
        t = R["tags"]
        name = t.get("name:he") or t.get("name") or t.get("name:en")
        lines = [LineString(w.geom[i]) for i in R["ways"] if i in w.geom and len(w.geom[i]) > 1]
        if not name or not lines:
            continue
        g = linemerge(unary_union(lines))
        g = g if g.geom_type == "MultiLineString" else MultiLineString([g]) if g.geom_type == "LineString" else None
        if g is None:
            continue
        g = g.simplify(0.00005)                              # ~5 m
        if g.geom_type == "LineString":
            g = MultiLineString([g])
        x0, y0, x1, y1 = g.bounds
        if not (BBOX[0] <= (x0 + x1) / 2 <= BBOX[2] and BBOX[1] <= (y0 + y1) / 2 <= BBOX[3]):
            continue
        coords = [[[round(x, 5), round(y, 5)] for x, y in line.coords] for line in g.geoms]
        json.dump({"type": "MultiLineString", "coordinates": coords}, open(f"{out}/{rid}.json", "w"), separators=(",", ":"))
        e = {"id": rid, "n": name, "km": round(km(g), 1), "b": [round(v, 4) for v in (x0, y0, x1, y1)]}
        if t.get("name:en") and t.get("name:en") != name:
            e["en"] = t["name:en"]
        c = color_of(t)
        if c:
            e["c"] = c
        index.append(e)
    index.sort(key=lambda e: -e["km"])
    json.dump(index, open(f"{out}/index.json", "w"), ensure_ascii=False, separators=(",", ":"))
    print("trails", len(index))


if __name__ == "__main__":
    main(*sys.argv[1:3])
