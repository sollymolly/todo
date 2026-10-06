import { redirect } from "next/navigation";
import Dashboard from "@/components/Dashboard";
import { sql } from "@/lib/db";
import { getUserId } from "@/lib/session";
import { pruneFinished, sweepOverdue } from "@/lib/actions";
import { signOut } from "@/lib/auth-actions";
import { listHabits, syncHabits } from "@/lib/habit-actions";
import { unreadTotal } from "@/lib/social-actions";
import { unseenNudges } from "@/lib/village-server";
import type { NudgeView } from "@/lib/village";
import { loadTableData } from "@/lib/column-actions";
import type { ColumnValues, TableColumn } from "@/lib/table-columns";
import { latestUpdate, shouldShowUpdate } from "@/lib/updates";
import { DEFAULT_APPEARANCE, DEFAULT_EQUIPPED } from "@/lib/game";
import { normalizeTodo } from "@/lib/types";
import type { Habit } from "@/lib/habits";
import type { Category, Profile, Subtask, Todo } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  /** `?new=1`: the installed app's "New quest" shortcut. */
  searchParams: Promise<{ new?: string }>;
}) {
  const userId = await getUserId();
  if (!userId) redirect("/login");

  let sweptCount = 0;
  let profile: Profile | null = null;
  let categories: Category[] = [];
  let todos: Todo[] = [];
  // The sections below the board each fall back on their own when their
  // tables aren't set up: a missing badge is no reason to withhold the board.
  let unread = 0;
  let nudges: NudgeView[] = [];
  const steps: Record<string, Subtask[]> = {};
  let tableColumns: TableColumn[] = [];
  let tableValues: ColumnValues = {};
  let habits: Habit[] = [];
  let habitToday = new Date().toISOString().slice(0, 10);
  let habitFreezes: number | undefined;
  // Set inside the try, acted on after it: redirect() signals by throwing, and
  // the catch below would read that as a database failure.
  let orphanedSession = false;

  try {
    // Every query is a round trip to the database, so the writes go together
    // and then every read does. They touch different rows, meeting only at
    // the profile, which each locks before changing it.
    //
    // Anything past its deadline by more than a day fails before we read, and
    // finished quests past the retention window are cleared out. Habit days
    // that ended unticked are settled as misses: idempotent, so it runs on
    // every load — see settle_habits in db/schema.sql.
    [{ count: sweptCount }] = await Promise.all([sweepOverdue(), pruneFinished(), syncHabits()]);

    const [profileRows, categoryRows, todoRows, unreadCount, nudgeRows, stepRows, table, habitBoard] = await Promise.all([
      sql`select * from profiles where id = ${userId}::uuid`,
      sql`select * from categories where user_id = ${userId}::uuid order by sort_order`,
      // Same rule as byDeadline() on the client: soonest first, undated last.
      sql`select * from todos where user_id = ${userId}::uuid
           order by due_date asc nulls last, created_at asc`,
      unreadTotal().catch(() => 0), // companions aren't set up yet
      // Nudges from companions that haven't been seen.
      unseenNudges(userId).catch((): NudgeView[] => []), // the village isn't set up yet
      (sql`
        select id, todo_id, title, done, position
          from subtasks
         where user_id = ${userId}::uuid
         order by todo_id, position
      ` as unknown as Promise<Subtask[]>).catch((): Subtask[] => []), // steps aren't set up yet
      // The table's custom columns and their values.
      loadTableData().catch(() => null), // custom columns aren't set up yet
      listHabits().catch(() => null), // habits aren't set up yet
    ]);

    profile = (profileRows as Profile[])[0] ?? null;
    categories = categoryRows as Category[];
    todos = (todoRows as Record<string, unknown>[]).map(normalizeTodo);
    unread = unreadCount;
    nudges = nudgeRows;
    // Grouped here rather than passed down flat so every row doesn't
    // re-filter the whole set on each render.
    for (const s of stepRows) (steps[s.todo_id] ??= []).push(s);
    if (table) ({ columns: tableColumns, values: tableValues } = table);
    if (habitBoard) ({ habits, today: habitToday, freezes: habitFreezes } = habitBoard);

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
      habits={habits}
      habitToday={habitToday}
      habitFreezes={habitFreezes}
      tableColumns={tableColumns}
      tableValues={tableValues}
      sweptCount={sweptCount}
      unread={unread}
      nudges={nudges}
      startComposing={(await searchParams).new === "1"}
      // Decided here rather than in the browser so "this week" means one thing
      // for everybody and the server and client agree on the first render.
      //
      // The `in` check distinguishes "column exists, never seen" (null, so
      // show it) from "the column isn't there" (absent). Without it, the
      // dot on "What's new" could never be cleared. It's only a dot now: the
      // changelog used to open itself over the board, and the board is what
      // people come here for.
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
  const noTables =
    /relation .* does not exist|column .* does not exist|function .* does not exist/i.test(
      message
    );

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="panel max-w-lg rounded-2xl p-7">
        <h1 className="font-display text-2xl text-amber-200">Almost there</h1>
        <p className="mt-2 text-sm leading-relaxed text-parch-300/75">
          {noTables ? (
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
