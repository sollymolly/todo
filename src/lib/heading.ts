/* --------------------------------------------------------------------------
   Which way a knight faces, to 22.5°.

   Everywhere that stores or sends a facing still speaks the four old ways
   (Facing: 0 up, 1 left, 2 down, 3 right, the rows of a 4-direction LPC
   sheet). A *heading* is the finer version, 0–15 clockwise from straight up,
   which is the row order of the 16-direction sheets
   (docs/knight-art/SPEC.md). Anything with only a Facing can be shown as a
   heading (LEGACY_HEADING), and a heading as the nearest Facing (FACING_OF),
   so the two sides can be mixed freely while the new art is drawn.
   -------------------------------------------------------------------------- */

export type Facing = 0 | 1 | 2 | 3;

export const HEADINGS = 16;

/** The heading each old facing stands for: up, left, down, right. */
export const LEGACY_HEADING: readonly number[] = [0, 12, 8, 4];

/**
 * The old facing nearest each heading. Where a heading sits exactly between
 * two (the diagonals) it takes up or down, which is what the four-way
 * sprites always did.
 */
export const FACING_OF: readonly Facing[] = [0, 0, 0, 3, 3, 3, 2, 2, 2, 2, 2, 1, 1, 1, 0, 0];

/** The heading for looking along (dx, dy) on screen, y down. */
export function headingToward(dx: number, dy: number): number {
  const turn = Math.round(Math.atan2(dx, -dy) / (Math.PI / 8));
  return ((turn % HEADINGS) + HEADINGS) % HEADINGS;
}

/** Whatever came over the wire, as a heading, or null if it isn't one. */
export function cleanHeading(raw: unknown): number | null {
  const h = Number(raw);
  return raw != null && Number.isInteger(h) && h >= 0 && h < HEADINGS ? h : null;
}

/** The row of a sheet with `rows` rows (4 or 16) that shows this heading. */
export function rowFor(heading: number, rows: number): number {
  return rows === HEADINGS ? heading : FACING_OF[heading];
}
