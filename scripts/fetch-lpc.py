#!/usr/bin/env python3
"""
Fetch the LPC sprite layers this app uses.

The Universal LPC Spritesheet Generator stores each wearable as a "sheet
definition" JSON that names a directory per body type plus a z-order. The
actual PNG then lives at one of two shapes:

    <dir>walk.png                 (item has no colour variants)
    <dir>walk/<variant>.png       (item has variants)

Rather than hard-code paths — they are inconsistent across contributors — this
resolves each one by reading the definition and probing both shapes.

Output:
    public/sprites/lpc/**.png     the sheets (576x256, 9x4 grid of 64px frames)
    public/sprites/lpc/manifest.json
    public/sprites/lpc/CREDITS.md attribution required by CC-BY-SA / GPL

Run:  python3 scripts/fetch-lpc.py
"""

import collections
import json
import os
import struct
import sys
import urllib.parse
import urllib.request
import urllib.error

REPO = "LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator"
RAW = f"https://raw.githubusercontent.com/{REPO}/master"
OUT = "public/sprites/lpc"

# Body types to try, best first. Hair/hats use "adult"; gear uses "male".
BODY_KEYS = ["male", "adult", "universal", "muscular", "teen", "female", "child"]

# ---------------------------------------------------------------------------
# What we actually use, keyed by the item ids already in src/lib/game.ts.
# ---------------------------------------------------------------------------

BASE = {
    "body": "body/body",
    "head": "head/heads/human/heads_human_male",
}

TORSO = {
    "rags": "torso/shirts/sleeveless/torso_clothes_sleeveless",
    "tunic": "torso/shirts/longsleeve/torso_clothes_longsleeve",
    "jerkin": "torso/armour/torso_armour_leather",
    "scale": "torso/armour/torso_armour_legion",
    "chain": "torso/torso_chainmail",
    "plate": "torso/armour/torso_armour_plate",
    "gilded": "torso/armour/torso_armour_plate",
    "dragonscale": "torso/armour/torso_armour_plate",
}

WEAPON = {
    "stick": "weapons/polearm/weapon_polearm_cane",
    "dagger": "weapons/sword/weapon_sword_dagger",
    "shortsword": "weapons/sword/weapon_sword_arming",
    "axe": "weapons/blunt/weapon_blunt_waraxe",
    "hammer": "weapons/blunt/weapon_blunt_mace",
    "longsword": "weapons/sword/weapon_sword_longsword",
    "flamebrand": "weapons/sword/weapon_sword_glowsword",
    "runeblade": "weapons/sword/weapon_sword_katana",
    "dragonfang": "weapons/sword/weapon_sword_scimitar",
}

HEAD = {
    "bandana": "headwear/coverings/bandana/hat_bandana",
    "cap": "headwear/hats/caps/hat_cap_leather",
    "helm": "headwear/helmets/helmets/hat_helmet_bascinet",
    "greathelm": "headwear/helmets/helmets/hat_helmet_greathelm",
    "crown": "headwear/hats/formal/hat_formal_crown",
    "dragoncrown": "headwear/helmets/helmets/hat_helmet_horned",
}

CAPE = {
    "tattered": "torso/cape/cape_tattered",
    "traveler": "torso/cape/cape_solid",
    "heraldic": "torso/cape/cape_solid",
    "mantle": "torso/cape/cape_trim",
    "starcloak": "torso/cape/cape_solid",
}

OFFHAND = {
    "buckler": "weapons/shields/shield_round",
    "kite": "weapons/shields/heater/shield_heater_revised_wood",
    "tower": "weapons/shields/heater/shield_heater_wood",
    "lantern": "weapons/shields/shield_spartan",
    "aegis": "weapons/shields/engrailed/shield_crusader",
}

LEGS = {
    "cloth": "legs/pants/legs_pants",
    "armour": "legs/legs_armour",
}

FEET = {
    "boots": "feet/boots/feet_boots_basic",
    "armour": "feet/feet_armour",
}

# Eyes are the one slot with no sheet definition upstream: the generator drives
# them from the directory tree instead, so there is nothing to read a z-order or
# credits out of. The paths are stable, so they are named directly here.
#
#   spritesheets/eyes/human/adult/<expression>/walk/<colour>.png
#
# The head sheet already has blue eyes painted on. These layers are just the
# iris pixels, drawn on top at z=101 — above the head (100), below hair (120).
EYES_DIR = "eyes/human/adult/default/walk"
EYES_Z = 101
EYES = ["blue", "brown", "gray", "green", "orange", "purple", "red", "yellow"]

# CREDITS.csv has rows for the cyclops eyes but none for the human ones, so
# there is no per-author record to copy. Fall back to the collection-level
# attribution the repository as a whole ships under.
EYES_CREDIT = {
    "file": "eyes/human/adult",
    "authors": ["Liberated Pixel Cup contributors"],
    "licenses": ["CC-BY-SA 3.0", "GPL 3.0"],
    "urls": [f"https://github.com/{REPO}"],
}

