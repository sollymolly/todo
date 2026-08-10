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

# Body types the app offers. Every sheet is fetched once per body, because an
# item drawn for one silhouette does not line up on the other.
BODIES = ["male", "female"]

# Which key to read out of a sheet definition, best first, per body. Most
# definitions carry every body type; the tail is insurance so a layer is never
# silently dropped. Hair and hats resolve to a shared "adult" directory, which
# the download cache collapses back to one file.
BODY_KEYS = {
    "male": ["male", "muscular", "teen", "universal", "adult", "female"],
    "female": ["female", "teen", "universal", "adult", "male"],
}

# ---------------------------------------------------------------------------
# What we actually use, keyed by the item ids already in src/lib/game.ts.
# ---------------------------------------------------------------------------

# Heads are the exception: they are a *style* sheet, so "Human Male" points
# every body type at the male art. Picking a head therefore means picking a
# different definition rather than a different key inside one.
BASE = {
    "body": {"male": "body/body", "female": "body/body"},
    "head": {
        "male": "head/heads/human/heads_human_male",
        "female": "head/heads/human/heads_human_female",
    },
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

# Slots the Armoury lets you dye, plus the palette families a dye may come
# from. Legs and feet are in here because heavy armour drags matching greaves
# and sabatons along with it — they take the torso's dye so the suit matches.
DYEABLE_SLOTS = {"torso", "head", "cape", "legs", "feet"}
DYE_KINDS = ("cloth", "metal", "wood")

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


# Each item is now resolved once per body type, so the same URL is commonly
# requested twice (identically, for anything shared like hair). Cache both.
_fetched = {}
_definitions = {}


def get(url, binary=False):
    # Some contributors' variant filenames contain spaces.
    url = urllib.parse.quote(url, safe=":/?#[]@!$&'()*+,;=~")
    if url in _fetched:
        return _fetched[url]
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            out = r.read() if binary else r.read().decode("utf-8")
    except urllib.error.HTTPError:
        out = None
    except Exception as e:
        print(f"    ! {e}", file=sys.stderr)
        out = None
    _fetched[url] = out
    return out


def definition(path):
    if path in _definitions:
        return _definitions[path]
    raw = get(f"{RAW}/sheet_definitions/{path}.json")
    try:
        out = json.loads(raw) if raw is not None else None
    except json.JSONDecodeError:
        out = None
    _definitions[path] = out
    return out


def pick_variant(variants, slot):
    if not variants:
        return None
    for want in PREFER.get(slot, []):
        for v in variants:
            if v.lower() == want:
                return v
    return variants[0]


def resolve(defn, slot, body):
    """Yield (rel, blob, zPos) for every drawable layer of one item, for one body."""
    variants = defn.get("variants") or []
    variant = pick_variant(variants, slot)
    out = []

    for key in sorted(k for k in defn if k.startswith("layer_")):
        layer = defn[key]
        # Skip the attack-only layers; we only ever draw a standing frame.
        if any(x in str(layer) for x in ("attack_", "/behind/")):
            continue

        d = next((layer[k] for k in BODY_KEYS[body] if layer.get(k)), None)
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


def detect_dye(blob, palettes):
    """
    Same idea as detect_ramp, but across the three *gear* palettes at once, so
    a sheet reports both which ramp it is drawn in and which family that ramp
    belongs to. The family is what decides the swatches the Armoury offers:
    steel plate gets metal finishes, a linen tunic gets cloth colours.

    Every ULPC ramp is six stops dark-to-light, so a sheet drawn in one is
    recoloured by remapping those six exactly — the same swap the upstream
    generator does, which is why the shading survives it.

    The threshold is higher than detect_ramp's three: mail and plate share
    three greys with the `cloth/white` ramp, so a looser test would call plate
    a fabric and offer it pink.
    """
    cols = {c.upper() for c in png_colors(blob)}
    if not cols:
        return None
    best = None
    for kind in DYE_KINDS:
        for name, ramp in palettes.get(kind, {}).items():
            hits = len(cols & {c.upper() for c in ramp})
            if hits >= 4 and (best is None or hits > best[0]):
                best = (hits, kind, name)
    return (best[1], best[2]) if best else None


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
        ("metal", "palette_definitions/metal/metal_ulpc.json"),
        ("wood", "palette_definitions/wood/wood_ulpc.json"),
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
            kind = "body" if slot == "base" else ("hair" if slot == "hair" else None)
            bodies = {}
            name = item_id

            for body in BODIES:
                # A dict here means the item is a different sheet per body
                # (heads), rather than a different key inside one sheet.
                path = defpath[body] if isinstance(defpath, dict) else defpath
                defn = definition(path)
                if defn is None:
                    print(f"  MISS def  {slot}/{item_id}/{body}  ({path})")
                    misses.append(f"{slot}/{item_id}/{body} definition {path}")
                    continue

                layers = resolve(defn, slot, body)
                if not layers:
                    print(f"  MISS png  {slot}/{item_id}/{body}  ({path})")
                    misses.append(f"{slot}/{item_id}/{body} no png")
                    continue

                entries = []
                for rel, blob, z in layers:
                    dest = os.path.join(OUT, rel)
                    os.makedirs(os.path.dirname(dest), exist_ok=True)
                    with open(dest, "wb") as f:
                        f.write(blob)
                    entry = {"src": f"/sprites/lpc/{rel}", "z": z}
                    if kind:
                        ramp_name = detect_ramp(
                            blob, manifest.get("palettes", {}).get(kind, {})
                        )
                        if ramp_name:
                            entry["baseRamp"] = ramp_name
                    elif slot in DYEABLE_SLOTS:
                        found = detect_dye(blob, manifest.get("palettes", {}))
                        if found:
                            entry["dyeKind"], entry["baseRamp"] = found
                    entries.append(entry)

                bodies[body] = sorted(entries, key=lambda e: e["z"])
                name = defn.get("name", item_id)
                all_credits += credits_of(defn)

            if not bodies:
                continue

            # A body that resolved nothing borrows another's art rather than
            # rendering a hole. Shouldn't happen — reported above if it does.
            for body in BODIES:
                bodies.setdefault(body, next(iter(bodies.values())))

            manifest["slots"][slot][item_id] = {"name": name, "bodies": bodies}
            counts = "/".join(str(len(bodies[b])) for b in BODIES)
            print(f"  ok  {slot}/{item_id:<12} {counts} layer(s) [{'/'.join(BODIES)}]")

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

        # One sheet serves both bodies — LPC draws adult eyes at the same
        # offset regardless — but it is stored per body so the renderer has a
        # single shape to read.
        layer = [{"src": f"/sprites/lpc/{rel}", "z": EYES_Z}]
        manifest["slots"]["eyes"][color] = {
            "name": color.capitalize(),
            "bodies": {body: layer for body in BODIES},
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
