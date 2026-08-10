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

const ISSUER = "questline";
const AUDIENCE = "questline-session";
/** 32 bytes of entropy. Below this an HS256 key is worth trying to brute-force. */
const MIN_SECRET_LENGTH = 32;

function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  // A short secret silently downgrades every session to forgeable. Refusing to
  // start is the only safe response — this signs the entire authorisation model.
  if (secret.length < MIN_SECRET_LENGTH)
    throw new Error(
      `SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters — generate one with: openssl rand -base64 32`
    );
  return new TextEncoder().encode(secret);
}

/**
 * `pv` is the privacy-policy version this session has accepted. Keeping it in
 * the signed cookie means the consent gate can run in the proxy on every
 * request without touching the database — and, because the cookie is signed,
 * it can't be edited to skip the gate.
 */
export type Session = { userId: string; privacyVersion: number };

export async function signSession(
  userId: string,
  privacyVersion: number
): Promise<string> {
  return new SignJWT({ sub: userId, pv: privacyVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(key());
}

/** Returns the session, or null if the token is missing, tampered or expired. */
export async function verifySession(
  token: string | undefined
): Promise<Session | null> {
  if (!token) return null;
  try {
    // The algorithm is pinned rather than inferred from the token's own header,
    // so a forged header can never talk the verifier into a weaker check.
    const { payload } = await jwtVerify(token, key(), {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof payload.sub !== "string" || !payload.sub) return null;
    return {
      userId: payload.sub,
      // Cookies issued before consent existed carry no claim: treat them as
      // having accepted nothing, which routes them through the gate.
      privacyVersion: typeof payload.pv === "number" ? payload.pv : 0,
    };
  } catch {
    return null;
  }
}

export async function startSession(userId: string, privacyVersion: number) {
  const store = await cookies();
  store.set(COOKIE, await signSession(userId, privacyVersion), {
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

/** The whole session, or null. */
export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  return verifySession(store.get(COOKIE)?.value);
}

/** The signed-in user's id, or null. Use requireUserId() when it's mandatory. */
export async function getUserId(): Promise<string | null> {
  return (await getSession())?.userId ?? null;
}

export async function requireUserId(): Promise<string> {
  const id = await getUserId();
  if (!id) throw new Error("Not signed in");
  return id;
}
