"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import CharacterSprite from "@/components/CharacterSprite";
import { signIn, signUp } from "@/lib/auth-actions";
import {
  createKeyBundle,
  deriveAuthSecret,
  rememberPrivateKey,
  unwrapPrivateKey,
} from "@/lib/crypto";
import { DEFAULT_APPEARANCE, DEFAULT_EQUIPPED } from "@/lib/game";
import {
  PRIVACY_EFFECTIVE,
  PRIVACY_HIGHLIGHTS,
  PRIVACY_VERSION,
} from "@/lib/policy";

/* --------------------------------------------------------------------------
   The password never leaves this component. It becomes two derived values in
   the browser: an auth secret for the server, and — from a different salt —
   the key that unwraps the private key used for encrypted messages.
   -------------------------------------------------------------------------- */

type Mode = "signin" | "signup";

export default function LoginForm({ missingEnv }: { missingEnv: string[] }) {
  return (
    <Suspense fallback={null}>
      <Inner missingEnv={missingEnv} />
    </Suspense>
  );
}

function Inner({ missingEnv }: { missingEnv: string[] }) {
  const router = useRouter();
  const params = useSearchParams();
  // `next` is attacker-controllable: /login?next=https://evil.example would
  // otherwise send someone straight off-site the instant they sign in, from a
  // page they just typed their password into. Only same-origin paths are
  // honoured — and "//host" is rejected too, since the browser reads that as a
  // protocol-relative URL to another origin.
  const raw = params.get("next") || "/";
  const next =
    raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\")
      ? raw
      : "/";

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);

  const configured = missingEnv.length === 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNote(null);
    setBusy(true);

    if (mode === "signup" && !agreed) {
      setBusy(false);
      return setError("Please read and agree to the privacy policy first.");
    }

    try {
      const authSecret = await deriveAuthSecret(email, password);

      if (mode === "signup") {
        const bundle = await createKeyBundle(email, password);
        const res = await signUp({
          email,
          username,
          authSecret,
          displayName: name,
          publicKey: bundle.publicKey,
          wrappedPrivateKey: bundle.wrappedPrivateKey,
          // The version this form actually rendered, so a stale tab can't be
          // recorded as agreeing to text it never showed.
          acceptedPrivacyVersion: PRIVACY_VERSION,
        });
        if (!res.ok) return setError(res.error);
        await rememberPrivateKey(
          await unwrapPrivateKey(email, password, bundle.wrappedPrivateKey)
        );
      } else {
        // One call. The wrapped key comes back with the success result, so
        // nothing about this account is observable before the secret verifies.
        const res = await signIn(email, authSecret);
        if (!res.ok) return setError(res.error);

        if (res.wrappedPrivateKey) {
          try {
            await rememberPrivateKey(
              await unwrapPrivateKey(email, password, res.wrappedPrivateKey)
            );
          } catch {
            // Signed in fine; messages just stay locked for this session.
          }
        }
      }

      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const heading =
    mode === "signin" ? "Welcome back, adventurer." : "Roll a new character.";

  return (
    <main className="flex min-h-dvh items-center justify-center p-5">
      <div className="grid w-full max-w-4xl gap-6 md:grid-cols-[minmax(0,1fr)_380px] md:items-center">
        <div className="hidden flex-col items-center md:flex">
          <CharacterSprite
            appearance={DEFAULT_APPEARANCE}
            equipped={DEFAULT_EQUIPPED}
            scale={4}
            className="drop-shadow-[0_8px_12px_rgba(42,30,19,0.35)]"
          />
          <p className="mt-4 max-w-xs rounded-xl bg-white/70 px-4 py-2 text-center text-sm font-medium text-mud-700">
            Every errand is a quest. Every quest is experience. Start in rags —
            end in dragonscale.
          </p>
        </div>

        <div className="panel rounded-2xl p-7">
          <h1 className="font-display text-3xl font-bold tracking-wide text-mud-900">
            HabitKnight
          </h1>
          <p className="mt-1 text-sm font-medium text-mud-600">{heading}</p>

          {!configured ? (
            <div className="mt-6 rounded-xl border border-amber-400 bg-amber-50 p-4 text-sm leading-relaxed text-amber-900">
              <p className="font-semibold">Not connected yet.</p>
              <p className="mt-2 text-amber-800">
                Missing from{" "}
                <code className="rounded bg-amber-200 px-1 font-mono">.env.local</code>:{" "}
                {missingEnv.map((v) => (
                  <code key={v} className="mr-1 rounded bg-amber-200 px-1 font-mono">
                    {v}
                  </code>
                ))}
              </p>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-3">
              {note && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 ring-1 ring-amber-300">
                  {note}
                </p>
              )}

              {mode === "signup" && (
                <Field
                  label="Username"
                  value={username}
                  onChange={setUsername}
                  placeholder="reginald"
                  autoComplete="username"
                  required
                  hint="Unique. Friends use this to find you."
                />
              )}
              {mode === "signup" && (
                <Field
                  label="Character name"
                  value={name}
                  onChange={setName}
                  placeholder="Sir Reginald"
                  autoComplete="nickname"
                />
              )}

              <Field
                label="Email"
                type="email"
                value={email}
                onChange={setEmail}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
              <Field
                label="Password"
                type="password"
                value={password}
                onChange={setPassword}
                placeholder="••••••••"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                required
                minLength={8}
              />

              {mode === "signup" && (
                <div className="rounded-xl border border-mud-200 bg-white/60 p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-mud-500">
                    Before you start
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {PRIVACY_HIGHLIGHTS.map((point) => (
                      <li
                        key={point}
                        className="flex gap-1.5 text-[11px] leading-relaxed text-mud-600"
                      >
                        <span aria-hidden className="shrink-0 text-mud-400">
                          •
                        </span>
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                  <label className="mt-2.5 flex cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      checked={agreed}
                      onChange={(e) => setAgreed(e.target.checked)}
                      required
                      className="mt-0.5 size-4 shrink-0 accent-grass-600"
                    />
                    <span className="text-xs font-medium text-mud-800">
                      I agree to the{" "}
                      <Link
                        href="/privacy"
                        target="_blank"
                        className="font-semibold underline underline-offset-2 transition hover:text-grass-700"
                      >
                        privacy policy
                      </Link>{" "}
                      (v{PRIVACY_VERSION}, {PRIVACY_EFFECTIVE}).
                    </span>
                  </label>
                </div>
              )}

              {error && (
                <p className="rounded-lg bg-red-100 px-3 py-2 text-sm font-semibold text-red-800 ring-1 ring-red-300">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={busy || (mode === "signup" && !agreed)}
                className="mt-2 w-full rounded-xl bg-grass-600 px-4 py-3 font-display text-sm font-bold tracking-wide text-white shadow-md shadow-grass-700/30 transition hover:bg-grass-500 active:scale-[0.98] disabled:bg-mud-300"
              >
                {busy
                  ? "Deriving keys…"
                  : mode === "signin"
                    ? "Enter the realm"
                    : "Begin the journey"}
              </button>

              <button
                type="button"
                onClick={() => {
                  setMode(mode === "signin" ? "signup" : "signin");
                  setError(null);
                  setNote(null);
                  setAgreed(false);
                }}
                className="w-full pt-1 text-center text-sm font-semibold text-mud-500 underline-offset-4 transition hover:text-grass-700 hover:underline"
              >
                {mode === "signin"
                  ? "No character yet? Create one"
                  : "Already have a character? Sign in"}
              </button>

              <p className="pt-1 text-center text-[10px] leading-relaxed text-mud-400">
                Your password becomes keys in this browser. It is never sent
                to the server, and neither is anything needed to read your
                messages.{" "}
                <Link
                  href="/privacy"
                  className="underline underline-offset-2 transition hover:text-grass-700"
                >
                  Privacy
                </Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </main>
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
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="field w-full rounded-xl px-3.5 py-2.5 text-sm"
      />
      {hint && <span className="mt-1 block text-[10px] text-mud-400">{hint}</span>}
    </label>
  );
}
