import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

/* --------------------------------------------------------------------------
   Sessions are a signed JWT in an httpOnly cookie. No session table, no
   third-party service — the signature is what makes it trustworthy.

   Only jose is used here (Web Crypto), so this module is safe to import from
   the Edge runtime in proxy.ts as well as from Node server actions.
   -------------------------------------------------------------------------- */

export const COOKIE = "questline_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export const SESSION_CONFIGURED = !!process.env.SESSION_SECRET;

function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export async function signSession(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(key());
}

/** Returns the user id, or null if the token is missing, tampered or expired. */
export async function verifySession(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function startSession(userId: string) {
  const store = await cookies();
  store.set(COOKIE, await signSession(userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function endSession() {
  const store = await cookies();
  store.delete(COOKIE);
}

/** The signed-in user's id, or null. Use requireUserId() when it's mandatory. */
export async function getUserId(): Promise<string | null> {
  const store = await cookies();
  return verifySession(store.get(COOKIE)?.value);
}

export async function requireUserId(): Promise<string> {
  const id = await getUserId();
  if (!id) throw new Error("Not signed in");
  return id;
}
