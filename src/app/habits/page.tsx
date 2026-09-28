import { redirect } from "next/navigation";
import Habits from "@/components/Habits";
import Backdrop from "@/components/Backdrop";
import { FxProvider } from "@/components/Fx";
import { getUserId } from "@/lib/session";
import { listHabits, syncHabits, type HabitBoard } from "@/lib/habit-actions";

export const dynamic = "force-dynamic";

export default async function HabitsPage() {
  const userId = await getUserId();
  if (!userId) redirect("/login");

  let board: HabitBoard = { today: new Date().toISOString().slice(0, 10), habits: [] };
  let failed = false;

  try {
    // The same settle the dashboard runs, so days that ended unticked show
    // as misses however you arrive.
    await syncHabits();
    board = await listHabits();
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
            Your database is behind — run{" "}
            <code className="rounded bg-mud-800 px-1.5 py-0.5 text-mud-50">
              db/schema.sql
            </code>{" "}
            in the Neon SQL Editor, then reload.
          </p>
        </div>
      </main>
    );
  }

  return (
    <>
      <Backdrop />
      <FxProvider>
        <Habits habits={board.habits} today={board.today} />
      </FxProvider>
    </>
  );
}
