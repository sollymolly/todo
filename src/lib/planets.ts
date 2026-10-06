import { cleanLine } from "@/lib/village";
import { PLANET_LOOKS, PLOTS_PER_VILLAGE, SPECIAL_LOOKS, type PlanetLook } from "@/components/village/world";

/* --------------------------------------------------------------------------
   Planets: private, invite-only worlds, reached by rocket from any station.
   What the page, the server and its actions share. Each planet is a village
   of its own (world.ts, PLANET_BASE); its members each have a house there,
   apart from the one they have in the public villages.

   Whoever founds a planet owns it: they name it, pick its look, invite
   companions or share its code, and can take anyone off it. Anyone else on
   it can leave whenever they like. For now only whoever runs this instance
   can found one (planet-server.ts, canFound).
   -------------------------------------------------------------------------- */

export const PLANET_NAME_MAX = 30;
/** Planets one person can found. */
export const MAX_OWNED = 3;
/** Planets one person can be on, their own included. */
export const MAX_PLANETS = 12;
/** One village's worth: everyone on a planet has a lot there. */
export const MAX_MEMBERS = PLOTS_PER_VILLAGE;
/** Join codes: no 0/O, 1/I/L, so one read out loud can't be got wrong. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 8;

export type PlanetView = {
  id: number;
  /** Its village number (world.ts, planetVillage). */
  v: number;
  name: string;
  look: PlanetLook;
  owner: { id: string; name: string };
  /** Only for its owner: the code that lets anyone in. */
  code: string | null;
  members: { id: string; name: string }[];
  /** Only for its owner: companions asked who haven't answered yet. */
  invited: { id: string; name: string }[];
  /** Its weekly rehearsals, earliest in the week first. */
  rehearsals: Rehearsal[];
};

/**
 * A weekly rehearsal (or any regular meeting) on a planet: everyone on it is
 * reminded REHEARSAL_LEAD_MIN before (src/lib/reminders.ts). At `minute` past
 * midnight on `weekday` (0 = Sunday), in `tz`, an IANA name.
 */
export type Rehearsal = { id: number; weekday: number; minute: number; tz: string; label: string };
export const MAX_REHEARSALS = 14;
export const REHEARSAL_LEAD_MIN = 15;
export const REHEARSAL_LABEL_MAX = 40;
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const cleanRehearsalLabel = (raw: unknown) => cleanLine(raw, REHEARSAL_LABEL_MAX);

/** Minutes past midnight as "7:00 pm". */
export function clockLabel(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** An invitation to a planet I'm not on yet. */
export type PlanetInvite = { planetId: number; name: string; look: PlanetLook; from: string; members: number };

/** `canFound`: may I start planets of my own (for now, only whoever runs this instance). */
export type Planets = { planets: PlanetView[]; invites: PlanetInvite[]; canFound: boolean };

export const cleanPlanetName = (raw: unknown) => cleanLine(raw, PLANET_NAME_MAX);

/** A look someone picked: one of PLANET_LOOKS, never a special one. */
export function cleanLook(raw: unknown): PlanetLook {
  return PLANET_LOOKS.find((l) => l.look === raw)?.look ?? PLANET_LOOKS[0].look;
}

/** A look as the database has it, special ones included. */
export function readLook(raw: unknown): PlanetLook {
  return [...PLANET_LOOKS, ...SPECIAL_LOOKS].find((l) => l.look === raw)?.look ?? PLANET_LOOKS[0].look;
}

/** A code as typed — any case, spaces or dashes — or null if it can't be one. */
export function cleanCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.toUpperCase().replace(/[\s-]/g, "");
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c)) ? code : null;
}

/** "ABCD-EFGH": easier to read out. */
export const showCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;
