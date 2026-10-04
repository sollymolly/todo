import type { FenceTile } from "@/components/village/world";

/* --------------------------------------------------------------------------
   The wooden fence round an empty lot (world.ts, lotFence), drawn in the
   same flat, outlined style as everything else.

   It's built from one tile at a time, so each post sorts with the walkers on
   its own row: a walker behind a post is hidden by it, in front of it isn't.
   The gate is one piece, two tall posts and a beam across the opening, with
   the lot's sign hanging from it.
   -------------------------------------------------------------------------- */

const INK = "#3b2a1c";
const RAIL = "#c9a06a";
const RAIL_EDGE = "#6b4a2b";
const POST = "#8f5a3a";
const CAP = "#b58b5e";

/** Where a post's foot is in a tile, px from its top: a little below the middle, for depth. */
export const FOOT = 20;
/** How far above its tile's top a tile's drawing reaches, px. */
export const REACH = 24;

/**
 * One tile of fence: a post in the middle, with rails running out to whichever
 * neighbours it joins (`l`, `r`), and a rail running down the tile to the post
 * below (`d`). The drawing is 32 wide and reaches `REACH` px above the tile
 * and 8 below it.
 */
export function FencePiece({ tile }: { tile: FenceTile }) {
  return (
    <svg viewBox={`0 ${-REACH} 32 64`} className="h-full w-full" shapeRendering="crispEdges" aria-hidden>
      {tile.d && <rect x="13" y="3" width="6" height="32" fill={RAIL} stroke={RAIL_EDGE} strokeWidth="1" />}
      {[2, 10].map((y) => (
        <g key={y}>
          {tile.l && <rect x="0" y={y} width="17" height="4" fill={RAIL} stroke={RAIL_EDGE} strokeWidth="1" />}
          {tile.r && <rect x="15" y={y} width="17" height="4" fill={RAIL} stroke={RAIL_EDGE} strokeWidth="1" />}
        </g>
      ))}
      {tile.post && (
        <g>
          <rect x="10" y={FOOT} width="12" height="2" fill="#000" opacity="0.15" />
          <rect x="13" y="-4" width="6" height={FOOT + 4} fill={POST} stroke={INK} strokeWidth="1.5" />
          <rect x="12" y="-7" width="8" height="4" fill={CAP} stroke={INK} strokeWidth="1.5" />
        </g>
      )}
    </svg>
  );
}

/**
 * The gate's drawing: its size in px at 1×, and where the posts' feet are in
 * it. Tall enough that the sign hangs above a walker's head.
 */
export const GATE = { w: 128, h: 120, foot: 112 };

/**
 * The lot's gate, across the four tiles of its front from one gate post to
 * the other. The opening between the posts is the two middle tiles, 64 px; a
 * leaf stands open against each post, and the sign hangs from the beam.
 */
export function LotGate() {
  const post = (x: number) => (
    <g>
      <rect x={x - 4} y={GATE.foot - 4} width="12" height="3" fill="#000" opacity="0.15" />
      <rect x={x - 3} y="14" width="7" height={GATE.foot - 14} fill={POST} stroke={INK} strokeWidth="1.5" />
      <rect x={x - 5} y="11" width="11" height="4" fill={CAP} stroke={INK} strokeWidth="1.5" />
    </g>
  );
  // A leaf, open and standing against its post: two rails and a brace.
  const leaf = (x: number) => (
    <g>
      <rect x={x} y="82" width="12" height="28" fill={RAIL} stroke={RAIL_EDGE} strokeWidth="1" />
      <rect x={x} y="88" width="12" height="3" fill={POST} />
      <rect x={x} y="102" width="12" height="3" fill={POST} />
      <path d={`M${x} 105 L${x + 12} 88`} stroke={RAIL_EDGE} strokeWidth="1.5" />
    </g>
  );
  return (
    <svg viewBox={`0 0 ${GATE.w} ${GATE.h}`} className="h-full w-full" shapeRendering="crispEdges" aria-hidden>
      {post(16)}
      {post(112)}
      {leaf(21)}
      {leaf(95)}
      {/* The beam across the top, and the sign hung from it */}
      <rect x="8" y="18" width="112" height="8" fill={RAIL} stroke={INK} strokeWidth="1.5" />
      <rect x="8" y="22" width="112" height="2" fill={RAIL_EDGE} opacity="0.5" />
      {[34, 94].map((x) => (
        <rect key={x} x={x} y="26" width="2" height="8" fill={INK} />
      ))}
      <rect x="22" y="34" width="84" height="22" fill="#d8bb8a" stroke="#5a3e28" strokeWidth="2.5" />
      <text x="64" y="50" textAnchor="middle" fontSize="14" fontWeight="700" fill="#5a3e28" fontFamily="Georgia, serif">
        Empty lot
      </text>
    </svg>
  );
}
