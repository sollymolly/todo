import webpush from "web-push";
import { sql } from "@/lib/db";
import { appUrl } from "@/lib/email";

/* --------------------------------------------------------------------------
   Sending a notification to every device someone has said yes on.

   The one place that knows how a notification travels. Today that's Web Push
   (VAPID keys in the environment). When the app is wrapped for the App Store
   and Play Store, a native build registers with APNs / FCM instead, and this
   is the file that learns to send there too — nothing that decides *what* to
   send (src/lib/reminders.ts, sendMessage) needs to change.

   Server-only: it holds the private key.
   -------------------------------------------------------------------------- */

export type PushPayload = {
  title: string;
  body: string;
  /** Opened when the notification is tapped. */
  url?: string;
  /** Same tag replaces the older notification rather than stacking. */
  tag?: string;
  /** The app icon's number, where the platform has one. 0 clears it. */
  badge?: number;
};

export const PUSH_CONFIGURED = !!(
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
);

let configured = false;
function configure() {
  if (configured) return;
  // Push services may contact this address about misbehaving sends. It must
  // be mailto: or https: — web-push refuses anything else outright — so on
  // plain-http localhost it stands in with https://localhost, which Chrome
  // and Firefox accept (Apple doesn't, but Safari needs a real https site
  // for push anyway).
  const site = appUrl();
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT?.trim() || (site.startsWith("https:") ? site : "https://localhost"),
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );
  configured = true;
}

type Row = { id: string; endpoint: string; p256dh: string; auth: string };

/** Returns how many devices it reached. Never throws for a bad device. */
export async function sendToUser(userId: string, payload: PushPayload): Promise<number> {
  if (!PUSH_CONFIGURED) return 0;
  configure();

  const subs = (await sql`
    select id, endpoint, p256dh, auth from push_subscriptions
     where user_id = ${userId}::uuid
  `) as Row[];

  const body = JSON.stringify(payload);
  const results = await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          // Worth delivering for a few hours if the phone is off; a reminder
          // for a deadline long gone isn't.
          { TTL: 6 * 60 * 60, urgency: "normal", timeout: 10_000 }
        );
        await sql`update push_subscriptions set last_ok_at = now() where id = ${s.id}::uuid`;
        return 1;
      } catch (e) {
        // 404/410: the browser dropped this subscription (uninstalled,
        // permission revoked, signed out). It won't come back.
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410)
          await sql`delete from push_subscriptions where id = ${s.id}::uuid`;
        return 0;
      }
    })
  );
  return results.reduce<number>((a, b) => a + b, 0);
}
