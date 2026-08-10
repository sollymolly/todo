import { redirect } from "next/navigation";
import Dashboard from "@/components/Dashboard";
import { sql } from "@/lib/db";
import { getUserId } from "@/lib/session";
import { pruneFinished, sweepOverdue } from "@/lib/actions";
import { signOut } from "@/lib/auth-actions";
import { syncHabits } from "@/lib/habit-actions";
import { unreadTotal } from "@/lib/social-actions";
import { latestUpdate, shouldShowUpdate } from "@/lib/updates";
import { DEFAULT_APPEARANCE, DEFAULT_EQUIPPED } from "@/lib/game";
import { normalizeTodo } from "@/lib/types";
import type { Category, Profile, Subtask, Todo } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  const userId = await getUserId();
  if (!userId) redirect("/login");

  let sweptCount = 0;
  let profile: Profile | null = null;
  let categories: Category[] = [];
  let todos: Todo[] = [];
  // Set inside the try, acted on after it: redirect() signals by throwing, and
  // the catch below would read that as a database failure.
  let orphanedSession = false;

  try {
    // Anything past its deadline by more than a day fails before we read, and
    // finished quests past the retention window are cleared out.
    sweptCount = (await sweepOverdue()).count;
    await pruneFinished();
    // Puts today's habit instances on the board. Idempotent, so running it on
    // every load is safe — see materialise_habits in migration 013.
    await syncHabits();

    const [profileRows, categoryRows, todoRows] = await Promise.all([
      sql`select * from profiles where id = ${userId}::uuid`,
      sql`select * from categories where user_id = ${userId}::uuid order by sort_order`,
      // Same rule as byDeadline() on the client: soonest first, undated last.
      sql`select * from todos where user_id = ${userId}::uuid
           order by due_date asc nulls last, created_at asc`,
    ]);

    profile = (profileRows as Profile[])[0] ?? null;
    categories = categoryRows as Category[];
    todos = (todoRows as Record<string, unknown>[]).map(normalizeTodo);

    // A profile can be missing if a user row was created outside the app.
    if (!profile) {
      // Or because the account is gone and the cookie outlived it. The session
      // is a signed token, not a lookup, so it stays valid long after the row
      // it names has been deleted. bootstrap_user would fail on the foreign
      // key and land the reader on "could not reach the database", which sends
      // someone off to check DATABASE_URL over what is really a stale login.
      const account = await sql`select 1 from users where id = ${userId}::uuid`;
      if (account.length === 0) {
        orphanedSession = true;
      } else {
        await sql`select bootstrap_user(${userId}::uuid, ${"Adventurer"}::text)`;
        const rows = (await sql`select * from profiles where id = ${userId}::uuid`) as Profile[];
        profile = rows[0] ?? null;
      }
    }
  } catch (e) {
    return <SetupNotice message={e instanceof Error ? e.message : String(e)} />;
  }

  // Not a redirect to /login: the cookie still verifies, so the proxy would
  // send it straight back here. The cookie has to go first, and only a server
  // function can delete one — hence a button rather than a bounce.
  if (orphanedSession) return <StaleSessionNotice />;

  if (!profile) return <SetupNotice message="Could not create your profile." />;

  // Its own try/catch: this is the only read here that needs migration 002, and
  // a missing badge is not a reason to withhold the whole board.
  let unread = 0;
  try {
    unread = await unreadTotal();
  } catch {
    /* companions aren't set up yet */
  }

  // Likewise for migration 015. Grouped here rather than passed down flat so
  // every row doesn't re-filter the whole set on each render.
  const steps: Record<string, Subtask[]> = {};
  try {
    const rows = (await sql`
      select id, todo_id, title, done, position
        from subtasks
       where user_id = ${userId}::uuid
       order by todo_id, position
    `) as Subtask[];
    for (const s of rows) (steps[s.todo_id] ??= []).push(s);
  } catch {
    /* steps aren't set up yet */
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
      steps={steps}
      sweptCount={sweptCount}
      unread={unread}
      // Decided here rather than in the browser so "this week" means one thing
      // for everybody and the server and client agree on the first render.
      //
      // The `in` check distinguishes "column exists, never seen" (null, so
      // show it) from "migration 008 hasn't run" (absent). Without it, the
      // popup would appear and then fail to record the dismissal, reappearing
      // on every single page load.
      update={
        "updates_seen" in profile &&
        shouldShowUpdate(profile.updates_seen ?? null)
          ? latestUpdate()
          : null
      }
    />
  );
}

/* A signed cookie for an account that no longer exists. Rare, but it reads as
   a database outage if it isn't named, because the first thing to fail is the
   foreign key under bootstrap_user. */
function StaleSessionNotice() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="panel max-w-lg rounded-2xl p-7">
        <h1 className="font-display text-2xl text-amber-200">
          You&apos;ve been signed out
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-parch-300/75">
          This browser is still holding a sign-in for an account that no longer
          exists. Nothing is wrong with the app — the login just outlived the
          account it belonged to.
        </p>
        <form action={signOut}>
          <button
            type="submit"
            className="mt-4 rounded-lg bg-grass-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-grass-500"
          >
            Clear it and sign in
          </button>
        </form>
      </div>
    </main>
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
