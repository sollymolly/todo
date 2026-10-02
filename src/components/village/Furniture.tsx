import { FURNITURE, type FurnitureKind } from "@/lib/furniture";

/* --------------------------------------------------------------------------
   The furniture, drawn in code like the houses: flat shapes, hard edges.

   Each piece fills its footprint (w×h tiles of 32px, at 1×) and tall ones
   rise above it by LIFT px — a bookshelf stands up against the wall, the way
   rooms look in Animal Crossing's three-quarter view. Wall hangings are
   drawn on the back wall instead, 32 wide.
   -------------------------------------------------------------------------- */

export const LIFT: Record<FurnitureKind, number> = {
  bed: 14, table: 10, chair: 16, stool: 6, plant: 22, rug: 0, lamp: 30, chest: 8,
  bookshelf: 44, desk: 14, sofa: 16, armorstand: 34, fireplace: 40, trophy: 22, throne: 44,
  painting: 0, window: 0, clock: 0, mirror: 0, banner: 0,
  piano: 30, aquarium: 26, telescope: 30, stainedglass: 0,
};

const INK = "#3b2a1c";
const WOOD = "#9a7048";
const WOOD_D = "#7b5635";
const WOOD_L = "#b58b5e";

function body(kind: FurnitureKind, w: number, h: number): React.ReactNode {
  const W = w * 32;
  const H = h * 32;
  switch (kind) {
    case "bed":
      return (
        <g>
          <rect x={2} y={-12} width={W - 4} height={20} rx={3} fill={WOOD_D} stroke={INK} strokeWidth={2} />
          <rect x={3} y={4} width={W - 6} height={H - 6} rx={3} fill="#f4ecd6" stroke={INK} strokeWidth={2} />
          <rect x={8} y={8} width={W - 16} height={12} rx={4} fill="#ffffff" stroke="#d8ccb2" strokeWidth={2} />
          <rect x={3} y={24} width={W - 6} height={H - 26} rx={3} fill="#6f8fbf" stroke={INK} strokeWidth={2} />
          <rect x={3} y={24} width={W - 6} height={6} fill="#89a6cf" />
        </g>
      );
    case "table":
      return (
        <g>
          <rect x={6} y={10} width={4} height={H - 10} fill={WOOD_D} />
          <rect x={W - 10} y={10} width={4} height={H - 10} fill={WOOD_D} />
          <rect x={1} y={-8} width={W - 2} height={20} rx={4} fill={WOOD_L} stroke={INK} strokeWidth={2} />
          <rect x={W / 2 - 6} y={-5} width={12} height={8} rx={2} fill="#f4ecd6" />
        </g>
      );
    case "chair":
      return (
        <g>
          <rect x={7} y={-14} width={18} height={24} rx={2} fill={WOOD} stroke={INK} strokeWidth={2} />
          <rect x={5} y={10} width={22} height={10} rx={2} fill="#b5523b" stroke={INK} strokeWidth={2} />
          <rect x={7} y={20} width={3} height={10} fill={WOOD_D} />
          <rect x={22} y={20} width={3} height={10} fill={WOOD_D} />
        </g>
      );
    case "stool":
      return (
        <g>
          <rect x={10} y={10} width={3} height={18} fill={WOOD_D} />
          <rect x={19} y={10} width={3} height={18} fill={WOOD_D} />
          <ellipse cx={16} cy={8} rx={11} ry={6} fill={WOOD_L} stroke={INK} strokeWidth={2} />
        </g>
      );
    case "plant":
      return (
        <g>
          <path d="M8 16 L24 16 L22 30 L10 30 Z" fill="#b8683f" stroke={INK} strokeWidth={2} />
          <ellipse cx={16} cy={2} rx={12} ry={12} fill="#4f8a2f" stroke="#2f5a1a" strokeWidth={2} />
          <ellipse cx={10} cy={-8} rx={6} ry={7} fill="#5f9e3a" />
          <ellipse cx={21} cy={-12} rx={6} ry={7} fill="#6aa843" />
        </g>
      );
    case "rug":
      return (
        <g>
          <rect x={2} y={4} width={W - 4} height={H - 8} rx={4} fill="#a8453b" stroke={INK} strokeWidth={2} />
          <rect x={8} y={10} width={W - 16} height={H - 20} rx={3} fill="none" stroke="#e8c47a" strokeWidth={3} />
          <rect x={W / 2 - 8} y={H / 2 - 8} width={16} height={16} transform={`rotate(45 ${W / 2} ${H / 2})`} fill="#e8c47a" />
        </g>
      );
    case "lamp":
      return (
        <g>
          <rect x={10} y={24} width={12} height={5} rx={2} fill={WOOD_D} />
          <rect x={15} y={-12} width={3} height={38} fill={INK} />
          <path d="M6 -12 L26 -12 L21 -28 L11 -28 Z" fill="#f2d48a" stroke={INK} strokeWidth={2} />
        </g>
      );
    case "chest":
      return (
        <g>
          <rect x={3} y={4} width={26} height={24} rx={2} fill={WOOD} stroke={INK} strokeWidth={2} />
          <path d="M3 10 Q16 -6 29 10" fill={WOOD_L} stroke={INK} strokeWidth={2} />
          <rect x={3} y={9} width={26} height={3} fill="#c9a24a" />
          <rect x={14} y={12} width={5} height={6} fill="#e2c26a" stroke={INK} strokeWidth={1} />
        </g>
      );
    case "bookshelf":
      return (
        <g>
          <rect x={1} y={-44} width={W - 2} height={H + 42} fill={WOOD} stroke={INK} strokeWidth={2} />
          {[-38, -16, 6].map((y) => (
            <g key={y}>
              <rect x={5} y={y + 18} width={W - 10} height={3} fill={WOOD_D} />
              {Array.from({ length: 8 }, (_, i) => (
                <rect key={i} x={6 + i * 6.8} y={y + (i % 3)} width={5.5} height={18 - (i % 3)} fill={["#b5523b", "#5d6b7a", "#5f7d3a", "#c9a55a", "#7a4a6e"][i % 5]} />
              ))}
            </g>
          ))}
        </g>
      );
    case "desk":
      return (
        <g>
          <rect x={2} y={-6} width={W - 4} height={H + 2} fill={WOOD} stroke={INK} strokeWidth={2} />
          <rect x={W - 26} y={6} width={20} height={16} fill={WOOD_D} stroke={INK} strokeWidth={1} />
          <rect x={10} y={-12} width={16} height={10} fill="#f4ecd6" transform="rotate(-8 18 -7)" />
          <rect x={34} y={-16} width={2} height={14} fill="#f4ecd6" transform="rotate(20 35 -9)" />
        </g>
      );
    case "sofa":
      return (
        <g>
          <rect x={2} y={-14} width={W - 4} height={22} rx={6} fill="#5f7d3a" stroke={INK} strokeWidth={2} />
          <rect x={2} y={4} width={W - 4} height={20} rx={4} fill="#6e9146" stroke={INK} strokeWidth={2} />
          <rect x={0} y={-4} width={8} height={28} rx={3} fill="#4f6a2f" stroke={INK} strokeWidth={2} />
          <rect x={W - 8} y={-4} width={8} height={28} rx={3} fill="#4f6a2f" stroke={INK} strokeWidth={2} />
        </g>
      );
    case "armorstand":
      return (
        <g>
          <rect x={8} y={26} width={16} height={4} fill={WOOD_D} />
          <rect x={15} y={-10} width={3} height={38} fill={WOOD_D} />
          <path d="M6 -22 L26 -22 L24 6 L8 6 Z" fill="#aab3bd" stroke={INK} strokeWidth={2} />
          <rect x={11} y={-34} width={10} height={12} rx={4} fill="#c3cad1" stroke={INK} strokeWidth={2} />
          <rect x={6} y={-16} width={20} height={3} fill="#8c96a1" />
        </g>
      );
    case "fireplace":
      return (
        <g>
          <rect x={0} y={-40} width={W} height={H + 38} fill="#a39c90" stroke={INK} strokeWidth={2} />
          <rect x={-2} y={-44} width={W + 4} height={8} fill="#8a847b" stroke={INK} strokeWidth={2} />
          <path d={`M12 ${H - 2} V-8 A20 16 0 0 1 ${W - 12} -8 V${H - 2} Z`} fill="#2c2018" />
          <path d={`M22 ${H - 4} Q26 ${H - 26} 32 ${H - 16} Q36 ${H - 34} 42 ${H - 4} Z`} fill="#f2963c" className="fire-flicker" />
          <path d={`M27 ${H - 4} Q31 ${H - 16} 34 ${H - 10} Q38 ${H - 20} 38 ${H - 4} Z`} fill="#ffd66b" className="fire-flicker" />
        </g>
      );
    case "trophy":
      return (
        <g>
          <rect x={7} y={14} width={18} height={14} fill={WOOD_D} stroke={INK} strokeWidth={2} />
          <rect x={14} y={2} width={4} height={12} fill="#d9a92b" />
          <path d="M6 -18 L26 -18 Q26 4 16 4 Q6 4 6 -18 Z" fill="#f2c14e" stroke={INK} strokeWidth={2} />
          <path d="M6 -14 Q0 -12 6 -4 M26 -14 Q32 -12 26 -4" fill="none" stroke="#d9a92b" strokeWidth={3} />
        </g>
      );
    case "throne":
      return (
        <g>
          <path d={`M6 -44 L${W - 6} -44 L${W - 10} 10 L10 10 Z`} fill="#d9a92b" stroke={INK} strokeWidth={2} />
          <rect x={14} y={-36} width={W - 28} height={40} rx={4} fill="#a8453b" />
          <rect x={4} y={6} width={W - 8} height={18} rx={3} fill="#a8453b" stroke={INK} strokeWidth={2} />
          <rect x={2} y={-4} width={8} height={28} fill="#d9a92b" stroke={INK} strokeWidth={2} />
          <rect x={W - 10} y={-4} width={8} height={28} fill="#d9a92b" stroke={INK} strokeWidth={2} />
          <circle cx={W / 2} cy={-40} r={5} fill="#e0506a" stroke={INK} strokeWidth={2} />
        </g>
      );
    case "painting":
      return (
        <g>
          <rect x={3} y={6} width={26} height={22} fill="#c9a24a" stroke={INK} strokeWidth={2} />
          <rect x={6} y={9} width={20} height={16} fill="#a9cfe0" />
          <path d="M6 25 L12 16 L17 21 L21 15 L26 25 Z" fill="#5f7d3a" />
          <circle cx={21} cy={12} r={2} fill="#ffd66b" />
        </g>
      );
    case "window":
      return (
        <g>
          <rect x={4} y={4} width={24} height={26} fill="#cfe8f5" stroke={WOOD_D} strokeWidth={3} />
          <rect x={15} y={4} width={2} height={26} fill={WOOD_D} />
          <rect x={4} y={16} width={24} height={2} fill={WOOD_D} />
          <rect x={2} y={29} width={28} height={4} fill={WOOD_L} stroke={INK} strokeWidth={1} />
        </g>
      );
    case "clock":
      return (
        <g>
          <circle cx={16} cy={16} r={12} fill="#f4ecd6" stroke={WOOD_D} strokeWidth={3} />
          <path d="M16 16 V8 M16 16 L21 19" stroke={INK} strokeWidth={2} strokeLinecap="round" />
        </g>
      );
    case "mirror":
      return (
        <g>
          <ellipse cx={16} cy={17} rx={11} ry={14} fill="#dfeef5" stroke="#c9a24a" strokeWidth={3} />
          <path d="M10 10 L14 8 M10 16 L18 10" stroke="#ffffff" strokeWidth={2} />
        </g>
      );
    case "banner":
      return (
        <g>
          <rect x={4} y={2} width={24} height={3} fill={WOOD_D} />
          <path d="M7 5 L25 5 L25 32 L16 26 L7 32 Z" fill="#a8453b" stroke={INK} strokeWidth={2} />
          <path d="M16 11 L19 16 L16 21 L13 16 Z" fill="#e8c47a" />
        </g>
      );
    case "piano":
      return (
        <g>
          <rect x={2} y={-30} width={W - 4} height={H + 26} fill="#2a1d16" stroke={INK} strokeWidth={2} />
          <rect x={6} y={-24} width={W - 12} height={14} fill="#3d2a1f" />
          <rect x={W / 2 - 8} y={-22} width={16} height={10} fill="#f4ecd6" stroke="#8a7a66" strokeWidth={1} />
          <rect x={0} y={0} width={W} height={12} fill="#3d2a1f" stroke={INK} strokeWidth={2} />
          <rect x={3} y={2} width={W - 6} height={8} fill="#fbf7ee" />
          {Array.from({ length: 9 }, (_, i) =>
            i % 7 === 2 || i % 7 === 6 ? null : <rect key={i} x={7 + i * 6.4} y={2} width={3} height={5} fill="#1a1410" />
          )}
          <rect x={6} y={12} width={4} height={H - 14} fill="#2a1d16" />
          <rect x={W - 10} y={12} width={4} height={H - 14} fill="#2a1d16" />
          <rect x={W / 2 - 4} y={H - 6} width={8} height={4} fill="#d9a92e" />
        </g>
      );
    case "aquarium":
      return (
        <g>
          <rect x={2} y={8} width={W - 4} height={H - 8} fill={WOOD_D} stroke={INK} strokeWidth={2} />
          <rect x={2} y={-26} width={W - 4} height={36} fill="#7fc4e0" stroke={INK} strokeWidth={2} />
          <rect x={4} y={-22} width={W - 8} height={4} fill="#a9dcef" />
          <rect x={4} y={2} width={W - 8} height={6} fill="#e3d2a4" />
          <path d="M12 6 Q8 -6 13 -14 M16 6 Q19 -4 15 -10" fill="none" stroke="#3f7a3a" strokeWidth={2} />
          <ellipse cx={40} cy={-10} rx={6} ry={4} fill="#f28a3c" stroke={INK} strokeWidth={1} />
          <path d="M34 -10 L29 -14 L29 -6 Z" fill="#f28a3c" stroke={INK} strokeWidth={1} />
          <ellipse cx={30} cy={0} rx={4} ry={2.5} fill="#f2c14e" />
          <path d="M34 0 L37 -2 L37 2 Z" fill="#f2c14e" />
          {[[50, -6], [52, -14], [49, -20]].map(([x, y]) => (
            <circle key={y} cx={x} cy={y} r={1.6} fill="none" stroke="#ffffff" strokeWidth={1} />
          ))}
        </g>
      );
    case "telescope":
      return (
        <g>
          <path d="M16 6 L7 30 M16 6 L25 30 M16 6 L16 30" stroke={WOOD_D} strokeWidth={3} />
          <g transform="rotate(-30 16 -6)">
            <rect x={2} y={-11} width={28} height={9} rx={2} fill="#c9a24a" stroke={INK} strokeWidth={2} />
            <rect x={26} y={-13} width={6} height={13} rx={1} fill="#8a6a2a" stroke={INK} strokeWidth={1.5} />
          </g>
          <circle cx={16} cy={5} r={3} fill="#5a3e28" stroke={INK} strokeWidth={1} />
        </g>
      );
    case "stainedglass":
      return (
        <g>
          <path d="M5 32 V12 A11 11 0 0 1 27 12 V32 Z" fill="#3b2a1c" stroke={INK} strokeWidth={2} />
          <path d="M8 30 V13 A8 8 0 0 1 16 5 V30 Z" fill="#c0392b" />
          <path d="M16 5 A8 8 0 0 1 24 13 V30 H16 Z" fill="#2f4fa3" />
          <rect x={8} y={18} width={16} height={6} fill="#f2c14e" />
          <path d="M16 5 V30 M8 18 H24 M8 24 H24" stroke="#3b2a1c" strokeWidth={1.5} />
          <circle cx={16} cy={13} r={2.5} fill="#5f9e3a" stroke="#3b2a1c" strokeWidth={1} />
        </g>
      );
  }
}

/** A piece at 1× px; the caller positions and scales it. */
export default function Furniture({ kind, ghost = false }: { kind: FurnitureKind; ghost?: boolean }) {
  const spec = FURNITURE[kind];
  const W = spec.w * 32;
  const H = spec.layer === "wall" ? 36 : spec.h * 32;
  const lift = LIFT[kind];
  return (
    <svg
      viewBox={`0 ${-lift} ${W} ${H + lift}`}
      width={W}
      height={H + lift}
      shapeRendering="crispEdges"
      aria-hidden
      style={ghost ? { opacity: 0.6 } : undefined}
      className="block h-full w-full"
    >
      {body(kind, spec.w, spec.layer === "wall" ? 1 : spec.h)}
    </svg>
  );
}
