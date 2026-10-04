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
    title: "A village for you and your companions, work sessions, and HabitKnight as an app",
    items: [
      "New: the Village. Every companion has a house in it, and so do you. Walk around with the arrow keys or WASD, or tap where you want to go, and walk up to a door to visit. Companions who have the village open are out and about too — at home, at someone's house, or at the town hall.",
      "Your house grows as you level up, from a tent to a keep, and its garden blooms with your habit streak. Pick your walls, roof colour and garden from My house; stone and brick unlock at levels 5 and 9.",
      "Visit a companion's house to see how their day is going, pin a short note to their door, or message them. Notes on your own door wait inside for you.",
      "Nudge a companion to get going — pick a line or write your own, and point it at one of their overdue or due-today quests if you like. They see only its category and deadline, never the title. One nudge per companion every three hours, and anyone can switch nudges off on the Notifications page.",
      "Work sessions: start one from the town hall or the menu, and a timer runs wherever you are in the app. Companions can sit down at your table any time. Turn on shared focus rounds, in step for everyone at the table: 25 minutes of work and a 5-minute break, 50 and 10, or 90 and 15. Start one at the town hall, at a library desk, or at a café table in the bakery.",
      "Focus time earns XP: 3 for every 25 minutes at a table, and 1 more for each person working with you, up to 6 — for four stretches a day. Your time is logged, and your companions can see today's and this week's totals on your house.",
      "Messages look and work like a proper messaging app now: your conversations in a list, newest first, with a preview of the last message and an unread count, and the conversation beside it. Messages group into bubbles with the day marked, the box grows as you type (Enter sends, Shift+Enter for a new line), and you'll see when your last message has been seen. Everything is still end-to-end encrypted — even the previews are unlocked on your device.",
      "Each house in the village has a signpost with its owner's name by the garden.",
      "You wake up in your own bed: the village always opens inside your house, beside your bed, and the door takes you out to your front step.",
      "A journal on your desk at home: walk up to the notebook (or tap it) and write. It saves as you go, keeps every entry with its date, and is private — nobody else in the village can open it. If you have no desk, it sits on your table; a bare tent now has a small table for it. The privacy policy has been updated to cover journals, and you'll be asked to agree to it once.",
      "Go inside! Tap any companion's house (or your own) to walk in, or just walk onto its door — no key to press. Rooms grow with the house, and everyone inside sees each other move around.",
      "Decorate your house, Animal Crossing style: inside your own home, press Decorate, pick a piece — beds, tables, bookshelves, a fireplace, rugs, paintings and more — and tap where it goes. Wallpaper and floors too. Fancier pieces unlock as you level up.",
      "Talk to whoever's around: inside a house, in the arena, or at the town hall, type into the bar at the bottom and your words appear over your knight's head for everyone there.",
      "The Arena: walk in through the gatehouse, tap a companion and challenge them to a duel. Each round you both pick at once — Strike beats Feint, Guard beats Strike, Feint beats Guard. Your weapon, shield and armour give you an edge, but reading your opponent wins duels. No XP changes hands; your win/loss record is shown in the arena.",
      "Habits are their own section now, tracked in a grid: a green check for each day you kept one, a red x for each day you missed. They no longer add quests to your categories — tick today's straight from the grid on the Habits page or the dashboard.",
      "Habits follow the 1% rule: a tick is worth +1 XP, and each day of the streak makes the next one 1% richer, up to +10. A missed day costs 1 XP and starts that habit's streak over at +1.",
      "Got a day wrong? For a week afterwards, tap any day in the grid to change it: tick it late if you did it after all, mark it missed if you didn't, or spend a streak freeze on it (you get two a month, and the village store sells more). You choose which missed days get your freezes; any miss you leave alone for its whole week gets one then, if you have one left.",
      "The bakery: walk in to send a companion a treat with a note, which waits on their door, or buy a bread oven, cake stand and more for your own house. It has café tables to hold a work session at, too.",
      "More at the general store: new roofs, wallpapers, floors and furniture — a piano, an aquarium, a telescope and a stained glass window, set out in the store so you can walk up and look before you buy.",
      "Hedges now run round the village's shops in one clipped line, and you can walk on the grass right up to a tent.",
      "A tidier village: a simpler, even town hall and arena, a stone plaza as wide as the road, a fenced yard with a gate for every empty lot (its sign hangs from the gate), and the bakery's door on its wall. A village now holds four rows of six houses, so the next one opens sooner. The whole app is set in Georgia.",
      "Getting about the village: hold F to run, press Space to jump, or hold it to keep jumping (everyone nearby sees it), and press and hold on the ground to steer your knight in any direction. A tap now walks the straight way there instead of zig-zagging, and your knight faces where it's going rather than following the mouse.",
      "Many more category colours to choose from — 24 in all.",
      "The privacy policy has been updated to cover the village, work sessions, houses and duels, and you'll be asked to agree to it once.",
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
