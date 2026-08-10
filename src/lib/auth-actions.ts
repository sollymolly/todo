"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { dummyVerify, hashPassword, verifyPassword } from "@/lib/password";
import { endSession, requireUserId, startSession } from "@/lib/session";
import { rateLimited, TOO_MANY } from "@/lib/rate-limit";
import { PRIVACY_VERSION } from "@/lib/policy";
import { OWNER_EMAIL } from "@/lib/owner";

/* --------------------------------------------------------------------------
   Under auth_version 2 the browser derives an "auth secret" from the password
   and sends only that. The server scrypt-hashes the secret on top, so the raw
   password never reaches this process and a stolen database still yields no
   usable credential.

   Accounts created before that change are auth_version 1: their stored hash
   was computed from the raw password. `upgradeAccount` migrates one, and is
   the only path that ever accepts a raw password.
   -------------------------------------------------------------------------- */

export type AuthResult = { ok: true } | { ok: false; error: string };

/** Sign-in hands back the wrapped key, but only once the secret has verified. */
export type SignInResult =
  | { ok: true; wrappedPrivateKey: string | null }
  | { ok: false; error: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME = /^[a-zA-Z0-9_]{3,20}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Key material is opaque to this server, which is exactly why its *shape* has
 * to be checked here. Without this, `publicKey` is an unbounded attacker-
 * controlled string that the app later hands to every one of your friends —
 * and an easy way to park megabytes in a 0.5 GB database.
 */
function wellFormedKeys(publicKey: string, wrapped: string): boolean {
  if (publicKey.length > 512 || !BASE64.test(publicKey)) return false;
  if (wrapped.length > 1024) return false;
  const [iv, ciphertext, ...rest] = wrapped.split(".");
  if (!iv || !ciphertext || rest.length) return false;
  return BASE64.test(iv) && BASE64.test(ciphertext);
}

/**
 * Every new account starts already befriended to whoever runs the instance,
 * so nobody lands on an empty Companions page. Set OWNER_EMAIL to move it.
 *
 * Worth being clear about what this grants, since the new user never agreed
 * to it: an accepted friendship is mutual, so the owner can see their
 * category names with open counts, their completed-quest total and level, and
 * can open a DM thread with them. Quest titles and notes stay private.
 */
async function befriendOwner(newUserId: string) {
  try {
    // The owner is stored as the requester so the pair ordering is
    // deterministic. Nothing happens if that account doesn't exist yet, or if
    // the person signing up *is* the owner.
    await sql`
      insert into friendships (requester_id, addressee_id, status, responded_at)
      select u.id, ${newUserId}::uuid, 'accepted', now()
        from users u
       where u.email = ${OWNER_EMAIL}
         and u.id <> ${newUserId}::uuid
      on conflict (requester_id, addressee_id) do nothing
    `;
  } catch {
    // A missing friendships table or any other hiccup must never cost someone
    // their account — they just start with no companions, as before.
  }
}

/* --------------------------------------------------------------------------
   There used to be a `probeAccount` here that any unauthenticated caller could
   run against any email address. It was the worst hole in the app, twice over:

     1. For a real account it returned `wrapped_private_key`. That blob is the
        user's ECDH private key sealed under PBKDF2(password). Handing it to a
        stranger converts "guess the password against a rate-limited server"
        into "guess it offline, on your own hardware, as fast as you like" —
        and cracking it yields not just the account but every message ever sent
        to it. 310k PBKDF2 iterations slow that down; they do not stop it.

     2. Its answer differed for accounts that existed, so it was also a
        free membership oracle for any list of email addresses.

   Both are gone. The wrapped key is now returned by `signIn` only after the
   secret verifies, and there is no pre-login endpoint left to probe.
   -------------------------------------------------------------------------- */

export async function signUp(input: {
  email: string;
  username: string;
  authSecret: string;
  displayName: string;
  publicKey: string;
  wrappedPrivateKey: string;
  /** The policy version the form actually displayed. */
  acceptedPrivacyVersion: number;
}): Promise<AuthResult> {
  const mail = input.email.trim().toLowerCase();
  const username = input.username.trim();

  if (!EMAIL.test(mail)) return { ok: false, error: "That doesn't look like an email address." };
  if (!USERNAME.test(username))
    return {
      ok: false,
      error: "Username must be 3–20 characters: letters, numbers or underscore.",
    };
  if (!input.authSecret || !input.publicKey || !input.wrappedPrivateKey)
    return { ok: false, error: "Your browser could not prepare encryption keys." };
  if (!wellFormedKeys(input.publicKey, input.wrappedPrivateKey))
    return { ok: false, error: "Your browser could not prepare encryption keys." };

  // The *version the client displayed* is what's checked, not a bare "true".
  // A tab left open across a policy change would otherwise have someone
  // recorded as agreeing to text they were never shown.
  if (input.acceptedPrivacyVersion !== PRIVACY_VERSION)
    return {
      ok: false,
      error: "The privacy policy has been updated. Reload the page and read it again.",
    };

  if (await rateLimited("signUp")) return { ok: false, error: TOO_MANY };

  try {
    const taken = (await sql`
      select 1 from users where username = ${username} limit 1
    `) as unknown[];
    if (taken.length) return { ok: false, error: "That username is taken." };

    const hash = await hashPassword(input.authSecret);

    const rows = (await sql`
      insert into users
        (email, username, password_hash, auth_version, public_key, wrapped_private_key,
         privacy_version, privacy_accepted_at)
      values
        (${mail}, ${username}, ${hash}, 2, ${input.publicKey}, ${input.wrappedPrivateKey},
         ${PRIVACY_VERSION}, now())
      on conflict (email) do nothing
      returning id
    `) as { id: string }[];

    if (rows.length === 0)
      return { ok: false, error: "An account with that email already exists." };

    const userId = rows[0].id;
    await sql`
      insert into policy_acceptances (user_id, version)
      values (${userId}::uuid, ${PRIVACY_VERSION})
      on conflict (user_id, version) do nothing
    `;
    await sql`select bootstrap_user(${userId}::uuid, ${input.displayName.trim() || username}::text)`;
    await befriendOwner(userId);
    await startSession(userId, PRIVACY_VERSION);

    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

export async function signIn(
  email: string,
  authSecret: string
): Promise<SignInResult> {
  const mail = email.trim().toLowerCase();
  const WRONG = "Email or password is incorrect.";

  // Checked before the scrypt call, not after: the whole point is to stop an
  // attacker spending our CPU. Both buckets must pass — one caps a single
  // source, the other caps attempts against a single account.
  if ((await rateLimited("signIn")) || (await rateLimited("signInEmail", mail)))
    return { ok: false, error: TOO_MANY };

  try {
    const rows = (await sql`
      select id, password_hash, wrapped_private_key, privacy_version
        from users where email = ${mail} and auth_version >= 2
    `) as {
      id: string;
      password_hash: string;
      wrapped_private_key: string | null;
      privacy_version: number;
    }[];

    if (rows.length === 0) {
      // Spend the same time as a real check so timing reveals nothing.
      await dummyVerify(authSecret);
      return { ok: false, error: WRONG };
    }

    if (!(await verifyPassword(authSecret, rows[0].password_hash)))
      return { ok: false, error: WRONG };

    await startSession(rows[0].id, rows[0].privacy_version ?? 0);
    revalidatePath("/", "layout");
    // Released only on this side of the password check.
    return { ok: true, wrappedPrivateKey: rows[0].wrapped_private_key };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

/* ========================================================================== */
/* Account                                                                    */
/* ========================================================================== */

export type Account = {
  email: string;
  username: string;
  authVersion: number;
  publicKey: string | null;
  wrappedPrivateKey: string | null;
};

/** The signed-in user's own details. The email is needed as the PBKDF2 salt. */
export async function myAccount(): Promise<Account | null> {
  const userId = await requireUserId();
  const rows = (await sql`
    select email::text as email, username::text as username,
           auth_version, public_key, wrapped_private_key
      from users where id = ${userId}::uuid
  `) as {
    email: string;
    username: string;
    auth_version: number;
    public_key: string | null;
    wrapped_private_key: string | null;
  }[];

  if (rows.length === 0) return null;
  return {
    email: rows[0].email,
    username: rows[0].username,
    authVersion: rows[0].auth_version,
    publicKey: rows[0].public_key,
    wrappedPrivateKey: rows[0].wrapped_private_key,
  };
}

/**
 * Change the password. The browser has already done the interesting part: it
 * re-wrapped the private key under the new password and derived both auth
 * secrets. This only proves the old secret matches and swaps the two values
 * together, so the hash and the key material can never disagree.
 *
 * Note this server never learns the new password's length or content — it sees
 * a fixed-size derived secret. Strength is enforced in the browser, which is
 * the only place the password exists.
 */
export async function changePassword(input: {
  currentAuthSecret: string;
  newAuthSecret: string;
  publicKey: string;
  wrappedPrivateKey: string;
}): Promise<AuthResult> {
  const userId = await requireUserId();

  if (!input.currentAuthSecret || !input.newAuthSecret)
    return { ok: false, error: "Both passwords are required." };
  if (input.currentAuthSecret === input.newAuthSecret)
    return { ok: false, error: "That is already your password." };
  if (!input.publicKey || !input.wrappedPrivateKey)
    return { ok: false, error: "Your browser could not prepare encryption keys." };
  if (!wellFormedKeys(input.publicKey, input.wrappedPrivateKey))
    return { ok: false, error: "Your browser could not prepare encryption keys." };

  // A stolen session cookie must not be enough to grind the password here.
  if (await rateLimited("changePassword", userId))
    return { ok: false, error: TOO_MANY };

  try {
    const rows = (await sql`
      select password_hash from users where id = ${userId}::uuid and auth_version >= 2
    `) as { password_hash: string }[];

    if (rows.length === 0) return { ok: false, error: "Account not found." };

    if (!(await verifyPassword(input.currentAuthSecret, rows[0].password_hash)))
      return { ok: false, error: "Your current password is incorrect." };

    const hash = await hashPassword(input.newAuthSecret);

    await sql`
      update users set
        password_hash       = ${hash},
        public_key          = ${input.publicKey},
        wrapped_private_key = ${input.wrappedPrivateKey}
      where id = ${userId}::uuid
    `;

    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

/* ========================================================================== */
/* Privacy consent                                                            */
/* ========================================================================== */

/**
 * Records agreement to the current policy for an account that already exists.
 *
 * Two things make this hold up as a consent record rather than a checkbox:
 * the version agreed to is written alongside the timestamp into an append-only
 * table, and the *client tells us which version it displayed* — so a tab left
 * open across a policy change can't have someone recorded as agreeing to text
 * they never saw.
 *
 * The session cookie is then re-issued carrying the new version, which is what
 * lets the gate in the proxy clear without a database read per request.
 */
export async function acceptPrivacy(version: number): Promise<AuthResult> {
  const userId = await requireUserId();

  if (version !== PRIVACY_VERSION)
    return {
      ok: false,
      error: "The privacy policy has been updated. Reload the page and read it again.",
    };

  try {
    await sql`
      update users
         set privacy_version = ${PRIVACY_VERSION}, privacy_accepted_at = now()
       where id = ${userId}::uuid
    `;
    // Append-only: re-consenting to a later version leaves the older row.
    await sql`
      insert into policy_acceptances (user_id, version)
      values (${userId}::uuid, ${PRIVACY_VERSION})
      on conflict (user_id, version) do nothing
    `;

    await startSession(userId, PRIVACY_VERSION);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

/**
 * Someone who accepted on another device arrives here with a stale cookie.
 * Re-issuing it from what the database already says avoids asking twice for
 * the same agreement.
 */
export async function refreshConsentSession(): Promise<boolean> {
  const userId = await requireUserId();
  try {
    const rows = (await sql`
      select privacy_version from users where id = ${userId}::uuid
    `) as { privacy_version: number }[];

    const stored = rows[0]?.privacy_version ?? 0;
    if (stored < PRIVACY_VERSION) return false;

    await startSession(userId, stored);
    return true;
  } catch {
    return false;
  }
}

export async function signOut() {
  await endSession();
  revalidatePath("/", "layout");
  redirect("/login");
}

/**
 * Turns an exception into something safe to show.
 *
 * The old version ended in `return msg` — the raw driver error. On a failed
 * query Postgres names the table, the column and often the constraint, so an
 * attacker could map the schema just by provoking errors on the login form.
 * Anything unrecognised is now generic here and detailed only in the logs.
 */
function friendly(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);

  // Setup problems are worth naming: they're about *your* deployment, not a
  // user's data, and the fix is a migration.
  if (/column .* does not exist/i.test(msg))
    return "Your database is behind — run the migrations in db/migrations.";
  if (/relation .* does not exist/i.test(msg))
    return "The database tables aren't set up yet — run db/schema.sql.";
  if (/SESSION_SECRET/.test(msg)) return "The server is missing SESSION_SECRET.";
  if (/DATABASE_URL|ENOTFOUND|fetch failed/i.test(msg))
    return "Could not reach the database.";

  console.error("[auth]", e);
  return "Something went wrong. Please try again.";
}
