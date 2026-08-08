import { redirect } from "next/navigation";
import Dashboard from "@/components/Dashboard";
import { sql } from "@/lib/db";
import { getUserId } from "@/lib/session";
import { sweepOverdue } from "@/lib/actions";
import { unreadTotal } from "@/lib/social-actions";
import { DEFAULT_APPEARANCE, DEFAULT_EQUIPPED } from "@/lib/game";
import { normalizeTodo } from "@/lib/types";
import type { Category, Profile, Todo } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  const userId = await getUserId();
  if (!userId) redirect("/login");

  let sweptCount = 0;
  let profile: Profile | null = null;
  let categories: Category[] = [];
  let todos: Todo[] = [];

  try {
    // Anything past its deadline by more than a day fails before we read.
    sweptCount = (await sweepOverdue()).count;

    const [profileRows, categoryRows, todoRows] = await Promise.all([
      sql`select * from profiles where id = ${userId}::uuid`,
      sql`select * from categories where user_id = ${userId}::uuid order by sort_order`,
      sql`select * from todos where user_id = ${userId}::uuid order by position nulls last, created_at desc`,
    ]);

    profile = (profileRows as Profile[])[0] ?? null;
    categories = categoryRows as Category[];
    todos = (todoRows as Record<string, unknown>[]).map(normalizeTodo);

    // A profile can be missing if a user row was created outside the app.
    if (!profile) {
      await sql`select bootstrap_user(${userId}::uuid, ${"Adventurer"}::text)`;
      const rows = (await sql`select * from profiles where id = ${userId}::uuid`) as Profile[];
      profile = rows[0] ?? null;
    }
  } catch (e) {
    return <SetupNotice message={e instanceof Error ? e.message : String(e)} />;
  }

  if (!profile) return <SetupNotice message="Could not create your profile." />;

  // Its own try/catch: this is the only read here that needs migration 002, and
  // a missing badge is not a reason to withhold the whole board.
  let unread = 0;
  try {
    unread = await unreadTotal();
  } catch {
    /* companions aren't set up yet */
  }

  return (
    <Dashboard
      profile={{
        ...profile,
        appearance: { ...DEFAULT_APPEARANCE, ...(profile.appearance ?? {}) },
        equipped: { ...DEFAULT_EQUIPPED, ...(profile.equipped ?? {}) },
      }}
      categories={categories}
      todos={todos}
      sweptCount={sweptCount}
      unread={unread}
    />
  );
}

function SetupNotice({ message }: { message: string }) {
  const noTables = /relation .* does not exist|function .* does not exist/i.test(
    message
  );
  // A missing column means the tables exist but a migration hasn't been run.
  const needsMigration = /column .* does not exist/i.test(message);

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="panel max-w-lg rounded-2xl p-7">
        <h1 className="font-display text-2xl text-amber-200">Almost there</h1>
        <p className="mt-2 text-sm leading-relaxed text-parch-300/75">
          {needsMigration ? (
            <>
              Your database is one migration behind. Open the Neon SQL Editor,
              paste{" "}
              <code className="rounded bg-black/40 px-1.5 py-0.5 text-amber-200">
                db/migrations/001-quest-order.sql
              </code>{" "}
              and run it, then reload. It only adds a column and backfills it —
              nothing is dropped.
            </>
          ) : noTables ? (
            <>
              Your database is connected, but the tables aren&apos;t set up yet.
              Open the Neon SQL Editor, paste the contents of{" "}
              <code className="rounded bg-black/40 px-1.5 py-0.5 text-amber-200">
                db/schema.sql
              </code>{" "}
              and run it. Then reload this page.
            </>
          ) : (
            <>
              Could not reach the database. Check{" "}
              <code className="rounded bg-black/40 px-1.5 py-0.5 text-amber-200">
                DATABASE_URL
              </code>{" "}
              in <code className="rounded bg-black/40 px-1.5 py-0.5">.env.local</code>.
            </>
          )}
        </p>
        <p className="mt-4 rounded-lg bg-black/30 px-3 py-2 font-mono text-xs break-words text-rose-200">
          {message}
        </p>
      </div>
    </main>
  );
}
