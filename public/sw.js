/* App shell SW — cache hashed Vite assets for fast cold start; never cache HTML
   so deploys never point at stale chunk names. Handles Web Push for installed PWA. */
const CACHE = "plebly-assets-v2";

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

const PUSH_FALLBACK_PATH = "/account?tab=notifications";
const PUSH_PATH_ORIGIN = "https://plebly.invalid";

/** Keep in sync with src/web-push.ts pushNavigationPath. */
function pushNavigationPath(raw) {
  let url = typeof raw === "string" ? raw.trim() : "";
  if (!url) return PUSH_FALLBACK_PATH;
  if (/^https?:\/\//i.test(url)) {
    try {
      const abs = new URL(url);
      url = `${abs.pathname}${abs.search}${abs.hash}` || "/";
    } catch {
      return PUSH_FALLBACK_PATH;
    }
  }
  if (!url.startsWith("/")) url = `/${url}`;
  if (url.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(url)) return PUSH_FALLBACK_PATH;
  try {
    const resolved = new URL(url, PUSH_PATH_ORIGIN);
    if (resolved.origin !== PUSH_PATH_ORIGIN) return PUSH_FALLBACK_PATH;
    return `${resolved.pathname}${resolved.search}${resolved.hash}` || "/";
  } catch {
    return PUSH_FALLBACK_PATH;
  }
}

/** Click target, or null when the path would leave this origin. */
function notificationClickUrl(path, origin) {
  const safe = pushNavigationPath(path);
  try {
    const target = new URL(safe, origin);
    if (target.origin !== origin) return null;
    return target.href;
  } catch {
    return null;
  }
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
    const url = pushNavigationPath(
      typeof data.url === "string" ? data.url : PUSH_FALLBACK_PATH,
    );
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
  // Never cache-first JS: a stale bundle kept the old GitHub login URL.
  if (/\.js$/i.test(pathname)) return;
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
  const target = notificationClickUrl(path, self.location.origin);
  if (!target) return;
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
