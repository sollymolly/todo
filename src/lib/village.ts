import type { Appearance, Equipped } from "@/lib/types";

/* --------------------------------------------------------------------------
   The village (migration 026): what's shared by the page, the server and the
   check-in route, so everything is judged by the same rules.
   -------------------------------------------------------------------------- */

/* ------------------------------------------------------------------ places */

/**
 * Where someone is. A place rather than a spot on a map: everyone's village
 * holds different people, so each viewer draws a friend at that place in
 * their own layout.
 */
export type Place =
  | { kind: "home" }
  | { kind: "square" }
  | { kind: "hall" }
  | { kind: "house"; hostId: string }
  /* Migration 027: inside someone's house, or in the arena. These two are
     real shared rooms — the same layout for everyone — so they carry a
     position too. */
  | { kind: "inside"; hostId: string }
  | { kind: "arena" };

/** Where someone stands in a shared room, in tiles. */
export type Pos = { x: number; y: number; facing: 0 | 1 | 2 | 3 };

/** How often to check in while in a shared room: people are moving about. */
export const ROOM_PULSE_MS = 1_500;

/**
 * The space a place is, for talking: people in the same one can hear each
 * other. The square and house fronts aren't spaces — everyone's village is
 * laid out differently, so "near you" out there means nothing to anyone else.
 */
export function spaceOf(p: Place | null): string | null {
  if (!p) return null;
  if (p.kind === "inside") return `inside:${p.hostId}`;
  if (p.kind === "arena") return "arena";
  if (p.kind === "hall") return "hall";
  return null;
}

export const SAY_MAX = 140;
/** How long a line hangs over someone's head. */
export const BUBBLE_MS = 7_000;

/** Seen this recently counts as in the village right now. */
export const ONLINE_MS = 45_000;
/** How often an open village checks in; a session elsewhere, less often. */
export const PULSE_MS = 5_000;
export const SESSION_PULSE_MS = 20_000;

/* ------------------------------------------------------------------ houses */

export type HouseStyle = "timber" | "stone" | "brick";
export type Garden = "flowers" | "vegetables" | "hedges";
export type HouseLook = { style: HouseStyle; roof: string; garden: Garden };

export const DEFAULT_HOUSE: HouseLook = { style: "timber", roof: "red", garden: "flowers" };

/** How big a house is, from its owner's level. */
export type Tier = "tent" | "hut" | "cottage" | "house" | "manor" | "keep";

export const TIERS: { tier: Tier; from: number; label: string }[] = [
  { tier: "tent", from: 1, label: "Tent" },
  { tier: "hut", from: 2, label: "Hut" },
  { tier: "cottage", from: 4, label: "Cottage" },
  { tier: "house", from: 7, label: "House" },
  { tier: "manor", from: 11, label: "Manor" },
  { tier: "keep", from: 16, label: "Keep" },
];

export function tierFor(level: number): (typeof TIERS)[number] {
  return [...TIERS].reverse().find((t) => level >= t.from) ?? TIERS[0];
}

/** Walls. The better ones unlock with level, like armour does. */
export const STYLES: { style: HouseStyle; label: string; level: number }[] = [
  { style: "timber", label: "Timber", level: 1 },
  { style: "stone", label: "Stone", level: 5 },
  { style: "brick", label: "Brick", level: 9 },
];

/** Roof colours. All free: a colour is taste, not an achievement. */
export const ROOFS: { id: string; label: string; fill: string; dark: string }[] = [
  { id: "red", label: "Red", fill: "#b5523b", dark: "#8a3a29" },
  { id: "slate", label: "Slate", fill: "#5d6b7a", dark: "#434e5a" },
  { id: "moss", label: "Moss", fill: "#5f7d3a", dark: "#465e2a" },
  { id: "thatch", label: "Thatch", fill: "#c9a55a", dark: "#9f7f3d" },
  { id: "plum", label: "Plum", fill: "#7a4a6e", dark: "#5a3451" },
  { id: "teal", label: "Teal", fill: "#3f7f80", dark: "#2d5f60" },
  { id: "ochre", label: "Ochre", fill: "#c07a2c", dark: "#94591c" },
  { id: "charcoal", label: "Charcoal", fill: "#3f3d3a", dark: "#2a2826" },
];

export const GARDENS: { garden: Garden; label: string }[] = [
  { garden: "flowers", label: "Flowers" },
  { garden: "vegetables", label: "Vegetables" },
  { garden: "hedges", label: "Hedges" },
];

/** How lush a garden is, from its owner's best habit streak. 0 is bare soil. */
export function bloomFor(streak: number): 0 | 1 | 2 | 3 {
  if (streak >= 14) return 3;
  if (streak >= 7) return 2;
  if (streak >= 1) return 1;
  return 0;
}

