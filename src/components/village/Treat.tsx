import type { TreatId } from "@/lib/bakery";

/* --------------------------------------------------------------------------
   The bakery's treats (src/lib/bakery.ts), drawn like everything else in the
   village: flat shapes, hard edges, a dark outline. 32×32 at 1×.
   -------------------------------------------------------------------------- */

const INK = "#3b2a1c";
const CRUST = "#c98a3c";
const CRUST_D = "#9a6428";

function body(id: TreatId) {
  switch (id) {
    case "loaf":
      return (
        <g>
          <ellipse cx="16" cy="20" rx="13" ry="8" fill={CRUST} stroke={INK} strokeWidth="2" />
          <ellipse cx="16" cy="17" rx="10" ry="4" fill="#dba45a" />
          <path d="M9 15 L12 21 M15 14 L18 21 M21 15 L23 20" stroke={CRUST_D} strokeWidth="1.5" />
        </g>
      );
    case "croissant":
      return (
        <g>
          <path d="M3 22 Q6 10 16 9 Q26 10 29 22 Q24 18 16 18 Q8 18 3 22 Z" fill="#e0a64c" stroke={INK} strokeWidth="2" />
          <path d="M10 12 L12 19 M16 10 L16 18 M22 12 L20 19" stroke={CRUST_D} strokeWidth="1.5" />
        </g>
      );
    case "bun":
      return (
        <g>
          <ellipse cx="16" cy="19" rx="12" ry="9" fill="#d29a55" stroke={INK} strokeWidth="2" />
          <path d="M16 19 m-2.5 0 a2.5 2 0 1 1 5 0 a5 4 0 1 1 -10 0 a7.5 6 0 1 1 15 0" fill="none" stroke="#8a5424" strokeWidth="1.6" />
          <path d="M7 14 Q10 11 13 13 M19 12 Q23 11 25 14" stroke="#fff6e4" strokeWidth="2" strokeLinecap="round" />
        </g>
      );
    case "cupcake":
      return (
        <g>
          <path d="M8 18 L24 18 L21 29 L11 29 Z" fill="#e2c26a" stroke={INK} strokeWidth="2" />
          <path d="M12 19 L13 28 M16 19 L16 28 M20 19 L19 28" stroke="#c9a24a" strokeWidth="1.2" />
          <path d="M6 19 Q6 9 16 8 Q26 9 26 19 Z" fill="#f2a0b8" stroke={INK} strokeWidth="2" />
          <rect x="10" y="12" width="2" height="2" fill="#7cc4f0" />
          <rect x="18" y="11" width="2" height="2" fill="#f2c14e" />
          <rect x="14" y="15" width="2" height="2" fill="#5f9e3a" />
          <circle cx="16" cy="6" r="3" fill="#c0392b" stroke={INK} strokeWidth="1.5" />
        </g>
      );
    case "pie":
      return (
        <g>
          <ellipse cx="16" cy="21" rx="14" ry="7" fill="#b8b2a6" stroke={INK} strokeWidth="2" />
          <ellipse cx="16" cy="18" rx="12" ry="6" fill="#dba45a" stroke={INK} strokeWidth="2" />
          <path d="M8 16 L24 20 M8 20 L24 16 M12 14 L20 22 M20 14 L12 22" stroke="#7a2f5a" strokeWidth="1.6" />
          <ellipse cx="16" cy="18" rx="12" ry="6" fill="none" stroke={CRUST_D} strokeWidth="2" />
        </g>
      );
    case "cake":
      return (
        <g>
          <rect x="5" y="15" width="22" height="13" fill="#fbf3e4" stroke={INK} strokeWidth="2" />
          <rect x="5" y="20" width="22" height="3" fill="#f2a0b8" />
          <path d="M5 15 Q8 19 11 15 Q14 19 17 15 Q20 19 23 15 Q25 18 27 15" fill="none" stroke="#f2a0b8" strokeWidth="2" />
          {[10, 16, 22].map((x) => (
            <g key={x}>
              <rect x={x - 1} y="8" width="2" height="7" fill={x === 16 ? "#7cc4f0" : "#f2c14e"} />
              <path d={`M${x} 3 Q${x + 2} 6 ${x} 8 Q${x - 2} 6 ${x} 3 Z`} fill="#f2963c" className="fire-flicker" />
            </g>
          ))}
        </g>
      );
  }
}

/** A treat drawn inside another drawing: `size` px square, its top-left at x, y. */
export function TreatShape({ id, x, y, size }: { id: TreatId; x: number; y: number; size: number }) {
  return <g transform={`translate(${x} ${y}) scale(${size / 32})`}>{body(id)}</g>;
}

export default function TreatArt({ id, className = "h-full w-full" }: { id: TreatId; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      {body(id)}
    </svg>
  );
}
