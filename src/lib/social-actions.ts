"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { sendToUser } from "@/lib/push";
import { sql } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { rateLimited, TOO_MANY } from "@/lib/rate-limit";
import { ESCROW_CONFIGURED, openPrivateKey, publicKeyFor, sealPrivateKey } from "@/lib/escrow";
import type { Appearance, Equipped } from "@/lib/types";

/* --------------------------------------------------------------------------
   Friends, and the relay for encrypted direct messages.

   Two rules hold throughout:
     1. Every read about another person goes through are_friends(), so a raw
        user id is never enough to see anything.
     2. Message bodies are opaque here. This file moves base64 around and
        never decrypts anything. (The account's key *is* held in escrow — see
        migration 022 — but only ever handed back to that same account.)
   -------------------------------------------------------------------------- */

export type PublicProfile = {
  user_id: string;
  username: string;
  display_name: string;
  xp: number;
  appearance: Appearance;
  equipped: Equipped;
  public_key: string | null;
};

export type FriendSummary = PublicProfile & {
  friendship_id: string;
  completed: number;
  categories: { name: string; color: string; open: number }[];
  unread: number;
  /** Quests they finished today, in *their* timezone. */
  done_today: number;
  /** Their current best habit streak, or 0. */
  streak: number;
};

export type PendingRequest = {
  friendship_id: string;
  username: string;
  display_name: string;
  xp: number;
  direction: "incoming" | "outgoing";
};

function bump() {
  revalidatePath("/friends");
}

/* ========================================================================== */
/* Discovery                                                                  */
/* ========================================================================== */

export type FoundPerson = {
  user_id: string;
  username: string;
  display_name: string;
  xp: number;
  status: "pending" | "accepted" | "declined" | null;
  /** True when the existing row was opened by me rather than by them. */
  i_asked: boolean;
};

