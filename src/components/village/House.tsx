import { ROOFS, type Garden, type HouseLook, type HouseStyle, type Tier } from "@/lib/village";

/* --------------------------------------------------------------------------
   A house, drawn to fill its 8×7-tile plot (256×224 at 1×).

   Flat shapes with hard edges, like the Armoury room: a house has to take
   any roof colour and any wall style, which a fixed tile sheet can't. Tiles
   1–7 across and 1–6 down are the building; the bottom row is the front
   garden, a bed either side of the path to the door (tile 4).

   What it shows:
     size      the owner's level (tent → keep)
     walls     timber, stone or brick, the owner's choice
     roof      the owner's colour
     garden    how lush follows their best habit streak
     windows   lit while they're at a work session
     chimney   smoking while they're in the village
   -------------------------------------------------------------------------- */

const WALL: Record<HouseStyle, { fill: string; line: string }> = {
  timber: { fill: "#efe3c8", line: "#6b4a2b" },
  stone: { fill: "#aaa49a", line: "#857f76" },
  brick: { fill: "#b3643f", line: "#8c4a2e" },
};

const DOOR = "#6b4226";
const FRAME = "#5a3e28";
const OUTLINE = "#3b2a1c";

function Walls({ style, x, y, w, h }: { style: HouseStyle; x: number; y: number; w: number; h: number }) {
  const c = WALL[style];
  const lines: React.ReactNode[] = [];
  if (style === "timber") {
    // Beams: posts at the corners and every ~40px, a rail at mid-height.
    for (let px = x; px <= x + w; px += Math.max(32, Math.round(w / 4)))
      lines.push(<rect key={`p${px}`} x={Math.min(px, x + w - 6)} y={y} width={6} height={h} fill={c.line} />);
    lines.push(<rect key="rail" x={x} y={y + Math.round(h / 2) - 3} width={w} height={5} fill={c.line} />);
  } else {
    // Courses of blocks, staggered.
    const bh = style === "brick" ? 8 : 14;
    const bw = style === "brick" ? 18 : 28;
    for (let row = 0, py = y + bh; py < y + h; row++, py += bh) {
      lines.push(<rect key={`r${py}`} x={x} y={py} width={w} height={2} fill={c.line} />);
      for (let px = x + (row % 2 ? bw / 2 : 0); px < x + w; px += bw)
        lines.push(<rect key={`b${py}-${px}`} x={px} y={py - bh} width={2} height={bh} fill={c.line} />);
    }
  }
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={c.fill} />
      {lines}
      <rect x={x} y={y} width={w} height={h} fill="none" stroke={OUTLINE} strokeWidth={3} />
    </g>
  );
}

function Window({ x, y, w = 24, h = 22, lit }: { x: number; y: number; w?: number; h?: number; lit: boolean }) {
  return (
    <g>
      {lit && <rect x={x - 4} y={y - 4} width={w + 8} height={h + 8} fill="#ffd66b" opacity={0.35} />}
      <rect x={x} y={y} width={w} height={h} fill={lit ? "#ffd66b" : "#4a5a6e"} stroke={FRAME} strokeWidth={3} />
      <rect x={x + w / 2 - 1} y={y} width={2} height={h} fill={FRAME} />
      <rect x={x} y={y + h / 2 - 1} width={w} height={2} fill={FRAME} />
    </g>
  );
}

function Door({ x, y, w = 24, h = 40, arch = false }: { x: number; y: number; w?: number; h?: number; arch?: boolean }) {
  return (
    <g>
      {arch ? (
        <path d={`M${x} ${y + h} V${y + w / 2} A${w / 2} ${w / 2} 0 0 1 ${x + w} ${y + w / 2} V${y + h} Z`} fill={DOOR} stroke={OUTLINE} strokeWidth={3} />
      ) : (
        <rect x={x} y={y} width={w} height={h} fill={DOOR} stroke={OUTLINE} strokeWidth={3} />
      )}
      <rect x={x + w - 8} y={y + h / 2} width={4} height={4} fill="#e2c26a" />
    </g>
  );
}

