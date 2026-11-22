const CACHE = "vicehub-public-v2";
const OFFLINE = "/offline.html";
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(["/", OFFLINE, "/manifest.webmanifest", "/icons/vicehub.svg"]);
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (/^\/(api|_server|functions)\//.test(url.pathname)) return;
  if (/^\/(dashboard|admin|messages|notifications|social|studio)(\/|$)/.test(url.pathname)) return;
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(req);
        if (response.ok) await cache.put(req, response.clone());
        return response;
      } catch {
        return (await cache.match(req)) || (await cache.match("/")) || (await cache.match(OFFLINE));
      }
    })());
    return;
  }
  if (!url.pathname.startsWith("/assets/") && !/\.(js|css|woff2?|svg|png|webp|ico)$/.test(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    const network = fetch(req).then(response => {
      if (response.ok && response.type === "basic") cache.put(req, response.clone());
      return response;
    }).catch(() => cached);
    return cached || network;
  })());
});
