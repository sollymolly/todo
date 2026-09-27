"use client";

import { removeSubscription, saveSubscription } from "@/lib/notify-actions";

/* --------------------------------------------------------------------------
   This device's side of push notifications: asking permission, subscribing
   with the push service, and telling the server where to send.

   Needs the service worker, which only runs in a production build (see
   src/lib/pwa.ts), so in `next dev` this reports "unsupported".
   -------------------------------------------------------------------------- */

export type PushState =
  | "unsupported" // no service worker or Push API here
  | "needs-install" // iPhone/iPad in Safari: only an installed app can
  | "blocked" // permission denied; only the browser's settings can undo it
  | "off"
  | "on";

const RESYNC_KEY = "habitknight.pushSynced";

export function pushSupported(): boolean {
  return (
    process.env.NODE_ENV === "production" &&
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function isIosBrowser(): boolean {
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const installed =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !installed;
}

async function registration() {
  return navigator.serviceWorker.ready;
}

export async function pushState(): Promise<PushState> {
  if (typeof window !== "undefined" && isIosBrowser()) return "needs-install";
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const sub = await (await registration()).pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Asks, subscribes, and saves. Must be called from a tap (iOS insists). */
export async function turnOnPush(): Promise<PushState> {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) throw new Error("Notifications aren't set up on the server yet.");
  const permission = await Notification.requestPermission();
  if (permission === "denied") return "blocked";
  if (permission !== "granted") return "off";

  const reg = await registration();
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
  const saved = await saveSubscription(sub.toJSON());
  if (!saved.ok) {
    await sub.unsubscribe().catch(() => {});
    throw new Error(saved.error ?? "Couldn't save this device.");
  }
  markSynced();
  return "on";
}

export async function turnOffPush(): Promise<PushState> {
  const sub = await (await registration()).pushManager.getSubscription();
  if (sub) {
    await removeSubscription(sub.endpoint).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  return "off";
}

function markSynced() {
  try {
    localStorage.setItem(RESYNC_KEY, String(Date.now()));
  } catch {
    /* storage unavailable: it'll just resync next visit */
  }
}

/**
 * Once a day, re-tell the server about this device's subscription. Browsers
 * rotate them now and then, and a database restore or a device that changed
 * accounts would otherwise leave notifications going nowhere.
 */
export async function resyncPush(): Promise<void> {
  if (!pushSupported() || Notification.permission !== "granted") return;
  try {
    const last = Number(localStorage.getItem(RESYNC_KEY) ?? 0);
    if (Date.now() - last < 24 * 60 * 60 * 1000) return;
  } catch {
    /* no storage: resync every visit, which is harmless */
  }
  const sub = await (await registration()).pushManager.getSubscription();
  if (!sub) return;
  const saved = await saveSubscription(sub.toJSON()).catch(() => null);
  if (saved?.ok) markSynced();
}

/**
 * Signed out: this device stops receiving the last person's notifications.
 * The server's row goes stale and is dropped the next time a send to it
 * fails (404/410), so this needs no session.
 */
export async function forgetPush(): Promise<void> {
  if (!pushSupported()) return;
  try {
    localStorage.removeItem(RESYNC_KEY);
  } catch {
    /* fine */
  }
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  await sub?.unsubscribe().catch(() => {});
}

/** The number on the installed app's icon. Quietly nothing where unsupported. */
export function setIconBadge(n: number) {
  const nav = navigator as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  if (n > 0) nav.setAppBadge?.(n).catch(() => {});
  else nav.clearAppBadge?.().catch(() => {});
}
