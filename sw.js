'use strict';

/* enige versieconstante van de app; bump bij elke release */
const VERSIE = 'epc-v14';

/* sw.js staat mee in de cache zodat de app er VERSIE uit kan lezen voor /Producer;
   de browser haalt SW-updates zelf op, buiten deze fetch-handler om */
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './db.js',
  './maakpdf.js',
  './maakzip.js',
  './pdfworker.js',
  './sw.js',
  './manifest.json',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSIE).then(c => c.addAll(ASSETS)));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSIE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  /* versiecheck (§9.5): sw.js mét cache-buster gaat rechtstreeks naar het
     netwerk — anders las de update-check altijd de oude, gecachete versie */
  if (e.request.url.includes('sw.js?')) return;
  e.respondWith(
    /* uitsluitend de eigen cache: een nieuwe SW mag nooit oude bestanden serveren */
    caches.open(VERSIE).then(c => c.match(e.request, { ignoreSearch: true })).then(hit => {
      if (hit) return hit;
      return fetch(e.request)
        .then(res => {
          if (res.ok && new URL(e.request.url).origin === self.location.origin) {
            const kopie = res.clone();
            caches.open(VERSIE).then(c => c.put(e.request, kopie));
          }
          return res;
        })
        .catch(() => (e.request.mode === 'navigate' ? caches.open(VERSIE).then(c => c.match('./index.html')) : Response.error()));
    })
  );
});