/** Exact match on username or email — no prefix search, so this can't enumerate. */
export async function findPerson(
  query: string
): Promise<{ ok: true; person: FoundPerson } | { ok: false; error: string }> {
  const me = await requireUserId();
  const q = query.trim().toLowerCase();
  if (!q) return { ok: false, error: "Enter a username or email." };
  if (q.length > 254) return { ok: false, error: "No adventurer by that name." };

  // Exact-match only, so this can't enumerate — but it still confirms whether
  // a given address is registered, one guess at a time. Capped accordingly.
  if (await rateLimited("findPerson", me)) return { ok: false, error: TOO_MANY };

  try {
    const rows = (await sql`
      select
        u.id as user_id,
        u.username::text as username,
        p.display_name,
        p.xp,
        f.status,
        (f.requester_id = ${me}::uuid) as i_asked
      from users u
      join profiles p on p.id = u.id
      left join lateral (
        select status, requester_id from friendships f
         where (f.requester_id = ${me}::uuid and f.addressee_id = u.id)
            or (f.requester_id = u.id and f.addressee_id = ${me}::uuid)
         limit 1
      ) f on true
      where (u.username = ${q} or u.email = ${q})
        and u.id <> ${me}::uuid
      limit 1
    `) as (Omit<FoundPerson, "i_asked"> & { i_asked: boolean | null })[];

    if (rows.length === 0) return { ok: false, error: "No adventurer by that name." };
    return { ok: true, person: { ...rows[0], i_asked: rows[0].i_asked ?? false } };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/* ========================================================================== */
/* Requests                                                                   */
/* ========================================================================== */

/* Results rather than thrown errors: Next redacts server-action exception
   messages in production, and these are all things the user needs to read. */
export type ActionResult = { ok: true } | { ok: false; error: string };

export async function sendFriendRequest(targetId: string): Promise<ActionResult> {
  const me = await requireUserId();
  if (targetId === me)
    return { ok: false, error: "You are already your own companion." };

  // If they already asked you, accept instead of creating a mirrored row.
  const existing = (await sql`
    select id, requester_id, status from friendships
     where (requester_id = ${me}::uuid and addressee_id = ${targetId}::uuid)
        or (requester_id = ${targetId}::uuid and addressee_id = ${me}::uuid)
     limit 1
  `) as { id: string; requester_id: string; status: string }[];

  if (existing.length) {
    const f = existing[0];
    const theyAsked = f.requester_id === targetId;

    if (f.status === "accepted") return { ok: true };

    // They asked first, and I'm asking back — that's a mutual yes.
    if (f.status === "pending" && theyAsked) {
      await sql`
        update friendships set status = 'accepted', responded_at = now()
         where id = ${f.id}::uuid
      `;
      bump();
      return { ok: true };
    }

    // My own request is already open. Nothing to do — and deliberately no
    // created_at bump, so re-asking can't push it back to the top of their list.
    if (f.status === "pending") return { ok: true };

    // status = 'declined'. A decline has to actually mean something, so the
    // person who was turned down cannot re-open the row. The one who declined
    // may change their mind, which flips the direction.
    if (theyAsked) {
      await sql`
        update friendships
           set requester_id = ${me}::uuid,
               addressee_id = ${targetId}::uuid,
               status       = 'pending',
               created_at   = now(),
               responded_at = null
         where id = ${f.id}::uuid
      `;
      bump();
      return { ok: true };
    }

    return { ok: false, error: "That request has already been answered." };
  }

  await sql`
    insert into friendships (requester_id, addressee_id)
    values (${me}::uuid, ${targetId}::uuid)
  `;
  bump();
  return { ok: true };
}

/**
 * Withdraw a request you sent.
 *
 * The row is *deleted* rather than marked declined, which matters: a
 * withdrawal is not a refusal. Leaving a 'declined' row behind would trip the
 * guard in sendFriendRequest — the one that stops a rejected person re-asking —
 * and permanently block you from ever inviting them again. Deleting it puts
 * both people back where they started.
 *
 * Scoped to requests where you are the requester and the status is still
 * pending, so this can't cancel someone else's invitation, decline one sent to
 * you (that's respondToRequest), or quietly dissolve an accepted friendship.
 */
export async function cancelRequest(friendshipId: string): Promise<ActionResult> {
  const me = await requireUserId();

  const rows = (await sql`
    delete from friendships
     where id = ${friendshipId}::uuid
       and requester_id = ${me}::uuid
       and status = 'pending'
    returning id
  `) as { id: string }[];

  if (rows.length === 0)
    return { ok: false, error: "That request is no longer pending." };

  bump();
  return { ok: true };
}

export async function respondToRequest(friendshipId: string, accept: boolean) {
  const me = await requireUserId();
  // Only the addressee may answer.
  await sql`
    update friendships
       set status = ${accept ? "accepted" : "declined"}, responded_at = now()
     where id = ${friendshipId}::uuid
       and addressee_id = ${me}::uuid
       and status = 'pending'
  `;
  bump();
}

/**
 * Parting ways also destroys the thread. Two reasons: nobody can read those
 * rows once the friendship gate closes, so leaving them is pure residue; and
 * without this, re-adding someone later would silently resurrect a
 * conversation both people believed was over.
 */
export async function removeFriend(friendshipId: string) {
  const me = await requireUserId();

  const rows = (await sql`
    select requester_id, addressee_id from friendships
     where id = ${friendshipId}::uuid
       and (requester_id = ${me}::uuid or addressee_id = ${me}::uuid)
  `) as { requester_id: string; addressee_id: string }[];

  if (rows.length === 0) return;
  const other =
    rows[0].requester_id === me ? rows[0].addressee_id : rows[0].requester_id;

  await sql`
    delete from messages
     where (sender_id = ${me}::uuid and recipient_id = ${other}::uuid)
        or (sender_id = ${other}::uuid and recipient_id = ${me}::uuid)
  `;

  await sql`
    delete from friendships
     where id = ${friendshipId}::uuid
       and (requester_id = ${me}::uuid or addressee_id = ${me}::uuid)
  `;
  bump();
}

/* ========================================================================== */
/* Reads                                                                      */
/* ========================================================================== */

export async function listFriends(): Promise<FriendSummary[]> {
  const me = await requireUserId();

  const rows = (await sql`
    select
      f.id as friendship_id,
      u.id as user_id,
      u.username::text as username,
      u.public_key,
      p.display_name,
      p.xp,
      p.appearance,
      p.equipped,
      -- Archived counter plus what is still on their board: finished quests
      -- are deleted after a week, so the live count alone would shrink.
      (p.archived_done + (select count(*)::int from todos t
        where t.user_id = u.id and t.status = 'done')) as completed,
      -- "Today" is measured in *their* timezone, not the viewer's: seeing a
      -- friend's count reset at your midnight rather than theirs would be
      -- quietly wrong for anyone in another country.
      (select count(*)::int from todos t
        where t.user_id = u.id and t.status = 'done'
          and t.completed_at is not null
          and (t.completed_at at time zone coalesce(p.timezone, 'UTC'))::date
              = (now() at time zone coalesce(p.timezone, 'UTC'))::date) as done_today,
      coalesce((select max(h.streak)::int from habits h
        where h.user_id = u.id and h.active), 0) as streak,
      (select count(*)::int from messages m
        where m.sender_id = u.id and m.recipient_id = ${me}::uuid
          and m.read_at is null) as unread
    from friendships f
    join users u
      on u.id = case when f.requester_id = ${me}::uuid
                     then f.addressee_id else f.requester_id end
    join profiles p on p.id = u.id
    where f.status = 'accepted'
      and (f.requester_id = ${me}::uuid or f.addressee_id = ${me}::uuid)
    -- Busiest today first: the list is more interesting when it reflects
    -- what people are actually doing rather than a static XP ranking.
    order by done_today desc, p.xp desc
  `) as (Omit<FriendSummary, "categories"> & Record<string, unknown>)[];

  if (rows.length === 0) return [];

  // Category names plus open counts — the agreed visibility level.
  const ids = rows.map((r) => r.user_id);
  const cats = (await sql`
    select
      c.user_id,
      c.name,
      c.color,
      (select count(*)::int from todos t
        where t.category_id = c.id and t.status <> 'done') as open
    from categories c
    where c.user_id = any(${ids}::uuid[])
    order by c.sort_order
  `) as { user_id: string; name: string; color: string; open: number }[];

  return rows.map((r) => ({
    ...(r as unknown as FriendSummary),
    categories: cats
      .filter((c) => c.user_id === r.user_id)
      .map(({ name, color, open }) => ({ name, color, open })),
  }));
}

export async function listRequests(): Promise<PendingRequest[]> {
  const me = await requireUserId();

  const rows = (await sql`
    select
      f.id as friendship_id,
      u.username::text as username,
      p.display_name,
      p.xp,
      case when f.addressee_id = ${me}::uuid then 'incoming' else 'outgoing' end as direction
    from friendships f
    join users u
      on u.id = case when f.requester_id = ${me}::uuid
                     then f.addressee_id else f.requester_id end
    join profiles p on p.id = u.id
    where f.status = 'pending'
      and (f.requester_id = ${me}::uuid or f.addressee_id = ${me}::uuid)
    order by f.created_at desc
  `) as PendingRequest[];

  return rows;
}

/** The signed-in user's own key material, for unlocking the thread. */
export async function myKeys(): Promise<{
  publicKey: string | null;
  wrappedPrivateKey: string | null;
  /** The server already holds this account's key (migration 022). */
  escrowed: boolean;
}> {
  const me = await requireUserId();
  const rows = (await sql`
    select public_key, wrapped_private_key from users where id = ${me}::uuid
  `) as { public_key: string | null; wrapped_private_key: string | null }[];

  return {
    publicKey: rows[0]?.public_key ?? null,
    wrappedPrivateKey: rows[0]?.wrapped_private_key ?? null,
    escrowed: await hasEscrow(me),
  };
}

/** Own query, so a database without migration 022 still loads Messages. */
async function hasEscrow(me: string): Promise<boolean> {
  try {
    const rows = (await sql`
      select escrowed_private_key is not null as escrowed
        from users where id = ${me}::uuid
    `) as { escrowed: boolean }[];
    return !!rows[0]?.escrowed;
  } catch {
    return false;
  }
}

/**
 * Files the account's private key (PKCS#8, base64) in escrow, so it survives
 * a forgotten password. Called by a browser that has the key unlocked.
 *
 * Only a key that matches the account's published public key is accepted —
 * one that didn't would read none of its messages — and an existing escrow is
 * left alone, so an old tab can't overwrite a newer key.
 */
export async function escrowMyKey(privateKey: string): Promise<boolean> {
  const me = await requireUserId();
  if (!ESCROW_CONFIGURED) return false;

  const publicKey = publicKeyFor(privateKey);
  if (!publicKey) return false;

  try {
    const rows = (await sql`
      update users set escrowed_private_key = ${sealPrivateKey(privateKey)}
       where id = ${me}::uuid
         and public_key = ${publicKey}
         and escrowed_private_key is null
      returning 1
    `) as unknown[];
    return rows.length > 0;
  } catch {
    return false; // migration 022 not run yet
  }
}

/**
 * The account's private key out of escrow, for a signed-in session that
 * doesn't have it — a new device, a new tab, a password nobody typed here.
 * This is what makes messages belong to the account rather than the password.
 */
export async function recoverMyKey(): Promise<string | null> {
  const me = await requireUserId();
  if (!ESCROW_CONFIGURED) return null;

  try {
    const rows = (await sql`
      select public_key, escrowed_private_key from users where id = ${me}::uuid
    `) as { public_key: string | null; escrowed_private_key: string | null }[];

    const sealed = rows[0]?.escrowed_private_key;
    if (!sealed) return null;
    const key = openPrivateKey(sealed);
    // A key for some other keypair would decrypt nothing; better to say so.
    return key && publicKeyFor(key) === rows[0].public_key ? key : null;
  } catch {
    return null;
  }
}

/* ========================================================================== */
/* Messages — ciphertext in, ciphertext out                                   */
/* ========================================================================== */

export type SealedMessage = {
  id: string;
  sender_id: string;
  iv: string;
  body: string;
  created_at: string;
};

/**
 * The composer caps a draft at 2000 UTF-16 code units. Worst case that is 3
 * bytes each (a BMP character like CJK is one unit, three bytes), plus the
 * 16-byte GCM tag, base64'd: ceil((2000*3 + 16) / 3) * 4 = 8024. So the old
 * 8000 was reachable by a legitimate message. Rounded up to leave room.
 */
const MAX_BODY = 9000;

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** How many messages one fetch will return. */
const PAGE = 300;

export async function sendMessage(
  friendId: string,
  iv: string,
  body: string
): Promise<{ ok: true; message: SealedMessage } | { ok: false; error: string }> {
  const me = await requireUserId();

  if (!iv || !body) return { ok: false, error: "Nothing to send." };
  if (body.length > MAX_BODY) return { ok: false, error: "That message is too long." };
  // The server doesn't decrypt these, so it validates what it can: that they are
  // base64 of a sane size. Without this, `body` is an unbounded blob store.
  if (iv.length > 32 || !B64.test(iv) || !B64.test(body))
    return { ok: false, error: "That message could not be encrypted." };

  // One friend flooding the thread is a storage problem as much as a nuisance.
  if (await rateLimited("sendMessage", me))
    return { ok: false, error: TOO_MANY };

  const ok = (await sql`select are_friends(${me}::uuid, ${friendId}::uuid) as ok`) as {
    ok: boolean;
  }[];
  if (!ok[0]?.ok) return { ok: false, error: "You can only message companions." };

  const rows = (await sql`
    insert into messages (sender_id, recipient_id, iv, body)
    values (${me}::uuid, ${friendId}::uuid, ${iv}, ${body})
    returning id, sender_id, iv, body, created_at
  `) as Record<string, unknown>[];

  // A push to the recipient's devices, once the sender already has their
  // answer. Only who wrote: the text is sealed, and the server can't read it.
  after(() => notifyMessage(friendId, me));

  const r = rows[0];
  return {
    ok: true,
    message: {
      id: r.id as string,
      sender_id: r.sender_id as string,
      iv: r.iv as string,
      body: r.body as string,
      created_at:
        r.created_at instanceof Date
          ? r.created_at.toISOString()
          : String(r.created_at),
    },
  };
}

/**
 * Oldest-first, always.
 *
 * With `afterId` this is the polling call: everything that arrived after that
 * message, which is normally nothing. Without it, the most recent page — the
 * previous version ordered ascending and took the first 300, so a long thread
 * showed its opening messages forever and never the ones you were waiting for.
 *
 * The cursor compares (created_at, id) as a tuple rather than created_at
 * alone, so two messages landing in the same millisecond can't hide each other.
 */
export async function listMessages(
  friendId: string,
  afterId?: string | null
): Promise<SealedMessage[]> {
  const me = await requireUserId();

  const ok = (await sql`select are_friends(${me}::uuid, ${friendId}::uuid) as ok`) as {
    ok: boolean;
  }[];
  if (!ok[0]?.ok) return [];

  const rows = (
    afterId
      ? // Ascending from the cursor: a burst larger than one page leaves the
        // remainder for the next poll instead of opening a gap.
        await sql`
          select id, sender_id, iv, body, created_at
            from messages
           where ((sender_id = ${me}::uuid and recipient_id = ${friendId}::uuid)
              or (sender_id = ${friendId}::uuid and recipient_id = ${me}::uuid))
             and (created_at, id) > (
                   select m2.created_at, m2.id from messages m2
                    where m2.id = ${afterId}::uuid
                 )
           order by created_at, id
           limit ${PAGE}
        `
      : await sql`
          select * from (
            select id, sender_id, iv, body, created_at
              from messages
             where (sender_id = ${me}::uuid and recipient_id = ${friendId}::uuid)
                or (sender_id = ${friendId}::uuid and recipient_id = ${me}::uuid)
             order by created_at desc, id desc
             limit ${PAGE}
          ) recent
          order by created_at, id
        `
  ) as Record<string, unknown>[];

  await sql`
    update messages set read_at = now()
     where recipient_id = ${me}::uuid
       and sender_id = ${friendId}::uuid
       and read_at is null
  `;

  return rows.map((r) => ({
    id: r.id as string,
    sender_id: r.sender_id as string,
    iv: r.iv as string,
    body: r.body as string,
    created_at:
      r.created_at instanceof Date
        ? r.created_at.toISOString()
        : String(r.created_at),
  }));
}

export type InboxEntry = {
  friend_id: string;
  /** Their newest message either way, still sealed: the preview is decrypted in the browser. */
  last: SealedMessage | null;
  unread: number;
  /** When they last read something I sent them: what "Seen" is based on. */
  seen_at: string | null;
  /** Walking around the village right now (migration 026). */
  in_village: boolean;
};

/**
 * One row per companion for the conversation list. The server can't read
 * the previews any more than the messages, so it hands them over sealed.
 */
export async function inbox(): Promise<InboxEntry[]> {
  const me = await requireUserId();
  const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
  const rows = (await sql`
    with friends as (
      select case when requester_id = ${me}::uuid then addressee_id else requester_id end as id
        from friendships
       where status = 'accepted'
         and (requester_id = ${me}::uuid or addressee_id = ${me}::uuid)
    )
    select f.id as friend_id,
           l.id, l.sender_id, l.iv, l.body, l.created_at,
           (select count(*)::int from messages u
             where u.sender_id = f.id and u.recipient_id = ${me}::uuid and u.read_at is null) as unread,
           (select max(r.read_at) from messages r
             where r.sender_id = ${me}::uuid and r.recipient_id = f.id) as seen_at
      from friends f
      left join lateral (
        select m.id, m.sender_id, m.iv, m.body, m.created_at from messages m
         where (m.sender_id = ${me}::uuid and m.recipient_id = f.id)
            or (m.sender_id = f.id and m.recipient_id = ${me}::uuid)
         order by m.created_at desc, m.id desc
         limit 1
      ) l on true
  `) as Record<string, unknown>[];

  // Who's in the village. Its own query, so messaging works before 026 is run.
  let here = new Set<string>();
  try {
    const p = (await sql`
      select user_id from village_presence
       where user_id = any(${rows.map((r) => r.friend_id as string)}::uuid[])
         and seen_at > now() - interval '45 seconds'
    `) as { user_id: string }[];
    here = new Set(p.map((x) => x.user_id));
  } catch {
    /* no village yet */
  }

  return rows.map((r) => ({
    friend_id: r.friend_id as string,
    in_village: here.has(r.friend_id as string),
    last: r.id
      ? { id: r.id as string, sender_id: r.sender_id as string, iv: r.iv as string, body: r.body as string, created_at: iso(r.created_at)! }
      : null,
    unread: r.unread as number,
    seen_at: iso(r.seen_at),
  }));
}

/** Total unread across every companion — drives the badge in the header. */
export async function unreadTotal(): Promise<number> {
  const me = await requireUserId();
  const rows = (await sql`
    select count(*)::int as n from messages
     where recipient_id = ${me}::uuid and read_at is null
  `) as { n: number }[];
  return rows[0]?.n ?? 0;
}

async function notifyMessage(recipientId: string, senderId: string) {
  try {
    const rows = (await sql`
      select coalesce(np.messages, true) as wanted,
             (select display_name from profiles where id = ${senderId}::uuid) as sender
        from (select 1) one
        left join notification_prefs np on np.user_id = ${recipientId}::uuid
    `) as { wanted: boolean; sender: string | null }[];
    if (!rows[0]?.wanted) return;
    await sendToUser(recipientId, {
      title: rows[0].sender ?? "A companion",
      body: "Sent you a message.",
      url: "/friends",
      // One per sender: a burst of messages is one notification, not ten.
      tag: `msg-${senderId}`,
    });
  } catch {
    /* notifications not set up (migration 025): the message still went */
  }
}

/** Never hand a raw driver error to the client — it names tables and columns. */
function msg(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/relation .* does not exist|column .* does not exist|function .* does not exist/i.test(m))
    return "Run the migrations in db/migrations first.";
  console.error("[social]", e);
  return "Something went wrong. Please try again.";
}
