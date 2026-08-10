/* --------------------------------------------------------------------------
   The changelog people actually see.

   Weeks are keyed by the ISO date of their Monday, computed in **UTC**. One
   definition of "this week" for everybody is the point: deriving it from each
   browser's clock would make the popup appear, vanish and reappear for anyone
   whose Sunday evening is already Monday somewhere else, and would differ
   between the server render and the client hydration.
   -------------------------------------------------------------------------- */

export type Update = {
  /** ISO date of the Monday this entry belongs to. */
  week: string;
  title: string;
  items: string[];
};

/** The Monday of the week `now` falls in, as YYYY-MM-DD, in UTC. */
export function weekKey(now: Date = new Date()): string {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  // getUTCDay() is 0 for Sunday, so shift it to "days since Monday".
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** "10 August 2026" — for headings, from a week key. */
export function formatWeek(week: string): string {
  const d = new Date(`${week}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/* --------------------------------------------------------------------------
   Newest first. Add an entry at the top when you ship something; everyone who
   hasn't already seen that week gets the popup once.
   -------------------------------------------------------------------------- */
export const UPDATES: Update[] = [
  {
    week: "2026-08-10",
    title: "Late quests, honest XP, and a locked-down account",
    items: [
      "New Strengths panel: how often you actually deliver in each category, weakest first, so the area you have been neglecting is the one at the top.",
      "Completed quests are now deleted after 7 days to keep the app light. Your completed total, on-time rate and category strengths are unaffected — those numbers are kept — but the titles and notes of finished quests do not stick around, so copy anything you want to keep.",
      "A missed quest now stays in its category box instead of vanishing into the chronicle. Late is not the same as gone — finish it and you get the late award, and the penalty you already paid is refunded.",
      "Fixed a real XP bug: completing a late quest and then un-completing it charged the missed-deadline penalty a second time, and again on every repeat. A deadline now costs XP once and a completion pays once, however often you toggle it.",
      "Choose your character's build — masculine or feminine — in the Armoury. Every piece of armour and clothing was redrawn for both.",
      "Eye colour replaces the old eye 'styles', which had no artwork behind them and never changed anything.",
      "Quests now sort by deadline, soonest first, with undated ones at the bottom. The deadline chip is red for today and tomorrow, amber for two to four days, green beyond that.",
      "Add and remove categories straight from the board, and change your password from the new Account page without losing a single message.",
      "A security pass closed a hole that could have exposed the key protecting your messages. Every conversation now shows a verification code you can read aloud to check nobody is in the middle.",
    ],
  },
];

/** The most recent entry that has actually arrived, or null before the first. */
export function latestUpdate(now: Date = new Date()): Update | null {
  const week = weekKey(now);
  return UPDATES.find((u) => u.week <= week) ?? null;
}

/**
 * Whether to interrupt someone with the popup. True on their first visit of a
 * week in which something shipped, and false for the rest of that week.
 */
export function shouldShowUpdate(
  lastSeenWeek: string | null,
  now: Date = new Date()
): boolean {
  const update = latestUpdate(now);
  if (!update) return false;
  return !lastSeenWeek || lastSeenWeek < update.week;
}
