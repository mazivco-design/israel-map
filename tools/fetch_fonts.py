"""Copy the map label fonts (glyph PBFs) used by the site into fonts/, so local mode needs no font server.
Source: OpenFreeMap's font set (OpenMapTiles fonts, Noto Sans, OFL licensed)."""
import os, sys, time, urllib.error, urllib.parse, urllib.request

STACKS = ["Noto Sans Regular", "Noto Sans Bold"]
SRC = "https://tiles.openfreemap.org/fonts/{stack}/{start}-{end}.pbf"

def main(out="fonts"):
    n = missing = failed = 0
    for stack in STACKS:
        d = os.path.join(out, stack)
        os.makedirs(d, exist_ok=True)
        for start in range(0, 65536, 256):
            end = start + 255
            url = SRC.format(stack=urllib.parse.quote(stack), start=start, end=end)
            data = b""   # an empty glyph file is valid: MapLibre treats the range as having no characters
            for attempt in range(4):
                try:
                    data = urllib.request.urlopen(url, timeout=30).read()
                    break
                except urllib.error.HTTPError as e:
                    if e.code == 404:
                        missing += 1
                        break
                    time.sleep(2 + attempt * 3)
                except Exception:
                    time.sleep(2 + attempt * 3)
            else:
                failed += 1
            with open(os.path.join(d, f"{start}-{end}.pbf"), "wb") as f:
                f.write(data)
            n += 1
    print("glyph ranges", n, "missing", missing, "failed", failed)
    if failed > 20:
        sys.exit("too many failed downloads")

if __name__ == "__main__":
    main(*sys.argv[1:])
