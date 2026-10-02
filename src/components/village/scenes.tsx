"use client";

import Furniture, { LIFT } from "@/components/village/Furniture";
import { FLOORS, FURNITURE, WALLS } from "@/lib/furniture";
import { TreatShape } from "@/components/village/Treat";
import { T } from "@/components/village/world";
import type { ArenaScene, IndoorScene, RoomScene } from "@/components/village/rooms";

/* --------------------------------------------------------------------------
   Drawing the shared rooms. Positions are grid tiles × 32 × scale, the same
   as the village, and furniture is z-sorted by where its feet are so a knight
   walks behind a bookshelf and in front of a bed's footboard.
   -------------------------------------------------------------------------- */

export function RoomView({ room, scale: S, onPiece }: { room: RoomScene; scale: number; onPiece?: (index: number) => void }) {
  const wall = WALLS.find((w) => w.id === room.interior.wall) ?? WALLS[0];
  const floor = FLOORS.find((f) => f.id === room.interior.floor) ?? FLOORS[0];
  const W = room.w * T;
  const H = room.h * T;
  const checker = !!floor.tiles;

  return (
    <>
      <svg
        aria-hidden
        className="pointer-events-none absolute left-0 top-0"
        style={{ width: W * S, height: H * S }}
        viewBox={`0 0 ${W} ${H}`}
        shapeRendering="crispEdges"
      >
        <defs>
          <pattern id="floorpat" width={checker ? 64 : 32} height={checker ? 64 : 16} patternUnits="userSpaceOnUse">
            {checker ? (
              <>
                <rect width="64" height="64" fill={floor.a} />
                <rect width="32" height="32" fill={floor.b} />
                <rect x="32" y="32" width="32" height="32" fill={floor.b} />
              </>
            ) : (
              <>
                <rect width="32" height="16" fill={floor.a} />
                <rect y="15" width="32" height="1" fill={floor.b} />
                <rect x="20" width="1" height="16" fill={floor.b} />
              </>
            )}
          </pattern>
          <pattern id="wallpat" width="16" height="16" patternUnits="userSpaceOnUse">
            <rect width="16" height="16" fill={wall.fill} />
            {wall.id === "stripes" && <rect width="5" height="16" fill={wall.line} opacity="0.5" />}
            {(wall.id === "brick" || wall.id === "stone") && (
              <>
                <rect y="7" width="16" height="1.5" fill={wall.line} />
                <rect x="7" width="1.5" height="7" fill={wall.line} />
              </>
            )}
            {(wall.id === "panel" || wall.id === "gilded") && <rect x="15" width="1" height="16" fill={wall.line} />}
            {wall.id === "gilded" && <rect y="11" width="16" height="1" fill={wall.line} opacity="0.6" />}
            {wall.id === "ivy" && (
              <>
                <path d="M0 0 L16 16 M16 0 L0 16" stroke="#b7a57a" strokeWidth="1" />
                <rect x="3" y="6" width="3" height="3" fill={wall.line} />
                <rect x="11" y="2" width="3" height="2" fill="#78a548" />
              </>
            )}
            {wall.id === "damask" && <path d="M8 3 L11 8 L8 13 L5 8 Z" fill={wall.line} opacity="0.55" />}
            {!["stripes", "brick", "stone", "panel", "gilded", "ivy", "damask"].includes(wall.id) && <circle cx="8" cy="8" r="1" fill={wall.line} />}
          </pattern>
        </defs>
        {/* The dark all round is the rest of the house. */}
        <rect width={W} height={H} fill="#2c2018" />
        <rect x={T} y={2 * T} width={(room.w - 2) * T} height={(room.h - 3) * T} fill="url(#floorpat)" />
        <rect x={T} y={0} width={(room.w - 2) * T} height={2 * T} fill="url(#wallpat)" />
        <rect x={T} y={2 * T - 6} width={(room.w - 2) * T} height={6} fill="#6b4a2b" />
        <rect x={T} y={2 * T} width={(room.w - 2) * T} height={8} fill="#000" opacity="0.12" />
        {/* Door and mat */}
        <rect x={room.door.x * T + 2} y={room.door.y * T} width={T - 4} height={T} fill="#6b4226" />
        <rect x={room.door.x * T - 6} y={(room.door.y - 1) * T + 14} width={T + 12} height={16} rx="3" fill="#8f5a3a" />
      </svg>

      {room.interior.items.map((it, i) => {
        const spec = FURNITURE[it.k];
        const lift = LIFT[it.k];
        const isWall = spec.layer === "wall";
        const left = (it.x + 1) * T;
        const top = isWall ? 0.4 * T : (it.y + 2) * T - lift;
        const h = isWall ? 36 : spec.h * T + lift;
        const z = isWall ? 1 : spec.layer === "rug" ? 2 : (it.y + 2 + spec.h) * T;
        return (
          <div
            key={`${it.k}-${it.x}-${it.y}-${i}`}
            className={`absolute ${onPiece ? "cursor-pointer hover:brightness-110" : "pointer-events-none"}`}
            style={{ left: left * S, top: top * S, width: spec.w * T * S, height: h * S, zIndex: z }}
            onPointerDown={
              onPiece
                ? (e) => {
                    e.stopPropagation();
                    onPiece(i);
                  }
                : undefined
            }
          >
            <Furniture kind={it.k} />
          </div>
        );
      })}
    </>
  );
}

