import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

/* --------------------------------------------------------------------------
   Password hashing with Node's built-in scrypt — a memory-hard KDF, so no
   third-party dependency is needed.

   Stored form:  scrypt$<N>$<r>$<p>$<saltHex>$<hashHex>
   The parameters travel with the hash so they can be raised later without
   invalidating existing passwords.
   -------------------------------------------------------------------------- */

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  opts: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, opts, (err, key) =>
      err ? reject(err) : resolve(key)
    );
  });
}

const N = 16384; // CPU/memory cost — ~16 MB per hash at r=8
const R = 8;
const P = 1;
const KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEYLEN, { N, r: R, p: P });

  return [
    "scrypt",
    N,
    R,
    P,
    salt.toString("hex"),
    hash.toString("hex"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, saltHex, hashHex] = parts;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");

  const actual = await scryptAsync(password, salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Burns roughly the same time as a real verification. Used when no account
 * matches, so a wrong email and a wrong password take equally long to reject.
 */
export async function dummyVerify(password: string): Promise<void> {
  await scryptAsync(password, randomBytes(16), KEYLEN, { N, r: R, p: P });
}
