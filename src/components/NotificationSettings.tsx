"use client";

import { useEffect, useState } from "react";
import { saveNotificationPrefs, sendTestNotification } from "@/lib/notify-actions";
import { LEAD_CHOICES, type NotificationPrefs } from "@/lib/notify";
import { pushState, turnOffPush, turnOnPush, type PushState } from "@/lib/push-client";

/* --------------------------------------------------------------------------
   Two separate things, laid out as such:

   1. This device — whether it gets notifications at all. Permission lives
      in the browser, per device, so it's switched on here, on each one.
   2. What to be told about — the same on every device, saved to the account.
   -------------------------------------------------------------------------- */

const TOGGLE =
  "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grass-400 disabled:cursor-default disabled:opacity-50";

function Toggle({
  on,
  label,
  disabled,
  onChange,
}: {
  on: boolean;
  label: string;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`${TOGGLE} ${on ? "bg-grass-600" : "bg-mud-300"}`}
    >
      <span
        aria-hidden
        className={`inline-block size-5 rounded-full bg-white shadow transition ${on ? "translate-x-5.5" : "translate-x-0.5"}`}
      />
    </button>
  );
}

const toTime = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const fromTime = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};

export default function NotificationSettings({
  initial,
  configured,
}: {
  initial: NotificationPrefs;
  /** Whether the server has its push keys. */
  configured: boolean;
}) {
  const [prefs, setPrefs] = useState(initial);
  const [device, setDevice] = useState<PushState | "checking">("checking");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    pushState()
      .then((s) => live && setDevice(s))
      .catch(() => live && setDevice("unsupported"));
    return () => {
      live = false;
    };
  }, []);

  function update(next: Partial<NotificationPrefs>) {
    const merged = { ...prefs, ...next };
    setPrefs(merged);
    setNote(null);
    saveNotificationPrefs(merged).catch(() =>
      setNote({ kind: "error", text: "Couldn't save that. Check your connection and try again." })
    );
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      setNote({ kind: "error", text: e instanceof Error ? e.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  }

  const on = device === "on";

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------ this device */}
      <section className="panel rounded-2xl p-5">
        <h2 className="font-display text-lg font-bold text-mud-900">This device</h2>

        {!configured ? (
          <p className="mt-2 text-sm text-mud-600">
            Notifications aren&apos;t set up on the server yet: it needs its push keys.
          </p>
        ) : device === "checking" ? (
          <p className="mt-2 text-sm text-mud-500">Checking…</p>
        ) : device === "unsupported" ? (
          <p className="mt-2 text-sm text-mud-600">
            This browser can&apos;t receive notifications. Try Chrome, Edge, Firefox or Safari, or
            install the app from the menu.
          </p>
        ) : device === "needs-install" ? (
          <p className="mt-2 text-sm leading-relaxed text-mud-600">
            On iPhone and iPad, notifications only work in the installed app. Tap <b>Share</b>{" "}
            <span aria-hidden>(□↑)</span> in Safari, then <b>Add to Home Screen</b>, and open
            HabitKnight from there.
          </p>
        ) : device === "blocked" ? (
          <p className="mt-2 text-sm leading-relaxed text-mud-600">
            Notifications are blocked for this site. Allow them in your browser&apos;s site settings
            (the icon beside the address), then reload this page.
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <p className="mr-auto text-sm text-mud-700">
              {on ? "Notifications are on for this device." : "Notifications are off for this device."}
            </p>
            {on && (
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const r = await sendTestNotification();
                    setNote(
                      r.ok
                        ? { kind: "ok", text: "Sent. It should arrive in a moment." }
                        : { kind: "error", text: r.error ?? "Couldn't send." }
                    );
                  })
                }
                className="rounded-lg border border-mud-300 bg-white/80 px-3 py-1.5 text-xs font-semibold text-mud-700 transition hover:border-grass-500 hover:text-grass-700 disabled:opacity-50"
              >
                Send a test
              </button>
            )}
            <button
              disabled={busy}
              onClick={() => run(async () => setDevice(on ? await turnOffPush() : await turnOnPush()))}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
                on
                  ? "border border-mud-300 bg-white/80 text-mud-700 hover:border-red-300 hover:text-red-700"
                  : "bg-grass-600 text-white hover:bg-grass-500"
              }`}
            >
              {busy ? "…" : on ? "Turn off" : "Turn on"}
            </button>
          </div>
        )}

        {note && (
          <p
            role="status"
            className={`mt-3 rounded-lg px-3 py-2 text-xs ${
              note.kind === "ok" ? "bg-grass-100 text-grass-700" : "bg-red-50 text-red-800"
            }`}
          >
            {note.text}
          </p>
        )}
      </section>

      {/* -------------------------------------------- what to be told */}
      <section className="panel rounded-2xl p-5">
        <h2 className="font-display text-lg font-bold text-mud-900">What to be told about</h2>
        <p className="mt-1 text-xs text-mud-500">The same on every device you&apos;ve turned on.</p>

        <ul className="mt-4 divide-y divide-mud-200">
          <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
            <div className="mr-auto min-w-0">
              <p className="text-sm font-semibold text-mud-900">Deadline reminders</p>
              <p className="text-xs text-mud-500">Before each quest is due.</p>
            </div>
            <select
              value={prefs.leadMinutes}
              disabled={!prefs.dueSoon}
              onChange={(e) => update({ leadMinutes: Number(e.target.value) })}
              aria-label="How long before the deadline"
              className="rounded-md bg-mud-100 px-2 py-1 text-[13px] text-mud-700 outline-none focus:ring-2 focus:ring-grass-400 disabled:opacity-50"
            >
              {LEAD_CHOICES.map((c) => (
                <option key={c.minutes} value={c.minutes}>
                  {c.label}
                </option>
              ))}
            </select>
            <Toggle on={prefs.dueSoon} label="Deadline reminders" onChange={(v) => update({ dueSoon: v })} />
          </li>

          <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
            <div className="mr-auto min-w-0">
              <p className="text-sm font-semibold text-mud-900">Morning summary</p>
              <p className="text-xs text-mud-500">What&apos;s due today, and today&apos;s habits.</p>
            </div>
            <input
              type="time"
              value={toTime(prefs.morningMinutes)}
              disabled={!prefs.morning}
              onChange={(e) => {
                const m = fromTime(e.target.value);
                if (m !== null) update({ morningMinutes: m });
              }}
              aria-label="Morning summary time"
              className="rounded-md bg-mud-100 px-2 py-1 text-[13px] text-mud-700 outline-none focus:ring-2 focus:ring-grass-400 disabled:opacity-50"
            />
            <Toggle on={prefs.morning} label="Morning summary" onChange={(v) => update({ morning: v })} />
          </li>

          <li className="flex items-center gap-3 py-3">
            <div className="mr-auto min-w-0">
              <p className="text-sm font-semibold text-mud-900">Messages</p>
              <p className="text-xs text-mud-500">When a companion writes to you.</p>
            </div>
            <Toggle on={prefs.messages} label="Message notifications" onChange={(v) => update({ messages: v })} />
          </li>

          <li className="flex items-center gap-3 py-3">
            <div className="mr-auto min-w-0">
              <p className="text-sm font-semibold text-mud-900">Nudges</p>
              <p className="text-xs text-mud-500">Companions giving you a push from the village. Off means they can&apos;t nudge you at all.</p>
            </div>
            <Toggle on={prefs.nudges} label="Nudges" onChange={(v) => update({ nudges: v })} />
          </li>
        </ul>
      </section>
    </div>
  );
}
