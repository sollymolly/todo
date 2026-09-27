/* --------------------------------------------------------------------------
   Outgoing email, through Resend's HTTP API. Server-only: the API key must
   never reach a browser, so nothing client-side may import this.

   The one message the app sends is a password reset link. Deliberately plain
   fetch rather than an SDK — it is a single POST, and the CSP's connect-src
   only governs the browser, not this server.
   -------------------------------------------------------------------------- */

export const EMAIL_CONFIGURED = !!process.env.RESEND_API_KEY;

/**
 * Who the mail comes from. Resend only delivers from a domain you have
 * verified with them; until then, its shared onboarding address works, but
 * only to the email address that owns the Resend account.
 */
const FROM = process.env.EMAIL_FROM?.trim() || "HabitKnight <onboarding@resend.dev>";

/**
 * The address links in emails point at.
 *
 * Never derived from the request's Host header: that header is whatever the
 * caller says it is, and a reset link built from it would let anyone send a
 * victim a genuine email whose link delivers the token to their own server.
 */
export function appUrl(): string {
  const explicit = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  // Set by Vercel on every deployment: the project's production domain.
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

export async function sendEmail(message: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
  });

  if (!res.ok) {
    throw new Error(`Resend refused the email (${res.status}): ${await res.text()}`);
  }
}
