/* --------------------------------------------------------------------------
   The privacy policy, versioned.

   Consent is only meaningful if you can say *what* was agreed to and *when*.
   Bumping this number is what re-prompts everyone: the accepted version rides
   in the session cookie, so a mismatch sends the user back through the gate on
   their very next request, on every device, with no database read.

   Bump it whenever the policy changes in a way that affects what is collected,
   who can see it, or who it is shared with. Wording and typo fixes don't count
   — re-consenting people for nothing trains them to click through.
   -------------------------------------------------------------------------- */

export const PRIVACY_VERSION = 2;

/** Shown alongside the version so "which one did I agree to" has an answer. */
export const PRIVACY_EFFECTIVE = "26 September 2026";

/**
 * The handful of points someone must actually see before agreeing. The full
 * text lives at /privacy; burying the consequential parts behind a link and
 * calling it informed consent is the thing this avoids.
 */
export const PRIVACY_HIGHLIGHTS = [
  "Your email, quests, notes and deadlines are stored in plain text, and whoever administers the database can read them.",
  "Your direct messages are encrypted, and tied to your account rather than your password, so they survive a forgotten password. The trade-off: whoever runs this app holds the key that can decrypt them.",
  "Companions you accept can see your level, completed-quest count, and your category names with how many quests are open in each. Never the quests themselves.",
  "New accounts start already befriended to whoever runs this instance, which gives them that same visibility.",
  "Data is held by Neon (database) and Vercel (hosting). If you ask for a password reset, Resend delivers the email. There is no analytics, no advertising and no third-party tracking.",
] as const;