function Smoke({ x, y }: { x: number; y: number }) {
  return (
    <g className="house-smoke" opacity={0.7}>
      <rect x={x} y={y - 12} width={10} height={10} fill="#d9d4cc" />
      <rect x={x + 6} y={y - 26} width={12} height={12} fill="#e6e2dc" />
      <rect x={x + 2} y={y - 42} width={14} height={14} fill="#efece7" />
    </g>
  );
}

function Bed({ x, garden, bloom }: { x: number; garden: Garden; bloom: number }) {
  const y = 194;
  const parts: React.ReactNode[] = [<rect key="soil" x={x + 2} y={y + 6} width={60} height={20} rx={3} fill="#7a5536" />];
  if (garden === "hedges") {
    const hh = [6, 12, 18, 24][bloom];
    parts.push(<rect key="h" x={x + 4} y={y + 26 - hh} width={56} height={hh} rx={5} fill="#4f7d34" stroke="#34561f" strokeWidth={2} />);
    if (bloom >= 3) parts.push(<rect key="h2" x={x + 10} y={y + 4} width={10} height={6} fill="#6e9e48" />);
  } else {
    const cols = [x + 10, x + 24, x + 38, x + 52];
    cols.forEach((cx, i) => {
      if (bloom === 0) {
        parts.push(<rect key={`d${i}`} x={cx - 3} y={y + 14} width={6} height={3} fill="#5c3f27" />);
        return;
      }
      const stem = 4 + bloom * 4;
      parts.push(<rect key={`s${i}`} x={cx - 1} y={y + 22 - stem} width={3} height={stem} fill="#4f8a2f" />);
      parts.push(<rect key={`l${i}`} x={cx - 5} y={y + 18 - stem / 2} width={10} height={4} fill="#5f9e3a" />);
      if (bloom >= 2) {
        const color =
          garden === "flowers" ? ["#e0506a", "#f2c14e", "#b86be0", "#f28a3c"][i] : ["#d9432b", "#f2963c", "#6e9e2e", "#d9432b"][i];
        const s = garden === "flowers" ? 7 + bloom : 6 + bloom * 2;
        parts.push(<rect key={`f${i}`} x={cx - s / 2} y={y + 20 - stem - s / 2} width={s} height={s} rx={garden === "flowers" ? 1 : 3} fill={color} />);
      }
    });
  }
  return <g>{parts}</g>;
}

