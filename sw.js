/* Nocturne service worker — app shell only.
   Never intercepts /api/ (NetEase auth, search, audio proxy) or non-GET. */

const VERSION = 'nocturne-20261027-1';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/css/fonts.css',
  '/css/style.css',
  '/js/app.js',
  '/js/audio.js',
  '/js/stage.js',
  '/js/heart.js',
  '/js/paper-dots.js',
  '/js/lyrics.js',
  '/js/meta.js',
  '/js/presets.js',
  '/js/shelf.js',
  '/js/wheel.js',
  '/js/gallery.js',
  '/js/ink.js',
  '/js/cursor.js',
  '/js/netease.js',
  '/js/login.js',
  '/js/pwa.js',
  '/vendor/qrcode.js',
  '/vendor/fonts/general-sans-400.woff2',
  '/vendor/fonts/general-sans-500.woff2',
  '/vendor/fonts/general-sans-600.woff2',
  '/vendor/fonts/general-sans-700.woff2',
  '/vendor/fonts/manrope-var.woff2',
  '/assets/demo-1.mp3',
  '/assets/demo-2.mp3',
  '/assets/demo-5.mp3',
  '/assets/demo.lrc',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

async function networkFirst(request, fallbackKey) {
  const cache = await caches.open(VERSION);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(fallbackKey || request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(fallbackKey || request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, '/'));
    return;
  }

  if (
    url.pathname.startsWith('/js/') ||
    url.pathname.startsWith('/css/') ||
    url.pathname === '/index.html' ||
    url.pathname === '/manifest.webmanifest'
  ) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});
