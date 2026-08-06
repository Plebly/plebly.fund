/* App shell SW — cache hashed Vite assets for fast cold start; never cache HTML
   so deploys never point at stale chunk names. Handles Web Push for installed PWA. */
const CACHE = "plebly-assets-v1";

function isHashedAsset(pathname) {
  return (
    pathname.includes("/assets/") &&
    /\.(js|css|woff2?|png|svg|jpeg|jpg|webp)$/i.test(pathname)
  );
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    void cache.put(request, response.clone());
  }
  return response;
}

/** Keep in sync with src/web-push.ts parsePushEventData. */
function parsePushEventData(raw) {
  if (!raw) {
    return {
      title: "Plebly",
      body: "You have a new notification.",
      url: "/account?tab=notifications",
    };
  }
  try {
    const data = JSON.parse(raw);
    const title =
      typeof data.title === "string" && data.title.trim()
        ? data.title.trim()
        : "Plebly";
    const body =
      typeof data.body === "string" && data.body.trim()
        ? data.body.trim()
        : "Open Plebly for details.";
    let url =
      typeof data.url === "string" && data.url.trim()
        ? data.url.trim()
        : "/account?tab=notifications";
    if (url.startsWith("http://") || url.startsWith("https://")) {
      try {
        const u = new URL(url);
        url = `${u.pathname}${u.search}${u.hash}` || "/";
      } catch {
        url = "/account?tab=notifications";
      }
    } else if (!url.startsWith("/")) {
      url = `/${url}`;
    }
    return {
      title,
      body,
      url,
      tag: typeof data.tag === "string" ? data.tag : undefined,
    };
  } catch {
    return {
      title: "Plebly",
      body: "You have a new notification.",
      url: "/account?tab=notifications",
    };
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const { pathname } = new URL(event.request.url);
  if (!isHashedAsset(pathname)) return;
  event.respondWith(cacheFirst(event.request));
});

self.addEventListener("push", (event) => {
  const raw = event.data ? event.data.text() : null;
  const payload = parsePushEventData(raw);
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      data: { url: payload.url },
      tag: payload.tag || "plebly",
      renotify: Boolean(payload.tag),
      icon: "./icon-192.png",
      badge: "./icon-192.png",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path =
    (event.notification.data && event.notification.data.url) ||
    "/account?tab=notifications";
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of all) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(target);
            } catch {
              /* older clients */
            }
          }
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(target);
    })(),
  );
});