export default function House({
  tier,
  look,
  bloom,
  lit,
  smoke,
}: {
  tier: Tier;
  look: HouseLook;
  bloom: number;
  lit: boolean;
  smoke: boolean;
}) {
  const roof = ROOFS.find((r) => r.id === look.roof) ?? ROOFS[0];
  const style = look.style;

  let building: React.ReactNode;
  switch (tier) {
    case "tent":
      building = (
        <g>
          <path d="M52 192 L128 70 L204 192 Z" fill={roof.fill} stroke={OUTLINE} strokeWidth={3} />
          <path d="M128 70 L150 192 L128 192 Z" fill={roof.dark} />
          <path d="M128 120 L146 192 L128 192 Z" fill="#2c2018" />
          <rect x={126} y={58} width={4} height={14} fill={OUTLINE} />
          {lit && <rect x={70} y={170} width={10} height={14} fill="#ffd66b" stroke={OUTLINE} strokeWidth={2} />}
        </g>
      );
      break;
    case "hut":
      building = (
        <g>
          <Walls style={style} x={64} y={124} w={128} h={68} />
          <path d="M44 128 L128 62 L212 128 Z" fill={roof.fill} stroke={OUTLINE} strokeWidth={3} />
          <path d="M128 62 L212 128 L128 128 Z" fill={roof.dark} opacity={0.5} />
          <Window x={80} y={144} lit={lit} />
          <Door x={132} y={152} h={40} />
        </g>
      );
      break;
    case "cottage":
      building = (
        <g>
          <rect x={172} y={52} width={18} height={40} fill="#7d6e62" stroke={OUTLINE} strokeWidth={3} />
          {smoke && <Smoke x={174} y={52} />}
          <Walls style={style} x={40} y={108} w={176} h={84} />
          <path d="M26 112 L128 44 L230 112 Z" fill={roof.fill} stroke={OUTLINE} strokeWidth={3} />
          <path d="M128 44 L230 112 L128 112 Z" fill={roof.dark} opacity={0.5} />
          <Window x={60} y={132} lit={lit} />
          <Window x={176} y={132} lit={lit} />
          <Door x={132} y={148} h={44} />
        </g>
      );
      break;
    case "house":
      building = (
        <g>
          <rect x={176} y={34} width={18} height={40} fill="#7d6e62" stroke={OUTLINE} strokeWidth={3} />
          {smoke && <Smoke x={178} y={34} />}
          <Walls style={style} x={40} y={80} w={176} h={112} />
          <path d="M28 84 L128 30 L228 84 Z" fill={roof.fill} stroke={OUTLINE} strokeWidth={3} />
          <path d="M128 30 L228 84 L128 84 Z" fill={roof.dark} opacity={0.5} />
          <Window x={58} y={96} lit={lit} />
          <Window x={116} y={96} lit={lit} />
          <Window x={174} y={96} lit={lit} />
          <Window x={58} y={144} lit={lit} />
          <Window x={176} y={144} lit={lit} />
          <Door x={132} y={148} h={44} />
        </g>
      );
      break;
    case "manor":
      building = (
        <g>
          <rect x={52} y={30} width={16} height={36} fill="#7d6e62" stroke={OUTLINE} strokeWidth={3} />
          <rect x={188} y={30} width={16} height={36} fill="#7d6e62" stroke={OUTLINE} strokeWidth={3} />
          {smoke && <Smoke x={190} y={30} />}
          <Walls style={style} x={32} y={84} w={192} h={108} />
          <path d="M22 88 L64 40 L192 40 L234 88 Z" fill={roof.fill} stroke={OUTLINE} strokeWidth={3} />
          <path d="M100 88 L144 34 L188 88 Z" fill={roof.dark} stroke={OUTLINE} strokeWidth={3} />
          <Window x={46} y={100} lit={lit} />
          <Window x={90} y={100} lit={lit} />
          <Window x={132} y={100} w={24} lit={lit} />
          <Window x={186} y={100} lit={lit} />
          <Window x={46} y={148} lit={lit} />
          <Window x={90} y={148} lit={lit} />
          <Window x={186} y={148} lit={lit} />
          <Door x={130} y={144} w={28} h={48} arch />
        </g>
      );
      break;
    case "keep":
      building = (
        <g>
          <rect x={126} y={4} width={3} height={36} fill={OUTLINE} />
          <path d="M129 6 L160 13 L129 22 Z" fill={roof.fill} stroke={OUTLINE} strokeWidth={2} />
          <Walls style="stone" x={44} y={52} w={168} h={140} />
          {[44, 76, 108, 140, 172].map((x) => (
            <rect key={x} x={x} y={38} width={20} height={16} fill={WALL.stone.fill} stroke={OUTLINE} strokeWidth={3} />
          ))}
          <rect x={44} y={52} width={168} height={10} fill={roof.fill} stroke={OUTLINE} strokeWidth={3} />
          {[62, 118, 174].map((x) => (
            <Window key={x} x={x} y={80} w={14} h={30} lit={lit} />
          ))}
          <Window x={62} y={132} w={14} h={30} lit={lit} />
          <Window x={174} y={132} w={14} h={30} lit={lit} />
          <Door x={126} y={138} w={36} h={54} arch />
        </g>
      );
      break;
  }

  return (
    <svg viewBox="0 0 256 224" width={256} height={224} shapeRendering="crispEdges" aria-hidden>
      {/* Shadow on the ground, then the building, then the garden in front.
          The path to the door is the ground's own dirt, under tile 4. */}
      <rect x={36} y={186} width={184} height={10} fill="#000" opacity={0.12} />
      {building}
      <Bed x={32} garden={look.garden} bloom={bloom} />
      <Bed x={160} garden={look.garden} bloom={bloom} />
    </svg>
  );
}
