/* sw.js in Node: service-worker-omgeving nagebootst met stubs (SPEC.md §11).
   Elke tak van install/activate/fetch wordt aangeroepen met nep-events. */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { strict as assert } from 'node:assert';

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = join(HIER, '..');
const require = createRequire(import.meta.url);

/* ---- stubs: cache-API, clients, location ---- */
const cacheStores = new Map(); /* naam -> Map(url -> Response) */
let geclaimd = false;
const handlers = {};

let geskipt = false;
globalThis.self = {
  addEventListener: (t, f) => { handlers[t] = f; },
  clients: { claim: async () => { geclaimd = true; } },
  skipWaiting: async () => { geskipt = true; },
  location: { origin: 'https://app.test' }
};
globalThis.caches = {
  open: async naam => {
    if (!cacheStores.has(naam)) cacheStores.set(naam, new Map());
    const m = cacheStores.get(naam);
    return {
      addAll: async urls => urls.forEach(u => m.set(u, new Response('gecachet:' + u))),
      /* de echte Cache API geeft een kopie terug, nooit hetzelfde Response-object */
      match: async req => { const r = m.get(typeof req === 'string' ? req : req.url); return r && r.clone(); },
      put: async (req, res) => m.set(typeof req === 'string' ? req : req.url, res)
    };
  },
  keys: async () => [...cacheStores.keys()],
  delete: async naam => cacheStores.delete(naam)
};
let fetchAntwoord = null; /* per test ingesteld */
const installUrls = [];   /* urls die de install-fase ophaalt */
let installModus = true;  /* tijdens install: per asset een vers Response-object */
let installFout = false;  /* simuleert een 404 tijdens de install */
globalThis.fetch = async (url) => {
  if (installModus) {
    if (installFout) return new Response('weg', { status: 404 });
    installUrls.push(String(url));
    return new Response('gecachet:' + String(url).split('?')[0], { status: 200 });
  }
  if (fetchAntwoord instanceof Error) throw fetchAntwoord;
  return fetchAntwoord;
};

require(join(REPO, 'sw.js'));

function fetchEvent(req) {
  const e = { request: req, antwoord: null, respondWithAangeroepen: false };
  e.respondWith = p => { e.respondWithAangeroepen = true; e.antwoord = Promise.resolve(p); };
  return e;
}

/* ---- install: alle assets vers (met ?v=VERSIE-cachebuster) in de versie-cache ---- */
let klaar = null;
handlers.install({ waitUntil: p => { klaar = p; } });
await klaar;
installModus = false;
const cacheNaam = [...cacheStores.keys()][0];
assert.match(cacheNaam, /^epc-v\d+$/, 'cache heet naar de versie');
assert.ok(cacheStores.get(cacheNaam).has('./index.html'), 'index.html gecachet');
assert.ok(cacheStores.get(cacheNaam).has('./sw.js'), 'sw.js zelf gecachet (voor /Producer)');
assert.ok(installUrls.length >= 10 && installUrls.every(u => u.includes('?v=' + cacheNaam)),
  'elk asset opgehaald met ?v=VERSIE (voorbij elke CDN-cache)');

/* ---- message: skipWaiting enkel op het juiste bericht ---- */
handlers.message({ data: 'iets anders' });
assert.ok(!geskipt, 'vreemd bericht genegeerd');
handlers.message({ data: 'skipWaiting' });
assert.ok(geskipt, 'skipWaiting aangeroepen op verzoek');

/* ---- install die een 404 tegenkomt: de hele installatie verwerpt ---- */
installModus = true;
installFout = true;
handlers.install({ waitUntil: p => { klaar = p; } });
await assert.rejects(() => klaar, /installatie mislukt/, 'niet-ok antwoord breekt de install af');
installModus = false;
installFout = false;

