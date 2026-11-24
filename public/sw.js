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

self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = { body: event.data?.text() || "A new VICEHUB update is available." }; }
  event.waitUntil(self.registration.showNotification(payload.title || "VICEHUB update", {
    body: payload.body || "A new GTA VI story or video is waiting.",
    icon: "/icons/vicehub-192.svg", badge: "/icons/vicehub-192.svg",
    data: { url: payload.url || "/notifications" },
    tag: payload.tag || "vicehub-update", renotify: false,
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/notifications", self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(windows => {
    const existing = windows.find(client => client.url.startsWith(self.location.origin));
    return existing ? existing.navigate(target).then(() => existing.focus()) : clients.openWindow(target);
  }));
});
