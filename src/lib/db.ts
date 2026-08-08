import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

/* --------------------------------------------------------------------------
   Tagged-template query helper. Interpolations become bound parameters, so
   sql`select * from todos where id = ${id}` is safe against injection.

   The underlying client is created lazily: neon() validates the connection
   string eagerly, and building the app (on Vercel, or locally before
   .env.local exists) must not require a reachable database.
   -------------------------------------------------------------------------- */

let client: NeonQueryFunction<false, false> | null = null;

function connect(): NeonQueryFunction<false, false> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — see README.md");
  }
  client ??= neon(process.env.DATABASE_URL);
  return client;
}

export const sql = ((...args: Parameters<NeonQueryFunction<false, false>>) =>
  connect()(...args)) as NeonQueryFunction<false, false>;

export const DB_CONFIGURED = !!process.env.DATABASE_URL;