HAIR = {
    "tousled": "hair/short/hair_messy1",
    "long": "hair/long/hair_long",
    "braided": "hair/braids/hair_braid",
    "ponytail": "hair/braids/hair_ponytail",
    "curly": "hair/curly/hair_curly_short",
    "buzz": "hair/bald/hair_buzzcut",
    "topknot": "hair/braids/hair_topknot_long",
}

# Preferred colour variant per slot, first match wins.
PREFER = {
    "torso": ["brown", "tan", "walnut", "leather", "steel", "silver", "gray", "grey"],
    "cape": ["red", "crimson", "blue", "forest", "brown", "gray", "grey"],
    "offhand": ["brown", "wood", "steel", "silver", "gray", "grey", "red"],
    "legs": ["brown", "tan", "walnut", "gray", "grey", "steel"],
    "feet": ["brown", "tan", "walnut", "black", "steel"],
    "head": ["steel", "silver", "gray", "grey", "brown", "gold", "red"],
    "weapon": [],
}


def get(url, binary=False):
    # Some contributors' variant filenames contain spaces.
    url = urllib.parse.quote(url, safe=":/?#[]@!$&'()*+,;=~")
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            return r.read() if binary else r.read().decode("utf-8")
    except urllib.error.HTTPError:
        return None
    except Exception as e:
        print(f"    ! {e}", file=sys.stderr)
        return None


def definition(path):
    raw = get(f"{RAW}/sheet_definitions/{path}.json")
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def pick_variant(variants, slot):
    if not variants:
        return None
    for want in PREFER.get(slot, []):
        for v in variants:
            if v.lower() == want:
                return v
    return variants[0]


def resolve(defn, slot):
    """Yield (url, zPos) for every drawable layer of one item."""
    variants = defn.get("variants") or []
    variant = pick_variant(variants, slot)
    out = []

    for key in sorted(k for k in defn if k.startswith("layer_")):
        layer = defn[key]
        # Skip the attack-only layers; we only ever draw a standing frame.
        if any(x in str(layer) for x in ("attack_", "/behind/")):
            continue

        d = next((layer[k] for k in BODY_KEYS if layer.get(k)), None)
        if not d:
            continue

        # Some definitions already point at the animation folder, others stop
        # at the item folder. Probe both shapes.
        stem = d if d.rstrip("/").endswith("walk") else f"{d}walk"
        candidates = []
        if variant:
            candidates += [f"{stem}/{variant}.png", f"{d}{variant}.png"]
        candidates.append(f"{stem}.png")
        for v in variants[:4]:
            candidates += [f"{stem}/{v}.png", f"{d}{v}.png"]

        for rel in candidates:
            url = f"{RAW}/spritesheets/{rel}"
            blob = get(url, binary=True)
            if blob and blob[:8] == b"\x89PNG\r\n\x1a\n":
                out.append((rel, blob, int(layer.get("zPos", 50))))
                break

    return out


def png_colors(blob):
    """Unique visible colours in a PNG, most common first. Pure stdlib."""
    import zlib

    i, idat, ihdr, plte = 8, b"", None, None
    while i < len(blob):
        ln = struct.unpack(">I", blob[i : i + 4])[0]
        typ = blob[i + 4 : i + 8]
        data = blob[i + 8 : i + 8 + ln]
        if typ == b"IHDR":
            ihdr = struct.unpack(">IIBBBBB", data)
        elif typ == b"PLTE":
            plte = data
        elif typ == b"IDAT":
            idat += data
        i += 12 + ln

    if not ihdr:
        return []
    w, h, _depth, ctype = ihdr[0], ihdr[1], ihdr[2], ihdr[3]

    if ctype == 3 and plte:
        return [
            f"#{plte[j]:02X}{plte[j+1]:02X}{plte[j+2]:02X}"
            for j in range(0, len(plte), 3)
        ]

    try:
        raw = zlib.decompress(idat)
    except zlib.error:
        return []

    bpp = {0: 1, 2: 3, 4: 2, 6: 4}.get(ctype)
    if not bpp:
        return []

    stride = w * bpp
    prev = bytearray(stride)
    pos = 0
    counts = collections.Counter()

    for _ in range(h):
        if pos >= len(raw):
            break
        f = raw[pos]
        pos += 1
        line = bytearray(raw[pos : pos + stride])
        pos += stride
        for x in range(len(line)):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if f == 1:
                line[x] = (line[x] + a) & 255
            elif f == 2:
                line[x] = (line[x] + b) & 255
            elif f == 3:
                line[x] = (line[x] + ((a + b) >> 1)) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        for j in range(0, len(line), bpp):
            if bpp == 4 and line[j + 3] == 0:
                continue
            counts[f"#{line[j]:02X}{line[j+1]:02X}{line[j+2]:02X}"] += 1
        prev = line

    return [c for c, _ in counts.most_common(24)]


def detect_ramp(blob, palettes):
    """Which palette ramp is this sheet drawn in? Needed to recolour it."""
    cols = {c.upper() for c in png_colors(blob)}
    if not cols:
        return None
    best, best_hits = None, 0
    for name, ramp in palettes.items():
        hits = len(cols & {c.upper() for c in ramp})
        if hits > best_hits:
            best, best_hits = name, hits
    # Require most of the ramp to be present, else it's a coincidence.
    return best if best_hits >= 3 else None


