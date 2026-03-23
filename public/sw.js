const CACHE_NAME = 'aftg-cache-v3';
const APP_SHELL = 'index.html';

const PRECACHE_ASSETS = [
  './',
  APP_SHELL,
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'logo.png',
  'theme.mp3',
  'welcome1.mp3',
  'welcome2.mp3',
  'correct.mp3',
  'wrong.mp3',
  'times-up.mp3',
  'won.mp3',
  'lost.mp3',
  'spin.mp3',
];

async function cacheFirst(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  const response = await fetch(request);
  if (response && response.ok && response.type === 'basic') {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);
  const networkPromise = fetch(request)
    .then((networkResponse) => {
      if (networkResponse && networkResponse.ok && networkResponse.type === 'basic') {
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    })
    .catch(() => cachedResponse);

  return cachedResponse || networkPromise;
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => Promise.all(
      cacheNames
        .filter((name) => name !== CACHE_NAME)
        .map((name) => caches.delete(name))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(event.request.url);

  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  if (requestUrl.pathname.startsWith('/api/') || requestUrl.pathname.includes('firestore') || requestUrl.pathname.includes('identitytoolkit')) {
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        return cache.match(APP_SHELL);
      })
    );
    return;
  }

  if (['script', 'style', 'worker'].includes(event.request.destination)) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  if (['image', 'font', 'audio', 'video'].includes(event.request.destination)) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  event.respondWith(staleWhileRevalidate(event.request));
});
