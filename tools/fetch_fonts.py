"""Copy the map label fonts (glyph PBFs) used by the site into fonts/, so local mode needs no font server.
Source: OpenFreeMap's font set (OpenMapTiles fonts, Noto Sans, OFL licensed)."""
import os, sys, time, urllib.parse, urllib.request

STACKS = ["Noto Sans Regular", "Noto Sans Bold"]
SRC = "https://tiles.openfreemap.org/fonts/{stack}/{start}-{end}.pbf"

def main(out="fonts"):
    n = 0
    for stack in STACKS:
        d = os.path.join(out, stack)
        os.makedirs(d, exist_ok=True)
        for start in range(0, 65536, 256):
            end = start + 255
            url = SRC.format(stack=urllib.parse.quote(stack), start=start, end=end)
            for attempt in range(4):
                try:
                    data = urllib.request.urlopen(url, timeout=30).read()
                    break
                except Exception as e:
                    if attempt == 3:
                        sys.exit(f"failed {url}: {e}")
                    time.sleep(2 + attempt * 3)
            with open(os.path.join(d, f"{start}-{end}.pbf"), "wb") as f:
                f.write(data)
            n += 1
    print("glyph ranges", n)

if __name__ == "__main__":
    main(*sys.argv[1:])
