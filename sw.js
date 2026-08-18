const CACHE_NAME = "fahrtenlog-v1";
const ASSETS = ["./index.html", "./config.js", "./app.js", "./parkschein.js", "./export.js", "./manifest.json", "./vorlage.xlsx"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((networkRes) => {
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkRes.clone()));
          return networkRes;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
