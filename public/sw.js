/* --------------------------------------------------------------------------
   HabitKnight's service worker: what lets the installed app open with no
   connection, showing the quests as they were last loaded.

   Read-only on purpose. Pages are fetched from the network first, every
   time, and a copy is kept; only when the network fails is the copy served,
   and the page is told so (see "status" below) so it can say it's offline
   and pause every control. Writes — server actions, RSC fetches — are never
   touched here.

   Registered in production only (src/components/PwaClient.tsx): in dev,
   chunk URLs aren't hashed, and a cache would serve yesterday's code.
   -------------------------------------------------------------------------- */

const PAGES = "hk-pages-v1";
const STATIC = "hk-static-v1";
/** Hashed build files pile up across deploys; keep the newest this many. */
const STATIC_LIMIT = 400;

/** The pages worth a copy. Anything else offline gets the offline notice. */
const PAGE_PATHS = ["/", "/habits", "/friends", "/character", "/updates", "/account"];

/** Which open pages were served from the copy, and how old it was. */
const fromCopy = new Map();

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([PAGES, STATIC]);
      for (const key of await caches.keys())
        if (key.startsWith("hk-") && !keep.has(key)) await caches.delete(key);
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(page(event, url));
  } else if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(hashed(req));
  } else if (url.pathname.startsWith("/sprites/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(fresh(event, req));
  }
});

/** Network first; keep a copy; fall back to the copy, then to a notice. */
async function page(event, url) {
  const key = url.pathname; // not the query: /?new=1 is still "/"
  try {
    const res = await fetch(event.request);
    if (res.redirected && new URL(res.url).pathname === "/login") {
      // Signed out, or the session lapsed: the copies are someone's quests.
      event.waitUntil(caches.delete(PAGES));
    } else if (res.ok && !res.redirected && PAGE_PATHS.includes(key)) {
      event.waitUntil(keepCopy(key, res.clone()));
    }
    return res;
  } catch {
    const copy = await (await caches.open(PAGES)).match(key);
    if (copy) {
      fromCopy.set(event.resultingClientId, Number(copy.headers.get("x-hk-saved-at")) || null);
      return copy;
    }
    return offlineNotice();
  }
}

async function keepCopy(key, res) {
  const headers = new Headers(res.headers);
  headers.set("x-hk-saved-at", String(Date.now()));
  const body = await res.blob();
  const cache = await caches.open(PAGES);
  await cache.put(key, new Response(body, { status: res.status, statusText: res.statusText, headers }));
}

/** Build files are named by their contents, so a cached one is never stale. */
async function hashed(req) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone()).then(() => trim(cache));
  return res;
}

/** Sprites and icons can change under the same name: serve, then refresh. */
async function fresh(event, req) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(req);
  const update = fetch(req)
    .then((res) => {
      if (res.ok) return cache.put(req, res.clone()).then(() => res);
      return res;
    })
    .catch(() => hit);
  if (hit) {
    event.waitUntil(update);
    return hit;
  }
  return (await update) ?? Response.error();
}

async function trim(cache) {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - STATIC_LIMIT))) await cache.delete(k);
}

function offlineNotice() {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#f6f0e2"><title>HabitKnight — offline</title>
<style>
  body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:16px;
    background:linear-gradient(180deg,#f6f0e2,#e7dcc3) fixed;color:#26251f;
    font:16px/1.5 ui-sans-serif,system-ui,sans-serif}
  main{max-width:22rem;text-align:center;background:#fffdf8;border:1px solid rgba(55,53,47,.1);
    border-radius:14px;padding:24px;box-shadow:0 8px 24px -12px rgba(15,15,15,.18)}
  h1{font-size:1.15rem;margin:0 0 .4rem} p{margin:0 0 1rem;color:#615d54}
  button{font:inherit;font-weight:600;color:#fff;background:#437a28;border:0;border-radius:8px;
    padding:.5rem 1rem;cursor:pointer}
</style></head><body><main>
<h1>You're offline</h1>
<p>This page hasn't been opened on this device yet, so there's no copy to show. It'll load once you're back online.</p>
<button onclick="location.reload()">Try again</button>
</main></body></html>`;
  return new Response(html, { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });
}

self.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || !event.source) return;

  // "Was I served from the copy?" — asked by each page as it starts.
  if (msg.type === "status") {
    event.source.postMessage({ type: "status", savedAt: fromCopy.get(event.source.id) ?? null });
    fromCopy.delete(event.source.id);
  }

  // The build files the page already loaded before this worker was running,
  // so the very first visit is enough to open offline next time.
  if (msg.type === "precache" && Array.isArray(msg.urls)) {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(STATIC);
        for (const u of msg.urls.slice(0, 200)) {
          try {
            const url = new URL(u, self.location.origin);
            if (url.origin !== self.location.origin || !url.pathname.startsWith("/_next/static/")) continue;
            if (await cache.match(url.href)) continue;
            const res = await fetch(url.href);
            if (res.ok) await cache.put(url.href, res);
          } catch {
            /* one missing chunk shouldn't stop the rest */
          }
        }
        await trim(cache);
      })()
    );
  }
});

/* ------------------------------------------------------------ notifications

   Sent by src/lib/push.ts. Every push shows a notification — iOS revokes the
   permission of an app that receives one silently — and may carry the number
   for the app icon's badge, where the platform has one. */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }

  const jobs = [
    self.registration.showNotification(data.title || "HabitKnight", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      // Android's status bar: a white silhouette, drawn from the alpha.
      badge: "/icons/badge-96.png",
      tag: data.tag,
      renotify: Boolean(data.tag),
      data: { url: data.url || "/" },
    }),
  ];
  const nav = self.navigator;
  if (typeof data.badge === "number" && nav && nav.setAppBadge) {
    jobs.push(data.badge > 0 ? nav.setAppBadge(data.badge) : nav.clearAppBadge());
  }
  event.waitUntil(Promise.all(jobs).catch(() => {}));
});

/** Tapped: bring the app forward on the right page, or open it there. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin);
  if (target.origin !== self.location.origin) return;

  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const mine = open.find((c) => new URL(c.url).origin === self.location.origin);
      if (mine) {
        await mine.focus();
        if (mine.url !== target.href && "navigate" in mine) await mine.navigate(target.href).catch(() => {});
        return;
      }
      await self.clients.openWindow(target.href);
    })()
  );
});
