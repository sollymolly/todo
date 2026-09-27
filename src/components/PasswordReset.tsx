"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Field } from "@/components/LoginForm";
import {
  completePasswordReset,
  openPasswordReset,
  requestPasswordReset,
} from "@/lib/auth-actions";
import {
  createKeyBundle,
  deriveAuthSecret,
  rememberPrivateKey,
  unwrapPrivateKey,
} from "@/lib/crypto";

/* --------------------------------------------------------------------------
   Both halves of a forgotten password: asking for a link, and using one.

   As on the login form, the new password never leaves the browser. It becomes
   an auth secret for the server and a fresh keypair for messages — fresh
   because the old private key was sealed under the password being replaced,
   and nobody here knows it.
   -------------------------------------------------------------------------- */

function Card({ title, subtitle, children }: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-5">
      <div className="panel w-full max-w-sm rounded-2xl p-7">
        <h1 className="font-display text-3xl font-bold tracking-wide text-mud-900">
          {title}
        </h1>
        <p className="mt-1 text-sm font-medium text-mud-600">{subtitle}</p>
        {children}
      </div>
    </main>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg bg-red-100 px-3 py-2 text-sm font-semibold text-red-800 ring-1 ring-red-300">
      {children}
    </p>
  );
}

const BUTTON =
  "mt-2 w-full rounded-xl bg-grass-600 px-4 py-3 font-display text-sm font-bold tracking-wide text-white shadow-md shadow-grass-700/30 transition hover:bg-grass-500 active:scale-[0.98] disabled:bg-mud-300";

const BACK =
  "block w-full pt-1 text-center text-sm font-semibold text-mud-500 underline-offset-4 transition hover:text-grass-700 hover:underline";

/* ========================================================================== */
/* Asking for a link                                                          */
/* ========================================================================== */

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await requestPasswordReset(email);
      if (!res.ok) return setError(res.error);
      setSent(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Card title="Check your inbox" subtitle="A raven is on its way.">
        {/* Worded the same whether or not the account exists — see
            requestPasswordReset. */}
        <p className="mt-5 text-sm leading-relaxed text-mud-700">
          If <b>{email.trim()}</b> has a HabitKnight account, it will get a
          link to choose a new password within a minute or two. The link works
          once and expires in 30 minutes.
        </p>
        <p className="mt-3 text-xs leading-relaxed text-mud-500">
          Nothing there? Check your spam folder, or make sure that&rsquo;s the
          address you signed up with.
        </p>
        <Link href="/login" className={`${BACK} mt-5`}>
          Back to sign in
        </Link>
      </Card>
    );
  }

  return (
    <Card title="Forgot your password?" subtitle="It happens to the best of knights.">
      <form onSubmit={submit} className="mt-6 space-y-3">
        <Field
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="you@example.com"
          autoComplete="email"
          required
          hint="We'll email you a link to choose a new password."
        />
        {error && <ErrorNote>{error}</ErrorNote>}
        <button type="submit" disabled={busy} className={BUTTON}>
          {busy ? "Sending…" : "Send reset link"}
        </button>
        <Link href="/login" className={BACK}>
          Back to sign in
        </Link>
      </form>
    </Card>
  );
}

/* ========================================================================== */
/* Using one                                                                  */
/* ========================================================================== */

type LinkState =
  | { kind: "checking" }
  | { kind: "bad"; error: string }
  | { kind: "ready"; email: string };

export function ResetPasswordForm() {
  const router = useRouter();
  const token = useRef<string | null>(null);
  const [link, setLink] = useState<LinkState>({ kind: "checking" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Read once and then wiped from the address bar, so the token doesn't sit
    // in browser history. Kept in a ref because development runs effects
    // twice, and the second pass would find the fragment already gone.
    if (token.current == null) {
      token.current =
        new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
      window.history.replaceState(null, "", window.location.pathname);
    }
    let live = true;
    openPasswordReset(token.current)
      .then((res) => {
        if (!live) return;
        setLink(res.ok ? { kind: "ready", email: res.email } : { kind: "bad", error: res.error });
      })
      .catch(() => {
        if (live) setLink({ kind: "bad", error: "Could not check that link. Please try again." });
      });
    return () => {
      live = false;
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (link.kind !== "ready" || !token.current) return;
    if (password !== confirm) return setError("Those two passwords don't match.");

    setBusy(true);
    setError(null);
    try {
      const { email } = link;
      const authSecret = await deriveAuthSecret(email, password);
      const bundle = await createKeyBundle(email, password);
      const res = await completePasswordReset({
        token: token.current,
        authSecret,
        publicKey: bundle.publicKey,
        wrappedPrivateKey: bundle.wrappedPrivateKey,
      });
      if (!res.ok) return setError(res.error);

      // Signed in by the reset; unlock messages for this tab as sign-in would.
      await rememberPrivateKey(
        await unwrapPrivateKey(email, password, bundle.wrappedPrivateKey)
      );
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (link.kind === "checking") {
    return (
      <Card title="Reset password" subtitle="Checking your link…">
        <div className="mt-6 h-10 animate-pulse rounded-xl bg-mud-100" />
      </Card>
    );
  }

  if (link.kind === "bad") {
    return (
      <Card title="Reset password" subtitle="That link won't open the gate.">
        <div className="mt-6 space-y-3">
          <ErrorNote>{link.error}</ErrorNote>
          <Link href="/forgot-password" className={BUTTON + " block text-center"}>
            Send a new link
          </Link>
          <Link href="/login" className={BACK}>
            Back to sign in
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Choose a new password" subtitle={`For ${link.email}`}>
      <form onSubmit={submit} className="mt-6 space-y-3">
        <div className="rounded-xl border border-amber-400 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
          <p className="font-bold">Your message history will be cleared.</p>
          <p className="mt-1">
            Messages with companions are end-to-end encrypted with a key that
            only your old password could unlock, so no one — including this
            server — can recover them. Your quests, XP, gear, habits and
            friends are all kept.
          </p>
        </div>

        {/* Lets a password manager file the new password under the account. */}
        <input type="email" value={link.email} autoComplete="username" readOnly hidden />
        <Field
          label="New password"
          type="password"
          value={password}
          onChange={setPassword}
          placeholder="••••••••"
          autoComplete="new-password"
          required
          minLength={8}
        />
        <Field
          label="Confirm new password"
          type="password"
          value={confirm}
          onChange={setConfirm}
          placeholder="••••••••"
          autoComplete="new-password"
          required
          minLength={8}
        />
        {error && <ErrorNote>{error}</ErrorNote>}
        <button type="submit" disabled={busy} className={BUTTON}>
          {busy ? "Deriving keys…" : "Set new password"}
        </button>
      </form>
    </Card>
  );
}
