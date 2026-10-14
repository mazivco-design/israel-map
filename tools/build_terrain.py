"""Build Terrarium-encoded elevation tiles for the site from the Copernicus DEM.

Downloads the Copernicus GLO-30 DEM (public AWS Open Data bucket) for the area
around Israel, mosaics it, and writes 256 px tiles to terrain/{z}/{x}/{y}.webp
in Terrarium encoding (elevation = R*256 + G + B/256 - 32768), lossless WebP.

Runs in GitHub Actions (see .github/workflows/build-terrain.yml).
Local test: python tools/build_terrain.py --local some_dem.tif --maxzoom 9
"""
import argparse, math, os, sys, urllib.request
import numpy as np
import mercantile, rasterio
from rasterio.merge import merge
from rasterio.warp import reproject, Resampling
from rasterio.transform import from_bounds
from PIL import Image

BBOX = (34.0, 29.3, 36.2, 33.6)          # west, south, east, north
URL = ("https://copernicus-dem-30m.s3.amazonaws.com/"
       "Copernicus_DSM_COG_10_{lat}_00_{lon}_00_DEM/Copernicus_DSM_COG_10_{lat}_00_{lon}_00_DEM.tif")


def download(cache):
    os.makedirs(cache, exist_ok=True)
    paths = []
    for la in range(math.floor(BBOX[1]), math.ceil(BBOX[3])):
        for lo in range(math.floor(BBOX[0]), math.ceil(BBOX[2])):
            lat, lon = f"N{la:02d}", f"E{lo:03d}"
            out = os.path.join(cache, f"{lat}_{lon}.tif")
            if not os.path.exists(out):
                url = URL.format(lat=lat, lon=lon)
                try:
                    urllib.request.urlretrieve(url, out)
                except Exception as e:          # all-sea tiles do not exist
                    print("skip", lat, lon, e)
                    continue
            paths.append(out)
            print("have", out)
    return paths


def encode(elev):
    # rounded to whole meters (the DEM's own accuracy is a few meters); B stays 0, which compresses far better
    v = np.round(np.nan_to_num(elev, nan=0.0)) + 32768.0
    v = np.clip(v, 0, 65535)
    r = np.floor(v / 256)
    g = v - r * 256
    b = np.zeros_like(v)
    return np.dstack([r, g, b]).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--local", nargs="*", help="use these DEM files instead of downloading")
    ap.add_argument("--out", default="terrain")
    ap.add_argument("--cache", default=".dem-cache")
    ap.add_argument("--maxzoom", type=int, default=12)
    a = ap.parse_args()

    paths = a.local or download(a.cache)
    if not paths:
        sys.exit("no DEM data")
    srcs = [rasterio.open(p) for p in paths]
    nod = srcs[0].nodata
    mosaic, transform = merge(srcs, nodata=nod)
    dem = mosaic[0].astype(np.float32)
    if nod is not None:
        dem[dem == nod] = np.nan
    dem[(dem < -1000) | (dem > 9000)] = np.nan
    crs = srcs[0].crs
    print("mosaic", dem.shape)

    n = 0
    for tile in mercantile.tiles(*BBOX, zooms=list(range(0, a.maxzoom + 1))):
        b = mercantile.xy_bounds(tile)
        dst = np.full((256, 256), np.nan, dtype=np.float32)
        reproject(dem, dst, src_transform=transform, src_crs=crs, src_nodata=np.nan,
                  dst_transform=from_bounds(b.left, b.bottom, b.right, b.top, 256, 256),
                  dst_crs="EPSG:3857", dst_nodata=np.nan,
                  resampling=Resampling.average if tile.z < 11 else Resampling.bilinear)
        d = os.path.join(a.out, str(tile.z), str(tile.x))
        os.makedirs(d, exist_ok=True)
        Image.fromarray(encode(dst)).save(os.path.join(d, f"{tile.y}.webp"), "WEBP", lossless=True, method=4)
        n += 1
    print("tiles", n)


if __name__ == "__main__":
    main()
