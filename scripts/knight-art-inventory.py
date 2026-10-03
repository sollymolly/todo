#!/usr/bin/env python3
"""
Lists every knight sprite sheet that needs redrawing in 16 directions
(docs/knight-art/SPEC.md), straight from the sprite manifest, so the list
can't drift from what the game actually layers.

    python scripts/knight-art-inventory.py

Writes docs/knight-art/inventory.csv: one row per sheet to deliver, with
where it goes, what it's for, its frame size, columns, and the colour ramp
it must be painted in (blank: free colours).
"""

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "public/sprites/lpc/manifest.json"
OUT = ROOT / "docs/knight-art/inventory.csv"

COLS = {"walk": 9, "slash": 6, "thrust": 8}
# Sheets with no dyeKind still have a fixed ramp to keep: skin and hair.
FIXED = {"base": "body", "hair": "hair"}


def main() -> None:
    m = json.loads(MANIFEST.read_text(encoding="utf-8"))
    sheets: dict[str, dict] = {}

    def add(slot: str, item: str, name: str, anim: str, body: str, layer: dict) -> None:
        row = sheets.setdefault(
            layer["src"],
            {
                "slot": slot,
                "items": set(),
                "names": set(),
                "bodies": set(),
                "anim": anim,
                "z": layer["z"],
                "frame": layer.get("frame", m["frame"]),
                "family": layer.get("dyeKind") or (FIXED.get(slot) if layer.get("baseRamp") else ""),
                "ramp": layer.get("baseRamp") or "",
            },
        )
        row["items"].add(item)
        row["names"].add(name)
        row["bodies"].add(body)

    for slot, items in m["slots"].items():
        for item, spec in items.items():
            for body, layers in spec["bodies"].items():
                for layer in layers:
                    add(slot, item, spec["name"], "walk", body, layer)
            for anim, bodies in (spec.get("anims") or {}).items():
                for body, layers in bodies.items():
                    for layer in layers:
                        add(slot, item, spec["name"], anim, body, layer)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["deliver_as", "replaces", "slot", "items", "bodies", "anim", "z", "frame_px", "columns", "rows", "sheet_px", "palette_family", "base_ramp"])
        for src, r in sorted(sheets.items(), key=lambda kv: (kv[1]["slot"], kv[0])):
            cols = COLS[r["anim"]]
            frame = r["frame"]
            w.writerow([
                src.replace("/sprites/lpc/", "/sprites/lpc16/", 1),
                src,
                r["slot"],
                " ".join(sorted(r["items"])),
                " ".join(sorted(r["bodies"])),
                r["anim"],
                r["z"],
                frame,
                cols,
                16,
                f"{frame * cols}x{frame * 16}",
                r["family"],
                r["ramp"],
            ])

    new_frames = sum(COLS[r["anim"]] * 12 for r in sheets.values())
    print(f"{len(sheets)} sheets, {new_frames} new frames (12 new directions each) -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
