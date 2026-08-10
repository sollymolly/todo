import Link from "next/link";
import { PRIVACY_EFFECTIVE, PRIVACY_VERSION } from "@/lib/policy";

export const metadata = {
  title: "Privacy — HabitKnight",
  description: "What HabitKnight stores, what it can read, and what it cannot.",
};

/* A plain page, deliberately public: a privacy policy nobody can read without
   an account is not a privacy policy. */

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-10">
      <div className="panel rounded-2xl p-7">
        <h1 className="font-display text-3xl font-bold tracking-wide text-mud-900">
          Privacy
        </h1>
        <p className="mt-2 text-sm font-medium text-mud-600">
          What this app stores, what it can read, and what it genuinely cannot.
        </p>
        <p className="mt-1 text-xs font-semibold text-mud-400">
          Version {PRIVACY_VERSION} · effective {PRIVACY_EFFECTIVE}
        </p>

        <Section title="What is stored">
          <List>
            <li>
              <B>Your email address and a username.</B> The email is how you
              sign in and is also used as the salt for your encryption keys, so
              it cannot be changed without re-deriving them.
            </li>
            <li>
              <B>A password verifier — never your password.</B> Your browser
              turns the password into a derived secret before anything is sent;
              the server hashes that again with scrypt. The password itself
              never reaches the server or its logs.
            </li>
            <li>
              <B>Your quests</B> — titles, notes, deadlines, and their XP
              history. These are stored in plain text and are readable by
              whoever administers the database.
            </li>
            <li>
              <B>Completed quests are deleted after 7 days.</B> The title, notes
              and deadline are removed permanently and cannot be recovered; only
              the counts survive, so your completed total, on-time rate and
              per-category strengths stay accurate. Missed quests are kept,
              because they can still be finished.
            </li>
            <li>
              <B>Your character</B> — display name, level, appearance, gear.
            </li>
            <li>
              <B>Your messages, as ciphertext only.</B> See below.
            </li>
            <li>
              <B>Rate-limiting counters</B> keyed by IP address or account, kept
              briefly to stop password guessing.
            </li>
            <li>
              <B>A record that you agreed to this policy</B> — which version,
              and when. Nothing else about that moment is kept: no IP address,
              no device or browser details.
            </li>
          </List>
        </Section>

        <Section title="What the server cannot read">
          <p>
            Direct messages are end-to-end encrypted in your browser. The key
            that reads them is derived from your password and stored only
            wrapped — encrypted with a second key that also never leaves your
            device. The server holds ciphertext and cannot decrypt it, and
            neither can anyone with a copy of the database.
          </p>
          <p className="mt-3">
            Two honest limits. First, if you forget your password, your
            messages are unrecoverable — there is no reset that could preserve
            them, because that would mean the server could read them. Second,
            your friends&apos; public keys are handed to you <em>by this
            server</em>, so a compromised server could hand you the wrong one
            and read what follows. Each conversation shows a verification code
            for exactly this reason: compare it with your friend out loud, and a
            substituted key becomes visible.
          </p>
        </Section>

        <Section title="What other people can see">
          <p>
            Accepting a companion request is mutual and shows them your display
            name, level, completed-quest total, character, and your{" "}
            <B>category names with the number of open quests in each</B>. Quest
            titles, notes and deadlines are never shared. Removing a companion
            deletes the conversation for both of you.
          </p>
          <p className="mt-3">
            Anyone who knows your exact username or email can send you a
            request. Search is exact-match only, so your account cannot be
            discovered by browsing or guessing at prefixes.
          </p>
          <p className="mt-3">
            New accounts start already befriended to whoever runs this instance,
            which grants them the visibility described above.
          </p>
        </Section>

        <Section title="Who else is involved">
          <p>
            Data is held in a Postgres database (Neon) and served from Vercel.
            Both can see traffic metadata and operate their own logging. There
            is no analytics, no advertising, no third-party trackers, and
            nothing is sold or shared beyond those two providers.
          </p>
        </Section>

        <Section title="Agreeing to this policy">
          <p>
            Creating an account requires agreeing to this policy, and the
            version you agreed to is stored with the date. If it changes in a
            way that affects what is collected, who can see it, or who it is
            shared with, the version number goes up and you will be asked again
            before you can carry on using the app. Wording and typo fixes do not
            trigger that — being re-prompted for nothing only teaches people to
            click through without reading.
          </p>
          <p className="mt-3">
            Declining signs you out. It does not delete the account; see below.
          </p>
        </Section>

        <Section title="Deleting your data">
          <p>
            Completed quests are deleted automatically after 7 days, as above.
            Deleting a quest or a category removes it immediately. Removing a
            companion deletes every message between you. Full account deletion
            is not yet available in the app — ask the administrator, and the
            account row plus everything keyed to it is removed together.
          </p>
        </Section>

        <p className="mt-8 text-xs text-mud-400">
          This is a personal project, not a company. Treat it accordingly: keep
          a copy of anything you would be upset to lose.
        </p>

        <Link
          href="/"
          className="mt-6 inline-block rounded-lg border border-mud-300 bg-white/80 px-3 py-1.5 text-xs font-semibold text-mud-700 transition hover:border-grass-500 hover:bg-grass-50 hover:text-grass-700"
        >
          ← Back
        </Link>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="font-display text-lg font-bold text-mud-900">{title}</h2>
      <div className="mt-2 text-sm leading-relaxed text-mud-700">{children}</div>
    </section>
  );
}

function List({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5">{children}</ul>;
}

function B({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-mud-900">{children}</strong>;
}
