"""Copy the map label fonts (glyph PBFs) into fonts/, so local mode needs no font server.
Source: the OpenMapTiles font release (Noto Sans, SIL Open Font License), one zip download."""
import io, os, sys, urllib.request, zipfile

URL = "https://github.com/openmaptiles/fonts/releases/download/v2.0/v2.0.zip"
STACKS = ["Noto Sans Regular", "Noto Sans Bold"]

def main(out="fonts"):
    data = urllib.request.urlopen(URL, timeout=120).read()
    z = zipfile.ZipFile(io.BytesIO(data))
    n = 0
    for name in z.namelist():
        parts = name.strip("/").split("/")
        if len(parts) >= 2 and parts[-2] in STACKS and parts[-1].endswith(".pbf"):
            d = os.path.join(out, parts[-2])
            os.makedirs(d, exist_ok=True)
            with open(os.path.join(d, parts[-1]), "wb") as f:
                f.write(z.read(name))
            n += 1
    print("glyph files", n)
    if n < 2 * 256:
        sys.exit("font set incomplete")

if __name__ == "__main__":
    main(*sys.argv[1:])