export function ArenaView({ arena, scale: S }: { arena: ArenaScene; scale: number }) {
  const W = arena.w * T;
  const H = arena.h * T;
  const { cx, cy, r } = arena.ring;
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute left-0 top-0"
      style={{ width: W * S, height: H * S }}
      viewBox={`0 0 ${W} ${H}`}
      shapeRendering="crispEdges"
    >
      <defs>
        <pattern id="dirtpat" width="32" height="32" patternUnits="userSpaceOnUse">
          <rect width="32" height="32" fill="#c9a06a" />
          <rect x="5" y="7" width="3" height="2" fill="#b58b56" />
          <rect x="21" y="18" width="4" height="2" fill="#b58b56" />
          <rect x="12" y="26" width="2" height="2" fill="#d8b27f" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="#5f8f34" />
      <rect x={T} y={2 * T} width={W - 2 * T} height={H - 3 * T} fill="url(#dirtpat)" />
      {/* The ring */}
      <ellipse cx={(cx + 0.5) * T} cy={(cy + 0.5) * T} rx={r * T} ry={r * T * 0.7} fill="none" stroke="#f1e6cc" strokeWidth="4" strokeDasharray="10 8" />
      {/* Stands along the back, with pennants */}
      <rect x={T} y={0} width={W - 2 * T} height={2 * T} fill="#8a6848" />
      {[0.25, 0.9, 1.55].map((row) => (
        <rect key={row} x={T} y={row * T} width={W - 2 * T} height={8} fill="#6b4a2b" />
      ))}
      {Array.from({ length: arena.w - 2 }, (_, i) => (
        <path key={i} d={`M${(i + 1) * T + 8} ${2 * T - 2} l8 12 l8 -12 Z`} fill={i % 2 ? "#b5523b" : "#e8c47a"} />
      ))}
      {/* Fence posts and rails */}
      <rect x={0} y={2 * T} width={T} height={H - 2 * T} fill="#5f8f34" />
      <rect x={W - T} y={2 * T} width={T} height={H - 2 * T} fill="#5f8f34" />
      <rect x={T - 6} y={2 * T} width={6} height={H - 2 * T} fill="#7b5635" />
      <rect x={W - T} y={2 * T} width={6} height={H - 2 * T} fill="#7b5635" />
      <rect x={T - 6} y={H - T} width={arena.gate.x * T - T + 6} height={8} fill="#7b5635" />
      <rect x={(arena.gate.x + 1) * T} y={H - T} width={W - (arena.gate.x + 2) * T + 6} height={8} fill="#7b5635" />
      <rect x={arena.gate.x * T - 4} y={H - T - 20} width={6} height={28} fill="#5a3e28" />
      <rect x={(arena.gate.x + 1) * T - 2} y={H - T - 20} width={6} height={28} fill="#5a3e28" />
    </svg>
  );
}

