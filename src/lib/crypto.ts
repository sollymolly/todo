/* --------------------------------------------------------------------------
   Browser-side cryptography for end-to-end encrypted messages.

   This module runs ONLY in the browser. The raw password and the unwrapped
   private key must never be sent to the server, so nothing here may be
   imported from a server action or a server component.

   Design
   ------
   Two independent keys are derived from the password with PBKDF2, using
   different salts so neither can be computed from the other:

     authSecret  = PBKDF2(password, "questline-auth|" + email)   -> sent to
                   the server as the login credential. The server then scrypt
                   -hashes it again, so a stolen database still doesn't yield
                   a usable credential.

     masterKey   = PBKDF2(password, "questline-key|" + email)    -> never
                   leaves the browser. Wraps the user's ECDH private key.

   The email is the salt so a fresh browser can derive both before it has ever
   talked to the server. That is weaker than a random per-user salt against
   precomputation, which is why the iteration count is high and the server
   hashes again on top.

   Messages use ECDH P-256 between the two users' keypairs, run through HKDF
   to an AES-GCM key. Both ends derive the same key, so one stored ciphertext
   serves both.
   -------------------------------------------------------------------------- */

const PBKDF2_ITERATIONS = 310_000;
const AUTH_SALT_PREFIX = "questline-auth|";
const KEY_SALT_PREFIX = "questline-key|";

const enc = new TextEncoder();

export function toB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  // Build over a concrete ArrayBuffer so this satisfies BufferSource.
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Random bytes typed as a plain ArrayBuffer view, for Web Crypto params. */
function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(n));
  crypto.getRandomValues(out);
  return out;
}

function subtle(): SubtleCrypto {
  if (typeof window === "undefined" || !window.crypto?.subtle) {
    throw new Error("Encryption needs a browser with Web Crypto (and HTTPS).");
  }
  return window.crypto.subtle;
}

async function pbkdf2(
  password: string,
  salt: string,
  usage: "auth" | "wrap"
): Promise<ArrayBuffer | CryptoKey> {
  const base = await subtle().importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"]
  );

  const params: Pbkdf2Params = {
    name: "PBKDF2",
    salt: enc.encode(salt),
    iterations: PBKDF2_ITERATIONS,
    hash: "SHA-256",
  };

  if (usage === "auth") return subtle().deriveBits(params, base, 256);

  return subtle().deriveKey(params, base, { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** The credential actually sent to the server. The password itself never is. */
export async function deriveAuthSecret(
  email: string,
  password: string
): Promise<string> {
  const bits = (await pbkdf2(
    password,
    AUTH_SALT_PREFIX + email.trim().toLowerCase(),
    "auth"
  )) as ArrayBuffer;
  return toB64(bits);
}

/** Wraps and unwraps the private key. Stays in this tab, always. */
async function deriveMasterKey(
  email: string,
  password: string
): Promise<CryptoKey> {
  return (await pbkdf2(
    password,
    KEY_SALT_PREFIX + email.trim().toLowerCase(),
    "wrap"
  )) as CryptoKey;
}

/* ========================================================================== */
/* Identity keypair                                                           */
/* ========================================================================== */

export type KeyBundle = {
  publicKey: string; // SPKI, base64
  wrappedPrivateKey: string; // iv.ciphertext, both base64
};

/** Encrypts a private key under the master key derived from a password. */
async function wrapPrivateKey(
  email: string,
  password: string,
  privateKey: CryptoKey
): Promise<string> {
  const pkcs8 = await subtle().exportKey("pkcs8", privateKey);
  const master = await deriveMasterKey(email, password);
  const iv = randomBytes(12);
  const wrapped = await subtle().encrypt({ name: "AES-GCM", iv }, master, pkcs8);
  return `${toB64(iv.buffer)}.${toB64(wrapped)}`;
}

/** Called once, when an account is created or upgraded. */
export async function createKeyBundle(
  email: string,
  password: string
): Promise<KeyBundle> {
  const pair = await subtle().generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey", "deriveBits"]
  );

  const spki = await subtle().exportKey("spki", pair.publicKey);

  return {
    publicKey: toB64(spki),
    wrappedPrivateKey: await wrapPrivateKey(email, password, pair.privateKey),
  };
}

/**
 * Moves the existing private key from the old password's wrapping to the new
 * one. This is what makes a password change survivable: the keypair itself is
 * unchanged, so every message already on the server still decrypts and the
 * friend holding your public key notices nothing.
 *
 * Generating a fresh keypair here instead would silently destroy every
 * conversation the account has ever had.
 */
export async function rewrapPrivateKey(
  email: string,
  oldPassword: string,
  newPassword: string,
  wrappedPrivateKey: string
): Promise<string> {
  const priv = await unwrapPrivateKey(email, oldPassword, wrappedPrivateKey);
  return wrapPrivateKey(email, newPassword, priv);
}

export async function unwrapPrivateKey(
  email: string,
  password: string,
  wrappedPrivateKey: string
): Promise<CryptoKey> {
  const [ivB64, dataB64] = wrappedPrivateKey.split(".");
  if (!ivB64 || !dataB64) throw new Error("Malformed key material");

  const master = await deriveMasterKey(email, password);
  const pkcs8 = await subtle().decrypt(
    { name: "AES-GCM", iv: fromB64(ivB64) },
    master,
    fromB64(dataB64)
  );

  return subtle().importKey("pkcs8", pkcs8, { name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveKey",
    "deriveBits",
  ]);
}

/* ========================================================================== */
/* Session storage of the unwrapped key                                       */
/* ========================================================================== */

const SESSION_KEY = "questline.privateKey";

/**
 * Kept in sessionStorage so navigating between pages doesn't force a
 * re-prompt. It is cleared when the tab closes and on sign-out.
 *
 * Trade-off worth being explicit about: anything able to run script in this
 * origin can read it. That is inherent to doing E2EE in a browser — the
 * alternative is re-entering the password on every page load.
 */
export async function rememberPrivateKey(key: CryptoKey): Promise<void> {
  const jwk = await subtle().exportKey("jwk", key);
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(jwk));
}

