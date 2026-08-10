import Link from "next/link";
import { redirect } from "next/navigation";
import Scenery from "@/components/Scenery";
import { getUserId } from "@/lib/session";
import { UPDATES, formatWeek } from "@/lib/updates";

export const dynamic = "force-dynamic";

export default async function UpdatesPage() {
  const userId = await getUserId();
  if (!userId) redirect("/login");

  return (
    <>
      <Scenery />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
        <header className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-wide text-mud-900 drop-shadow-sm sm:text-3xl">
              What&apos;s new
            </h1>
            <p className="text-xs font-semibold text-mud-600">
              Weekly notes on what changed.
            </p>
          </div>
          <Link
            href="/"
            className="rounded-lg border border-mud-300 bg-white/80 px-3 py-1.5 text-xs font-semibold text-mud-700 transition hover:border-grass-500 hover:bg-grass-50 hover:text-grass-700"
          >
            ← Back to quests
          </Link>
        </header>

        {UPDATES.length === 0 ? (
          <div className="panel rounded-2xl px-6 py-12 text-center">
            <p className="text-sm text-mud-500">Nothing to report yet.</p>
          </div>
        ) : (
          <ol className="space-y-4">
            {UPDATES.map((u) => (
              <li key={u.week} className="panel rounded-2xl p-5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-mud-400">
                  Week of {formatWeek(u.week)}
                </p>
                <h2 className="mt-1 font-display text-lg font-bold text-mud-900">
                  {u.title}
                </h2>
                <ul className="mt-3 space-y-2">
                  {u.items.map((item) => (
                    <li
                      key={item}
                      className="flex gap-2 text-sm leading-relaxed text-mud-700"
                    >
                      <span aria-hidden className="mt-0.5 shrink-0 text-mud-400">
                        •
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}

        <p className="mt-6 text-center text-xs text-mud-500">
          Something missing?{" "}
          <Link
            href="/feedback"
            className="font-semibold underline underline-offset-2 transition hover:text-grass-700"
          >
            Send feedback
          </Link>
          .
        </p>
      </main>
    </>
  );
}
