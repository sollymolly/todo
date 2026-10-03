#!/usr/bin/env python3
"""
Switches on the 16-direction knight art as it is delivered
(docs/knight-art/SPEC.md).

Finished sheets go in public/sprites/lpc16/, at the same path as the
sheet they redraw under public/sprites/lpc/ (the `deliver_as` column of
docs/knight-art/inventory.csv). This checks each one and records it in the
sprite manifest as the layer's `hi` sheet; the game then draws that layer
in 16 directions and every layer without one in its four, so art can arrive
a few sheets at a time.

    python scripts/link-lpc16.py            # link what's there, report the rest
    python scripts/link-lpc16.py --check    # report only; change nothing

Only walk sheets are linked: the duel animations are still four-way.

A sheet is linked only if it is a PNG of exactly 576x1024 (9 columns, 16
rows of 64px). Anything else is reported and left out, so a mis-sized
sheet can't reach the game. Layers whose art has been removed lose their
`hi`. Run it again after scripts/fetch-lpc.py, which rewrites the manifest
without them.
"""

import argparse
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FRAME, COLS, ROWS = 64, 9, 16
LPC = "/sprites/lpc/"
LPC16 = "/sprites/lpc16/"


def png_size(path: Path):
    """(width, height) of a PNG, from its header, or None if it isn't one."""
    with path.open("rb") as f:
        head = f.read(24)
    if len(head) < 24 or head[:8] != b"\x89PNG\r\n\x1a\n" or head[12:16] != b"IHDR":
        return None
    return struct.unpack(">II", head[16:24])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="report only; change nothing")
    ap.add_argument("--manifest", type=Path, default=ROOT / "public/sprites/lpc/manifest.json")
    ap.add_argument("--art", type=Path, default=ROOT / "public/sprites/lpc16")
    args = ap.parse_args()

    raw = args.manifest.read_text(encoding="utf-8")
    manifest = json.loads(raw)
    linked = missing = 0
    bad: list[str] = []
    stray = {p.relative_to(args.art).as_posix() for p in args.art.rglob("*.png")} if args.art.is_dir() else set()

    for items in manifest["slots"].values():
        for spec in items.values():
            for layers in spec["bodies"].values():
                for layer in layers:
                    if not layer["src"].startswith(LPC):
                        continue
                    rel = layer["src"][len(LPC):]
                    art = args.art / rel
                    layer.pop("hi", None)
                    if not art.is_file():
                        missing += 1
                        continue
                    stray.discard(rel)
                    size = png_size(art)
                    want = (FRAME * COLS, FRAME * ROWS)
                    if size != want:
                        bad.append(f"{rel}: is {size and 'x'.join(map(str, size)) or 'not a PNG'}, needs {want[0]}x{want[1]}")
                        missing += 1
                        continue
                    layer["hi"] = LPC16 + rel
                    linked += 1

    total = linked + missing
    print(f"{linked} of {total} walk sheets have 16-direction art ({missing} still four-way)")
    for line in bad:
        print("  rejected:", line)
    for rel in sorted(stray):
        print(f"  not used (no such sheet in the manifest): {rel}")

    out = json.dumps(manifest, indent=1) + "\n"
    if args.check:
        print("(--check: manifest not changed)")
    elif out != raw:
        args.manifest.write_text(out, encoding="utf-8")
        print(f"updated {args.manifest.relative_to(ROOT) if args.manifest.is_relative_to(ROOT) else args.manifest}")
    else:
        print("manifest already up to date")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
