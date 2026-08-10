"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { acceptPrivacy, signOut } from "@/lib/auth-actions";
import { forgetPrivateKey } from "@/lib/crypto";
import {
  PRIVACY_EFFECTIVE,
  PRIVACY_HIGHLIGHTS,
  PRIVACY_VERSION,
} from "@/lib/policy";

/* --------------------------------------------------------------------------
   Shown to an account that hasn't agreed to the current policy.

   The rules it follows, which are what separate consent from a speed bump:
   the box starts unchecked, the button stays disabled until it isn't, the
   consequential points are on the page rather than behind the link, and
   declining is a real option that signs you out rather than a dead end.
   -------------------------------------------------------------------------- */

export default function ConsentGate({ displayName }: { displayName: string }) {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    if (!agreed || busy) return;
    setBusy(true);
    setError(null);
    // The version displayed on this page is what gets sent, so a stale tab is
    // rejected rather than silently recorded against newer text.
    const res = await acceptPrivacy(PRIVACY_VERSION);
    if (!res.ok) {
      setError(res.error);
      setBusy(false);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-5">
      <div className="panel w-full max-w-lg rounded-2xl p-7">
        <h1 className="font-display text-2xl font-bold tracking-wide text-mud-900">
          Before you continue
        </h1>
        <p className="mt-1 text-sm font-medium text-mud-600">
          {displayName}, this account hasn&apos;t agreed to the privacy policy
          yet. Here is what it says in short.
        </p>

        <ul className="mt-5 space-y-2.5">
          {PRIVACY_HIGHLIGHTS.map((point) => (
            <li
              key={point}
              className="flex gap-2 text-sm leading-relaxed text-mud-700"
            >
              <span aria-hidden className="mt-0.5 shrink-0 text-mud-400">
                •
              </span>
              <span>{point}</span>
            </li>
          ))}
        </ul>

        <p className="mt-4 text-xs text-mud-500">
          The full text is at{" "}
          <Link
            href="/privacy"
            target="_blank"
            className="font-semibold underline underline-offset-2 transition hover:text-grass-700"
          >
            /privacy
          </Link>
          . Version {PRIVACY_VERSION}, effective {PRIVACY_EFFECTIVE}.
        </p>

        <label className="mt-6 flex cursor-pointer items-start gap-2.5 rounded-xl border border-mud-200 bg-white/70 p-3">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-grass-600"
          />
          <span className="text-sm font-medium text-mud-800">
            I have read and agree to the privacy policy.
          </span>
        </label>

        {error && (
          <p className="mt-3 rounded-lg bg-red-100 px-3 py-2 text-sm font-semibold text-red-800 ring-1 ring-red-300">
            {error}
          </p>
        )}

        <button
          onClick={accept}
          disabled={!agreed || busy}
          className="mt-4 w-full rounded-xl bg-grass-600 px-4 py-3 font-display text-sm font-bold tracking-wide text-white shadow-md shadow-grass-700/30 transition hover:bg-grass-500 active:scale-[0.98] disabled:bg-mud-300 disabled:shadow-none"
        >
          {busy ? "Recording…" : "Agree and continue"}
        </button>

        <form action={signOut} className="mt-2">
          <button
            type="submit"
            onClick={() => forgetPrivateKey()}
            className="w-full rounded-xl px-4 py-2 text-center text-xs font-semibold text-mud-500 transition hover:text-mud-900"
          >
            No thanks — sign me out
          </button>
        </form>

        <p className="mt-4 text-center text-[10px] leading-relaxed text-mud-400">
          Your agreement is recorded with its version and the date. Nothing else
          about this moment is stored — no IP address, no device details.
        </p>
      </div>
    </main>
  );
}
