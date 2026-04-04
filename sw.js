// Confidence Book — Service Worker
// Provides: offline fallback, static asset caching, fast load

const CACHE_NAME = 'confidence-book-v1';
const STATIC_ASSETS = [
  '/welcome.html',
  '/auth.html',
  '/feed.html',
  '/post.html',
  '/profile.html',
  '/settings.html',
  '/translations.js',
  '/manifest.json'
];

// Install — cache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate — clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — network first for API, cache first for static
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // API calls — always network, no cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ success: false, message: 'You are offline' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Static assets — cache first, then network
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Cache new static responses
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback
        if (event.request.destination === 'document') {
          return caches.match('/welcome.html');
        }
      });
    })
  );
});
