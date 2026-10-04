/* --------------------------------------------------------------------------
   The journal: the notebook on the desk at home. What a page and the server
   agree on (src/lib/journal-actions.ts is the server side).
   -------------------------------------------------------------------------- */

/** The most one entry holds, in characters (the table's check says the same). */
export const JOURNAL_MAX = 10_000;

/** `at`: when it was begun; `edited`: when it was last saved. Both ms since the epoch. */
export type JournalEntry = { id: string; body: string; at: number; edited: number };

/** What someone typed, made safe to keep: lines kept, stray carriage returns and trailing space gone, cut to size. */
export function cleanBody(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim().slice(0, JOURNAL_MAX) : "";
}
