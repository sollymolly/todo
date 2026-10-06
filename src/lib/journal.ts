/* --------------------------------------------------------------------------
   The journal: the notebook on the desk at home. What a page and the server
   agree on (src/lib/journal-actions.ts is the server side).

   An entry is a day and time (when it was begun, which can be changed), a
   topic, how the day felt and what the weather was, and what was written.
   -------------------------------------------------------------------------- */

/** The most one entry holds, in characters (the table's check says the same). */
export const JOURNAL_MAX = 10_000;
export const TOPIC_MAX = 80;

export const MOODS = [
  { id: "great", label: "Great", icon: "😄" },
  { id: "good", label: "Good", icon: "🙂" },
  { id: "okay", label: "Okay", icon: "😐" },
  { id: "low", label: "Low", icon: "😔" },
  { id: "rough", label: "Rough", icon: "😣" },
] as const;

export const WEATHER = [
  { id: "sunny", label: "Sunny", icon: "☀️" },
  { id: "cloudy", label: "Cloudy", icon: "☁️" },
  { id: "rainy", label: "Rainy", icon: "🌧️" },
  { id: "stormy", label: "Stormy", icon: "⛈️" },
  { id: "snowy", label: "Snowy", icon: "❄️" },
  { id: "windy", label: "Windy", icon: "🍃" },
] as const;

/**
 * `at`: the day and time the entry is for (when it was begun, unless
 * changed); `edited`: when it was last saved. Both ms since the epoch.
 */
export type JournalEntry = {
  id: string;
  body: string;
  topic: string;
  mood: string | null;
  weather: string | null;
  at: number;
  edited: number;
};

/** What a page sends to be kept. */
export type JournalDraft = Pick<JournalEntry, "body" | "topic" | "mood" | "weather" | "at">;

/** What someone typed, made safe to keep: lines kept, stray carriage returns and trailing space gone, cut to size. */
export function cleanBody(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim().slice(0, JOURNAL_MAX) : "";
}

/** A topic: one line, cut to size. */
export function cleanTopic(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, TOPIC_MAX) : "";
}

/** One of `list`'s ids, or null. */
export function cleanChoice(raw: unknown, list: readonly { id: string }[]): string | null {
  return list.some((c) => c.id === raw) ? (raw as string) : null;
}

/** A day and time for an entry: any from 1900 to a day from now, or null if it isn't one. */
export function cleanAt(raw: unknown, now = Date.now()): number | null {
  const ms = Math.round(Number(raw));
  return Number.isFinite(ms) && ms >= Date.UTC(1900, 0, 1) && ms <= now + 86_400_000 ? ms : null;
}
