import type { Appearance, Equipped } from "@/lib/types";
import { houseWorld } from "@/components/village/world";

/* --------------------------------------------------------------------------
   The village: what's shared by the page, the server and the
   check-in route, so everything is judged by the same rules.
   -------------------------------------------------------------------------- */

/* ------------------------------------------------------------------ places */

/**
 * Where someone is. A place rather than a spot on a map: everyone's village
 * holds different people, so each viewer draws a friend at that place in
 * their own layout.
 *
 * "home" is being in the app but not in the village (on the quests page,
 * say): drawn at their own front door. In the village, standing by your own
 * house is "house" with your own id.
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
  | { kind: "arena" }
  /* A village's library, store and bakery: rooms of their own, like the arena. */
  | { kind: "library" }
  | { kind: "store" }
  | { kind: "bakery" };

/** Where a work session's table is: by the town hall, or in one of the rooms with tables. */
export type Spot = "hall" | "library" | "bakery";

/** "the library", for "· Ashford library". */
export const SPOT_LABEL: Record<Spot, string> = { hall: "town hall", library: "library", bakery: "bakery" };

export const readSpot = (raw: unknown): Spot => (raw === "library" || raw === "bakery" ? raw : "hall");

/** Where someone stands in a shared room, in tiles. */
export type Pos = { x: number; y: number; facing: 0 | 1 | 2 | 3 };

/** How often to check in while in a shared room: people are moving about. */
export const ROOM_PULSE_MS = 1_500;
/**
 * The same, while the live connection is up: positions and changes arrive
 * over it as they happen, so the check-in is only the backstop.
 */
export const LIVE_ROOM_PULSE_MS = 5_000;

/**
 * The space a place is, for talking: people in the same one can hear each
 * other. The square and house fronts aren't spaces for talking — nobody's
 * near enough there to hear.
 */
export function spaceOf(p: Place | null, village: number): string | null {
  if (!p) return null;
  if (p.kind === "inside") return insideSpace(p.hostId, village);
  if (p.kind === "arena") return arenaSpace(village);
  if (p.kind === "hall" || p.kind === "library" || p.kind === "store" || p.kind === "bakery") return `${p.kind}:${village}`;
  return null;
}

/** Each village's own arena, and everywhere outside in it. */
export const arenaSpace = (village: number) => `arena:${village}`;
export const outsideSpace = (village: number) => `village:${village}`;
/**
 * Inside someone's house: the one they have in every public village, or
 * the one on a planet (world.ts, houseWorld), which is a room of its own.
 */
export function insideSpace(hostId: string, village: number): string {
  const w = houseWorld(village);
  return w ? `inside:${hostId}:${w}` : `inside:${hostId}`;
}

type SpaceKind = "hall" | "arena" | "village" | "library" | "store" | "bakery" | "inside";

/**
 * A space's kind and village: "hall:2" → hall, 2. Inside a house: whose
 * (`host`), and the planet it's on — or -1, a public village's.
 */
export function readSpace(space: string): { kind: SpaceKind; village: number; host?: string } | null {
  const m = /^(hall|arena|village|library|store|bakery):(\d{1,7})$/.exec(space);
  if (m) return { kind: m[1] as SpaceKind, village: Number(m[2]) };
  const i = /^inside:([0-9a-f-]{36})(?::(\d{1,7}))?$/i.exec(space);
  return i ? { kind: "inside", village: i[2] ? Number(i[2]) : -1, host: i[1] } : null;
}

/**
 * The live connection's space for a place (src/lib/live-hub.ts): who hears
 * whose footsteps. A room or an arena is its own; everywhere outside in a
 * village is that village's, its town hall included. Being home in the app
 * isn't anywhere.
 */
export function liveSpaceOf(p: Place | null, village: number): string | null {
  if (!p || p.kind === "home") return null;
  if (p.kind === "inside" || p.kind === "arena" || p.kind === "library" || p.kind === "store" || p.kind === "bakery") return spaceOf(p, village);
  return outsideSpace(village);
}

export const SAY_MAX = 140;
/** How long a line hangs over someone's head. */
export const BUBBLE_MS = 7_000;

/** Seen this recently counts as around right now. */
export const ONLINE_MS = 45_000;
/** How often an open village checks in; the rest of the app, less often. */
export const PULSE_MS = 5_000;
export const APP_PULSE_MS = 20_000;

/**
 * What friends see of someone: not in the app (or not for a while), in the
 * app but not the village, or in the village.
 */
export type Status = "offline" | "home" | "village";

export function statusOf(p: { place: Place; seenAt: number } | undefined, now: number): Status {
  if (!p || now - p.seenAt >= ONLINE_MS) return "offline";
  return p.place.kind === "home" ? "home" : "village";
}

