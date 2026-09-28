import Link from "next/link";
import { redirect } from "next/navigation";
import Backdrop from "@/components/Backdrop";
import NotificationSettings from "@/components/NotificationSettings";
import { loadNotificationPrefs } from "@/lib/notify-actions";
import { DEFAULT_PREFS, type NotificationPrefs } from "@/lib/notify";
import { PUSH_CONFIGURED } from "@/lib/push";
import { getUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const userId = await getUserId();
  if (!userId) redirect("/login");

  let prefs: NotificationPrefs = DEFAULT_PREFS;
  let ready = true;
  try {
    prefs = await loadNotificationPrefs();
  } catch {
    ready = false; // the tables aren't there yet
  }

  return (
    <>
      <Backdrop />
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
        <header className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-wide text-mud-900 drop-shadow-sm sm:text-3xl">
              Notifications
            </h1>
            <p className="text-xs font-semibold text-mud-600">
              Reminders before deadlines, a morning summary, and messages.
            </p>
          </div>
          <Link
            href="/"
            className="rounded-lg border border-mud-300 bg-white/80 px-3 py-1.5 text-xs font-semibold text-mud-700 transition hover:border-grass-500 hover:bg-grass-50 hover:text-grass-700"
          >
            ← Back to quests
          </Link>
        </header>

        {ready ? (
          <NotificationSettings initial={prefs} configured={PUSH_CONFIGURED} />
        ) : (
          <div className="panel rounded-2xl p-6 text-sm text-mud-700">
            Your database is behind — run <code>db/schema.sql</code> in the Neon SQL{" "}
            Editor, then reload.
          </div>
        )}
      </main>
    </>
  );
}
