"use client";

import { useState } from "react";
import Link from "next/link";
import Scenery from "@/components/Scenery";
import { changePassword, type Account } from "@/lib/auth-actions";
import {
  createKeyBundle,
  deriveAuthSecret,
  rememberPrivateKey,
  rewrapPrivateKey,
  unwrapPrivateKey,
} from "@/lib/crypto";

/* --------------------------------------------------------------------------
   Changing the password is a browser-side job, because the password is what
   unlocks the private key. The order matters:

     1. re-wrap the private key under the new password  (can fail — do it first)
     2. send the two derived secrets and the new wrapping to the server
     3. refresh the key held for this tab

   Doing step 2 before step 1 would leave an account whose stored key material
   no longer matches its password: every message unreadable, permanently.
   -------------------------------------------------------------------------- */

const MIN_LENGTH = 8;

export default function AccountForm({ account }: { account: Account }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const legacy = account.authVersion < 2;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);

    if (next.length < MIN_LENGTH)
      return setError(`Use at least ${MIN_LENGTH} characters.`);
    if (next !== confirm) return setError("The new passwords don't match.");
    if (next === current) return setError("That is already your password.");

    setBusy(true);
    try {
      const email = account.email;

      // The key material first: if the current password is wrong, this throws
      // and nothing has been sent anywhere.
      let publicKey: string;
      let wrappedPrivateKey: string;

      if (account.wrappedPrivateKey) {
        try {
          wrappedPrivateKey = await rewrapPrivateKey(
            email,
            current,
            next,
            account.wrappedPrivateKey
          );
        } catch {
          setError("Your current password is incorrect.");
          return;
        }
        // The keypair is unchanged, so the published public key still stands.
        publicKey = account.publicKey ?? "";
        if (!publicKey) {
          setError("This account is missing its public key. Sign out and back in.");
          return;
        }
      } else {
        // No keys yet — the new password is as good a moment as any to make them.
        const bundle = await createKeyBundle(email, next);
        publicKey = bundle.publicKey;
        wrappedPrivateKey = bundle.wrappedPrivateKey;
      }

      const res = await changePassword({
        currentAuthSecret: await deriveAuthSecret(email, current),
        newAuthSecret: await deriveAuthSecret(email, next),
        publicKey,
        wrappedPrivateKey,
      });
      if (!res.ok) return setError(res.error);

      // Keep this tab unlocked under the new wrapping.
      await rememberPrivateKey(
        await unwrapPrivateKey(email, next, wrappedPrivateKey)
      );

      setCurrent("");
      setNext("");
      setConfirm("");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Scenery />
      <main className="mx-auto max-w-xl px-4 py-6 sm:px-6 sm:py-10">
        <header className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-wide text-mud-900 drop-shadow-sm sm:text-3xl">
              Account
            </h1>
            <p className="text-xs font-semibold text-mud-600">
              @{account.username} · {account.email}
            </p>
          </div>
          <Link
            href="/"
            className="rounded-lg border border-mud-300 bg-white/80 px-3 py-1.5 text-xs font-semibold text-mud-700 transition hover:border-grass-500 hover:bg-grass-50 hover:text-grass-700"
          >
            ← Back to quests
          </Link>
        </header>

        <section className="panel rounded-2xl p-6">
          <h2 className="font-display text-lg font-bold text-mud-900">
            Change password
          </h2>

          {legacy ? (
            <p className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 ring-1 ring-amber-300">
              This account still needs its one-time security upgrade. Sign out
              and back in to complete it, then you can change your password
              here.
            </p>
          ) : (
            <form onSubmit={submit} className="mt-4 space-y-3">
              <p className="rounded-lg bg-mud-100 px-3 py-2 text-xs leading-relaxed text-mud-600">
                Your password unlocks the key that reads your messages, so
                this re-encrypts that key in your browser as part of the change.
                Your conversations are preserved and your friends see nothing
                different.
              </p>

              <Field
                label="Current password"
                value={current}
                onChange={setCurrent}
                autoComplete="current-password"
                required
              />
              <Field
                label="New password"
                value={next}
                onChange={setNext}
                autoComplete="new-password"
                required
                minLength={MIN_LENGTH}
                hint={`At least ${MIN_LENGTH} characters.`}
              />
              <Field
                label="Confirm new password"
                value={confirm}
                onChange={setConfirm}
                autoComplete="new-password"
                required
              />

              {error && (
                <p className="rounded-lg bg-red-100 px-3 py-2 text-sm font-semibold text-red-800 ring-1 ring-red-300">
                  {error}
                </p>
              )}
              {done && (
                <p className="rounded-lg bg-grass-50 px-3 py-2 text-sm font-semibold text-grass-800 ring-1 ring-grass-300">
                  Password changed. Your messages are still readable here.
                  You&apos;ll need the new one on other devices.
                </p>
              )}

              <button
                type="submit"
                disabled={busy || !current || !next || !confirm}
                className="mt-1 w-full rounded-xl bg-grass-600 px-4 py-3 font-display text-sm font-bold tracking-wide text-white shadow-md shadow-grass-700/30 transition hover:bg-grass-500 active:scale-[0.98] disabled:bg-mud-300"
              >
                {busy ? "Re-encrypting your key…" : "Change password"}
              </button>
            </form>
          )}
        </section>
      </main>
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  hint,
  ...rest
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value">) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-mud-500">
        {label}
      </span>
      <input
        {...rest}
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="field w-full rounded-xl px-3.5 py-2.5 text-sm"
      />
      {hint && <span className="mt-1 block text-[10px] text-mud-400">{hint}</span>}
    </label>
  );
}
