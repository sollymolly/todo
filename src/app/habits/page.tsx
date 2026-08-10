import { redirect } from "next/navigation";
import Habits from "@/components/Habits";
import Scenery from "@/components/Scenery";
import { sql } from "@/lib/db";
import { getUserId } from "@/lib/session";
import { listHabits, syncHabits } from "@/lib/habit-actions";
import type { Category } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function HabitsPage() {
  const userId = await getUserId();
  if (!userId) redirect("/login");

  let habits: Awaited<ReturnType<typeof listHabits>> = [];
  let categories: Category[] = [];
  let timezone: string | null = null;
  let failed = false;

  try {
    // The same reconcile the dashboard runs, so arriving here directly still
    // puts today's instances on the board.
    await syncHabits();
    habits = await listHabits();
    categories = (await sql`
      select * from categories where user_id = ${userId}::uuid order by sort_order
    `) as Category[];
    const tz = (await sql`
      select timezone from profiles where id = ${userId}::uuid
    `) as { timezone: string | null }[];
    timezone = tz[0]?.timezone ?? null;
  } catch {
    failed = true;
  }

  if (failed) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <div className="panel max-w-lg rounded-2xl p-7">
          <h1 className="font-display text-2xl font-bold text-mud-900">
            Almost there
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-mud-700">
            Habits need one more migration — run{" "}
            <code className="rounded bg-mud-800 px-1.5 py-0.5 text-mud-50">
              db/migrations/013-habits.sql
            </code>{" "}
            in the Neon SQL Editor, then reload.
          </p>
        </div>
      </main>
    );
  }

  return (
    <>
      <Scenery />
      <Habits habits={habits} categories={categories} timezone={timezone} />
    </>
  );
}
