"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import CharacterSprite from "@/components/CharacterSprite";
import { probeAccount, signIn, signUp, upgradeAccount } from "@/lib/auth-actions";
import {
  createKeyBundle,
  deriveAuthSecret,
  rememberPrivateKey,
  unwrapPrivateKey,
} from "@/lib/crypto";
import { DEFAULT_APPEARANCE, DEFAULT_EQUIPPED } from "@/lib/game";

/* --------------------------------------------------------------------------
   The password never leaves this component. It becomes two derived values in
   the browser: an auth secret for the server, and — from a different salt —
   the key that unwraps the private key used for encrypted messages.
   -------------------------------------------------------------------------- */

type Mode = "signin" | "signup" | "upgrade";

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
  const next = params.get("next") || "/";

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const configured = missingEnv.length === 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNote(null);
    setBusy(true);

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
        });
        if (!res.ok) return setError(res.error);
        await rememberPrivateKey(
          await unwrapPrivateKey(email, password, bundle.wrappedPrivateKey)
        );
      } else if (mode === "upgrade") {
        const bundle = await createKeyBundle(email, password);
        const res = await upgradeAccount({
          email,
          password,
          authSecret,
          username,
          publicKey: bundle.publicKey,
          wrappedPrivateKey: bundle.wrappedPrivateKey,
        });
        if (!res.ok) return setError(res.error);
        await rememberPrivateKey(
          await unwrapPrivateKey(email, password, bundle.wrappedPrivateKey)
        );
      } else {
        const probe = await probeAccount(email);
        if (!probe.ok) return setError(probe.error);

        if (probe.needsUpgrade) {
          setMode("upgrade");
          setNote(
            "This account predates encrypted messaging. Choose a username and re-enter your password once. After this, your password stops being sent to the server at all."
          );
          return;
        }

        const res = await signIn(email, authSecret);
        if (!res.ok) return setError(res.error);

        if (probe.wrappedPrivateKey) {
          try {
            await rememberPrivateKey(
              await unwrapPrivateKey(email, password, probe.wrappedPrivateKey)
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
    mode === "signin"
      ? "Welcome back, adventurer."
      : mode === "signup"
        ? "Roll a new character."
        : "One-time security upgrade.";

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
            Questline
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

              {(mode === "signup" || mode === "upgrade") && (
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

              {error && (
                <p className="rounded-lg bg-red-100 px-3 py-2 text-sm font-semibold text-red-800 ring-1 ring-red-300">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={busy}
                className="mt-2 w-full rounded-xl bg-grass-600 px-4 py-3 font-display text-sm font-bold tracking-wide text-white shadow-md shadow-grass-700/30 transition hover:bg-grass-500 active:scale-[0.98] disabled:bg-mud-300"
              >
                {busy
                  ? "Deriving keys…"
                  : mode === "signin"
                    ? "Enter the realm"
                    : mode === "signup"
                      ? "Begin the journey"
                      : "Upgrade and enter"}
              </button>

              {mode !== "upgrade" && (
                <button
                  type="button"
                  onClick={() => {
                    setMode(mode === "signin" ? "signup" : "signin");
                    setError(null);
                    setNote(null);
                  }}
                  className="w-full pt-1 text-center text-sm font-semibold text-mud-500 underline-offset-4 transition hover:text-grass-700 hover:underline"
                >
                  {mode === "signin"
                    ? "No character yet? Create one"
                    : "Already have a character? Sign in"}
                </button>
              )}

              <p className="pt-1 text-center text-[10px] leading-relaxed text-mud-400">
                Your password becomes keys in this browser. It is never sent
                to the server, and neither is anything needed to read your
                messages.
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
