// Slip Catch service worker: offline play + instant repeat loads.
// - Navigations: network-first so a fresh deploy always wins; the cache is
//   only the offline fallback.
// - Same-origin GETs (hashed assets under /assets/, icons, manifest):
//   cache-first, then fill the cache in the background.
// Cross-origin and non-GET requests pass straight through.
const CACHE = "slipcatch-v1";
const MAX_ENTRIES = 80;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) {
    await cache.delete(key);
  }
}

function put(cache, req, res) {
  return cache.put(req, res).then(() => trim(cache));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => put(c, req, copy));
          return res;
        })
        .catch(() =>
          caches
            .match(req)
            .then((hit) => hit || caches.match("./index.html")),
        ),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => put(c, req, copy));
          }
          return res;
        }),
    ),
  );
});
