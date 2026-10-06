# Next steps

- Knights in 16 directions: the game side is built (see docs/knight-art/SPEC.md, section 8). What's left is the art: find an artist, starting with the pilot set in the spec; Wolthera's LPC diagonal walk cycle (section 9) is a possible head start for the bodies. Decide first whether the Pointy Stick gets a slash animation (cuts the work by a third). As sheets arrive, put them in public/sprites/lpc16/ and run `python scripts/link-lpc16.py`. Then the duel animations (still four-way) are a second step if you want them.
- **Roaring 20's look and rehearsals:** run these in the Neon SQL Editor, in order: `db/migrations/2026-10-06_01_roaring20_look.sql`, `2026-10-06_02_planet_rehearsals.sql` and `2026-10-06_03_rehearsal_reminders.sql`. Then go to Station → Rockets → Roaring 20 → Look after it, pick "Roaring 20" (gold ring), and Save. Only whoever runs this instance sees that look in the picker.

## Ideas (not built)

### Where everyone is, in real life (Roaring 20 and other planets)
Show each member's real-world whereabouts on the planet, e.g. "at rehearsal", "on campus" or "away", next to their name in the member list and on their house's signpost.
- **Find My can't be the source.** Apple has no public API for Find My locations, and nothing outside Apple's own apps can read them. Scraping iCloud would break Apple's terms and mean holding people's Apple ID passwords. Rule it out.
- **What could work instead:**
  - The browser's Geolocation API while the app is open. It's easy, but it only updates while the app is open; iOS doesn't run web apps in the background.
  - An iOS Shortcuts or Android automation ("When I arrive at / leave a place") that calls a personal webhook URL. This works in the background and is set up once per person, without the app ever seeing coordinates.
  - A manual "I'm here" button.
- **Store places, not coordinates.** The owner defines a few named places per planet (a circle: centre and radius, e.g. the rehearsal room or the dorms). The device works out which one it's in, and only the place's name (or "away") is sent and kept. No location history, and each status expires after a few hours.
- **Strictly opt-in, per planet, and off by default.** People can see who's sharing, pause it, and stop at any time.
- **It's a big privacy change.** It needs a privacy policy bump and its own consent screen before anyone shares. It's real-time location of real people, so it needs care.
- **Nice with rehearsals:** "4 of 12 here" on a rehearsal 5 minutes in, or a nudge to anyone not there yet.

## Done

- Planet themes: the special look `roaring20` (Princeton's Roaring 20) has crimson-velvet ground with gold art-deco diamonds, a black-marble-and-gold plaza and platform, crimson and gold trees and hedges, and music notes drifting up from the town hall. No other planet can pick it (`SPECIAL_LOOKS` in world.ts).
- Rehearsal reminders: a planet's owner adds weekly rehearsals (day, time and name, in the owner's timezone) under "Look after it". Everyone on the planet gets a push 15 minutes before, from the existing 5-minute cron (src/lib/reminders.ts), unless they switch "Rehearsal reminders" off on the Notifications page.

- Planets: private, invite-only villages reached by rocket from the station (Trains and Rockets tabs). Join by invitation or code; each member has a separate house there. Only OWNER_EMAIL can found planets for now (`canFound` in src/lib/planet-server.ts). **Needs `db/schema.sql` run once in Neon (`planets`, `planet_members`, `planet_invites`, `planet_houses`)**; until then the village works as before, and joining or founding a planet says they aren't set up.
- Privacy policy bumped to version 7 for planets.

- Village start: everyone begins in their own room beside their bed (the page loads your room with the village, so there's no flash of outdoors); the door leads out to your own front step. No bed: just inside the door.
- Journal: a notebook on your desk at home (your table if there's no desk; a bare tent now has a small table). Walk up and press E, or tap it. Entries autosave, are dated, can be deleted, and are only ever shown to their owner. Plain text, like quest notes, not encrypted. **Needs `db/schema.sql` run once in Neon (`journal_entries`)**; until then the panel says it isn't set up.
- Privacy policy bumped to version 6 for the journal (everyone is asked to agree again on their next request).

- Empty lots: fenced round in wood with a two-tile gate at the front (the fence blocks, the gate is a way in to the tilled soil), and the "Empty lot" sign hung from the gate.
- Doors open as you walk onto them: your house, a companion's, the arena, the library, the store and the bakery, and out again from inside. Once per visit to a door; a tap-walk to a door still goes in by itself. E / Enter still work. (Houses of people who aren't companions stay locked.)
- Hall plaza: 4×2 tiles of stone in front of the door, with the dirt street running on below it.

- Make a working bakery.
- Add more things to the store.
- Better bush borders for buildings.
- Tents: walkable grass right up to a tent; only the canvas blocks, and only what's drawn of a house takes a press.
- Bakery: kitchen goods to buy for your own house (bread oven, cake stand, bread basket, copper pans).
- Bakery: two café tables where a work session can sit, like the library's desks.
- Work sessions: focus rounds of 25/5, 50/10 or 90/15 (or none), chosen when starting and changeable at the table.
- Work sessions: +1 XP per 25-minute stretch for each other person at the table during it, up to +3; four paid stretches a day.
- Store: its furniture set out on stands in the room (stained glass on the wall); walk up to one to see it at the counter.
- Habits: any day from the last week can be changed from a menu on its box (done, missed, or a streak freeze).
- Streak freezes: placed by hand on the missed day of your choice; a miss left alone for its whole week gets one then, if any are left.
- Village movement: Space to jump (seen by others nearby), hold F to run at 1.5×, press and hold on the ground to steer at any angle, and taps walk the straight way.
- The mouse no longer turns the knight: it faces the way it moves, and its opponent in a duel.
- Checked in the running app: tent footprint, bakery tables and goods, store displays, focus rhythm picker.
- Village jumping: holding Space jumps on every landing, a tap in the air is remembered until you land, and the key-handling that could leave the knight walking on after a key was let go is made sturdier.
- Village movement: on a diagonal the knight faces the last key you pressed (Up then Left turns it left), instead of looking like it was still walking up.
- Village look: a simpler, symmetric town hall and arena gate, the plaza as wide as the road, a big empty-lot sign in the middle of the lot, the bakery door flush on its wall.
- Villages are four rows of six houses (24 a village, was 40).
- Font: Georgia everywhere (to see how it looks).
