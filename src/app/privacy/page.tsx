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
              <B>Your journal</B> — the entries you write in the notebook on
              your desk at home in the village. They are shown only to you,
              never to companions or anyone else in the village, but they are
              stored in plain text, not encrypted like messages, and are
              readable by whoever administers the database. Deleting an entry
              removes it immediately.
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
              <B>Your messages, as ciphertext</B>, and the key that reads
              them. See below.
            </li>
            <li>
              <B>The village</B> — where you last were in it (at home, at the
              town hall, at a companion&apos;s house) and when; how your house
              looks; notes pinned to doors, in plain text, not encrypted like
              messages; and nudges sent and received.
            </li>
            <li>
              <B>Planets</B> — the private planets you&apos;re on: their names
              and looks, who founded each and who&apos;s on it, invitations sent
              and received, each planet&apos;s join code, its weekly rehearsal
              times if its founder sets any, and the house (and rooms) you
              have on each.
            </li>
            <li>
              <B>Work sessions</B> — when you joined and left each table, and
              which of your quests you said you were working on.
            </li>
            <li>
              <B>Inside houses and the arena</B> — where you&apos;re standing
              while you&apos;re in one, how you&apos;ve decorated your own house,
              and what you say out loud there, in plain text, deleted after an
              hour. Duels: the moves, the outcome, and your win/loss record.
            </li>
            <li>
              <B>Password reset links</B> — only a fingerprint of each link,
              never the link itself, kept until it is used or expires.
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

        <Section title="Who can read your messages">
          <p>
            Direct messages are encrypted in your browser before they are sent,
            and stored as ciphertext. The key that reads them belongs to your
            account, not your password: it is kept in two sealed copies, one
            locked with your password and one locked with a secret held by the
            server. That second copy is what lets your messages survive a
            forgotten password, and follow you to a new device.
          </p>
          <p className="mt-3">
            The honest consequence: <B>whoever runs this app can decrypt your
            messages.</B> The server&apos;s secret is kept apart from the
            database, so someone with only a copy of the database still cannot
            read them — but the operator, who has both, could. If you need
            messages nobody but you and your friend can read, use an app built
            for that.
          </p>
          <p className="mt-3">
            Your friends&apos; public keys are also handed to you by this
            server, so a compromised server could hand you the wrong one. Each
            conversation shows a verification code: compare it with your friend
            out loud, and a substituted key becomes visible.
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
            In the village, companions also see <B>whether you&apos;re there
            and where</B>, your house, your best habit streak, how many quests
            you finished today, and your work-session time today and this
            week. When they nudge you, they can pick one of your overdue or
            due-today quests, which they see — and you&apos;re reminded of —
            only as <B>its category and deadline</B>, never its title. You can
            turn nudges off on the Notifications page.
          </p>
          <p className="mt-3">
            At a work-session table, <B>everyone at the table sees your
            character and display name</B>, including people who aren&apos;t your
            companions, and your time there. Only your companions see the
            category of the quest you&apos;re working on.
          </p>
          <p className="mt-3">
            Inside a companion&apos;s house it&apos;s the same: everyone in the
            room sees your character, name and where you stand, and hears what
            you say — including their other companions you may not know. Only
            your own companions can come into your house. In the arena and at
            the town hall, you&apos;re seen and heard by your companions only,
            and the person you&apos;re duelling. Your duel record is visible to
            your companions.
          </p>
          <p className="mt-3">
            On a <B>private planet</B>, everyone on it sees who else is (by
            display name), their houses there, and them out and about on it —
            companions or not — the same as in a village. Whoever founded it
            also sees who they&apos;ve invited, and can take anyone off it.
            Anyone with a planet&apos;s code can join it, so share a code only
            with people you&apos;d have there. Companions who aren&apos;t on a
            planet see only that you&apos;re on a private planet, never which
            one or where on it. An invitation to a planet sends a notification
            with the inviter&apos;s name and the planet&apos;s.
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
            Both can see traffic metadata and operate their own logging. If you
            ask for a password reset, your email address is passed to Resend,
            which delivers the reset email. There is no analytics, no
            advertising, no third-party trackers, and nothing is sold or shared
            beyond those providers.
          </p>
          <p className="mt-3">
            <B>Screenshot import</B> is the one feature that sends your content
            to an AI. When you import a screenshot, the image — along with
            today&apos;s date and your category names — is sent through
            OpenRouter to an AI model (Google&apos;s Gemma, on OpenRouter&apos;s
            free tier) to read the tasks in it. Those services handle it
            under their own policies, and free models may keep what they are
            sent. The screenshot itself is never stored here. Nothing is sent
            unless you choose to import one, so leave out anything you
            wouldn&apos;t want a third party to see.
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
            Deleting a quest, a category or a journal entry removes it
            immediately. Removing a
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
