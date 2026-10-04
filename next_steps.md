# Next steps

- Knights in 16 directions: the game side is built (see docs/knight-art/SPEC.md, section 8). What's left is the art: find an artist, starting with the pilot set in the spec; Wolthera's LPC diagonal walk cycle (section 9) is a possible head start for the bodies. Decide first whether the Pointy Stick gets a slash animation (cuts the work by a third). As sheets arrive, put them in public/sprites/lpc16/ and run `python scripts/link-lpc16.py`. Then the duel animations (still four-way) are a second step if you want them.

## Done

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
