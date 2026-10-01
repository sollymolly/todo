#!/usr/bin/env node
/*
  Replaces names chosen before the name filter (src/lib/names.ts) with
  defaults: a bad @username becomes knight_xxxxxx, a bad display name
  "Adventurer". Sign-in is by email, so nobody is locked out.

  Shows what it would change; --apply changes it.

  Run:  node --env-file=.env.local scripts/clean-names.mjs [--apply]
*/

import { neon } from "@neondatabase/serverless";
import { badName, DEFAULT_DISPLAY_NAME, defaultUsername } from "../src/lib/names.ts";

const apply = process.argv.includes("--apply");
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set: run with --env-file=.env.local");
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

const rows = await sql`
  select u.id, u.username::text as username, p.display_name
    from users u left join profiles p on p.id = u.id
`;

let changed = 0;
for (const r of rows) {
  if (badName(r.username)) {
    let name = defaultUsername();
    while ((await sql`select 1 from users where username = ${name}`).length) name = defaultUsername();
    console.log(`@${r.username} → @${name}`);
    if (apply) await sql`update users set username = ${name} where id = ${r.id}::uuid`;
    changed++;
  }
  if (r.display_name != null && badName(r.display_name)) {
    console.log(`"${r.display_name}" → "${DEFAULT_DISPLAY_NAME}"`);
    if (apply) await sql`update profiles set display_name = ${DEFAULT_DISPLAY_NAME} where id = ${r.id}::uuid`;
    changed++;
  }
}

console.log(`\n${rows.length} accounts checked; ${changed} name(s) ${apply ? "replaced" : "would be replaced (run with --apply)"}.`);
