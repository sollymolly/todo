/* --------------------------------------------------------------------------
   The village's landmarks (world.ts, Landmark): a general store, a library,
   a bakery, parks and gardens, drawn like the houses — flat shapes, hard
   edges, a dark outline.

   A building fills its body, 5×4 tiles (160×128 at 1×), door at the bottom
   middle. A park or garden is two drawings: the ground (paths, beds,
   benches; under everyone) over its whole 5×7-tile area, and the thing in
   the middle you walk round (a fountain, a well), sorted with the walkers.
   -------------------------------------------------------------------------- */

const OUTLINE = "#3b2a1c";
const FRAME = "#5a3e28";
const DOOR = "#6b4226";

function Sign({ x, y, w, text }: { x: number; y: number; w: number; text: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={16} fill="#e8dcc0" stroke={OUTLINE} strokeWidth={2} />
      <text x={x + w / 2} y={y + 12} textAnchor="middle" fontSize="10" fontWeight="700" fill={OUTLINE} fontFamily="Georgia, serif">
        {text}
      </text>
    </g>
  );
}

function Door({ x = 66, y = 86, w = 28, h = 38 }: { x?: number; y?: number; w?: number; h?: number }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={DOOR} stroke={OUTLINE} strokeWidth={3} />
      <rect x={x + w - 8} y={y + h / 2} width={4} height={4} fill="#e2c26a" />
    </g>
  );
}

/** Timber and plaster, a striped awning, goods in the windows. */
export function Store() {
  const goods = ["#d9432b", "#f2c14e", "#5f9e3a", "#4a7ab8", "#b86be0", "#f28a3c"];
  return (
    <svg viewBox="0 0 160 128" className="h-full w-full" shapeRendering="crispEdges" aria-hidden>
      <rect x="6" y="120" width="148" height="8" fill="#000" opacity="0.12" />
      <rect x="12" y="50" width="136" height="74" fill="#efe3c8" stroke={OUTLINE} strokeWidth="3" />
      {[12, 46, 108, 142].map((x) => (
        <rect key={x} x={x} y="50" width="6" height="74" fill="#6b4a2b" />
      ))}
      <path d="M2 54 L24 14 L136 14 L158 54 Z" fill="#8a3a29" stroke={OUTLINE} strokeWidth="3" />
      <Sign x={52} y={22} w={56} text="STORE" />
      {/* The awning */}
      {Array.from({ length: 8 }, (_, i) => (
        <rect key={i} x={10 + i * 17.5} y="56" width="17.5" height="14" fill={i % 2 ? "#f4ecd6" : "#c0392b"} />
      ))}
      <rect x="10" y="56" width="140" height="14" fill="none" stroke={OUTLINE} strokeWidth="2" />
      {/* Windows full of things */}
      {[22, 102].map((x) => (
        <g key={x}>
          <rect x={x} y="78" width="36" height="28" fill="#4a5a6e" stroke={FRAME} strokeWidth="3" />
          {goods.map((c, i) => (
            <rect key={i} x={x + 4 + (i % 3) * 10} y={84 + Math.floor(i / 3) * 10} width="7" height="7" fill={c} />
          ))}
        </g>
      ))}
      <Door />
      {/* A barrel and a crate by the door */}
      <rect x="40" y="108" width="14" height="16" rx="2" fill="#8f5a3a" stroke={OUTLINE} strokeWidth="2" />
      <rect x="40" y="114" width="14" height="2" fill={OUTLINE} />
      <rect x="104" y="110" width="16" height="14" fill="#b58b5e" stroke={OUTLINE} strokeWidth="2" />
      <path d="M104 110 L120 124 M120 110 L104 124" stroke={FRAME} strokeWidth="1.5" />
    </svg>
  );
}

