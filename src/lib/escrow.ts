import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
} from "node:crypto";

/* --------------------------------------------------------------------------
   The server's copy of each account's message key — see db/schema.sql.

   Server-only. The escrow is sealed with AES-256-GCM under a key derived from
   MESSAGE_KEY_SECRET, which lives in the environment and never in the
   database: a leaked backup on its own still reads nothing. Anyone with both
   can read messages, which is the price of messages that survive a forgotten
   password, and the privacy policy says so.

   Without the secret, escrow is simply off, and everything behaves as it did
   before: the password is the only way to the key.

   ⚠ Changing MESSAGE_KEY_SECRET makes every escrow unreadable. Nothing is lost
   while people remember their passwords, but a reset after the change falls
   back to fresh keys and a cleared history. Set it once and leave it.
   -------------------------------------------------------------------------- */

const MIN_SECRET_LENGTH = 32;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export const ESCROW_CONFIGURED =
  (process.env.MESSAGE_KEY_SECRET?.length ?? 0) >= MIN_SECRET_LENGTH;

function key(): Buffer {
  const secret = process.env.MESSAGE_KEY_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH)
    throw new Error(`MESSAGE_KEY_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  // Domain-separated, so the same string reused elsewhere by mistake would
  // not produce the same key.
  return createHash("sha256").update(`habitknight-message-escrow|${secret}`).digest();
}

/** Seals a PKCS#8 private key (base64) as "v1.iv.tag.ciphertext". */
export function sealPrivateKey(pkcs8: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(Buffer.from(pkcs8, "base64")), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), body]
    .map((part) => (typeof part === "string" ? part : part.toString("base64")))
    .join(".");
}

/** The PKCS#8 key (base64) back out of an escrow, or null if it won't open. */
export function openPrivateKey(sealed: string): string | null {
  try {
    const [version, iv, tag, body] = sealed.split(".");
    if (version !== "v1" || !iv || !tag || !body) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(body, "base64")),
      decipher.final(),
    ]).toString("base64");
  } catch {
    // A changed secret, or a tampered row. Either way there's no key here.
    return null;
  }
}

/**
 * The public key (SPKI, base64) a PKCS#8 private key belongs to, or null if
 * it isn't a well-formed EC key. This is how the server checks that a key it
 * is asked to escrow really is the account's — otherwise a bug, or a stale
 * tab, could file away a key that opens nothing.
 */
export function publicKeyFor(pkcs8: string): string | null {
  if (pkcs8.length > 1024 || !BASE64.test(pkcs8)) return null;
  try {
    const priv = createPrivateKey({
      key: Buffer.from(pkcs8, "base64"),
      format: "der",
      type: "pkcs8",
    });
    if (priv.asymmetricKeyType !== "ec") return null;
    return createPublicKey(priv).export({ format: "der", type: "spki" }).toString("base64");
  } catch {
    return null;
  }
}
