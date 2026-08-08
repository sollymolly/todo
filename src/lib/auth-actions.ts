"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { dummyVerify, hashPassword, verifyPassword } from "@/lib/password";
import { endSession, requireUserId, startSession } from "@/lib/session";

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

export type LoginProbe =
  | { ok: true; needsUpgrade: false; wrappedPrivateKey: string | null }
  | { ok: true; needsUpgrade: true }
  | { ok: false; error: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME = /^[a-zA-Z0-9_]{3,20}$/;

/** Which login flow an account needs, before any secret is sent. */
export async function probeAccount(email: string): Promise<LoginProbe> {
  const mail = email.trim().toLowerCase();
  if (!EMAIL.test(mail)) return { ok: false, error: "That doesn't look like an email address." };

  try {
    const rows = (await sql`
      select auth_version, wrapped_private_key from users where email = ${mail}
    `) as { auth_version: number; wrapped_private_key: string | null }[];

    // Don't reveal whether the account exists — treat unknown as "modern".
    if (rows.length === 0) return { ok: true, needsUpgrade: false, wrappedPrivateKey: null };
    if (rows[0].auth_version < 2) return { ok: true, needsUpgrade: true };

    return {
      ok: true,
      needsUpgrade: false,
      wrappedPrivateKey: rows[0].wrapped_private_key,
    };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

export async function signUp(input: {
  email: string;
  username: string;
  authSecret: string;
  displayName: string;
  publicKey: string;
  wrappedPrivateKey: string;
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

  try {
    const taken = (await sql`
      select 1 from users where username = ${username} limit 1
    `) as unknown[];
    if (taken.length) return { ok: false, error: "That username is taken." };

    const hash = await hashPassword(input.authSecret);

    const rows = (await sql`
      insert into users
        (email, username, password_hash, auth_version, public_key, wrapped_private_key)
      values
        (${mail}, ${username}, ${hash}, 2, ${input.publicKey}, ${input.wrappedPrivateKey})
      on conflict (email) do nothing
      returning id
    `) as { id: string }[];

    if (rows.length === 0)
      return { ok: false, error: "An account with that email already exists." };

    const userId = rows[0].id;
    await sql`select bootstrap_user(${userId}::uuid, ${input.displayName.trim() || username}::text)`;
    await startSession(userId);

    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

export async function signIn(email: string, authSecret: string): Promise<AuthResult> {
  const mail = email.trim().toLowerCase();

  try {
    const rows = (await sql`
      select id, password_hash, auth_version from users where email = ${mail}
    `) as { id: string; password_hash: string; auth_version: number }[];

    if (rows.length === 0) {
      // Spend the same time as a real check so timing reveals nothing.
      await dummyVerify(authSecret);
      return { ok: false, error: "Email or password is incorrect." };
    }
    if (rows[0].auth_version < 2)
      return { ok: false, error: "This account needs its one-time security upgrade." };

    if (!(await verifyPassword(authSecret, rows[0].password_hash)))
      return { ok: false, error: "Email or password is incorrect." };

    await startSession(rows[0].id);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

/**
 * One-time migration from auth_version 1. This is the only action that sees a
 * raw password: it is needed once to prove ownership against the old hash.
 * Afterwards the account uses derived secrets exclusively.
 */
export async function upgradeAccount(input: {
  email: string;
  password: string;
  authSecret: string;
  username: string;
  publicKey: string;
  wrappedPrivateKey: string;
}): Promise<AuthResult> {
  const mail = input.email.trim().toLowerCase();
  const username = input.username.trim();

  if (!USERNAME.test(username))
    return {
      ok: false,
      error: "Username must be 3–20 characters: letters, numbers or underscore.",
    };

  try {
    const rows = (await sql`
      select id, password_hash, auth_version, username from users where email = ${mail}
    `) as {
      id: string;
      password_hash: string;
      auth_version: number;
      username: string;
    }[];

    if (rows.length === 0) {
      await dummyVerify(input.password);
      return { ok: false, error: "Email or password is incorrect." };
    }

    const user = rows[0];
    if (user.auth_version >= 2)
      return { ok: false, error: "This account has already been upgraded." };

    if (!(await verifyPassword(input.password, user.password_hash)))
      return { ok: false, error: "Email or password is incorrect." };

    if (username.toLowerCase() !== user.username.toLowerCase()) {
      const taken = (await sql`
        select 1 from users where username = ${username} and id <> ${user.id}::uuid limit 1
      `) as unknown[];
      if (taken.length) return { ok: false, error: "That username is taken." };
    }

    const hash = await hashPassword(input.authSecret);

    await sql`
      update users set
        password_hash       = ${hash},
        auth_version        = 2,
        username            = ${username},
        public_key          = ${input.publicKey},
        wrapped_private_key = ${input.wrappedPrivateKey}
      where id = ${user.id}::uuid
    `;

    await startSession(user.id);
    revalidatePath("/", "layout");
    return { ok: true };
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

  try {
    const rows = (await sql`
      select password_hash, auth_version from users where id = ${userId}::uuid
    `) as { password_hash: string; auth_version: number }[];

    if (rows.length === 0) return { ok: false, error: "Account not found." };
    if (rows[0].auth_version < 2)
      return {
        ok: false,
        error: "This account needs its one-time security upgrade — sign out and back in first.",
      };

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

export async function signOut() {
  await endSession();
  revalidatePath("/", "layout");
  redirect("/login");
}

function friendly(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);

  if (/column .* does not exist/i.test(msg))
    return "Your database is behind — run db/migrations/002-social.sql in the Neon SQL Editor.";
  if (/relation .* does not exist/i.test(msg))
    return "The database tables aren't set up yet — run db/schema.sql against your Neon database.";
  if (/SESSION_SECRET/.test(msg)) return "SESSION_SECRET is missing from .env.local.";
  if (/DATABASE_URL|invalid|ENOTFOUND|fetch failed/i.test(msg))
    return "Could not reach the database. Check DATABASE_URL in .env.local.";

  return msg;
}