export const STATUS_LABEL: Record<Status, string> = { offline: "Offline", home: "At home", village: "In the village" };

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
/** Roof colours. `shop`: sold at the village store (src/lib/shop.ts), the rest free. */
export const ROOFS: { id: string; label: string; fill: string; dark: string; shop?: boolean }[] = [
  { id: "red", label: "Red", fill: "#b5523b", dark: "#8a3a29" },
  { id: "slate", label: "Slate", fill: "#5d6b7a", dark: "#434e5a" },
  { id: "moss", label: "Moss", fill: "#5f7d3a", dark: "#465e2a" },
  { id: "thatch", label: "Thatch", fill: "#c9a55a", dark: "#9f7f3d" },
  { id: "plum", label: "Plum", fill: "#7a4a6e", dark: "#5a3451" },
  { id: "teal", label: "Teal", fill: "#3f7f80", dark: "#2d5f60" },
  { id: "ochre", label: "Ochre", fill: "#c07a2c", dark: "#94591c" },
  { id: "charcoal", label: "Charcoal", fill: "#3f3d3a", dark: "#2a2826" },
  { id: "gold", label: "Gold leaf", fill: "#d9a92e", dark: "#a87a17", shop: true },
  { id: "royal", label: "Royal blue", fill: "#2f4fa3", dark: "#22397a", shop: true },
  { id: "copper", label: "Verdigris copper", fill: "#5fa391", dark: "#3f7a6a", shop: true },
  { id: "blossom", label: "Blossom", fill: "#e08aa4", dark: "#b2607a", shop: true },
  { id: "amethyst", label: "Amethyst", fill: "#6a4fb0", dark: "#4b3585", shop: true },
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

/**
 * A house's look made safe. `owned` (what they've bought, src/lib/shop.ts)
 * is checked when saving; a look already saved is shown as it is.
 */
export function cleanHouse(raw: Partial<HouseLook> | null | undefined, level: number, owned?: Set<string>): HouseLook {
  const r = raw ?? {};
  const style = STYLES.find((s) => s.style === r.style && level >= s.level)?.style ?? DEFAULT_HOUSE.style;
  const roof = ROOFS.some((x) => x.id === r.roof && (!x.shop || !owned || owned.has(`roof:${x.id}`))) ? (r.roof as string) : DEFAULT_HOUSE.roof;
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
  /** Duels won and lost. */
  duels?: { wins: number; losses: number };
};

/** A session as the village sees it. */
export type SessionView = {
  id: string;
  hostId: string;
  /** Whose town hall the table is in. */
  village: number;
  /** Out by the town hall, at a desk in the library, or at a bakery table. */
  spot: Spot;
  focus: boolean;
  /** Epoch ms the shared focus clock counts from. */
  focusFrom: number | null;
  /** The clock's rhythm: minutes of work, then of break (RHYTHMS). */
  rhythm: Rhythm;
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

/**
 * Someone with a house in the village — everyone who's been, since it's one
 * village. Companions are `known`; for anyone else the village shows their
 * house and their knight with a name, and nothing more.
 */
export type Resident = Villager & {
  plot: number;
  level: number;
  /** Best habit streak, for the garden. */
  streak: number;
  house: HouseLook;
  known: boolean;
};

/**
 * Someone about in the village, outside, or in the app ("home"): where
 * their own screen last had them, in tiles. No position when they're home.
 */
export type OutdoorPerson = {
  villager: Villager;
  known: boolean;
  place: Place;
  pos: Pos | null;
};

export type ChatLine = { id: string; authorId: string; name: string; body: string; at: number };

/** A duel as either fighter or a spectator sees it. See src/lib/duel.ts. */
export type DuelView = {
  id: string;
  a: { id: string; name: string };
  b: { id: string; name: string };
  status: "pending" | "active" | "done" | "declined" | "expired" | "cancelled";
  /** While active: when the fighting starts (after the countdown) and ends. */
  startsAt: number | null;
  endsAt: number | null;
  createdAt: number;
  hp: { a: number; b: number; aMax: number; bMax: number } | null;
  winner: string | null;
};

/** Everything a check-in returns. */
export type Pulse = {
  now: number;
  /** Who's asking — the viewer's own id. */
  me: string;
  presence: Record<string, { place: Place; seenAt: number; village: number }>;
  /** The village this check-in was from: where `outdoors` and `room` are. */
  village: number;
  /**
   * The village asked for is a planet I'm not on (any more): this check-in
   * is from `village` instead, the one my house is in, and that's where I go.
   */
  bounced?: boolean;
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
  /** Everyone else outside in the village, or at home in the app. */
  outdoors: OutdoorPerson[];
  /** Changes whenever someone gets a plot or moves house: time to redraw the village. */
  plotsAt: string;
  /**
   * I'm signed in on another device too, and that one got here first:
   * friends see me where it has me until it's closed, and this check-in
   * didn't move me.
   */
  elsewhere: boolean;
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

/** A shared focus clock's rhythm: minutes of work, then minutes of break. */
export type Rhythm = { work: number; rest: number };

/** The rhythms a table can keep. The first is the default. */
export const RHYTHMS: (Rhythm & { label: string; blurb: string })[] = [
  { work: 25, rest: 5, label: "25 / 5", blurb: "Short sprints" },
  { work: 50, rest: 10, label: "50 / 10", blurb: "Settled work" },
  { work: 90, rest: 15, label: "90 / 15", blurb: "Deep work" },
];

/** One of RHYTHMS, or the first if it isn't. */
export function cleanRhythm(r: unknown): Rhythm {
  const x = r as Partial<Rhythm> | null;
  const hit = RHYTHMS.find((k) => k.work === x?.work && k.rest === x?.rest) ?? RHYTHMS[0];
  return { work: hit.work, rest: hit.rest };
}

export const rhythmLabel = (r: Rhythm) => `${r.work} / ${r.rest}`;

/** Where a shared focus clock is: which phase, and how long is left in it. */
export function focusPhase(from: number, now: number, rhythm: Rhythm = RHYTHMS[0]): { phase: "work" | "break"; left: number } {
  const work = rhythm.work * 60_000;
  const cycle = work + rhythm.rest * 60_000;
  const t = (((now - from) % cycle) + cycle) % cycle;
  return t < work ? { phase: "work", left: work - t } : { phase: "break", left: cycle - t };
}

/** Focus XP for one 25-minute stretch at a table with `others` there too (db: award_focus_xp). */
export const focusXp = (others: number) => 3 + Math.min(3, others);

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
