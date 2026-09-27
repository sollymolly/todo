/* --------------------------------------------------------------------------
   Renders every app icon from the SVGs below:

     node scripts/make-icons.mjs

   A placeholder until the real icon is drawn: a checked shield on grass.
   When it is, replace GLYPH (drawn on a 512×512 canvas, kept inside the
   middle ~70% so the maskable crop never clips it) and run this again.

   Outputs
     public/icons/icon-192.png, icon-512.png  manifest, "any" — rounded tile
     public/icons/maskable-512.png            manifest, "maskable" — full bleed;
                                              Android crops it to its own shape
     public/icons/shortcut-*.png              long-press shortcuts (manifest)
     public/icons/badge-96.png                Android's status bar, beside a
                                              notification: a white silhouette
     src/app/apple-icon.png                   iOS home screen; iOS rounds it
     src/app/icon.png                         the browser tab
   -------------------------------------------------------------------------- */

import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const GRASS = "#437a28";
const IVORY = "#fffdf8";

const GLYPH = `
  <path d="M256 96 L376 136 V256 C376 336 320 392 256 420 C192 392 136 336 136 256 V136 Z"
        fill="${IVORY}"/>
  <polyline points="198,262 240,304 318,214" fill="none" stroke="${GRASS}"
            stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>`;

/** The glyph on a tile. `bleed`: square to the edge, for platforms that mask. */
function tile({ bleed = false, scale = 1 } = {}) {
  const bg = bleed
    ? `<rect width="512" height="512" fill="${GRASS}"/>`
    : `<rect width="512" height="512" rx="112" fill="${GRASS}"/>`;
  const t = 256 * (1 - scale);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    ${bg}<g transform="translate(${t} ${t}) scale(${scale})">${GLYPH}</g></svg>`;
}

/** A shortcut's icon: a symbol on a grass circle. */
function shortcut(symbol) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
    <circle cx="48" cy="48" r="48" fill="${GRASS}"/>
    <g fill="none" stroke="${IVORY}" stroke-width="8" stroke-linecap="round"
       stroke-linejoin="round">${symbol}</g></svg>`;
}

/** Android paints the status-bar icon from its alpha alone: one flat shape. */
function badge() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <mask id="m"><rect width="512" height="512" fill="#000"/>
      <g transform="translate(-51 -51) scale(1.2)">${GLYPH.replace(`fill="${IVORY}"`, 'fill="#fff"').replace(`stroke="${GRASS}"`, 'stroke="#000"')}</g>
    </mask>
    <rect width="512" height="512" fill="#fff" mask="url(#m)"/></svg>`;
}

const PLUS = `<path d="M48 28 V68 M28 48 H68"/>`;
const LOOP = `<path d="M66 40 A20 20 0 1 0 68 54"/><polyline points="68,28 68,42 54,42"/>`;

const outputs = [
  ["public/icons/icon-192.png", tile(), 192],
  ["public/icons/icon-512.png", tile(), 512],
  // Maskable crops to as little as the middle 80% circle; shrink to fit.
  ["public/icons/maskable-512.png", tile({ bleed: true, scale: 0.78 }), 512],
  ["public/icons/shortcut-new.png", shortcut(PLUS), 96],
  ["public/icons/shortcut-habits.png", shortcut(LOOP), 96],
  ["public/icons/badge-96.png", badge(), 96],
  ["src/app/apple-icon.png", tile({ bleed: true, scale: 0.86 }), 180],
  ["src/app/icon.png", tile(), 64],
];

await mkdir("public/icons", { recursive: true });
for (const [file, svg, size] of outputs) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(file);
  console.log(`${file}  ${size}×${size}`);
}
