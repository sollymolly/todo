"use client";

import { useSyncExternalStore } from "react";

/* --------------------------------------------------------------------------
   The installed app's two bits of browser state: whether we're offline, and
   whether the app can be installed. Both are set up once, by startPwa() in
   the root layout's PwaShell, and read anywhere through the hooks below.

   Offline means either the browser says so, or this page was opened from the
   service worker's saved copy (public/sw.js) because the network failed —
   which the browser doesn't know about, and which is the case that matters
   most: someone opening the app on a train.

   Read through useSyncExternalStore, like motion-pref: the server render and
   the first client render agree (online, nothing to install), and the real
   values arrive once the page is running.
   -------------------------------------------------------------------------- */

export const PAGES_CACHE = "hk-pages-v1";

type Connectivity = { offline: boolean; savedAt: number | null };
type Install = { canPrompt: boolean; ios: boolean; installed: boolean };

const ONLINE: Connectivity = { offline: false, savedAt: null };
const NOTHING: Install = { canPrompt: false, ios: false, installed: false };

let online = true;
let savedAt: number | null = null;
let connectivity: Connectivity = ONLINE;

/** Chromium's install prompt, held until someone asks for it. */
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<unknown> };
let deferred: InstallPromptEvent | null = null;
let install: Install = NOTHING;

const listeners = new Set<() => void>();
function emit() {
  connectivity = { offline: !online || savedAt !== null, savedAt };
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useConnectivity(): Connectivity {
  return useSyncExternalStore(subscribe, () => connectivity, () => ONLINE);
}

export function useInstall(): Install & { prompt: () => Promise<void> } {
  const state = useSyncExternalStore(subscribe, () => install, () => NOTHING);
  return { ...state, prompt: promptInstall };
}

async function promptInstall() {
  if (!deferred) return;
  const e = deferred;
  deferred = null;
  await e.prompt();
  await e.userChoice.catch(() => {});
  refreshInstall();
  emit();
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function refreshInstall() {
  // iPadOS reports itself as a Mac; the touchscreen gives it away.
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  install = { canPrompt: deferred !== null, ios, installed: isStandalone() };
}

/** Once the saved copy is showing, the real page as soon as it's reachable. */
function comeBack() {
  if (savedAt === null) return;
  fetch("/manifest.webmanifest", { cache: "no-store" })
    .then((r) => r.ok && window.location.reload())
    .catch(() => {});
}

/** Wires everything up. Returns the teardown, for the effect that calls it. */
export function startPwa(): () => void {
  let poll: ReturnType<typeof setInterval> | undefined;

  const onOnline = () => {
    online = true;
    emit();
    comeBack();
  };
  const onOffline = () => {
    online = false;
    emit();
  };
  const onPrompt = (e: Event) => {
    e.preventDefault(); // shown from the menu instead, when asked for
    deferred = e as InstallPromptEvent;
    refreshInstall();
    emit();
  };
  const onInstalled = () => {
    deferred = null;
    refreshInstall();
    emit();
  };
  const onMessage = (e: MessageEvent) => {
    if (e.data?.type !== "status" || !e.data.savedAt) return;
    savedAt = e.data.savedAt;
    emit();
    clearInterval(poll);
    poll = setInterval(comeBack, 15_000);
  };

  online = navigator.onLine;
  refreshInstall();
  emit();
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  window.addEventListener("beforeinstallprompt", onPrompt);
  window.addEventListener("appinstalled", onInstalled);

  const sw = "serviceWorker" in navigator ? navigator.serviceWorker : null;
  if (sw && process.env.NODE_ENV === "production") {
    sw.addEventListener("message", onMessage);
    sw.controller?.postMessage({ type: "status" });
    sw.register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then(() => sw.ready)
      .then((reg) =>
        reg.active?.postMessage({
          type: "precache",
          urls: performance.getEntriesByType("resource").map((r) => r.name),
        })
      )
      .catch(() => {
        /* no worker: the app still works, just not offline */
      });
  } else if (sw) {
    // In dev, a worker left over from testing a production build would serve
    // stale code from its cache. Take it away.
    sw.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
  }

  return () => {
    clearInterval(poll);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    window.removeEventListener("beforeinstallprompt", onPrompt);
    window.removeEventListener("appinstalled", onInstalled);
    sw?.removeEventListener("message", onMessage);
  };
}

/** The saved pages are one person's quests: gone the moment they sign out. */
export function forgetSavedPages() {
  if ("caches" in window) void caches.delete(PAGES_CACHE);
}
