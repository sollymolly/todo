/* --------------------------------------------------------------------------
   The changelog people actually see.

   Weeks are keyed by the ISO date of their Monday, computed in **UTC**. One
   definition of "this week" for everybody is the point: deriving it from each
   browser's clock would make the dot appear, vanish and reappear for anyone
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
   hasn't already seen that week gets a dot on "What's new" until they open it.
   -------------------------------------------------------------------------- */
export const UPDATES: Update[] = [
  {
    week: "2026-09-28",
    title: "HabitKnight is an app now: install it, get reminders, make the table yours",
    items: [
      "Install HabitKnight on your phone or computer: open the menu and choose Install app. On an iPhone or iPad, tap Share in Safari, then Add to Home Screen. It opens in its own window with its own icon, and on Android, Windows and Mac, long-pressing or right-clicking the icon gives you shortcuts straight to a new quest or to Habits.",
      "Notifications: turn them on under Notifications in the menu, once on each device. You can get a reminder before each deadline (anywhere from 15 minutes to a day ahead — an hour unless you change it), a morning summary at a time you pick with what's due today, today's habits and anything past its deadline, and a nudge when a companion writes to you. On an iPhone or iPad they need the app added to your Home Screen first.",
      "A message notification only says who wrote, never what they wrote: messages stay sealed, and the server can't read them to put them in a notification.",
      "The installed app's icon shows how many quests are due today, on iPhone, iPad, Windows and Mac.",
      "It opens without a signal: you'll see your quests as they were the last time you opened the app, with a note at the bottom saying so. Changes are paused until you're back online, and then it refreshes itself. Signing out clears the saved copy from that device.",
      "A layout made for phones: Quests, Habits, Messages and your knight are tabs along the bottom, and the round + button adds a quest. Adding and editing quests, categories and chats slide up from the bottom of the screen, and tapping into a field no longer zooms the whole page in.",
      "Make the table your own: add columns of your own — text, number, checkbox, a date, or a pick-list with coloured options — and fill them in quest by quest. Drag a column's edge to resize it, and use its menu to sort, rename, hide or delete it. Your layout follows your account onto every device.",
      "Drag rows in the table into any order you like, by the handle at their left edge (or with the arrow keys once it's selected). The table switches to Manual order and keeps it; sort by any column whenever you want and click Manual order to go back. This order is the table's own — your board stays exactly as you arranged it.",
      "The table remembers how you last sorted it.",
      "A new look: warm paper with light falling in from a window and a few motes of dust drifting through it, and the Armoury is now a wood-panelled dressing room. Drifting dust in the menu turns the dust off on that device, and it's off already if your system is set to reduce motion.",
      "The character strip at the top of your quests is now one big button into the Armoury.",
      "Long quest names in the table now use the whole column instead of stopping short of the edge.",
    ],
  },
  {
    week: "2026-09-21",
    title: "Drag anything, a table view, and screenshot import",
    items: [
      "New table view: flip the Board / Table switch above your quests to see every quest in one list. Sort by name, category, deadline, status or when it was added, and filter by category, deadline, status, or a search.",
      "Import from a screenshot: snap or paste a picture of any to-do list — notes, a syllabus, a group chat — and the tasks in it come back as a list you can fix up before adding. The picture is read by an AI model, so the privacy policy has been updated to say so, and you'll be asked to agree to it once.",
      "Quests can be dragged into any order within a category, not just from one category to another. A green line shows where it will land. A quest you haven't moved still sorts by its deadline, and editing a quest's deadline or category puts it back in deadline order.",
      "Dragging works on phones and tablets: press and hold a quest for a moment, then move it. A quick swipe still scrolls the page as normal, and holding a quest near the top or bottom edge scrolls for you.",
      "While you're carrying a quest, an Uncategorised box appears, so you can take a quest out of its category even when nothing else is uncategorised.",
      "Forgot your password? There's now a link on the sign-in page that emails you a reset link. Quests, XP, gear, habits and friends are always kept, and so are your messages as long as you've signed in once since this update.",
      "Messages now belong to your account instead of your password: they survive a password reset and open on any device you sign in to. The trade-off is that whoever runs the app holds a key that can read them — the privacy policy has been updated to say so, and you'll be asked to agree to it once.",
      "\"What's new\" no longer pops up over your board. A red dot on the menu tells you when there's something to read.",
      "Whole categories can be dragged too: pick one up by its header and drop it where you want it on the board.",
    ],
  },
  {
    week: "2026-08-10",
    title: "Late quests, honest XP, and a locked-down account",
    items: [
      "Abandon and Delete are now two different things. Abandoning a quest costs 5 XP, records the deadline as missed against its category, and takes the quest off the board for good — it is the way to say you are not doing something. Deleting is for a quest that should never have been written down: it counts as nothing, and any XP it had moved is handed back, including the award on a finished one.",
      "Anything you haven't finished can be abandoned, not just an open quest with a deadline: a missed one you are not going to redeem after all, or something you jotted down without a date and are never going to do. Abandoning a missed quest is free — its deadline already cost you 10 when it went by, and giving up afterwards never hands any of that back.",
      "A category with nothing but broken promises reads 0% rather than waiting for your first completed quest to have an opinion, and a deadline you abandoned still counts against you after the quest itself is gone.",
      "XP is priced in smaller numbers: +10 for a quest done on time, +3 for a late one, -10 for one you never delivered, and +5 for anything without a deadline. Every rank threshold came down by the same amount, so a rank still takes exactly the number of quests it always did. A missed deadline now costs one on-time quest instead of most of one.",
      "Everyone above level 3 has been set back to level 3 to start the new numbers from a level footing. Your armour is untouched — you keep wearing what you are wearing — but a piece above level 3 cannot be put back on once you switch that slot to something else. The XP on your finished quests has been restated at the new prices, so a completed quest shows what it is worth today.",
      "New Strengths panel: how often you actually deliver in each category, weakest first, so the area you have been neglecting is the one at the top.",
      "Completed quests are now deleted after 7 days to keep the app light. Your completed total, on-time rate and category strengths are unaffected — those numbers are kept — but the titles and notes of finished quests do not stick around, so copy anything you want to keep.",
      "A missed quest now stays in its category box instead of vanishing into the chronicle. Late is not the same as gone — finish it and you get the late award, and the penalty you already paid is refunded.",
      "Fixed a real XP bug: completing a late quest and then un-completing it charged the missed-deadline penalty a second time, and again on every repeat. A deadline now costs XP once and a completion pays once, however often you toggle it.",
      "Choose your character's build — masculine or feminine — in the Armoury. Every piece of armour and clothing was redrawn for both.",
      "Dye your armour, headgear and cloak. Each tab in the Armoury now has a colour row: cloth takes seventeen dyes, steel takes eight finishes from iron to gold, and heavy armour dyes its greaves and boots to match. Dyes cost nothing and are not level-gated — earning the piece was the achievement.",
      "Three cloaks that were quietly the same picture — the traveller's, the heraldic and the starcloak — now arrive in their own colours, as does gilded plate, which is finally gold.",
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
 * Whether to show the dot on "What's new". True from the week something
 * shipped until the changelog is opened.
 */
export function shouldShowUpdate(
  lastSeenWeek: string | null,
  now: Date = new Date()
): boolean {
  const update = latestUpdate(now);
  if (!update) return false;
  return !lastSeenWeek || lastSeenWeek < update.week;
}
