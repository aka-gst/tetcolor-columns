// Offline shell for Tetcolor. Registered from the page with a relative path so
// the scope follows the /tetcolor/ prefix the site proxy serves the game under.
// Raise this name when an asset is dropped from the shell: refreshed files
// replace themselves, but entries for files that no longer ship only go away
// when the old cache is discarded on activate.
const CACHE = 'tetcolor-v3';
// Both games are served from this one origin and therefore share a single
// CacheStorage. The cleanup on activate must only ever touch this game's own
// caches: deleting everything else wipes the other game's offline copy.
const PREFIX = 'tetcolor-';

// The whole game is ~350 KB of audio plus the shell, so it is cheap to hold the
// entire thing rather than warm the cache one sound at a time.
const SHELL = [
  './',
  './manifest.webmanifest',
  './favicon.svg',
  './icon-192.png',
  './icon-512.png',
  './sounds/clear-1.mp3',
  './sounds/clear-2.mp3',
  './sounds/cycle-1.mp3',
  './sounds/cycle-2.mp3',
  './sounds/gameover-1.mp3',
  './sounds/gameover-2.mp3',
  './sounds/land-1.mp3',
  './sounds/land-2.mp3',
  './sounds/level-1.mp3',
  './sounds/move-1.mp3',
  './sounds/move-2.mp3',
  './sounds/eggs/egg-1.mp3',
  './sounds/eggs/egg-10.mp3',
  './sounds/eggs/egg-11.mp3',
  './sounds/eggs/egg-12.mp3',
  './sounds/eggs/egg-13.mp3',
  './sounds/eggs/egg-14.mp3',
  './sounds/eggs/egg-15.mp3',
  './sounds/eggs/egg-2.mp3',
  './sounds/eggs/egg-3.mp3',
  './sounds/eggs/egg-4.mp3',
  './sounds/eggs/egg-5.mp3',
  './sounds/eggs/egg-6.mp3',
  './sounds/eggs/egg-7.mp3',
  './sounds/eggs/egg-8.mp3',
  './sounds/eggs/egg-9.mp3'
];

// Assets are versioned by a ?v= query, so the cache is keyed by path alone.
// Keeping one entry per asset means a background refresh REPLACES it; keying by
// the full URL instead left the fresh copy beside the precached one, and an
// ignoreSearch lookup could go on preferring the stale entry indefinitely.
const cacheKey = request => {
  const url = new URL(request.url);
  url.search = '';
  return url.href;
};

const store = (request, response) => caches.open(CACHE)
  .then(cache => cache.put(cacheKey(request), response))
  // Range requests answer 206, which the Cache API refuses to store.
  .catch(() => undefined);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE)
    // One entry at a time: addAll is atomic, so a single miss would leave the
    // whole install with nothing cached.
    .then(cache => Promise.all(SHELL.map(url => cache.add(url).catch(() => undefined))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Scores are worthless when stale, so they never touch the cache.
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request)
      .then(response => {
        if (response.status === 200) void store(request, response.clone());
        return response;
      })
      .catch(() => caches.match(cacheKey(request))
        .then(hit => hit || caches.match('./'))));
    return;
  }

  event.respondWith(caches.match(cacheKey(request)).then(hit => {
    const network = fetch(request).then(response => {
      if (response.status === 200) void store(request, response.clone());
      return response;
    }).catch(() => hit);
    return hit || network;
  }));
});
