/* =====================================================================
   The Monorepo and the Machine: service worker.

   ---------------------------------------------------------------------
   BUMP `CACHE` WHENEVER ANY PRECACHED FILE CHANGES.
   ---------------------------------------------------------------------
   The whole book is one HTML file, so `index.html` changes on every
   content edit. This worker is cache-first: a request that hits the
   cache never reaches the network, so without a new cache name an
   updated book is invisible to everyone who already installed it.
   The name is the only cache-busting mechanism here. There is no hash
   in any filename, on purpose, because the file list is hand-held and
   short. `npm run cap:sync` bumps this automatically via
   tools/bump-cache.mjs; if you edit www/index.html by hand, bump it by
   hand too.
   ===================================================================== */
const CACHE = 'mm-handbook-v1';

/* Everything the book needs to open with no network at all. Relative
   paths so the worker works under a project-scoped GitHub Pages URL as
   well as at a domain root. */
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // addAll is atomic: one 404 fails the whole install, which is what
      // you want. A half-populated cache is worse than no cache.
      await cache.addAll(PRECACHE);
      // Take over as soon as the new worker is ready rather than waiting
      // for every tab to close.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith('mm-handbook-') && n !== CACHE)
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

/**
 * Refetch in the background and store the result. Failures are expected
 * offline and must stay silent: this runs after a response has already
 * been served, so throwing here would only produce console noise.
 */
async function revalidate(request, cache) {
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok && fresh.type === 'basic') {
      await cache.put(request, fresh.clone());
    }
    return fresh;
  } catch {
    return null;
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  /* Navigations: serve the cached shell immediately, then refresh it in
     the background so the next launch has the new book. The book is a
     single document with hash routing, so every navigation resolves to
     index.html regardless of the fragment. */
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cached =
          (await cache.match('./index.html')) || (await cache.match('./'));

        if (cached) {
          event.waitUntil(revalidate(new Request('./index.html'), cache));
          return cached;
        }

        const fresh = await revalidate(request, cache);
        if (fresh) return fresh;

        return new Response(
          '<!doctype html><meta charset="utf-8">' +
            '<title>Offline</title>' +
            '<body style="font:16px Georgia,serif;padding:2rem;background:#E9EAE3;color:#191C18">' +
            '<h1>Offline</h1><p>The book has not been cached on this device yet. ' +
            'Connect once and it will open offline from then on.</p>',
          { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } },
        );
      })(),
    );
    return;
  }

  /* Everything else: cache first, network as fallback, and store what
     the network gave us so the second visit is offline-capable. */
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;

      const fresh = await revalidate(request, cache);
      if (fresh) return fresh;

      return new Response('', { status: 504, statusText: 'Offline' });
    })(),
  );
});

/* Lets a page ask the worker to activate immediately after an update,
   without a second reload. */
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
