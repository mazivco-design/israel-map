"""Whole numbered roads, one feature per road number, for the "tap a road" highlight.

The map tiles keep a road's number only on some pieces at some zoom levels, so a highlight
taken from the tiles has gaps. This collects every piece of every numbered road from the
site's own map file (map/israel.pmtiles, layer transportation_name, zoom 12), joins them
per road number and writes roads.geojson (loaded by the site the first time a road is tapped).

Run: python tools/build_roads.py        (needs: pip install pmtiles mapbox-vector-tile shapely)
"""
import gzip, json, math
from collections import defaultdict
import mapbox_vector_tile, mercantile
from pmtiles.reader import Reader, MmapSource
from shapely.geometry import LineString, MultiLineString, mapping
from shapely.ops import linemerge, unary_union

Z = 12
BBOX = (34.0, 29.3, 36.2, 33.6)
RANK = {"motorway": 0, "trunk": 1, "primary": 2, "secondary": 3, "tertiary": 4}


def one_carriageway(g, near=0.0007, min_km=0.25):
    """A divided road comes as two parallel lines (plus ramps). Keep the longer line of each pair and drop
    pieces that run alongside something already kept, so the road reads as one centreline for the
    elevation profile and the flight. `near` ~70 m in degrees."""
    lines = sorted(g.geoms, key=lambda l: -l.length)
    kept = []
    for l in lines:
        if l.length * 111 < min_km:                      # ramps and links
            continue
        if kept:
            k = unary_union(kept).buffer(near)
            if l.intersection(k).length > 0.6 * l.length:   # mostly alongside a kept line: the other carriageway
                continue
        kept.append(l)
    return MultiLineString(kept) if kept else MultiLineString([lines[0]])


def main():
    f = open("map/israel.pmtiles", "rb")
    rd = Reader(MmapSource(f))
    pieces, cls = defaultdict(list), {}
    n = 0
    for t in mercantile.tiles(*BBOX, zooms=[Z]):
        data = rd.get(Z, t.x, t.y)
        if not data:
            continue
        if data[:2] == b"\x1f\x8b":
            data = gzip.decompress(data)
        layer = mapbox_vector_tile.decode(data, default_options={"y_coord_down": True}).get("transportation_name")
        if not layer:
            continue
        b = mercantile.bounds(t)
        ext = layer.get("extent", 4096)
        n0, n1 = math.radians(b.north), math.radians(b.south)
        y0, y1 = math.log(math.tan(math.pi / 4 + n0 / 2)), math.log(math.tan(math.pi / 4 + n1 / 2))
        def ll(px, py):
            lon = b.west + (b.east - b.west) * px / ext
            lat = math.degrees(2 * math.atan(math.exp(y0 + (y1 - y0) * py / ext)) - math.pi / 2)
            return round(lon, 6), round(lat, 6)
        for ft in layer["features"]:
            p = ft["properties"]
            ref = str(p.get("ref") or "").strip()
            if not ref or len(ref) > 6:
                continue
            g = ft["geometry"]
            lines = [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"] if g["type"] == "MultiLineString" else []
            for ln in lines:
                if len(ln) >= 2:
                    pieces[ref].append(LineString([ll(*c) for c in ln]))
                    n += 1
            c = p.get("class", "")
            if RANK.get(c, 9) < RANK.get(cls.get(ref, ""), 9):
                cls[ref] = c
    feats = []
    for ref, ls in pieces.items():
        u = unary_union(ls)
        g = linemerge(u) if u.geom_type == "MultiLineString" else u
        if g.is_empty:
            continue
        if isinstance(g, LineString):
            g = MultiLineString([g])
        g = one_carriageway(g).simplify(0.00008)   # ~8 m
        if isinstance(g, LineString):
            g = MultiLineString([g])
        geom = mapping(g)
        geom["coordinates"] = [[[round(x, 5), round(y, 5)] for x, y in line] for line in geom["coordinates"]]
        feats.append({"type": "Feature", "properties": {"ref": ref, "class": cls.get(ref, "")}, "geometry": geom})
    feats.sort(key=lambda f: (RANK.get(f["properties"]["class"], 9), f["properties"]["ref"]))
    json.dump({"type": "FeatureCollection", "features": feats}, open("roads.geojson", "w"), separators=(",", ":"))
    print(len(feats), "roads from", n, "pieces")


if __name__ == "__main__":
    main()