/** Stone, columns and a pediment; shelves of books in the windows. */
export function Library() {
  const spines = ["#7a2a2a", "#2f4f7a", "#3f6b3a", "#a8782a", "#5a3e6e"];
  return (
    <svg viewBox="0 0 160 128" className="h-full w-full" shapeRendering="crispEdges" aria-hidden>
      <rect x="6" y="120" width="148" height="8" fill="#000" opacity="0.12" />
      <rect x="10" y="48" width="140" height="70" fill="#c9c2b6" stroke={OUTLINE} strokeWidth="3" />
      <path d="M4 50 L80 10 L156 50 Z" fill="#9aa3ad" stroke={OUTLINE} strokeWidth="3" />
      <path d="M30 46 L80 20 L130 46 Z" fill="#b8bfc7" />
      <Sign x={46} y={52} w={68} text="LIBRARY" />
      {[18, 46, 106, 134].map((x) => (
        <g key={x}>
          <rect x={x} y="72" width="8" height="46" fill="#e8e2d6" stroke={OUTLINE} strokeWidth="2" />
          <rect x={x - 2} y="70" width="12" height="4" fill="#e8e2d6" stroke={OUTLINE} strokeWidth="1.5" />
        </g>
      ))}
      {[28, 114].map((x) => (
        <g key={x}>
          <rect x={x} y="78" width="16" height="28" fill="#4a3a2a" stroke={FRAME} strokeWidth="2" />
          {spines.map((c, i) => (
            <rect key={i} x={x + 2 + i * 2.6} y={i % 2 ? 84 : 82} width="2.2" height={i % 2 ? 9 : 11} fill={c} />
          ))}
          {spines.map((c, i) => (
            <rect key={`b${i}`} x={x + 2 + i * 2.6} y={i % 2 ? 96 : 95} width="2.2" height={i % 2 ? 8 : 9} fill={spines[(i + 2) % 5]} />
          ))}
        </g>
      ))}
      <Door x={64} y={82} w={32} h={36} />
      <rect x="54" y="118" width="52" height="6" fill="#b4ada2" stroke={OUTLINE} strokeWidth="2" />
    </svg>
  );
}

/** Brick, a smoking chimney (rising past the top), loaves in the window. */
export function Bakery() {
  return (
    <svg viewBox="0 0 160 128" className="h-full w-full overflow-visible" shapeRendering="crispEdges" aria-hidden>
      <rect x="6" y="120" width="148" height="8" fill="#000" opacity="0.12" />
      <rect x="112" y="8" width="16" height="34" fill="#7d6e62" stroke={OUTLINE} strokeWidth="3" />
      <g className="house-smoke" opacity={0.7}>
        <rect x="114" y="-4" width="10" height="10" fill="#d9d4cc" />
        <rect x="120" y="-18" width="12" height="12" fill="#e6e2dc" />
        <rect x="116" y="-34" width="14" height="14" fill="#efece7" />
      </g>
      <rect x="12" y="52" width="136" height="70" fill="#b3643f" stroke={OUTLINE} strokeWidth="3" />
      {Array.from({ length: 8 }, (_, r) => (
        <rect key={r} x="12" y={60 + r * 8} width="136" height="2" fill="#8c4a2e" />
      ))}
      <path d="M2 56 L30 18 L130 18 L158 56 Z" fill="#6b4a2b" stroke={OUTLINE} strokeWidth="3" />
      {/* The sign: a loaf */}
      <circle cx="80" cy="36" r="13" fill="#e8dcc0" stroke={OUTLINE} strokeWidth="2" />
      <ellipse cx="80" cy="37" rx="8" ry="5" fill="#c98a3c" stroke={FRAME} strokeWidth="1.5" />
      <path d="M75 35 L77 39 M80 34 L82 39 M85 35 L86 38" stroke={FRAME} strokeWidth="1.2" />
      {Array.from({ length: 8 }, (_, i) => (
        <rect key={i} x={10 + i * 17.5} y="58" width="17.5" height="10" fill={i % 2 ? "#fbe7a1" : "#e0a83a"} />
      ))}
      <rect x="10" y="58" width="140" height="10" fill="none" stroke={OUTLINE} strokeWidth="2" />
      {[22, 102].map((x) => (
        <g key={x}>
          <rect x={x} y="76" width="36" height="26" fill="#ffd66b" stroke={FRAME} strokeWidth="3" />
          {[0, 1, 2].map((i) => (
            <ellipse key={i} cx={x + 8 + i * 10} cy="94" rx="5" ry="3.5" fill="#c98a3c" stroke={FRAME} strokeWidth="1" />
          ))}
        </g>
      ))}
      <Door />
    </svg>
  );
}

