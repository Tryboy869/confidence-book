// Confidence Book — Service Worker (fixed)
// Stratégie :
//   /api/*          → Network only (jamais de cache — données en temps réel)
//   *.html          → Network first, cache fallback (toujours à jour)
//   assets statiques → Cache first (fonts, scripts CDN)

const CACHE_NAME = 'cb-v2';

const STATIC_CACHE = [
  '/manifest.json',
  '/translations.js',
  '/sw.js'
];

// Install
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_CACHE))
      .then(() => self.skipWaiting())
  );
});

// Activate — vider les anciens caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. API — TOUJOURS réseau, jamais de cache
  //    Si hors ligne → réponse d'erreur JSON propre
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(
          JSON.stringify({ success: false, message: 'You are offline. Please check your connection.' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  // 2. Pages HTML — Network first, cache en fallback uniquement
  //    L'utilisateur voit toujours la version la plus récente
  if (event.request.destination === 'document' || url.pathname.endsWith('.html') || url.pathname === '/') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Mettre à jour le cache avec la version fraîche
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => {
          // Hors ligne → servir la version cachée si elle existe
          return caches.match(event.request) || caches.match('/welcome.html');
        })
    );
    return;
  }

  // 3. Assets statiques (scripts, fonts, images) — Cache first
  //    Ces fichiers changent rarement, le cache accélère le chargement
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
    })
  );
});