export async function loadPrivateKey(): Promise<CryptoKey | null> {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return await subtle().importKey(
      "jwk",
      JSON.parse(raw),
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveKey", "deriveBits"]
    );
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function forgetPrivateKey(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage unavailable — nothing to clear */
  }
}

/* ========================================================================== */
/* Messages                                                                   */
/* ========================================================================== */

/** ECDH -> HKDF -> AES-GCM. Both ends derive an identical key. */
async function conversationKey(
  myPrivateKey: CryptoKey,
  theirPublicKeyB64: string
): Promise<CryptoKey> {
  const theirKey = await subtle().importKey(
    "spki",
    fromB64(theirPublicKeyB64),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  const shared = await subtle().deriveBits(
    { name: "ECDH", public: theirKey },
    myPrivateKey,
    256
  );

  const hkdfBase = await subtle().importKey("raw", shared, "HKDF", false, [
    "deriveKey",
  ]);

  return subtle().deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: enc.encode("questline-dm"),
      info: enc.encode("aes-gcm-256"),
    },
    hkdfBase,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export type Sealed = { iv: string; body: string };

export async function sealMessage(
  myPrivateKey: CryptoKey,
  theirPublicKeyB64: string,
  plaintext: string
): Promise<Sealed> {
  const key = await conversationKey(myPrivateKey, theirPublicKeyB64);
  const iv = randomBytes(12);
  const body = await subtle().encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plaintext)
  );
  return { iv: toB64(iv.buffer), body: toB64(body) };
}

export async function openMessage(
  myPrivateKey: CryptoKey,
  theirPublicKeyB64: string,
  sealed: Sealed
): Promise<string> {
  const key = await conversationKey(myPrivateKey, theirPublicKeyB64);
  const plain = await subtle().decrypt(
    { name: "AES-GCM", iv: fromB64(sealed.iv) },
    key,
    fromB64(sealed.body)
  );
  return new TextDecoder().decode(plain);
}