/** A park's ground: gravel paths round the fountain, flower beds, benches. 5×7 tiles. */
export function ParkGround() {
  const flowers = ["#e0506a", "#f2c14e", "#b86be0", "#f28a3c", "#ffffff"];
  return (
    <svg viewBox="0 0 160 224" className="h-full w-full" shapeRendering="crispEdges" aria-hidden>
      <rect x="8" y="64" width="144" height="88" rx="10" fill="#d7c7a2" />
      <rect x="64" y="152" width="32" height="72" fill="#d7c7a2" />
      {[
        [14, 70],
        [118, 70],
        [14, 124],
        [118, 124],
      ].map(([x, y], i) => (
        <g key={i}>
          <rect x={x} y={y} width="28" height="22" rx="4" fill="#7a5536" />
          {flowers.map((c, j) => (
            <rect key={j} x={x + 3 + (j % 3) * 9} y={y + 3 + Math.floor(j / 3) * 9} width="5" height="5" fill={c} />
          ))}
        </g>
      ))}
      {/* Benches either side of the way in */}
      {[30, 108].map((x) => (
        <g key={x}>
          <rect x={x} y="166" width="22" height="5" fill="#8f5a3a" stroke={OUTLINE} strokeWidth="1.5" />
          <rect x={x} y="160" width="22" height="4" fill="#a8703f" stroke={OUTLINE} strokeWidth="1.5" />
          <rect x={x + 2} y="171" width="3" height="6" fill={FRAME} />
          <rect x={x + 17} y="171" width="3" height="6" fill={FRAME} />
        </g>
      ))}
    </svg>
  );
}

/** A stone fountain, its water moving. 3 tiles wide. */
export function Fountain() {
  return (
    <svg viewBox="0 0 96 56" className="h-full w-full" shapeRendering="crispEdges" aria-hidden>
      <ellipse cx="48" cy="44" rx="44" ry="11" fill="#000" opacity="0.12" />
      <ellipse cx="48" cy="38" rx="42" ry="14" fill="#a9a196" stroke={OUTLINE} strokeWidth="3" />
      <ellipse cx="48" cy="36" rx="34" ry="9" fill="#5b9bd5" />
      <ellipse className="fountain-ripple" cx="48" cy="36" rx="20" ry="5" fill="none" stroke="#cfe8ff" strokeWidth="2" />
      <rect x="44" y="12" width="8" height="24" fill="#b4ada2" stroke={OUTLINE} strokeWidth="2" />
      <rect x="38" y="10" width="20" height="5" fill="#b4ada2" stroke={OUTLINE} strokeWidth="2" />
      <g className="fountain-spray">
        <rect x="46" y="2" width="4" height="8" fill="#cfe8ff" />
        <rect x="40" y="6" width="3" height="5" fill="#cfe8ff" />
        <rect x="53" y="6" width="3" height="5" fill="#cfe8ff" />
      </g>
    </svg>
  );
}

/** A garden's ground: rows of vegetables either side of a path. 5×7 tiles. */
export function GardenGround() {
  const crops = ["#d9432b", "#f2963c", "#6e9e2e", "#c94d8a"];
  return (
    <svg viewBox="0 0 160 224" className="h-full w-full" shapeRendering="crispEdges" aria-hidden>
      <rect x="64" y="64" width="32" height="160" fill="#c9a77a" />
      {[0, 1, 2].map((r) =>
        [10, 100].map((x) => (
          <g key={`${r}-${x}`}>
            <rect x={x} y={70 + r * 30} width="50" height="18" rx="3" fill="#6b4a2b" />
            {[0, 1, 2, 3].map((i) => (
              <g key={i}>
                <rect x={x + 6 + i * 11} y={72 + r * 30} width="3" height="8" fill="#4f8a2f" />
                <rect x={x + 4 + i * 11} y={80 + r * 30} width="7" height="5" rx="2" fill={crops[(i + r) % 4]} />
              </g>
            ))}
          </g>
        ))
      )}
      {/* A low fence along the front */}
      <rect x="6" y="166" width="58" height="3" fill="#a8703f" />
      <rect x="96" y="166" width="58" height="3" fill="#a8703f" />
      {[6, 24, 42, 60, 96, 114, 132, 150].map((x) => (
        <rect key={x} x={x} y="160" width="4" height="12" fill="#8f5a3a" />
      ))}
    </svg>
  );
}

