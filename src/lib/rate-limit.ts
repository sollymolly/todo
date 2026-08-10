import { headers } from "next/headers";
import { sql } from "@/lib/db";

/* --------------------------------------------------------------------------
   Fixed-window rate limiting, kept in Postgres.

   Why this matters more than usual here: verifying a password runs scrypt at
   N=16384, which costs ~16 MB of memory and ~100 ms of CPU *per attempt*. An
   unauthenticated attacker hammering sign-in therefore gets free amplification
   — a few hundred requests a second is enough to exhaust a serverless
   function's memory budget. The limiter is as much a denial-of-service control
   as a brute-force one, which is why it runs *before* the hash.

   It deliberately FAILS OPEN. If the table is missing or the database hiccups,
   people can still sign in; the account is still protected by scrypt and by
   the password itself. Failing closed would turn a transient database problem
   into a total lockout, which is the worse outcome for a personal app.
   -------------------------------------------------------------------------- */

export type Limit = { limit: number; windowSeconds: number };

/** Tuned to be invisible to a real person and painful for a script. */
export const LIMITS = {
  /** Per IP. Sign-in is the expensive one. */
  signIn: { limit: 10, windowSeconds: 300 },
  /** Per email, so one target can't be ground down from many addresses. */
  signInEmail: { limit: 10, windowSeconds: 900 },
  signUp: { limit: 5, windowSeconds: 3600 },
  changePassword: { limit: 10, windowSeconds: 900 },
  /** Exact-match lookup, but still worth capping as a probing tool. */
  findPerson: { limit: 60, windowSeconds: 300 },
  sendMessage: { limit: 120, windowSeconds: 60 },
  /** Per account. Generous for a real person, tight enough to stop a flood. */
  feedback: { limit: 10, windowSeconds: 3600 },
} as const satisfies Record<string, Limit>;

/**
 * Best-effort caller identity. Behind Vercel `x-forwarded-for` is set by the
 * edge and its first entry is the real client; locally it's usually absent.
 * A spoofed value can only be used to rate-limit *yourself*, so trusting it
 * costs nothing — the per-email bucket is what protects a targeted account.
 */
async function clientKey(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  const ip = fwd ? fwd.split(",")[0] : h.get("x-real-ip");
  return (ip ?? "local").trim().slice(0, 64);
}

async function hit(bucket: string, { limit, windowSeconds }: Limit): Promise<boolean> {
  const rows = (await sql`
    insert into rate_limits (bucket, window_start, hits)
    values (${bucket}, now(), 1)
    on conflict (bucket) do update set
      hits = case
               when rate_limits.window_start
                    < now() - make_interval(secs => ${windowSeconds}::double precision)
               then 1
               else rate_limits.hits + 1
             end,
      window_start = case
               when rate_limits.window_start
                    < now() - make_interval(secs => ${windowSeconds}::double precision)
               then now()
               else rate_limits.window_start
             end
    returning hits
  `) as { hits: number }[];

  return (rows[0]?.hits ?? 0) > limit;
}

/**
 * True when the caller has run out of attempts. `scope` narrows the bucket
 * beyond the IP — pass an email to also cap attempts against one account.
 */
export async function rateLimited(
  action: keyof typeof LIMITS,
  scope?: string
): Promise<boolean> {
  try {
    const who = scope ? `${action}:s:${scope.slice(0, 120)}` : `${action}:ip:${await clientKey()}`;
    return await hit(who, LIMITS[action]);
  } catch {
    return false; // fail open — see the note at the top of this file
  }
}

export const TOO_MANY =
  "Too many attempts. Wait a few minutes and try again.";