/** The arena's gatehouse, out in the village. */
export function ArenaGate() {
  return (
    <svg viewBox="0 0 160 128" className="h-full w-full" shapeRendering="crispEdges" aria-hidden>
      <rect x="6" y="118" width="148" height="8" fill="#000" opacity="0.12" />
      <rect x="10" y="40" width="140" height="82" fill="#aaa49a" stroke="#3b2a1c" strokeWidth="3" />
      {[10, 38, 66, 94, 122].map((x) => (
        <rect key={x} x={x} y="26" width="20" height="16" fill="#aaa49a" stroke="#3b2a1c" strokeWidth="3" />
      ))}
      {Array.from({ length: 5 }, (_, r) => (
        <rect key={r} x="10" y={52 + r * 14} width="140" height="2" fill="#857f76" />
      ))}
      <path d="M62 122 V86 A18 18 0 0 1 98 86 V122 Z" fill="#2c2018" stroke="#3b2a1c" strokeWidth="3" />
      <rect x="44" y="48" width="72" height="18" fill="#e8dcc0" stroke="#3b2a1c" strokeWidth="2" />
      <text x="80" y="61" textAnchor="middle" fontSize="11" fontWeight="700" fill="#3b2a1c" fontFamily="Georgia, serif">
        ARENA
      </text>
      <rect x="18" y="4" width="3" height="26" fill="#3b2a1c" />
      <path d="M21 5 L40 10 L21 16 Z" fill="#b5523b" />
      <rect x="138" y="4" width="3" height="26" fill="#3b2a1c" />
      <path d="M141 5 L122 10 L141 16 Z" fill="#b5523b" />
    </svg>
  );
}

const SPINES = ["#7a2a2a", "#2f4f7a", "#3f6b3a", "#a8782a", "#5a3e6e", "#8a5a2a"];

/** A run of bookshelf, `w` px wide and `h` tall, books on every shelf. */
function Shelf({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const rows = Math.max(1, Math.floor((h - 6) / 14));
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill="#6b4a2b" stroke="#3b2a1c" strokeWidth="2" />
      {Array.from({ length: rows }, (_, r) =>
        Array.from({ length: Math.floor((w - 6) / 5) }, (_, i) => (
          <rect key={`${r}-${i}`} x={x + 3 + i * 5} y={y + 4 + r * 14 + (i % 3)} width="4" height={10 - (i % 3)} fill={SPINES[(i * 7 + r * 3) % SPINES.length]} />
        ))
      )}
      {Array.from({ length: rows }, (_, r) => (
        <rect key={r} x={x} y={y + 15 + r * 14} width={w} height="2" fill="#4a3320" />
      ))}
    </g>
  );
}