/* ---- activate: andere caches weg, clients geclaimd ---- */
cacheStores.set('epc-oud', new Map());
handlers.activate({ waitUntil: p => { klaar = p; } });
await klaar;
assert.ok(!cacheStores.has('epc-oud'), 'oude cache verwijderd');
assert.ok(cacheStores.has(cacheNaam), 'eigen cache blijft');
assert.ok(geclaimd, 'clients.claim aangeroepen');

/* ---- fetch: niet-GET wordt genegeerd ---- */
let e = fetchEvent({ method: 'POST', url: 'https://app.test/x' });
handlers.fetch(e);
assert.ok(!e.respondWithAangeroepen, 'POST niet afgehandeld');

/* ---- fetch: versiecheck (sw.js met cache-buster) gaat langs de SW heen ---- */
e = fetchEvent({ method: 'GET', url: 'https://app.test/sw.js?t=123' });
handlers.fetch(e);
assert.ok(!e.respondWithAangeroepen, 'sw.js?t=... niet afgehandeld (§9.5)');
/* ...maar sw.js zónder query komt gewoon uit de cache */
e = fetchEvent({ method: 'GET', url: './sw.js' });
handlers.fetch(e);
assert.equal(await (await e.antwoord).text(), 'gecachet:./sw.js', 'sw.js zelf uit de cache');

/* ---- fetch: hit uit de eigen cache ---- */
e = fetchEvent({ method: 'GET', url: './index.html' });
handlers.fetch(e);
assert.equal(await (await e.antwoord).text(), 'gecachet:./index.html', 'cache-hit geserveerd');

/* ---- fetch: miss -> netwerk ok, same-origin -> bijgecachet ---- */
fetchAntwoord = new Response('vers', { status: 200 });
e = fetchEvent({ method: 'GET', url: 'https://app.test/nieuw.png' });
handlers.fetch(e);
assert.equal((await e.antwoord).status, 200, 'netwerkantwoord doorgegeven');
await new Promise(r => setTimeout(r, 10));
assert.ok(cacheStores.get(cacheNaam).has('https://app.test/nieuw.png'), 'same-origin bijgecachet');

/* ---- fetch: vreemde oorsprong wordt helemaal niet afgehandeld (§4) ---- */
e = fetchEvent({ method: 'GET', url: 'https://nominatim.openstreetmap.org/reverse' });
handlers.fetch(e);
assert.ok(!e.respondWithAangeroepen, 'cross-origin gaat rechtstreeks naar het netwerk');
e = fetchEvent({ method: 'GET', url: 'https://192.168.0.200:5006/' });
handlers.fetch(e);
assert.ok(!e.respondWithAangeroepen, 'NAS-oproep niet afgehandeld: echte fout blijft zichtbaar');

/* ---- fetch: miss -> netwerk 500 -> doorgegeven, niet bijgecachet ---- */
fetchAntwoord = new Response('kapot', { status: 500 });
e = fetchEvent({ method: 'GET', url: 'https://app.test/kapot' });
handlers.fetch(e);
assert.equal((await e.antwoord).status, 500, 'fout-status doorgegeven');
await new Promise(r => setTimeout(r, 10));
assert.ok(!cacheStores.get(cacheNaam).has('https://app.test/kapot'), '500 niet bijgecachet');

/* ---- fetch: offline + navigatie -> index.html uit eigen cache ---- */
fetchAntwoord = new Error('offline');
e = fetchEvent({ method: 'GET', url: 'https://app.test/ergens', mode: 'navigate' });
handlers.fetch(e);
assert.equal(await (await e.antwoord).text(), 'gecachet:./index.html', 'offline navigatie -> index');

/* ---- fetch: offline + geen navigatie -> Response.error() ---- */
e = fetchEvent({ method: 'GET', url: 'https://app.test/data.png' });
handlers.fetch(e);
assert.equal((await e.antwoord).type, 'error', 'offline asset -> netwerkfout');

console.log('test-sw: alles OK');
