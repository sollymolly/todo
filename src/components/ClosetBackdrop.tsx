"use client";

import { Motes } from "@/components/Backdrop";

/* --------------------------------------------------------------------------
   The Armoury's room: a small wood-panelled dressing room.

   Drawn as flat shapes with crisp edges, so it sits comfortably next to the
   pixel-art character without pretending to be a tile map. The same rules as
   the old countryside keep it behind the UI rather than in front of it:

   1. Keep the middle calm. The wardrobe hugs the left edge and the mirror and
      coat stand the right; the centre is plain wall and floor, where the
      panels sit.
   2. Sit it back. Muted, warm colours, and an ivory wash over everything.
   3. Never stretch. The picture is drawn for a wide screen and cropped to fit
      (`slice`), anchored to the floor, so shapes keep their proportions.

   The dust from the other pages drifts here too.
   -------------------------------------------------------------------------- */

const WALL = "#e6d6b8";
const PLANK = "#dac7a3";
const TRIM = "#b9966c";
const FLOOR = "#c8a37a";
const BOARD = "#b58f66";
const WOOD = "#9a7048";
const WOOD_DARK = "#7b5635";
const SHADOW = "#5f432a";

export default function ClosetBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1600 1000"
        preserveAspectRatio="xMidYMax slice"
        shapeRendering="crispEdges"
      >
        {/* ----------------------------------------------------------- wall */}
        <rect width="1600" height="1000" fill={WALL} />
        {Array.from({ length: 21 }, (_, i) => (
          <rect key={i} x={i * 80} y="0" width="3" height="780" fill={PLANK} />
        ))}
        {/* Picture rail and skirting. */}
        <rect y="120" width="1600" height="10" fill={TRIM} opacity="0.6" />
        <rect y="760" width="1600" height="30" fill={TRIM} />
        <rect y="760" width="1600" height="5" fill={WOOD_DARK} opacity="0.35" />

        {/* ---------------------------------------------------------- window */}
        <g>
          <rect x="720" y="150" width="160" height="130" fill={WOOD} />
          <rect x="732" y="162" width="136" height="106" fill="#f8efd6" />
          <rect x="798" y="162" width="4" height="106" fill={WOOD} />
          <rect x="732" y="213" width="136" height="4" fill={WOOD} />
          <rect x="712" y="280" width="176" height="12" fill={WOOD_DARK} />
        </g>
        {/* Light from it, falling across the floor. */}
        <polygon points="732,268 868,268 1060,1000 540,1000" fill="#fff6dc" opacity="0.35" />

        {/* ----------------------------------------------------------- floor */}
        <rect y="790" width="1600" height="210" fill={FLOOR} />
        {[830, 872, 916, 962].map((y, row) => (
          <g key={y}>
            <rect y={y} width="1600" height="3" fill={BOARD} />
            {Array.from({ length: 9 }, (_, i) => (
              <rect key={i} x={(i * 200 + row * 110) % 1600} y={y - (row === 0 ? 40 : 42)} width="3" height="40" fill={BOARD} />
            ))}
          </g>
        ))}
        {/* The rug, in the middle, under where you'd stand. */}
        <ellipse cx="800" cy="905" rx="330" ry="62" fill="#b86b55" opacity="0.8" shapeRendering="auto" />
        <ellipse cx="800" cy="905" rx="300" ry="50" fill="none" stroke="#e7c9a0" strokeWidth="6" opacity="0.8" shapeRendering="auto" />

        {/* -------------------------------------------------- the wardrobe */}
        <g>
          <rect x="40" y="170" width="330" height="610" fill={WOOD} />
          <rect x="30" y="150" width="350" height="30" fill={WOOD_DARK} />
          {/* Open: a dark interior with a rail, and the doors swung out. */}
          <rect x="62" y="200" width="286" height="440" fill={SHADOW} />
          <rect x="62" y="228" width="286" height="6" fill="#c8b08a" />
          {/* Hanging clothes: a tunic, a cloak, a shirt, a coat. */}
          <Garment x={82} color="#7d9270" long />
          <Garment x={146} color="#a2594c" long cloak />
          <Garment x={218} color="#e1d6bf" />
          <Garment x={282} color="#5f7896" long />
          {/* The shelf below, with boots and a folded blanket. */}
          <rect x="62" y="640" width="286" height="12" fill={WOOD_DARK} />
          <rect x="62" y="652" width="286" height="108" fill={WOOD_DARK} opacity="0.55" />
          <Boot x={88} />
          <Boot x={130} />
          <rect x="220" y="700" width="104" height="22" fill="#c9a86b" />
          <rect x="220" y="722" width="104" height="22" fill="#8b9c6f" />
          {/* The doors, swung open against the wall. */}
          <rect x="4" y="185" width="36" height="590" fill={WOOD_DARK} />
          <rect x="370" y="185" width="36" height="590" fill={WOOD_DARK} />
          <rect x="16" y="470" width="6" height="30" fill="#d8b56b" />
          <rect x="384" y="470" width="6" height="30" fill="#d8b56b" />
        </g>

        {/* ----------------------------------------------------- the mirror */}
        <g>
          <rect x="1230" y="200" width="150" height="560" fill={WOOD} />
          <rect x="1246" y="216" width="118" height="528" fill="#dfe6e3" />
          {/* A sliver of reflected light. */}
          <polygon points="1262,236 1300,236 1262,300" fill="#ffffff" opacity="0.7" />
          <polygon points="1320,560 1348,520 1348,600" fill="#ffffff" opacity="0.45" />
          <rect x="1220" y="760" width="170" height="18" fill={WOOD_DARK} />
        </g>

        {/* ------------------------------------------------- the coat stand */}
        <g>
          <rect x="1478" y="220" width="12" height="560" fill={WOOD_DARK} />
          <rect x="1440" y="770" width="88" height="12" fill={WOOD_DARK} />
          <rect x="1452" y="240" width="64" height="8" fill={WOOD_DARK} />
          {/* A cloak on one hook, a helmet on the other, a shield leaning below. */}
          <polygon points="1454,248 1474,248 1488,470 1434,470" fill="#6d5a8c" />
          <rect x="1500" y="196" width="46" height="36" fill="#a9aeb2" />
          <rect x="1500" y="212" width="46" height="6" fill="#7d8388" />
          <rect x="1514" y="232" width="18" height="10" fill="#7d8388" />
          <circle cx="1540" cy="700" r="58" fill="#a0564a" shapeRendering="auto" />
          <circle cx="1540" cy="700" r="44" fill="none" stroke="#d8b56b" strokeWidth="8" shapeRendering="auto" />
          <rect x="1534" y="660" width="12" height="80" fill="#d8b56b" />
        </g>

        {/* ------------------------------------------------------ the wash */}
        {/* Everything above, muted to sit behind ivory panels. */}
        <rect width="1600" height="1000" fill="#fbf5e6" opacity="0.42" />
      </svg>
      <Motes />
    </div>
  );
}

