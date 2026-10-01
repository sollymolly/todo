#!/usr/bin/env python3
"""
Fetch the duel animations for the LPC layers this app uses: the swing
("slash") and the ready stance a guard is shown with ("thrust"'s first
frames). Run after fetch-lpc.py; it leaves the walk sheets alone and adds,
per item and body, the layers of each animation:

    manifest.slots[slot][item].anims[anim][body] = [{src, z, frame?, ...}]

Upstream keeps each animation beside the walk one:

    <dir><anim>.png  or  <dir><anim>/<variant>.png      64px frames

and a few long weapons only have a big-frame version, as its own layer
(custom_animation "slash_128" = 128px frames, "slash_oversize" = 192px).
`frame` is recorded when it isn't 64; src/lib/sprite.ts lines the frames
up by their middles.

Run:  python3 scripts/fetch-lpc-attack.py
"""

import importlib.util
import json
import os
import struct

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("fetch_lpc", os.path.join(HERE, "fetch-lpc.py"))
L = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(L)

ANIMS = ["slash", "thrust"]


def png_size(blob):
    return struct.unpack(">II", blob[16:24])


def is_png(blob):
    return bool(blob) and blob[:8] == b"\x89PNG\r\n\x1a\n"


def first_png(candidates):
    for rel in candidates:
        blob = L.get(f"{L.RAW}/spritesheets/{rel}", binary=True)
        if is_png(blob):
            return rel, blob
    return None


def resolve_anim(defn, slot, body, anim):
    """Yield (rel, blob, zPos) for every layer of one item's `anim`, for one body."""
    variants = defn.get("variants") or []
    variant = L.pick_variant(variants, slot)
    names = ([variant] if variant else []) + [v for v in variants[:4] if v != variant]
    keys = sorted(k for k in defn if k.startswith("layer_"))

    def folder(layer):
        d = next((layer[k] for k in L.BODY_KEYS[body] if layer.get(k)), None)
        return None if not d else (d if d.endswith("/") else f"{d}/")

    # The usual sheets first: the same folders the walk came from, this
    # animation's file instead.
    out = []
    for key in keys:
        layer = defn[key]
        if layer.get("custom_animation") or "attack_" in str(layer):
            continue
        d = folder(layer)
        if not d:
            continue
        base = d[: -len("walk/")] if d.endswith("walk/") else d
        found = first_png([f"{base}{anim}/{n}.png" for n in names] + [f"{base}{anim}.png"])
        if found:
            out.append((*found, int(layer.get("zPos", 50))))
    if out:
        return out

    # Nothing there: the item's own big-frame version, if it has one — this
    # animation exactly, not its variations (the longsword's slash_reverse).
    for key in keys:
        layer = defn[key]
        custom = layer.get("custom_animation") or ""
        if custom not in (f"{anim}_128", f"{anim}_oversize"):
            continue
        d = folder(layer)
        if not d:
            continue
        found = first_png([f"{d}{n}.png" for n in names] + [f"{d.rstrip('/')}.png"])
        if found:
            out.append((*found, int(layer.get("zPos", 50))))
    return out


def main():
    path = os.path.join(L.OUT, "manifest.json")
    with open(path, encoding="utf-8") as f:
        raw = f.read()
    manifest = json.loads(raw)
    palettes = manifest.get("palettes", {})

    groups = [
        ("base", L.BASE), ("torso", L.TORSO), ("weapon", L.WEAPON), ("head", L.HEAD), ("cape", L.CAPE),
        ("offhand", L.OFFHAND), ("legs", L.LEGS), ("feet", L.FEET), ("hair", L.HAIR),
    ]
    misses = []
    total = 0
    for slot, table in groups:
        for item_id, defpath in table.items():
            item = manifest["slots"].get(slot, {}).get(item_id)
            if not item:
                continue
            kind = "body" if slot == "base" else ("hair" if slot == "hair" else None)
            anims = item.setdefault("anims", {})
            for anim in ANIMS:
                bodies = {}
                for body in L.BODIES:
                    p = defpath[body] if isinstance(defpath, dict) else defpath
                    defn = L.definition(p)
                    if defn is None:
                        continue
                    entries = []
                    for rel, blob, z in resolve_anim(defn, slot, body, anim):
                        dest = os.path.join(L.OUT, rel)
                        os.makedirs(os.path.dirname(dest), exist_ok=True)
                        with open(dest, "wb") as f:
                            f.write(blob)
                        total += len(blob)
                        entry = {"src": f"/sprites/lpc/{rel}", "z": z}
                        w, h = png_size(blob)
                        if h // 4 != 64:
                            entry["frame"] = h // 4
                        if kind:
                            ramp = L.detect_ramp(blob, palettes.get(kind, {}))
                            if ramp:
                                entry["baseRamp"] = ramp
                        elif slot in L.DYEABLE_SLOTS:
                            found = L.detect_dye(blob, palettes)
                            if found:
                                entry["dyeKind"], entry["baseRamp"] = found
                        entries.append(entry)
                    if entries:
                        bodies[body] = sorted(entries, key=lambda e: e["z"])
                    else:
                        misses.append(f"{slot}/{item_id}/{body} {anim}")
                if bodies:
                    for body in L.BODIES:
                        bodies.setdefault(body, next(iter(bodies.values())))
                    anims[anim] = bodies
                counts = "/".join(str(len(bodies.get(b, []))) for b in L.BODIES)
                print(f"  {'ok' if bodies else '--'}  {anim:<7} {slot}/{item_id:<12} {counts}")

    # Eyes: by path, as in fetch-lpc.py.
    for color, item in manifest["slots"].get("eyes", {}).items():
        anims = item.setdefault("anims", {})
        for anim in ANIMS:
            rel = f"{L.EYES_DIR[: -len('walk')]}{anim}/{color}.png"
            blob = L.get(f"{L.RAW}/spritesheets/{rel}", binary=True)
            if not is_png(blob):
                misses.append(f"eyes/{color} {anim}")
                continue
            dest = os.path.join(L.OUT, rel)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest, "wb") as f:
                f.write(blob)
            total += len(blob)
            layer = [{"src": f"/sprites/lpc/{rel}", "z": L.EYES_Z}]
            anims[anim] = {body: layer for body in L.BODIES}

    newline = "\r\n" if "\r\n" in raw else "\n"
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(json.dumps(manifest, indent=1).replace("\n", newline) + newline)
    print(f"\nwrote {path}; {total // 1024} KB of sheets")
    if misses:
        print(f"\n{len(misses)} without that animation (shown walking instead):")
        for m in misses:
            print("  -", m)


if __name__ == "__main__":
    main()