/** A stone well with a little roof and a bucket. 1 tile wide, a bit taller. */
export function Well() {
  return (
    <svg viewBox="0 0 32 56" className="h-full w-full" shapeRendering="crispEdges" aria-hidden>
      <rect x="2" y="50" width="28" height="6" fill="#000" opacity="0.12" />
      <rect x="5" y="4" width="3" height="34" fill={FRAME} />
      <rect x="24" y="4" width="3" height="34" fill={FRAME} />
      <path d="M0 8 L16 0 L32 8 Z" fill="#8a3a29" stroke={OUTLINE} strokeWidth="2" />
      <rect x="14" y="10" width="2" height="12" fill="#3b2a1c" />
      <rect x="11" y="22" width="8" height="7" fill="#8f5a3a" stroke={OUTLINE} strokeWidth="1.5" />
      <rect x="3" y="34" width="26" height="18" fill="#a9a196" stroke={OUTLINE} strokeWidth="2.5" />
      <rect x="3" y="40" width="26" height="2" fill="#857f76" />
      <rect x="3" y="46" width="26" height="2" fill="#857f76" />
    </svg>
  );
}

/** The station: stone, a clock, a canopy over the platform side. 6×4 tiles, door at the bottom (4th tile). */
export function Station({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 192 128" className="h-full w-full" shapeRendering="crispEdges" aria-hidden>
      <rect x="6" y="120" width="180" height="8" fill="#000" opacity="0.12" />
      <rect x="10" y="40" width="172" height="82" fill="#c9a77a" stroke={OUTLINE} strokeWidth="3" />
      {Array.from({ length: 9 }, (_, r) => (
        <rect key={r} x="10" y={48 + r * 8} width="172" height="2" fill="#a8855a" />
      ))}
      <path d="M2 44 L24 10 L168 10 L190 44 Z" fill="#3e4751" stroke={OUTLINE} strokeWidth="3" />
      {/* The clock */}
      <circle cx="96" cy="26" r="11" fill="#f4ecd6" stroke={OUTLINE} strokeWidth="2" />
      <rect x="95" y="18" width="2" height="9" fill={OUTLINE} />
      <rect x="95" y="25" width="7" height="2" fill={OUTLINE} />
      <rect x="40" y="46" width="112" height="16" fill="#e8dcc0" stroke={OUTLINE} strokeWidth="2" />
      <text x="96" y="58" textAnchor="middle" fontSize="10" fontWeight="700" fill={OUTLINE} fontFamily="Georgia, serif">
        {name.toUpperCase()}
      </text>
      {[22, 52, 140, 160].map((x) => (
        <rect key={x} x={x} y="70" width="18" height="24" fill="#4a5a6e" stroke={FRAME} strokeWidth="3" />
      ))}
      {/* The canopy over the platform */}
      {Array.from({ length: 10 }, (_, i) => (
        <rect key={i} x={6 + i * 18} y="98" width="18" height="8" fill={i % 2 ? "#f4ecd6" : "#2f5d8a"} />
      ))}
      <rect x="6" y="98" width="180" height="8" fill="none" stroke={OUTLINE} strokeWidth="2" />
      <Door x={98} y={88} w={28} h={34} />
    </svg>
  );
}

/** One tile of hedge: clipped, leafy, a little darker underneath. Run side by side, they join up. */
export function Hedge() {
  return (
    <svg viewBox="0 0 32 40" className="h-full w-full" shapeRendering="crispEdges" aria-hidden>
      <rect x="0" y="34" width="32" height="6" fill="#000" opacity="0.15" />
      <rect x="-1" y="8" width="34" height="28" rx="6" fill="#3f6d2a" />
      <rect x="-1" y="8" width="34" height="18" rx="6" fill="#4f8a34" />
      <rect x="3" y="11" width="5" height="4" fill="#6aa848" />
      <rect x="14" y="13" width="6" height="4" fill="#6aa848" />
      <rect x="24" y="10" width="5" height="4" fill="#6aa848" />
      <rect x="8" y="22" width="4" height="3" fill="#35602a" />
      <rect x="21" y="24" width="4" height="3" fill="#35602a" />
    </svg>
  );
}
