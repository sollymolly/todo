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

Anything still open **24 hours** past its deadline is auto-failed on your next
page load, and a banner tells you how many oaths broke while you were away.
Completing a failed quest afterwards refunds the penalty and awards it normally
— redemption is always available. Undoing a completion returns the XP it
granted. Total XP never drops below zero.

It's an honour system — nothing verifies you actually did the thing.

**All of these numbers live in [`db/schema.sql`](db/schema.sql)** (`quest_xp`
and `quest_penalty`), and are mirrored in `XP` in
[`src/lib/game.ts`](src/lib/game.ts) purely to drive the previews in the UI. If
you retune the economy, change both — SQL is the source of truth, and the maths
lives there so the client can't inflate its own score.

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
level. Appearance — skin, hair style, hair colour, eyes — is always free.
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
  CategoryBoard.tsx        fixed-height boxes, inline add, drag-and-drop
  QuestRow.tsx             one quest; drag source, portalled ⋯ menu
  Fx.tsx                   particle bursts and floating XP numbers
  Dashboard.tsx            board state, optimistic updates, level-up detection
  CharacterStudio.tsx      the Armoury: appearance + per-slot wardrobe
```

The hand-drawn SVG character has been retired in favour of the LPC sprites.
