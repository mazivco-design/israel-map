"""Precompute cast-shadow masks for the sun layer.

Reads the site's own elevation tiles (terrain/11/*/*.webp, Terrarium encoding),
stitches them into one Web-Mercator grid, and for each half hour of the day
works out where the sun is and which pixels are hidden from it by terrain
(a ray is walked from every pixel toward the sun; if the ground rises above
the ray anywhere, the pixel is in shadow).

Output, per date (stage 1: June 21 only):
  shadows/<MMDD>/<HHMM>-n.png, <HHMM>-s.png   north and south halves (each ≤4096 px tall,
                                             the safe WebGL texture size); 2-color PNG, black = shadow
  shadows/manifest.json                       bounds, frames, sun azimuth/altitude per frame

Run: python tools/build_shadows.py            (takes a few minutes)
"""
import json, math, os, sys, datetime as dt
import numpy as np, mercantile
from scipy import ndimage
from PIL import Image

Z = 11
TERRAIN = "terrain"
OUT = "shadows"
TZ = 3                      # Israel summer time (IDT) = UTC+3
DATES = [(6, 21)]           # stage 1
YEAR = 2026
CENTER = (35.0, 31.5)       # sun position is taken here (the difference across Israel is a few minutes of time)
STEP_MIN = 30
BIAS = 3.0                  # meters; ignores small bumps (the DEM is a surface model with buildings and trees)
KMIN = 3                    # occluders closer than ~3 pixels are left to the slope shading (hillshade) on the site
SMOOTH = 1.2                # gaussian blur of the DEM (pixels) before the test, against surface-model noise


def load_dem():
    cols = sorted(int(x) for x in os.listdir(f"{TERRAIN}/{Z}"))
    rows = sorted({int(f[:-5]) for c in cols for f in os.listdir(f"{TERRAIN}/{Z}/{c}")})
    x0, y0 = cols[0], rows[0]
    H = np.zeros(((rows[-1] - y0 + 1) * 256, (cols[-1] - x0 + 1) * 256), np.float32)
    for c in cols:
        for f in os.listdir(f"{TERRAIN}/{Z}/{c}"):
            r = int(f[:-5])
            a = np.asarray(Image.open(f"{TERRAIN}/{Z}/{c}/{f}").convert("RGB"), np.float32)
            H[(r - y0) * 256:(r - y0 + 1) * 256, (c - x0) * 256:(c - x0 + 1) * 256] = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
    nw = mercantile.bounds(x0, y0, Z)
    se = mercantile.bounds(cols[-1], rows[-1], Z)
    return H, (nw.west, se.south, se.east, nw.north), y0


def sun(date_utc, lon, lat):
    """Solar azimuth (deg clockwise from north) and altitude (deg), NOAA formulas."""
    doy = date_utc.timetuple().tm_yday
    hour = date_utc.hour + date_utc.minute / 60
    g = 2 * math.pi / 365 * (doy - 1 + (hour - 12) / 24)
    eqt = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g) - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))
    dec = (0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g) - 0.006758 * math.cos(2 * g)
           + 0.000907 * math.sin(2 * g) - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g))
    tst = hour * 60 + eqt + 4 * lon
    ha = math.radians(tst / 4 - 180)
    la = math.radians(lat)
    cz = math.sin(la) * math.sin(dec) + math.cos(la) * math.cos(dec) * math.cos(ha)
    zen = math.acos(max(-1, min(1, cz)))
    az = math.degrees(math.atan2(math.sin(ha), math.cos(ha) * math.sin(la) - math.tan(dec) * math.cos(la))) + 180
    return az % 360, 90 - math.degrees(zen)


def shadow(H, mpp, az, alt):
    """Boolean mask of pixels shaded by terrain. mpp: meters per pixel for each row."""
    t = math.tan(math.radians(alt))
    dx, dy = math.sin(math.radians(az)), -math.cos(math.radians(az))
    relief = float(np.nanmax(H) - np.nanmin(H))
    kmax = int(relief / (mpp.min() * t)) + 1
    S = np.zeros(H.shape, bool)
    h, w = H.shape
    last = None
    for k in range(KMIN, kmax + 1):
        ox, oy = int(round(k * dx)), int(round(k * dy))
        if (ox, oy) == last:       # same pixel as the previous step, already tested with a lower ray
            continue
        last = (ox, oy)
        if abs(ox) >= w or abs(oy) >= h:
            break
        # target = pixel being tested, src = the pixel k steps toward the sun
        ty, sy = (slice(0, h - oy), slice(oy, h)) if oy >= 0 else (slice(-oy, h), slice(0, h + oy))
        tx, sx = (slice(0, w - ox), slice(ox, w)) if ox >= 0 else (slice(-ox, w), slice(0, w + ox))
        ray = H[ty, tx] + (k * t) * mpp[ty][:, None] + BIAS
        S[ty, tx] |= H[sy, sx] > ray
    # drop single-pixel specks
    return ndimage.binary_opening(S, np.ones((2, 2), bool))


def save(mask, path):
    im = Image.fromarray(np.where(mask, 1, 0).astype(np.uint8), "P")
    im.putpalette([0, 0, 0, 0, 0, 0])
    im.save(path, optimize=True, transparency=0)   # index 0 = clear, index 1 = black shadow


def main():
    H, (W, S_, E, N), y0 = load_dem()
    h, w = H.shape
    print("dem", H.shape, H.min(), H.max())
    H = ndimage.gaussian_filter(H, SMOOTH).astype(np.float32)
    # meters per pixel for each row (Mercator: same in x and y, shrinks with cos(latitude))
    n = 2 ** Z * 256
    lat = np.degrees(np.arctan(np.sinh(math.pi * (1 - 2 * (y0 * 256 + np.arange(h) + .5) / n))))
    mpp = (40075016.686 / n * np.cos(np.radians(lat))).astype(np.float32)
    half = h // 2
    west_cut = int(round((34.0 - W) / (E - W) * w)) + 2
    lat_mid = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y0 * 256 + half) / n))))
    os.makedirs(OUT, exist_ok=True)
    man = {"bounds": [W, S_, E, N], "split": lat_mid, "tz": TZ, "dates": {}}
    for mo, da in DATES:
        key = f"{mo:02d}{da:02d}"
        os.makedirs(f"{OUT}/{key}", exist_ok=True)
        frames = []
        for minute in range(0, 24 * 60, STEP_MIN):
            t = dt.datetime(YEAR, mo, da, minute // 60, minute % 60) - dt.timedelta(hours=TZ)
            az, alt = sun(t, *CENTER)
            if alt < 2:            # sun (nearly) down: no frame
                continue
            name = f"{minute // 60:02d}{minute % 60:02d}"
            m = shadow(H, mpp, az, alt)
            m[:, :west_cut] = False      # west of 34°E the DEM has no data (a false cliff in Sinai)
            save(m[:half], f"{OUT}/{key}/{name}-n.png")
            save(m[half:], f"{OUT}/{key}/{name}-s.png")
            frames.append({"t": f"{minute // 60:02d}:{minute % 60:02d}", "f": name, "az": round(az, 1), "alt": round(alt, 1)})
            print(key, name, f"az={az:.0f} alt={alt:.1f} shade={m.mean():.2%}", flush=True)
        man["dates"][key] = frames
    json.dump(man, open(f"{OUT}/manifest.json", "w"), separators=(",", ":"))


if __name__ == "__main__":
    main()
