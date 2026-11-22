const CACHE="vicehub-static-v1";
self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",event=>{event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));await self.clients.claim();})());});
self.addEventListener("fetch",event=>{
 const req=event.request;
 if(req.method!=="GET")return;
 const url=new URL(req.url);
 if(url.origin!==self.location.origin)return;
 if(url.pathname.startsWith("/api/")||url.pathname.startsWith("/_server/")||url.pathname.startsWith("/functions/"))return;
 const ext=url.pathname.split(".").pop().toLowerCase();
 if(!url.pathname.startsWith("/assets/")&&!["js","css","woff","woff2","svg","png","webp","ico"].includes(ext))return;
 event.respondWith((async()=>{const cache=await caches.open(CACHE);const cached=await cache.match(req);const network=fetch(req).then(response=>{if(response.ok&&response.type==="basic")cache.put(req,response.clone());return response;}).catch(()=>cached);return cached||network;})());
});