export function cleanHouse(raw: Partial<HouseLook> | null | undefined, level: number): HouseLook {
  const r = raw ?? {};
  const style = STYLES.find((s) => s.style === r.style && level >= s.level)?.style ?? DEFAULT_HOUSE.style;
  const roof = ROOFS.some((x) => x.id === r.roof) ? (r.roof as string) : DEFAULT_HOUSE.roof;
  const garden = GARDENS.some((g) => g.garden === r.garden) ? (r.garden as Garden) : DEFAULT_HOUSE.garden;
  return { style, roof, garden };
}

/* ------------------------------------------------------------------ nudges */

export const NUDGE_PRESETS = [
  "Get to work!",
  "You've got this.",
  "Join my work session?",
  "How's it going?",
  "Don't forget your habits!",
] as const;

export const NUDGE_MAX = 80;
export const NOTE_MAX = 140;
/** One nudge per friend per this long, from the same person. */
export const NUDGE_EVERY_MS = 3 * 60 * 60 * 1000;

/** Text made safe to store: one line, trimmed, within the limit. */
export function cleanLine(raw: unknown, max: number): string {
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/* ------------------------------------------------------------------ people */

/** Someone the village draws. Friends carry more than people met at a table. */
export type Villager = {
  id: string;
  name: string;
  appearance: Appearance;
  equipped: Equipped;
};

export type Neighbour = Villager & {
  xp: number;
  level: number;
  streak: number;
  doneToday: number;
  house: HouseLook;
  categories: { name: string; color: string; open: number }[];
  /** Duels won and lost (migration 027). */
  duels?: { wins: number; losses: number };
};

/** A session as the village sees it. */
export type SessionView = {
  id: string;
  hostId: string;
  focus: boolean;
  /** Epoch ms the shared focus clock counts from. */
  focusFrom: number | null;
  startedAt: number;
  members: {
    villager: Villager;
    /** Friends of the viewer (or the viewer) — the rest are "knight and name only". */
    known: boolean;
    joinedAt: number;
    /** The category of the quest they're on, if they picked one. */
    working: { name: string; color: string } | null;
  }[];
};

export type RoomPerson = { villager: Villager; known: boolean; x: number; y: number; facing: 0 | 1 | 2 | 3 };

export type ChatLine = { id: string; authorId: string; name: string; body: string; at: number };

/** A duel as either fighter or a spectator sees it. Moves not yet revealed stay hidden. */
export type DuelView = {
  id: string;
  a: { id: string; name: string };
  b: { id: string; name: string };
  status: "pending" | "active" | "done" | "declined" | "expired" | "cancelled";
  round: number;
  roundEndsAt: number | null;
  createdAt: number;
  hp: { a: number; b: number; aMax: number; bMax: number } | null;
  /** Whether each side has chosen this round — never what. */
  picked: { a: boolean; b: boolean };
  /** The viewer's own pick this round, if they're fighting and have picked. */
  myMove: "strike" | "guard" | "feint" | null;
  last: { r: number; a: "strike" | "guard" | "feint" | null; b: "strike" | "guard" | "feint" | null; ad: number; bd: number } | null;
  winner: string | null;
};

/** Everything a check-in returns. */
export type Pulse = {
  now: number;
  /** Who's asking — the viewer's own id. */
  me: string;
  presence: Record<string, { place: Place; seenAt: number }>;
  sessions: SessionView[];
  /** The viewer's own open seat, if any. */
  mySessionId: string | null;
  /** XP just paid for focus time on this check-in. */
  focusXp: number;
  nudges: NudgeView[];
  /** The shared space I'm in — who's there, and what's been said. */
  room: { space: string; people: RoomPerson[]; chat: ChatLine[] } | null;
  /** Duels I'm in, or can watch from where I am. */
  duels: DuelView[];
};

export type NudgeView = {
  id: string;
  fromName: string;
  body: string;
  /** "your Work quest due 5:00 PM" — never a title. */
  about: string | null;
  at: number;
};

/* ------------------------------------------------------------ focus clock */

export const ROUND_MS = 25 * 60 * 1000;
export const BREAK_MS = 5 * 60 * 1000;

/** Where a shared focus clock is: which phase, and how long is left in it. */
export function focusPhase(from: number, now: number): { phase: "work" | "break"; left: number } {
  const t = (((now - from) % (ROUND_MS + BREAK_MS)) + (ROUND_MS + BREAK_MS)) % (ROUND_MS + BREAK_MS);
  return t < ROUND_MS ? { phase: "work", left: ROUND_MS - t } : { phase: "break", left: ROUND_MS + BREAK_MS - t };
}

export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

export function minutesLabel(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
