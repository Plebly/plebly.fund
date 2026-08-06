/* App shell SW — cache hashed Vite assets for fast cold start; never cache HTML
   so deploys never point at stale chunk names. Enables installability on Chromium. */
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
