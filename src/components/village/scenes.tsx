"use client";

import Furniture, { LIFT } from "@/components/village/Furniture";
import { FLOORS, FURNITURE, WALLS } from "@/lib/furniture";
import { T } from "@/components/village/world";
import type { ArenaScene, RoomScene } from "@/components/village/rooms";

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
  const checker = floor.id === "checker";

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
            {wall.id === "panel" && <rect x="15" width="1" height="16" fill={wall.line} />}
            {!["stripes", "brick", "stone", "panel"].includes(wall.id) && <circle cx="8" cy="8" r="1" fill={wall.line} />}
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