/** The library: shelves all along the walls, four study desks with lamps, a rug down the aisle. */
export function LibraryView({ scene, scale: S }: { scene: IndoorScene; scale: number }) {
  const W = scene.w * T;
  const H = scene.h * T;
  return (
    <svg aria-hidden className="pointer-events-none absolute left-0 top-0" style={{ width: W * S, height: H * S }} viewBox={`0 0 ${W} ${H}`} shapeRendering="crispEdges">
      <rect width={W} height={H} fill="#2c2018" />
      <rect x={T} y={2 * T} width={W - 2 * T} height={H - 3 * T} fill="#8f6240" />
      {Array.from({ length: scene.h - 3 }, (_, r) => (
        <rect key={r} x={T} y={(2 + r) * T + T - 2} width={W - 2 * T} height="2" fill="#7d5436" />
      ))}
      {/* The back wall is all books */}
      <rect x={T} y={0} width={W - 2 * T} height={2 * T} fill="#5a3e28" />
      {Array.from({ length: Math.floor((scene.w - 2) / 2) }, (_, i) => (
        <Shelf key={i} x={T + i * 2 * T + 2} y={6} w={2 * T - 4} h={2 * T - 8} />
      ))}
      {/* A long rug from the door to the back */}
      <rect x={(scene.door.x - 1) * T + 6} y={2 * T + 6} width={3 * T - 12} height={H - 3 * T - 6} fill="#7a2a2a" />
      <rect x={(scene.door.x - 1) * T + 10} y={2 * T + 10} width={3 * T - 20} height={H - 3 * T - 14} fill="none" stroke="#c9a14a" strokeWidth="2" />
      {scene.desks.map((d, i) => (
        <g key={i}>
          <rect x={d.x * T + 2} y={d.y * T + 4} width={d.w * T - 4} height={T - 4} fill="#a8703f" stroke="#3b2a1c" strokeWidth="2" />
          <rect x={d.x * T + 2} y={d.y * T + 4} width={d.w * T - 4} height="5" fill="#c08a52" />
          {/* A green-shaded lamp and open books */}
          <rect x={d.x * T + d.w * T / 2 - 2} y={d.y * T - 8} width="4" height="14" fill="#5a3e28" />
          <path d={`M${d.x * T + d.w * T / 2 - 9} ${d.y * T - 6} L${d.x * T + d.w * T / 2 + 9} ${d.y * T - 6} L${d.x * T + d.w * T / 2 + 6} ${d.y * T - 14} L${d.x * T + d.w * T / 2 - 6} ${d.y * T - 14} Z`} fill="#3f7a4a" stroke="#22422a" strokeWidth="1.5" />
          <rect x={d.x * T + 10} y={d.y * T + 12} width="14" height="9" fill="#f4ecd6" stroke="#8a7a66" strokeWidth="1" />
          <rect x={d.x * T + d.w * T - 26} y={d.y * T + 12} width="14" height="9" fill="#f4ecd6" stroke="#8a7a66" strokeWidth="1" />
        </g>
      ))}
      <rect x={scene.door.x * T + 2} y={scene.door.y * T} width={T - 4} height={T} fill="#6b4226" />
    </svg>
  );
}

/** The store: shelves of goods down both sides, a counter at the back with a bell and the till. */
export function StoreView({ scene, scale: S }: { scene: IndoorScene; scale: number }) {
  const W = scene.w * T;
  const H = scene.h * T;
  const c = scene.counter!;
  const goods = ["#d9432b", "#f2c14e", "#5f9e3a", "#4a7ab8", "#b86be0", "#f28a3c", "#7cc4f0"];
  return (
    <svg aria-hidden className="pointer-events-none absolute left-0 top-0" style={{ width: W * S, height: H * S }} viewBox={`0 0 ${W} ${H}`} shapeRendering="crispEdges">
      <rect width={W} height={H} fill="#2c2018" />
      <rect x={T} y={2 * T} width={W - 2 * T} height={H - 3 * T} fill="#c9a77a" />
      {Array.from({ length: (scene.w - 2) * (scene.h - 3) }, (_, i) => {
        const x = 1 + (i % (scene.w - 2));
        const y = 2 + Math.floor(i / (scene.w - 2));
        return (x + y) % 2 ? <rect key={i} x={x * T} y={y * T} width={T} height={T} fill="#b8966a" /> : null;
      })}
      <rect x={T} y={0} width={W - 2 * T} height={2 * T} fill="#efe3c8" />
      {[T + 8, W - T - 72].map((x) => (
        <g key={x}>
          <rect x={x} y={10} width="64" height="40" fill="#8f5a3a" stroke="#3b2a1c" strokeWidth="2" />
          {goods.map((g, i) => (
            <rect key={i} x={x + 5 + (i % 4) * 15} y={14 + Math.floor(i / 4) * 18} width="10" height="12" rx="2" fill={g} />
          ))}
        </g>
      ))}
      {/* Side shelves */}
      {[T, W - 2 * T].map((x) => (
        <g key={x}>
          <rect x={x + 2} y={2 * T} width={T - 4} height={(scene.h - 4) * T} fill="#8f5a3a" stroke="#3b2a1c" strokeWidth="2" />
          {Array.from({ length: (scene.h - 4) * 2 }, (_, i) => (
            <rect key={i} x={x + 8} y={2 * T + 6 + i * 16} width={T - 16} height="9" rx="2" fill={goods[(i + x) % goods.length]} />
          ))}
        </g>
      ))}
      {/* The counter */}
      <rect x={c.x * T} y={c.y * T + 2} width={c.w * T} height={T - 2} fill="#a8703f" stroke="#3b2a1c" strokeWidth="2" />
      <rect x={c.x * T} y={c.y * T + 2} width={c.w * T} height="6" fill="#c08a52" />
      <circle cx={c.x * T + 20} cy={c.y * T + 6} r="5" fill="#e2c26a" stroke="#8a6a2a" strokeWidth="1.5" />
      <rect x={(c.x + c.w) * T - 34} y={c.y * T - 8} width="24" height="16" fill="#5a6470" stroke="#3b2a1c" strokeWidth="1.5" />
      <rect x={scene.door.x * T + 2} y={scene.door.y * T} width={T - 4} height={T} fill="#6b4226" />
    </svg>
  );
}

