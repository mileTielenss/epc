'use strict';

const CACHE = 'epc-v26';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* de app vraagt welke versie er echt draait; 'skip' duwt een wachtende update door */
self.addEventListener('message', e => {
  if (e.data === 'versie' && e.source) e.source.postMessage({ versie: CACHE });
  if (e.data === 'skip') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => {
      if (hit) return hit;
      return fetch(e.request)
        .then(res => {
          if (res.ok && new URL(e.request.url).origin === self.location.origin) {
            const kopie = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, kopie));
          }
          return res;
        })
        .catch(() => (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()));
    })
  );
});
