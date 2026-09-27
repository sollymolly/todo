"use server";

import { sql } from "@/lib/db";
import { requireUserId } from "@/lib/session";
import { rateLimited, TOO_MANY } from "@/lib/rate-limit";
import { PUSH_CONFIGURED, sendToUser } from "@/lib/push";
import { cleanPrefs, DEFAULT_PREFS, isPushEndpoint, type NotificationPrefs } from "@/lib/notify";

/* --------------------------------------------------------------------------
   Notification settings and this device's subscription (migration 025).
   Every statement is scoped by user_id, like everything in actions.ts.
   -------------------------------------------------------------------------- */

/** A person keeps at most this many devices; the oldest goes first. */
const MAX_DEVICES = 10;

type PrefsRow = {
  due_soon: boolean;
  lead_minutes: number;
  morning: boolean;
  morning_minutes: number;
  messages: boolean;
  nudges: boolean;
};

export async function loadNotificationPrefs(): Promise<NotificationPrefs> {
  const userId = await requireUserId();
  const rows = (await sql`
    select due_soon, lead_minutes, morning, morning_minutes, messages, nudges
      from notification_prefs where user_id = ${userId}::uuid
  `) as PrefsRow[];
  const r = rows[0];
  if (!r) return DEFAULT_PREFS;
  return cleanPrefs({
    dueSoon: r.due_soon,
    leadMinutes: r.lead_minutes,
    morning: r.morning,
    morningMinutes: r.morning_minutes,
    messages: r.messages,
    nudges: r.nudges,
  });
}

export async function saveNotificationPrefs(input: NotificationPrefs): Promise<void> {
  const userId = await requireUserId();
  const p = cleanPrefs(input);
  await sql`
    insert into notification_prefs
      (user_id, due_soon, lead_minutes, morning, morning_minutes, messages, nudges, updated_at)
    values (${userId}::uuid, ${p.dueSoon}, ${p.leadMinutes}, ${p.morning},
            ${p.morningMinutes}, ${p.messages}, ${p.nudges}, now())
    on conflict (user_id) do update set
      due_soon = excluded.due_soon,
      lead_minutes = excluded.lead_minutes,
      morning = excluded.morning,
      morning_minutes = excluded.morning_minutes,
      messages = excluded.messages,
      nudges = excluded.nudges,
      updated_at = now()
  `;
}

/**
 * This device said yes. Called again on later visits, which is harmless: an
 * address already known is simply (re)claimed by whoever is signed in now —
 * the device changed hands, so its notifications should too.
 */
export async function saveSubscription(sub: {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
}): Promise<{ ok: boolean; error?: string }> {
  const userId = await requireUserId();
  const endpoint = typeof sub?.endpoint === "string" ? sub.endpoint : "";
  const p256dh = typeof sub?.keys?.p256dh === "string" ? sub.keys.p256dh : "";
  const auth = typeof sub?.keys?.auth === "string" ? sub.keys.auth : "";
  const B64URL = /^[A-Za-z0-9_-]+=*$/;

  if (
    endpoint.length > 1000 ||
    !isPushEndpoint(endpoint) ||
    !B64URL.test(p256dh) ||
    p256dh.length > 200 ||
    !B64URL.test(auth) ||
    auth.length > 100
  )
    return { ok: false, error: "This browser's push details look wrong." };

  await sql`
    insert into push_subscriptions (user_id, endpoint, p256dh, auth)
    values (${userId}::uuid, ${endpoint}, ${p256dh}, ${auth})
    on conflict (endpoint) do update set
      user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth
  `;
  await sql`
    delete from push_subscriptions
     where user_id = ${userId}::uuid
       and id not in (
         select id from push_subscriptions where user_id = ${userId}::uuid
          order by created_at desc limit ${MAX_DEVICES}
       )
  `;
  return { ok: true };
}

export async function removeSubscription(endpoint: string): Promise<void> {
  const userId = await requireUserId();
  if (typeof endpoint !== "string" || endpoint.length > 1000) return;
  await sql`
    delete from push_subscriptions
     where endpoint = ${endpoint} and user_id = ${userId}::uuid
  `;
}

export async function sendTestNotification(): Promise<{ ok: boolean; error?: string }> {
  const userId = await requireUserId();
  if (!PUSH_CONFIGURED) return { ok: false, error: "Notifications aren't set up on the server yet." };
  if (await rateLimited("testPush", userId)) return { ok: false, error: TOO_MANY };
  const reached = await sendToUser(userId, {
    title: "HabitKnight",
    body: "Notifications are on. Your quests will find you.",
    url: "/notifications",
    tag: "test",
  });
  return reached
    ? { ok: true }
    : { ok: false, error: "No device could be reached. Try turning notifications off and on." };
}