/** A hanging garment: a hanger hook, shoulders and a body. */
function Garment({
  x,
  color,
  long = false,
  cloak = false,
}: {
  x: number;
  color: string;
  long?: boolean;
  cloak?: boolean;
}) {
  const h = long ? 300 : 210;
  return (
    <g>
      <rect x={x + 25} y="222" width="4" height="16" fill="#c8b08a" />
      <rect x={x + 4} y="238" width="46" height="6" fill="#c8b08a" />
      {cloak ? (
        <polygon points={`${x + 6},244 ${x + 48},244 ${x + 58},${244 + h} ${x - 4},${244 + h}`} fill={color} />
      ) : (
        <>
          <rect x={x} y="244" width="54" height="40" fill={color} />
          <rect x={x + 6} y="284" width="42" height={h - 40} fill={color} />
        </>
      )}
      {/* A fold of shade down one side. */}
      <rect x={x + 38} y="250" width="6" height={h - 12} fill="#000" opacity="0.12" />
    </g>
  );
}

function Boot({ x }: { x: number }) {
  return (
    <g>
      <rect x={x} y="690" width="28" height="56" fill="#5b3f27" />
      <rect x={x} y="734" width="44" height="12" fill="#5b3f27" />
      <rect x={x} y="690" width="28" height="8" fill="#7a5638" />
    </g>
  );
}
