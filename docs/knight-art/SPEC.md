# Knight sprites in 16 directions: art spec

HabitKnight's knights are layered pixel-art sprites from the Liberated Pixel Cup (LPC) collection. Each knight is a stack of transparent sheets: body, head, eyes, hair, clothes, armour, cape, shield and weapon. Today every sheet faces 4 ways (up, left, down and right). This spec is for redrawing them to face **16 ways**, so a knight walking at any angle looks the way it's going.

It is written for the artist doing the work and for whoever wires the result into the game.

- **What to draw:** every sheet listed in [`inventory.csv`](inventory.csv): 228 sheets in all. Run `python scripts/knight-art-inventory.py` to regenerate it if the game's items change.
- **How much is new:** 4 of the 16 directions already exist and are copied across as-is (see [Directions](#1-directions)). That leaves **12 new directions per sheet, about 21,000 new frames**: 8,640 walking, 5,688 slashing and 6,624 thrusting.
- **A way to cut it by a third:** give the Pointy Stick a slash animation instead of its thrust. Then no thrust sheets are needed at all, saving the 6,624 thrust frames for the cost of one new weapon sheet. Decide this before the pilot.
- **Style:** match the existing LPC art exactly: same proportions, outline weight, shading and palette. A knight is assembled from many sheets, so a sheet in a different style breaks every knight that wears it.

---

## 1. Directions

Rows run clockwise from straight up, in 22.5° steps. Angles are as seen on screen: 0° is toward the top of the screen and 90° is toward the right.

| Row | Facing | Angle | | Row | Facing | Angle |
|---:|---|---:|---|---:|---|---:|
| 0 | **Up (N)** | 0° | | 8 | **Down (S)** | 180° |
| 1 | N by NE | 22.5° | | 9 | S by SW | 202.5° |
| 2 | Up-right (NE) | 45° | | 10 | Down-left (SW) | 225° |
| 3 | E by NE | 67.5° | | 11 | W by SW | 247.5° |
| 4 | **Right (E)** | 90° | | 12 | **Left (W)** | 270° |
| 5 | E by SE | 112.5° | | 13 | W by NW | 292.5° |
| 6 | Down-right (SE) | 135° | | 14 | Up-left (NW) | 315° |
| 7 | S by SE | 157.5° | | 15 | N by NW | 337.5° |

**Rows 0, 4, 8 and 12 are the existing art.** In today's sheets those are rows 0 (up), 3 (right), 2 (down) and 1 (left). Copy them across unchanged.

The camera is LPC's usual three-quarter view: looking down at about 45°, so you see the top of the head and the front of the body at once. The in-between directions are the knight turning on the spot under that same camera, not the camera moving.

**Mirroring is fine** where the art allows it: rows 9–15 may be mirrors of rows 7–1 (row 12 mirrors row 4, and so on). Anything held in one hand (weapon, shield, lantern) and anything asymmetric (side braid, ponytail, heraldic cape) must stay on the correct side after mirroring. Fix those by hand.

---

## 2. Sheet layout

One PNG per row of [`inventory.csv`](inventory.csv), RGBA with a transparent background and no compression artefacts.

| Animation | Columns | Frame | Sheet size (64px frames) |
|---|---:|---|---|
| `walk` | 9 | 64×64 | 576×1024 |
| `slash` | 6 | 64×64, or 128 / 192 for long weapons | 384×1024 (or 768×2048, 1152×3072) |
| `thrust` | 8 | 64×64, or 192 for long weapons | 512×1024 (or 1536×3072) |

- **Columns** are animation frames, left to right. In `walk`, column 0 is standing still and columns 1–8 are the walk cycle, one full stride.
- **Rows** are the 16 directions, in the order above.
- **Oversized frames** (`frame_px` 128 or 192) are for blades that swing outside a 64px box. The knight sits dead centre of each big frame, exactly where a 64px frame would put it.

### Anchor

Every frame of every layer must line up, or the stack falls apart:

- Feet meet the ground **60px down** from the top of the 64px frame, centred horizontally at **x = 32**. Keep that point fixed across all 16 directions and all frames, apart from the natural bob of the walk cycle.
- Leave the top **7px** of the 64px frame as headroom. The game crops it away, except for tall helmets and crowns, which may use it.
- A layer that's empty in some direction (a shield hidden behind the body, for example) leaves that frame fully transparent. Don't delete the frame.

---

## 3. Layers and what goes in front

The game draws layers bottom to top by `z`, the same order for every direction:

| z | Layer |
|---:|---|
| 2 | Shield, behind-the-body part |
| 5 | Cape, behind-the-body part |
| 9 | Weapon behind the body; long hair behind the body |
| 10 | Body |
| 15–25 | Feet, legs |
| 35–60 | Torso: clothes, then armour |
| 85–90 | Cape, front part |
| 100 | Head |
| 101 | Eyes |
| 110 | Shield, front part |
| 120–130 | Hair, hats, helmets |
| 140–145 | Weapon in front; hair in front of a helmet |

The order never changes with direction, so an item that passes behind the body in some directions and in front of it in others is split across two sheets. That's why some items in the inventory have two (or three) layers: a behind part drawn at the low z and a front part drawn at the high z.

- For each direction, draw in the **behind** sheet only what the body should hide, and in the **front** sheet only what should cover the body.
- When turning from facing away to facing forward, a shield moves from the front sheet to the behind sheet. Work out where the switch happens for each in-between direction and keep the two sheets consistent, so nothing is drawn twice or vanishes for a frame.
- **Weapons and shields are the exception.** The game draws every weapon and shield layer, front part included, *underneath* the body, in walking and in duels alike, so a knight's arms and chest are never covered. What shows of them is what sticks out around the body. Keep LPC's behind/front split for these sheets anyway (it keeps them usable elsewhere), but judge them by how they look under the body: a swing has to read in all 16 directions from the parts that clear the knight's outline.

---

## 4. Colours: the most important rule

Players pick skin, hair colour and dye colours for their clothes and armour. The game recolours sheets by **swapping exact colours**: every pixel that is exactly the 3rd colour of the base ramp becomes exactly the 3rd colour of the chosen ramp, and so on. So:

- A sheet with a `palette_family` and `base_ramp` in the inventory **must be painted using only that ramp's six colours** for its recolourable parts. No in-between shades, no anti-aliasing against other colours, no new highlights. Anything outside the ramp is left alone when it's dyed, so it will look wrong.
- Non-recolourable details on those sheets (a gem, a buckle) may use other colours, as long as none of them is in that ramp.
- Sheets with no `palette_family` (most weapons and shields, and the eyes) aren't recoloured. Any colours from the existing LPC palette are fine.

The base ramps in use, dark to light:

| Family / ramp | Used by | Colours |
|---|---|---|
| `body` / `light` | Body, head | `#271920` `#99423c` `#cc8665` `#E4A47C` `#F9D5BA` `#FAECE7` |
| `hair` / `orange` | All hair | `#260D14` `#6A1108` `#A42600` `#BF4000` `#E55600` `#FF8A00` |
| `cloth` / `white` | Most clothes, capes, cloth hats | `#281820` `#4D4A5D` `#958080` `#C4B59F` `#E5E6C7` `#FFFFFF` |
| `cloth` / `brown` | Some clothes | `#1d131e` `#411E05` `#4B2B13` `#62351C` `#744B30` `#996B4A` |
| `cloth` / `leather` | Leather jerkin | `#2b1c1d` `#311210` `#4B2B13` `#704325` `#75502D` `#9A6F37` |
| `cloth` / `gray` | Some cloth layers | `#0e0e18` `#201E2B` `#373340` `#585561` `#797580` `#A2A0A4` |
| `metal` / `steel` | All dyeable armour and helmets | `#1D131E` `#4D4A5D` `#726B7E` `#867E7F` `#C4B59F` `#FFFFFF` |

The inventory names the exact ramp for each sheet. The source of truth is `public/sprites/lpc/manifest.json` (`palettes`, and `baseRamp` / `dyeKind` on each layer).

---

## 5. Animation

- **Walk:** 8 frames per stride, advanced by distance (one frame per 10px walked), so keep the stride length the same in every direction. Column 0 is the standing pose.
- **Slash:** 6 frames, played over 0.36s. This is the duel animation for every weapon that has one.
- **Thrust:** 8 frames over the same 0.36s. It's only used by a weapon with no slash, which today is just the **Pointy Stick** (the cane art). Every new player starts with that, though, so the thrust sheets are needed.
- **Guard pose:** while blocking in a duel, the knight holds **frame 1** of their duel animation (slash or thrust), with the weapon drawn across the body. That frame has to read as a guard in all 16 directions.
- Female and male bodies are separate sheets because gear doesn't line up across them. Draw each item for both.

---

## 6. Licence and credit

The existing sprites are **CC-BY-SA 3.0 and GPL 3.0** (some parts also OGA-BY 3.0). See [`public/sprites/lpc/CREDITS.md`](../../public/sprites/lpc/CREDITS.md). New directions drawn from this art are derivative works, so:

- The new sheets must be released under **CC-BY-SA 3.0 and GPL 3.0**, the same terms.
- The artist is added to `CREDITS.md` under the name they choose, with a line on what they drew.
- The original authors listed in `CREDITS.md` stay credited.

Agree this with the artist before work starts.

---

## 7. Delivery

Put each sheet at its `deliver_as` path, which mirrors the existing tree under `public/sprites/lpc16/`, for example `public/sprites/lpc16/body/bodies/male/walk.png`.

**Start with a pilot** before the full set, to settle style and alignment:

1. Male and female body, head and eyes (`base`, `eyes/blue`): walk, slash and thrust.
2. One outfit on top: `torso/tunic`, `legs/cloth`, `feet/boots`, `hair/tousled` and `weapon/shortsword`.

That's enough to see a complete knight turn and walk in 16 directions in the game. After sign-off, the rest can come in batches, one slot at a time. The game falls back to the old 4-direction art for anything not delivered yet (see below), so batches can ship as they land.

### Checklist for each sheet

- [ ] Right size: `sheet_px` in the inventory, 16 rows.
- [ ] Rows 0, 4, 8 and 12 match the original 4-direction art pixel for pixel.
- [ ] Stacked on the body sheet, it lines up in every frame of every row.
- [ ] Recolourable parts use only the six colours of its `base_ramp`. Check by dyeing it in the Armoury once it's in the game.
- [ ] Behind and front sheets of the same item never both draw the same pixel.
- [ ] Held items are in the correct hand in every row, including mirrored ones.

---

## 8. Wiring it in (for developers)

The game side of this is small and goes in once the pilot art arrives:

- **Manifest:** `scripts/fetch-lpc.py` gains a `lpc16` source, and each layer records whether it has 16 rows. `src/lib/sprite.ts` composes 16-row sheets (`rows` from the manifest instead of a fixed 4).
- **Fallback:** a layer without 16-direction art is drawn from its 4-direction sheet, using the nearest of up, right, down and left for each of the 16 rows. Partial delivery then works: an un-redrawn helmet just snaps between four ways.
- **Facing:** `Facing` (`src/lib/duel.ts`) becomes 0–15, worked out from the angle of movement (`engine.ts`, `faceToward`) instead of the dominant axis. The village already moves at any angle, so this is just which row is shown.
- **Network and saved positions:** facing is sent as 0–3 today and clamped to that range in `src/lib/live-hub.ts` and `src/app/api/village/pulse/route.ts`. Widen both to 0–15, and map old 0–3 values (up, left, down, right) to rows 0, 12, 8 and 4, so older pages and stored positions still face the right way.
- **Portraits:** the Armoury portrait shows the standing frame facing down (`DOWN_ROW` in `sprite.ts`), which moves from row 2 to row 8.
