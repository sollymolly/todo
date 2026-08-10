# Questline

A personal todo list where finishing things levels up a medieval character.
Quests are grouped into categories, deadlines are sworn oaths worth real XP, and
completing one sets off a small celebration.

Next.js 16 (App Router) · Neon Postgres · Tailwind v4 · Motion · LPC pixel-art sprites.

---

## Getting it running

### 1. Create a Neon database

Sign up at [neon.com](https://neon.com) and create a project. The free plan
allows **100 projects** at 0.5 GB each — far more headroom than this app needs,
and projects aren't force-paused.

On the project dashboard hit **Connect** and copy the connection string. Use the
**pooled** one (its host contains `-pooler`).

### 2. Apply the schema

In the Neon console open the **SQL Editor**, paste the entire contents of
[`db/schema.sql`](db/schema.sql), and run it.

If you set the database up earlier, also run everything in
[`db/migrations/`](db/migrations) in filename order. `create table if not
exists` skips tables that already exist, so it will never add a new **column**
to a database you already have — that's what the migrations are for.

That creates the tables, the `bootstrap_user` function (which gives every new
account a profile and four starter categories), and the XP functions.

### 3. Configure the app

```bash
cp .env.local.example .env.local
```

| Variable | What it is |
| --- | --- |
| `DATABASE_URL` | The pooled Neon connection string from step 1 |
| `SESSION_SECRET` | Signs your session cookie. Generate with `openssl rand -base64 32` |
| `OWNER_EMAIL` | *Optional.* Whoever every new account is befriended to on sign-up. Defaults to the constant in `src/lib/auth-actions.ts` |

Both are server-only and never reach the browser. `.env*` is gitignored.

### 4. Run it

```bash
npm install
npm run dev
```

Open <http://localhost:3000>, create a character, and start writing quests.

---

## Deploying to Vercel

1. Push this repo to GitHub.
2. Import it at [vercel.com/new](https://vercel.com/new).
3. Add `DATABASE_URL` and `SESSION_SECRET` in the project's environment
   variables — the **same** `SESSION_SECRET` as local, or existing sessions
   won't validate.
4. Deploy.

No callback URLs or provider dashboards to configure — auth is self-contained.
No build-time database access either: every page is `force-dynamic` and the
Neon client connects lazily, so the build succeeds before the env vars are set
and fails loudly at request time instead.

Worth knowing:

- **Use the pooled connection string.** Serverless functions open connections
  unpredictably; the pooler is what absorbs that.
- **Put the Neon project in the same region as your Vercel functions.** Every
  page here is dynamic, so a cross-region hop is paid on every single load.
- **Messaging needs HTTPS.** Web Crypto is unavailable outside a secure
  context. Vercel and `localhost` both qualify; a dev server reached over a LAN
  IP does not, and the app says so rather than failing silently.
- **Hobby plan is non-commercial**, per Vercel's terms.

---

## How the XP economy works

Deadlines are the whole point: a quest with no due date is barely worth
anything, and a quest with one puts XP at risk.

| What happens | XP |
| --- | --- |
| Completed, no deadline set | **+5** |
| Completed on time | **+25** |
| Completed late | **+8** |
| Deadline passed without completion | **−15** |
| Abandoned by hand (deadline quests only) | **−15** |

Anything still open **24 hours** past its deadline is marked **missed** on your
next page load, and a banner tells you how many oaths broke while you were away.
A missed quest **stays in its category box** rather than disappearing into the
chronicle — late is not the same as gone, and finishing it refunds the penalty
and pays the late award. Total XP never drops below zero.

### XP is reconciled, not accumulated

Each quest's XP contribution is a pure function of its state, and every
transition moves only `target - already_applied`:

| State | Contributes |
| --- | --- |
| done | `quest_xp(due, completed_at)` — +25 / +8 / +5 |
| missed | −15 if it had a deadline, else 0 |
| open | 0 |

So **a missed deadline costs 15 once and a completion pays once**, however many
times the checkbox is toggled. Undoing a completion removes exactly what that
completion granted and nothing more.

This replaced incremental deltas, which double-charged: undoing a completion
returned the quest to `open` with its deadline still long past, so the next page
load swept it and took the −15 again. One quest in the author's database
accumulated four ledger entries totalling −30 for a single missed deadline.
Undoing now puts a quest back to **missed** rather than open when its deadline
has already passed, so the XP settles in one visible step instead of a refund
followed by a surprise penalty.

`todos.xp_awarded` therefore means *the net XP this quest has moved*, not the
size of the last change to it — and because the floor at zero means a penalty
larger than the balance is only partly charged, it records what actually moved
rather than what was intended. That is what keeps the next transition correct
instead of refunding XP that was never taken.

All of it funnels through one function, `quest_transition` in
[`db/schema.sql`](db/schema.sql); `complete_quest`, `uncomplete_quest`,
`abandon_quest` and `sweep_overdue` are thin wrappers that pick a target state.

It's an honour system — nothing verifies you actually did the thing.

### Order and urgency

Quests sort by deadline: soonest first, undated ones at the bottom, creation
time as the tiebreak. There is deliberately **no manual ordering** — a stored
position would outrank the date it was meant to reflect, so editing a deadline
wouldn't move the quest. Dragging still moves a quest between categories; it
just no longer decides where in the list it lands.

Only today and tomorrow are written as words; every other deadline shows as
`mm/dd` (`mm/dd/yy` when it isn't the current year, since a bare `01/15` seen
in December reads as three weeks ago rather than eleven months away). Relative
phrasing like "in 3 days" is deliberately gone — how urgent something is comes
from the colour instead, so the text can just be the date.

The deadline chip colours by how soon it is, so a board reads at a glance:

| When | Colour |
| --- | --- |
| Overdue, or due today or tomorrow | **Red** |
| 2–4 days away | **Amber** |
| 5 or more days away | **Green** |

`urgencyOf` and `byDeadline` both live in
[`src/lib/date.ts`](src/lib/date.ts), next to the SQL `ORDER BY` they mirror,
so the three can't drift apart.

**All of these numbers live in [`db/schema.sql`](db/schema.sql)** (`quest_xp`
and `quest_penalty`), and are mirrored in `XP` in
[`src/lib/game.ts`](src/lib/game.ts) purely to drive the previews in the UI. If
you retune the economy, change both — SQL is the source of truth, and the maths
lives there so the client can't inflate its own score.

### Retention, and why the metrics are counters

Completed quests are **deleted after 7 days** (`FINISHED_RETENTION_DAYS`), by
`prune_finished` on the next page load. Titles, notes and deadlines go
permanently; the chronicle is a rolling week, not an archive.

Missed quests are never pruned. They are still completable, so they aren't
finished — deleting one would take away the chance to redeem it.

Every completion metric used to be a `count(*)` over `todos`, which pruning
would have silently walked back to zero. So each quest is folded into durable
counters **at the moment it is deleted**:

| Counter | Why it exists |
| --- | --- |
| `profiles.archived_done` | the completed total |
| `profiles.archived_on_time` | the numerator of the on-time rate |
| `profiles.archived_late` | its denominator — a quest finished after its deadline counts as *missed*, so without this pruning would flatter everyone |
| `categories.archived_done` | the Strengths bar |

Counting at deletion is what makes it safe: a row can only be deleted once, so
it can only be counted once. Incrementing on *completion* instead would need the
same reconciliation the XP economy needed, and would double-count every toggle.

Every total the app shows is therefore **archived counter + live count**, which
stays correct across pruning. A quest with no `completed_at` is never pruned, so
an unknown completion time can't cause a silent deletion.

### Strengths

`CategoryStrength` shows completed / (completed + missed) per category, weakest
first, because sorting alphabetically buries the thing that needs attention. An
open quest is neither a success nor a failure, so it is shown as a separate
count rather than guessed into the ratio — a category quietly filling with work
is still visible. A category with no resolved outcomes shows "—" and sinks to
the bottom rather than displaying a damning 0%.

Only `archived_done` is kept per category, because the other side of that ratio
(missed) is never pruned and so is always countable live.

### Art and licensing

The character is composited at runtime from **Liberated Pixel Cup** sprite
layers — body, head, eyes, hair, legs, feet, torso, weapon, headgear, cloak and
shield — drawn onto a canvas in LPC's own z-order. Skin and hair colour are
palette swaps against the LPC ramps rather than flat tints, so shading
survives.

Eyes are the exception: LPC ships a separate sheet per eye colour, so those are
selected rather than recoloured. The head sheet has blue eyes painted on and
the chosen sheet is drawn over them, which is why the layer sits at z-101 —
above the head, below the hair.

**Body type** (masculine / feminine) swaps the whole sprite set, not just the
torso: armour drawn for one silhouette does not line up on the other. So
`manifest.json` stores a layer list *per body* for every item, and
`fetch-lpc.py` resolves each sheet twice. Around 50 of the 65 sheets turn out
to be shared — hair and headwear resolve to a common `adult` directory — so
the download only grows by about 15 files.

Heads are a further exception: they are a *style* sheet, so LPC's "Human Male"
definition points every body type at the male art. Choosing a head therefore
means choosing a different **definition**, not a different key inside one.
That's why `BASE` in the fetch script maps body type to a path.

`scripts/fetch-lpc.py` pulls only the sheets this app uses (~50 files, ~400 KB)
straight from the generator's GitHub repo, resolving each path from its sheet
definition and detecting which palette ramp it was drawn in. Re-run it after
editing the item tables:

```bash
python3 scripts/fetch-lpc.py
```

> **Licence:** LPC art is **CC-BY-SA 3.0 / GPL-3.0**. `public/sprites/lpc/CREDITS.md`
> is generated with the full contributor list and linked from the Armoury. If
> you publish this app, keep that page reachable and license derivative sprite
> art under the same terms. This is the one part of the project that is not
> yours to relicense.

### The land

A quiet countryside tiled from the **LPC Tile Atlas** (32px tiles) in
`src/components/Scenery.tsx`. Painted once on mount; nothing moves.

Three rules keep it reading as scenery rather than a game screenshot:

1. **Never stretch.** The ground is a seamless block repeated by CSS at an
   exact integer scale, so tiles stay square at any viewport size. Scaling a
   fixed canvas to `cover` squashes the pixels and is what made earlier
   versions look wrong.
2. **Keep the middle calm.** Trees and rocks are anchored to the left and right
   margins, where the panels don't sit.
3. **Sit it back.** A parchment wash and vignette drop the saturation to match
   the panels.

Two atlas gotchas worth knowing: the terrain blocks are 3×3 autotiles, so only
*interior* tiles are safe to repeat (edges tile as dark seams), and mixing
tiles from different blocks reads as a brightness checkerboard.

### Ranks and gear

20 named ranks, from **Ragged Peasant** at 0 XP to **Living Legend** at 15,770.
The curve and every wardrobe item are in `RANKS` and `ITEMS` in
[`src/lib/game.ts`](src/lib/game.ts) — that's the one file to edit to retitle
ranks, add gear, or change what unlocks when.

Five equipment slots (armour, weapon, headgear, cloak, off-hand) unlock by
level. Appearance — body, skin, hair style, hair colour, eye colour — is always
free.
Equipping is re-checked server-side against your level, so the level gate is
real rather than cosmetic.

---

## How auth works

Self-contained, no third-party service:

- Passwords are hashed with Node's built-in **scrypt** (a memory-hard KDF), with
  a random 16-byte salt and the cost parameters stored alongside each hash so
  they can be raised later without invalidating anyone.
- Sessions are a **signed JWT in an httpOnly cookie** (30 days), verified in
  `src/proxy.ts` on every request. There's no session table to keep tidy.
- Every query in `src/lib/actions.ts` is scoped by `user_id` — that scoping is
  what isolates accounts, so don't remove those clauses when editing.

Sign-in gives a deliberately vague "email or password is incorrect" and spends
the same time whether or not the account exists, so it leaks nothing either way.

### The owner is everyone's first companion

Every account created through sign-up is given an **already-accepted**
friendship with the instance owner, so nobody lands on an empty Companions
page. The owner's address is `OWNER_EMAIL` (falling back to a constant in
`src/lib/auth-actions.ts`); it does nothing until an account with that address
exists, and never friends that account to itself.

Be deliberate about this, because the new user didn't agree to it. An accepted
friendship is mutual, so it lets the owner see their **category names with open
counts**, their level and completed-quest total, and open a DM thread with
them. Quest titles and notes stay private. If that's more than you want,
changing `'accepted'` to `'pending'` in `befriendOwner` turns it into a request
they can decline — the rest of the app already handles that state.

It never blocks sign-up: any failure is swallowed and the account is created
regardless.

### Changing a password

`/account` (the ⚙ in the header). This is more than a hash swap, because the
password is also what wraps the private key that reads your messages.

The browser does the real work, in this order:

1. Unwrap the private key with the **old** password and re-wrap it with the new
   one. If the old password is wrong this fails here, before anything is sent.
2. Send the server two derived secrets and the new wrapping, swapped together
   in one statement so the hash and the key material can never disagree.
3. Re-cache the key for the tab, so messages keep working without a re-login.

**The keypair itself never changes** — only its wrapping. Existing messages
stay readable and friends holding your public key notice nothing. Generating a
fresh keypair instead would destroy every conversation on the account.

The server never learns the new password's length or content, only a
fixed-size derived secret, so strength is enforced in the browser — the one
place the password exists.

One honest limitation: sessions are stateless JWTs, so changing a password
does **not** sign out other devices. Making it do so would mean a token version
on every request, and a database read on every request to check it. If you want
that trade, it's a `session_version` column on `users` plus a check in
`getUserId`.

---

## Feedback and weekly updates

`/feedback` takes a note from anyone signed in, with an **anonymous** option,
and shows the whole inbox to the owner (matched on `OWNER_EMAIL`) below the
form. `listFeedback` re-checks ownership next to the query rather than trusting
the page to have done it — it's the one read in the app that returns other
people's words.

**The anonymity is real, not a flag.** When someone ticks the box, `user_id` is
written as null: there is no hidden identifier beside an `anonymous` boolean for
the reader to ignore. Two details make that hold up:

- Submitting still requires a session, so the rate limiter knows who is asking
  — the identity authorises the request and is then discarded rather than
  stored.
- `created_at` is rounded to the hour for anonymous notes. On a handful of
  users, a to-the-second timestamp plus knowing who was online is often enough
  to name the author. The hour is plenty to know when something was said.

Named notes use `on delete set null`, so deleting an account drops the
attribution but keeps the message.

### The weekly popup

`/updates` is the changelog; the newest entry also appears once as a modal on
the dashboard, on the first visit of a week in which something shipped.

Add an entry to `UPDATES` in [`src/lib/updates.ts`](src/lib/updates.ts) keyed by
the **Monday of its week**, and everyone who hasn't seen that entry gets the
popup once. Two decisions worth knowing:

- **Weeks are Mondays in UTC, computed on the server.** Deriving "this week"
  from the browser clock would make the popup appear, vanish and reappear for
  anyone whose Sunday evening is already Monday elsewhere, and would differ
  between the server render and hydration.
- **It tracks the latest entry, not the calendar.** Someone away for a month
  still sees what they missed, once; someone who has read the latest notes
  isn't shown them again just because a new week began.

`profiles.updates_seen` stores the week key as **text, not `date`** — the driver
renders a `date` through the session timezone, which turns `2026-08-10` into a
timestamp hours off and makes week comparisons lie. New accounts are seeded as
already caught up, since a first-time user has no reason to be handed a list of
things that changed before they arrived.

---

## Security

The threat model worth stating plainly: **an attacker who can run JavaScript on
this origin can read every message on the account.** The unwrapped private key
lives in `sessionStorage` so navigation doesn't re-prompt for a password, so no
amount of ECDH survives an XSS. That is why the Content-Security-Policy in
`src/proxy.ts` is load-bearing rather than decorative — it is nonce-based, and
a script without the per-request nonce simply never executes.

What is in place:

- **Nonce CSP** with `strict-dynamic`, plus `frame-ancestors 'none'`,
  `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` and
  `connect-src 'self'` — the last of which is what stops injected code posting
  your messages somewhere else. `'unsafe-eval'` is added in development only.
- **Rate limiting** (`src/lib/rate-limit.ts`) in front of sign-in, sign-up and
  password change. Verifying a password costs ~16 MB and ~100 ms of scrypt, so
  an unbounded endpoint is a memory-exhaustion lever as much as a password
  oracle. The check runs *before* the hash. It fails open, so a database
  problem can't lock everyone out.
- **The wrapped private key is never released before authentication.** It now
  comes back from `signIn` only after the secret verifies.
- **Sessions** pin the JWT algorithm, issuer and audience, and refuse to sign
  with a `SESSION_SECRET` shorter than 32 characters.
- **Sender binding.** Message ciphertext covers `sender -> recipient` as AEAD
  additional data, so a tampered `sender_id` no longer decrypts.
- **Safety numbers.** Each thread shows a code derived from both public keys.
  Compare it out loud: it is the only way to detect a server that hands you the
  wrong key, which is the one attack E2EE cannot catch by itself.
- **Errors are generic.** Postgres names tables, columns and constraints in its
  messages; those now go to the logs, not the client.

### Agreeing to the privacy policy

Sign-up requires ticking a box that starts unchecked, and the submit button
stays disabled until it is — consent has to be an affirmative act, not a
pre-ticked default someone scrolls past. The consequential points are printed
on the form itself rather than hidden behind the link.

Existing accounts are caught by a gate in `src/proxy.ts`. The accepted version
rides in the signed session cookie as a `pv` claim, so the check costs **no
database read on any request** and can't be edited around. Anything below the
current version is redirected to `/consent`; `/privacy` deliberately stays
public so the policy is readable before agreeing, and before signing in at all.

`PRIVACY_VERSION` in [`src/lib/policy.ts`](src/lib/policy.ts) is the switch.
Bump it and everyone is asked again, on every device, on their next request.
Bump it for changes to what is collected, who can see it, or who it is shared
with — not for typos. Re-prompting people for nothing is how you train them to
click through without reading.

Two details that make it a record rather than a checkbox:

- **The client sends the version it displayed**, and the server rejects a
  mismatch. A tab left open across a policy change can't have someone recorded
  as agreeing to text they were never shown.
- **`policy_acceptances` is append-only**, one row per user per version.
  Re-consenting to v2 leaves the v1 row intact, so the history stays readable.
  It records who, which version, and when — and deliberately *not* IP address
  or user agent, which would mean collecting a new category of personal data,
  indefinitely, to prove agreement to a policy about collecting less.

### What is still true

- Sessions are stateless, so changing a password does not sign out other
  devices, and a stolen cookie stays valid until it expires.
- Quests, categories and display names are stored in plain text. Only messages
  are encrypted.
- Messages sent before sender binding existed are unforgeable but not
  sender-pinned; that shrinks to nothing as threads age.
- There is no account-deletion flow in the app yet.
- Declining consent signs you out; it does not delete the account.

See [`/privacy`](src/app/privacy/page.tsx) for the user-facing version.

---

## Layout

```
db/schema.sql              tables, bootstrap, XP functions
db/migrations/             run these on databases created before a change
src/proxy.ts               auth gate; verifies the session cookie
src/lib/db.ts              lazy Neon client
src/lib/session.ts         JWT cookie sign/verify
src/lib/password.ts        scrypt hashing
src/lib/auth-actions.ts    sign up / in / out, password change
src/lib/social-actions.ts  friends, requests, and the encrypted message relay
src/lib/crypto.ts          browser-only: key derivation, wrapping, seal/open
src/lib/actions.ts         all other writes, each scoped by user_id
src/lib/game.ts            ranks, wardrobe, XP constants, palettes
scripts/fetch-lpc.py       downloads the sprite layers + writes CREDITS.md
public/sprites/lpc/        LPC sheets, manifest, attribution
src/components/
  CharacterSprite.tsx      composites LPC layers on canvas, palette recolour;
                           click plays the walk cycle in place
  Scenery.tsx              static tiled countryside, seamless CSS repeat
  CategoryBoard.tsx        fixed-height boxes, inline add, add/delete a
                           category, drag quests between boxes
  QuestRow.tsx             one quest; drag source, portalled ⋯ menu
  Fx.tsx                   particle bursts and floating XP numbers
  Dashboard.tsx            board state, optimistic updates, level-up detection
  CharacterStudio.tsx      the Armoury: appearance + per-slot wardrobe
```

The hand-drawn SVG character has been retired in favour of the LPC sprites.