def credits_of(defn):
    rows = []
    for c in defn.get("credits", []):
        rows.append(
            {
                "file": c.get("file", ""),
                "authors": c.get("authors", []),
                "licenses": c.get("licenses", []),
                "urls": c.get("urls", []),
            }
        )
    return rows


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = {"frame": 64, "cols": 9, "rows": 4, "slots": {}}
    all_credits = []
    misses = []

    groups = [
        ("base", BASE),
        ("torso", TORSO),
        ("weapon", WEAPON),
        ("head", HEAD),
        ("cape", CAPE),
        ("offhand", OFFHAND),
        ("legs", LEGS),
        ("feet", FEET),
        ("hair", HAIR),
    ]

    # Palettes first: needed to detect each sheet's base ramp.
    for name, path in [
        ("body", "palette_definitions/body/body_ulpc.json"),
        ("hair", "palette_definitions/hair/hair_ulpc.json"),
        ("cloth", "palette_definitions/cloth/cloth_ulpc.json"),
    ]:
        raw = get(f"{RAW}/{path}")
        if raw:
            try:
                manifest.setdefault("palettes", {})[name] = json.loads(raw)
                print(f"  ok  palette/{name}")
            except json.JSONDecodeError:
                print(f"  MISS palette/{name}")

    for slot, table in groups:
        manifest["slots"][slot] = {}
        for item_id, defpath in table.items():
            defn = definition(defpath)
            if defn is None:
                print(f"  MISS def  {slot}/{item_id}  ({defpath})")
                misses.append(f"{slot}/{item_id} definition {defpath}")
                continue

            layers = resolve(defn, slot)
            if not layers:
                print(f"  MISS png  {slot}/{item_id}  ({defpath})")
                misses.append(f"{slot}/{item_id} no png")
                continue

            kind = "body" if slot == "base" else ("hair" if slot == "hair" else None)
            entries = []
            for rel, blob, z in layers:
                dest = os.path.join(OUT, rel)
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with open(dest, "wb") as f:
                    f.write(blob)
                entry = {"src": f"/sprites/lpc/{rel}", "z": z}
                if kind:
                    ramp_name = detect_ramp(blob, manifest.get("palettes", {}).get(kind, {}))
                    if ramp_name:
                        entry["baseRamp"] = ramp_name
                entries.append(entry)

            manifest["slots"][slot][item_id] = {
                "name": defn.get("name", item_id),
                "layers": sorted(entries, key=lambda e: e["z"]),
            }
            all_credits += credits_of(defn)
            print(f"  ok  {slot}/{item_id:<12} {len(entries)} layer(s)")

    # ---- eyes: fetched by path, since there is no definition to resolve -----
    manifest["slots"]["eyes"] = {}
    for color in EYES:
        rel = f"{EYES_DIR}/{color}.png"
        blob = get(f"{RAW}/spritesheets/{rel}", binary=True)
        if not blob or blob[:8] != b"\x89PNG\r\n\x1a\n":
            print(f"  MISS png  eyes/{color}")
            misses.append(f"eyes/{color} no png")
            continue

        dest = os.path.join(OUT, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as f:
            f.write(blob)

        manifest["slots"]["eyes"][color] = {
            "name": color.capitalize(),
            "layers": [{"src": f"/sprites/lpc/{rel}", "z": EYES_Z}],
        }
        print(f"  ok  eyes/{color:<12} 1 layer(s)")

    if manifest["slots"]["eyes"]:
        all_credits.append(EYES_CREDIT)

    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)

    # ---- credits ----------------------------------------------------------
    seen, lines = set(), []
    for c in all_credits:
        key = (tuple(c["authors"]), tuple(c["licenses"]))
        if key in seen:
            continue
        seen.add(key)
        lines.append(
            f"- **{', '.join(c['authors']) or 'unknown'}** — "
            f"{', '.join(c['licenses'])}"
            + (f"  \n  {c['urls'][0]}" if c["urls"] else "")
        )

    with open(os.path.join(OUT, "CREDITS.md"), "w") as f:
        f.write(
            "# Sprite credits\n\n"
            "Character sprites come from the [Universal LPC Spritesheet "
            "Generator](https://github.com/LiberatedPixelCup/"
            "Universal-LPC-Spritesheet-Character-Generator), assembled from "
            "the Liberated Pixel Cup asset collection.\n\n"
            "They are licensed **CC-BY-SA 3.0** and **GPL 3.0**. If you "
            "publish this app you must keep this file reachable and license "
            "derivative sprite art under the same terms.\n\n"
            "## Contributors\n\n" + "\n".join(sorted(lines)) + "\n"
        )

    print(f"\nwrote {OUT}/manifest.json and CREDITS.md")
    if misses:
        print(f"\n{len(misses)} unresolved:")
        for m in misses:
            print("  -", m)


if __name__ == "__main__":
    main()
