"""Small landform regions (craters, valleys, single mountains) traced from the site's own elevation tiles.

Each region is found from the terrain itself, with a rough hand-drawn "clip" polygon only
where the terrain gives no edge (a crater's outlet canyon, a valley that opens into a plain):
  crater  - floor enclosed by a ring of cliffs (slope above `smin` degrees)
  below   - ground lower than `level` meters, connected to the seed point (valleys, basins)
  above   - ground higher than `level` meters, connected to the seed point (single mountains)
Points of interest (too small to outline) are listed in POIS.

Output: subregions.geojson (polygons + points), properties id, name, kind, area (km², polygons), lx, ly (label).
Run: python tools/build_subregions.py
"""
import json, math, os
import numpy as np, mercantile, rasterio.features
from PIL import Image, ImageDraw
from scipy import ndimage
from shapely.geometry import shape, mapping, Point
from shapely.ops import transform, unary_union

Z = 12
TERRAIN = "terrain"

REGIONS = [
    dict(id="s_ramon", name="מכתש רמון", kind="crater", seed=(34.87, 30.61), smin=16,
         clip=[(34.60, 30.50), (34.72, 30.53), (34.80, 30.54), (34.88, 30.545), (34.96, 30.55), (35.01, 30.57),
               (35.0, 30.66), (34.99, 30.72), (34.80, 30.72), (34.60, 30.60)]),
    dict(id="s_gadol", name="המכתש הגדול", kind="crater", seed=(34.97, 30.93), smin=16,
         clip=[(34.86, 30.85), (34.86, 30.88), (34.97, 31.005), (35.02, 31.0), (35.05, 30.95), (35.04, 30.90),
               (35.02, 30.88), (34.95, 30.86)]),
    dict(id="s_katan", name="המכתש הקטן", kind="crater", seed=(35.19, 30.955), smin=16,
         clip=[(35.165, 30.93), (35.17, 30.985), (35.195, 30.995), (35.215, 30.985), (35.22, 30.94), (35.205, 30.925)]),
    dict(id="s_zin", name="בקעת צין", kind="below", seed=(34.95, 30.84), level=460,
         clip=[(34.74, 30.75), (34.74, 30.88), (35.08, 30.91), (35.12, 30.88), (35.06, 30.80), (35.0, 30.75)]),
    dict(id="s_netofa", name="בקעת בית נטופה", kind="below", seed=(35.32, 32.805), level=170,
         clip=[(35.22, 32.795), (35.22, 32.85), (35.43, 32.85), (35.43, 32.78), (35.31, 32.785)]),
    dict(id="s_tabor", name="הר תבור", kind="above", seed=(35.39, 32.687), level=250,
         clip=[(35.35, 32.66), (35.35, 32.71), (35.43, 32.71), (35.43, 32.66)]),
]
POIS = [
    dict(id="p_gamal", name="הר גמל", kind="poi", at=(34.7966, 30.6038), note="תצפית על מכתש רמון"),
]


def load(w, s, e, n):
    tl, br = mercantile.tile(w, n, Z), mercantile.tile(e, s, Z)
    H = np.zeros(((br.y - tl.y + 1) * 256, (br.x - tl.x + 1) * 256), np.float32)
    for x in range(tl.x, br.x + 1):
        for y in range(tl.y, br.y + 1):
            f = f"{TERRAIN}/{Z}/{x}/{y}.webp"
            if os.path.exists(f):
                a = np.asarray(Image.open(f).convert("RGB"), np.float32)
                H[(y - tl.y) * 256:(y - tl.y + 1) * 256, (x - tl.x) * 256:(x - tl.x + 1) * 256] = a[..., 0] * 256 + a[..., 1] - 32768
    return H, (tl.x, tl.y)


def grid(o):
    n = 2 ** Z * 256
    to_px = lambda lon, lat: ((lon + 180) / 360 * n - o[0] * 256,
                              (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n - o[1] * 256)
    to_ll = lambda c, r: ((o[0] * 256 + c) / n * 360 - 180, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (o[1] * 256 + r) / n)))))
    return to_px, to_ll


def region_mask(R, H, to_px):
    im = Image.new("L", (H.shape[1], H.shape[0]), 0)
    ImageDraw.Draw(im).polygon([to_px(*p) for p in R["clip"]], fill=1)
    clip = np.array(im, bool)
    c, r = (int(v) for v in to_px(*R["seed"]))
    def comp(M):
        lab, _ = ndimage.label(M)
        return lab == lab[r, c] if lab[r, c] else None
    if R["kind"] == "crater":
        mpp = 40075016.686 / (2 ** Z * 256) * math.cos(math.radians(R["seed"][1]))
        gy, gx = np.gradient(H, mpp)
        cliff = ndimage.binary_dilation(np.degrees(np.arctan(np.hypot(gx, gy))) > R["smin"], iterations=2)
        M = comp(~cliff & clip)
        M = ndimage.binary_dilation(M, iterations=3) & clip          # out to the foot of the cliffs
        return ndimage.binary_fill_holes(ndimage.binary_closing(M, iterations=4))
    if R["kind"] == "below":
        M = comp(ndimage.binary_opening((H < R["level"]) & clip, iterations=3))
        return ndimage.binary_fill_holes(ndimage.binary_closing(M, iterations=3))
    return ndimage.binary_fill_holes(comp((H > R["level"]) & clip))


def km2(geom):
    lat0 = geom.centroid.y
    return transform(lambda x, y: (np.asarray(x) * 111.32 * math.cos(math.radians(lat0)), np.asarray(y) * 110.57), geom).area


def main():
    feats = []
    for R in REGIONS:
        xs, ys = [p[0] for p in R["clip"]], [p[1] for p in R["clip"]]
        H, o = load(min(xs) - .02, min(ys) - .02, max(xs) + .02, max(ys) + .02)
        to_px, to_ll = grid(o)
        M = region_mask(R, H, to_px)
        polys = [shape(g) for g, v in rasterio.features.shapes(M.astype(np.uint8), mask=M) if v]
        g = unary_union(polys)
        g = transform(np.vectorize(to_ll), g)                     # pixel -> lon/lat
        g = g.buffer(0.0004).buffer(-0.0004).simplify(0.00025)     # smooth the pixel steps (~40 m)
        if g.geom_type == "MultiPolygon":
            g = max(g.geoms, key=lambda p: p.area)
        lp = g.representative_point()
        props = {"id": R["id"], "name": R["name"], "kind": R["kind"], "area": round(km2(g), 1),
                 "bbox": [round(v, 4) for v in g.bounds], "lx": round(lp.x, 4), "ly": round(lp.y, 4)}
        print(R["name"], props["area"], "km²")
        feats.append({"type": "Feature", "properties": props, "geometry": json.loads(json.dumps(mapping(g)))})
    for P in POIS:
        feats.append({"type": "Feature", "properties": {"id": P["id"], "name": P["name"], "kind": "poi", "note": P["note"],
                      "lx": P["at"][0], "ly": P["at"][1]}, "geometry": mapping(Point(P["at"]))})
    def rnd(x):
        return [rnd(v) for v in x] if isinstance(x, (list, tuple)) else round(x, 5) if isinstance(x, float) else x
    for f in feats:
        f["geometry"]["coordinates"] = rnd(f["geometry"]["coordinates"])
    json.dump({"type": "FeatureCollection", "features": feats}, open("subregions.geojson", "w"), ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