/** The bakery: a brick oven in the back wall, loaves on the shelves, a glass case of treats, a café table. */
export function BakeryView({ scene, scale: S }: { scene: IndoorScene; scale: number }) {
  const W = scene.w * T;
  const H = scene.h * T;
  const c = scene.counter!;
  const oven = { x: 7 * T, w: 4 * T };
  return (
    <svg aria-hidden className="pointer-events-none absolute left-0 top-0" style={{ width: W * S, height: H * S }} viewBox={`0 0 ${W} ${H}`} shapeRendering="crispEdges">
      <rect width={W} height={H} fill="#2c2018" />
      {/* Terracotta tiles */}
      <rect x={T} y={2 * T} width={W - 2 * T} height={H - 3 * T} fill="#d29a72" />
      {Array.from({ length: (scene.w - 2) * (scene.h - 3) }, (_, i) => {
        const x = 1 + (i % (scene.w - 2));
        const y = 2 + Math.floor(i / (scene.w - 2));
        return (
          <g key={i}>
            {(x + y) % 2 ? <rect x={x * T} y={y * T} width={T} height={T} fill="#c48a63" /> : null}
            <rect x={x * T} y={y * T + T - 1} width={T} height="1" fill="#a87250" />
            <rect x={x * T + T - 1} y={y * T} width="1" height={T} fill="#a87250" />
          </g>
        );
      })}
      {/* The back wall: plaster, shelves of bread, the oven */}
      <rect x={T} y={0} width={W - 2 * T} height={2 * T} fill="#f3e6c8" />
      <rect x={T} y={2 * T - 6} width={W - 2 * T} height={6} fill="#6b4a2b" />
      {[10, 34].map((y) => (
        <g key={y}>
          <rect x={T + 6} y={y + 12} width={5 * T - 12} height="4" fill="#8f5a3a" stroke="#3b2a1c" strokeWidth="1" />
          {Array.from({ length: 7 }, (_, i) => (
            <ellipse key={i} cx={T + 18 + i * 20} cy={y + 8} rx="8" ry="5" fill={i % 3 ? "#c98a3c" : "#a8692c"} stroke="#7a4a1c" strokeWidth="1" />
          ))}
        </g>
      ))}
      <rect x={oven.x} y={2} width={oven.w} height={2 * T - 6} fill="#b3643f" stroke="#3b2a1c" strokeWidth="2" />
      {Array.from({ length: 6 }, (_, r) => (
        <rect key={r} x={oven.x} y={10 + r * 9} width={oven.w} height="1.5" fill="#8c4a2e" />
      ))}
      <path
        d={`M${oven.x + 22} ${2 * T - 6} V${T + 2} A${oven.w / 2 - 22} 20 0 0 1 ${oven.x + oven.w - 22} ${T + 2} V${2 * T - 6} Z`}
        fill="#2c2018"
        stroke="#3b2a1c"
        strokeWidth="2"
      />
      <path d={`M${oven.x + 40} ${2 * T - 6} Q${oven.x + 48} ${T + 8} ${oven.x + 56} ${2 * T - 14} Q${oven.x + 64} ${T + 2} ${oven.x + 72} ${2 * T - 14} Q${oven.x + 80} ${T + 10} ${oven.x + 88} ${2 * T - 6} Z`} fill="#f2963c" className="fire-flicker" />
      <path d={`M${oven.x + 50} ${2 * T - 6} Q${oven.x + 58} ${T + 24} ${oven.x + 64} ${2 * T - 12} Q${oven.x + 70} ${T + 24} ${oven.x + 78} ${2 * T - 6} Z`} fill="#ffd66b" className="fire-flicker" />
      {/* Flour sacks */}
      {[2, 3].map((y) => (
        <g key={y}>
          <path d={`M${(scene.w - 2) * T + 4} ${(y + 1) * T - 2} L${(scene.w - 2) * T + 6} ${y * T + 6} Q${(scene.w - 1.5) * T} ${y * T - 2} ${(scene.w - 1) * T - 6} ${y * T + 6} L${(scene.w - 1) * T - 4} ${(y + 1) * T - 2} Z`} fill="#efe8da" stroke="#3b2a1c" strokeWidth="2" />
          <rect x={(scene.w - 2) * T + 10} y={y * T + 14} width="12" height="6" fill="#c9a24a" />
        </g>
      ))}
      {/* The glass case of treats, the till at its end */}
      <rect x={c.x * T} y={c.y * T - 10} width={c.w * T} height={T + 8} fill="#a8703f" stroke="#3b2a1c" strokeWidth="2" />
      <rect x={c.x * T + 4} y={c.y * T - 6} width={c.w * T - 40} height={20} fill="#dff0f5" stroke="#5a6470" strokeWidth="1.5" />
      {(["croissant", "bun", "cupcake", "pie", "cake", "loaf"] as const).map((id, i) => (
        <TreatShape key={id} id={id} x={c.x * T + 8 + i * 19} y={c.y * T - 6} size={18} />
      ))}
      <rect x={c.x * T + 4} y={c.y * T - 6} width={c.w * T - 40} height="3" fill="#ffffff" opacity="0.6" />
      <rect x={(c.x + c.w) * T - 30} y={c.y * T - 12} width="24" height="16" fill="#5a6470" stroke="#3b2a1c" strokeWidth="1.5" />
      <rect x={c.x * T} y={c.y * T + 14} width={c.w * T} height="6" fill="#c08a52" />
      {/* A café table and two stools */}
      {[8, 10].map((x) => (
        <ellipse key={x} cx={x * T + 16} cy={5 * T + 20} rx="9" ry="6" fill="#8f5a3a" stroke="#3b2a1c" strokeWidth="2" />
      ))}
      <rect x={9 * T + 14} y={5 * T + 10} width="4" height="18" fill="#5a3e28" />
      <ellipse cx={9 * T + 16} cy={5 * T + 10} rx="14" ry="8" fill="#efe3c8" stroke="#3b2a1c" strokeWidth="2" />
      <TreatShape id="croissant" x={9 * T + 6} y={5 * T - 2} size={16} />
      <rect x={9 * T + 20} y={5 * T + 2} width="6" height="7" fill="#f4ecd6" stroke="#3b2a1c" strokeWidth="1" />
      <rect x={scene.door.x * T + 2} y={scene.door.y * T} width={T - 4} height={T} fill="#6b4226" />
      <rect x={scene.door.x * T - 6} y={(scene.door.y - 1) * T + 14} width={T + 12} height={16} rx="3" fill="#8f5a3a" />
    </svg>
  );
}
