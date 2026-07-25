'use strict';

/* ============================== db.js ==============================
   IndexedDB: openen, CRUD, blob-URL-cache en foutkanaal.
   Stores: 'woningen' (record zonder beeldbytes) en 'fotos'
   ({id, woningId, blob, breedte, hoogte, groep, volgorde, gemaakt}).
   Foto's die aan een element hangen (raam, kenplaat, kranen) hebben
   groep null en verschijnen niet in het dossier. */

const DB = (() => {
  const DB_NAAM = 'epc-db';
  const DB_VERSIE = 4;

  let db = null;
  let foutmelder = null;   /* door app.js gezet: krijgt de foutnaam bij elke mislukte write */
  let geheugen = null;     /* fallback als de DB niet opent: {woningen:Map, fotos:Map} */

  /* blob-URL-cache van de open woning: lui aangemaakt, gerevoked bij sluiten/pagehide */
  const urls = new Map();     /* fotoId -> objectURL */
  let geladen = new Map();    /* fotoId -> fotorecord van de open woning */

  function meldFout(e) {
    const naam = e && e.name ? e.name : String(e || 'Onbekende fout');
    if (foutmelder) foutmelder(naam);
    return naam;
  }

  function dbId() { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }

  /* ---------- openen ----------
     Records van vóór v3 zijn onbruikbaar: die databanken worden bij de upgrade
     leeggemaakt (clean start). Vanaf v3 blijven de gegevens bij elke upgrade
     staan — v3 → v4 voegt enkel de 'extra'-store toe (§9.4). */

  function open() {
    return new Promise((res, rej) => {
      let q;
      try { q = indexedDB.open(DB_NAAM, DB_VERSIE); } catch (e) { rej(e); return; }
      q.onupgradeneeded = e => {
        const d = q.result;
        if (d.objectStoreNames.contains('instellingen')) d.deleteObjectStore('instellingen');
        if (!d.objectStoreNames.contains('woningen')) d.createObjectStore('woningen', { keyPath: 'id' });
        const fotoStore = d.objectStoreNames.contains('fotos')
          ? q.transaction.objectStore('fotos')
          : d.createObjectStore('fotos', { keyPath: 'id' });
        if (!fotoStore.indexNames.contains('woningId')) fotoStore.createIndex('woningId', 'woningId');
        const extraStore = d.objectStoreNames.contains('extra')
          ? q.transaction.objectStore('extra')
          : d.createObjectStore('extra', { keyPath: 'id' });
        if (!extraStore.indexNames.contains('woningId')) extraStore.createIndex('woningId', 'woningId');
        if (e.oldVersion > 0 && e.oldVersion < 3) {
          q.transaction.objectStore('woningen').clear();
          fotoStore.clear();
          extraStore.clear();
        }
      };
      q.onsuccess = () => { db = q.result; db.onversionchange = () => db.close(); res(); };
      q.onerror = () => rej(q.error);
      q.onblocked = () => rej(new Error('DB geblokkeerd'));
    });
  }

  /* geen DB: alles in het geheugen zodat "Bewaar PDF" blijft werken (§6) */
  function startGeheugenmodus() {
    geheugen = { woningen: new Map(), fotos: new Map(), extra: new Map() };
  }

  /* ---------- transacties (geslaagd = tx.oncomplete, §6) ---------- */

  function transactie(stores, modus) {
    try { return db.transaction(stores, modus, { durability: 'strict' }); }
    catch (e) { return db.transaction(stores, modus); }
  }

  function schrijf(stores, fn) {
    if (geheugen) return Promise.resolve(fn(null, geheugen));
    return new Promise((res, rej) => {
      let t;
      try { t = transactie(stores, 'readwrite'); } catch (e) { meldFout(e); rej(e); return; }
      t.oncomplete = () => res();
      /* bij een request-fout is t.error hier vaak nog null: de echte fout zit op de request */
      t.onerror = e => { const fout = (e.target && e.target.error) || t.error; meldFout(fout); rej(fout); };
      t.onabort = () => { meldFout(t.error); rej(t.error); };
      try { fn(t, null); } catch (e) { try { t.abort(); } catch (x) { } meldFout(e); rej(e); }
    });
  }

  function lees(store, fn) {
    if (geheugen) return Promise.resolve(fn(null, geheugen));
    return new Promise((res, rej) => {
      const t = db.transaction(store, 'readonly');
      const r = fn(t.objectStore(store), null);
      t.oncomplete = () => res(r && 'result' in r ? r.result : undefined);
      t.onerror = e => rej((e.target && e.target.error) || t.error);
      t.onabort = () => rej(t.error);
    });
  }

  /* ---------- woningen ---------- */

  function alleWoningen() {
    if (geheugen) return Promise.resolve([...geheugen.woningen.values()]);
    return lees('woningen', s => s.getAll());
  }

  function getWoning(id) {
    if (geheugen) return Promise.resolve(geheugen.woningen.get(id) || null);
    return lees('woningen', s => s.get(id));
  }

  function putWoning(w) {
    return schrijf('woningen', (t, mem) => {
      if (mem) { mem.woningen.set(w.id, w); return; }
      t.objectStore('woningen').put(w);
    });
  }

  /* woning + alle bijhorende foto's en extra bestanden in één transactie (§6) */
  function verwijderWoningMetFotos(woningId) {
    return schrijf(['woningen', 'fotos', 'extra'], (t, mem) => {
      if (mem) {
        mem.woningen.delete(woningId);
        [...mem.fotos.values()].filter(f => f.woningId === woningId).forEach(f => mem.fotos.delete(f.id));
        [...mem.extra.values()].filter(x => x.woningId === woningId).forEach(x => mem.extra.delete(x.id));
        return;
      }
      t.objectStore('woningen').delete(woningId);
      ['fotos', 'extra'].forEach(naam => {
        const store = t.objectStore(naam);
        store.index('woningId').openKeyCursor(IDBKeyRange.only(woningId)).onsuccess = e => {
          const cur = e.target.result;
          if (!cur) return;
          store.delete(cur.primaryKey);
          cur.continue();
        };
      });
    });
  }

  /* ---------- foto's ---------- */

  function putFoto(rec) {
    geladen.set(rec.id, rec);
    return schrijf('fotos', (t, mem) => {
      if (mem) { mem.fotos.set(rec.id, rec); return; }
      t.objectStore('fotos').put(rec);
    }).catch(e => { geladen.delete(rec.id); throw e; });
  }

  function verwijderFoto(id) {
    geladen.delete(id);
    const url = urls.get(id);
    if (url) { URL.revokeObjectURL(url); urls.delete(id); }
    return schrijf('fotos', (t, mem) => {
      if (mem) { mem.fotos.delete(id); return; }
      t.objectStore('fotos').delete(id);
    });
  }

  function fotosVanWoning(woningId) {
    if (geheugen) return Promise.resolve([...geheugen.fotos.values()].filter(f => f.woningId === woningId));
    return lees('fotos', s => s.index('woningId').getAll(woningId));
  }

  function getFoto(id) {
    if (geheugen) return Promise.resolve(geheugen.fotos.get(id) || null);
    return lees('fotos', s => s.get(id));
  }

  /* alle foto's van een woning in het geheugen laden bij het openen */
  async function laadFotos(woningId) {
    revokeUrls();
    geladen = new Map();
    (await fotosVanWoning(woningId)).forEach(f => geladen.set(f.id, f));
    return geladen;
  }

  function fotoRecord(id) { return geladen.get(id) || null; }
  function geladenFotos() { return geladen; }

  /* objectURL lui aanmaken en cachen; nooit één per render (§5.3) */
  function fotoUrl(id) {
    if (!id) return null;
    if (urls.has(id)) return urls.get(id);
    const rec = geladen.get(id);
    if (!rec) return null;
    const url = URL.createObjectURL(rec.blob);
    urls.set(id, url);
    return url;
  }

  function revokeUrls() {
    urls.forEach(u => URL.revokeObjectURL(u));
    urls.clear();
  }

  function sluitWoning() {
    revokeUrls();
    geladen = new Map();
  }

  /* ---------- extra bestanden (§7.3/§9.3): {id, woningId, naam, blob, gemaakt} ---------- */

  function putExtra(rec) {
    return schrijf('extra', (t, mem) => {
      if (mem) { mem.extra.set(rec.id, rec); return; }
      t.objectStore('extra').put(rec);
    });
  }

  function verwijderExtra(id) {
    return schrijf('extra', (t, mem) => {
      if (mem) { mem.extra.delete(id); return; }
      t.objectStore('extra').delete(id);
    });
  }

  function extraVanWoning(woningId) {
    if (geheugen) return Promise.resolve([...geheugen.extra.values()].filter(x => x.woningId === woningId));
    return lees('extra', s => s.index('woningId').getAll(woningId));
  }

  /* ---------- weesfotosweep (§5.1: op idle, faalt stil) ---------- */

  async function weesfotoSweep() {
    try {
      if (geheugen) return;
      const woningen = await alleWoningen();
      const perId = new Map(woningen.map(w => [w.id, w]));
      const alle = await lees('fotos', s => s.getAll());
      const dood = [];
      alle.forEach(f => {
        const w = perId.get(f.woningId);
        if (!w) { dood.push(f.id); return; }
        const ruimteIds = new Set((w.ruimtes || []).map(r => r.id));
        const verwezen = new Set();
        (w.ramen || []).forEach(r => { if (r.fotoId) verwezen.add(r.fotoId); });
        (((w.energie || {}).opwekkers) || []).forEach(o => {
          (o.fotoIds || []).forEach(id => verwezen.add(id));
          if (o.fotoKraanId) verwezen.add(o.fotoKraanId);
        });
        if (w.algemeen && w.algemeen.hoofdFotoId) verwezen.add(w.algemeen.hoofdFotoId);
        const inDossier = f.groep === 'gevels' || f.groep === 'algemeen' || ruimteIds.has(f.groep);
        if (!inDossier && !verwezen.has(f.id)) dood.push(f.id);
      });
      for (const id of dood) await verwijderFoto(id);
      /* extra bestanden van verdwenen woningen ook opruimen */
      const alleExtra = await lees('extra', s => s.getAll());
      for (const x of alleExtra) {
        if (!perId.has(x.woningId)) await verwijderExtra(x.id);
      }
    } catch (e) { /* faalt stil */ }
  }

  return {
    open, startGeheugenmodus,
    inGeheugen: () => !!geheugen,
    zetFoutmelder: fn => { foutmelder = fn; },
    alleWoningen, getWoning, putWoning, verwijderWoningMetFotos,
    putFoto, getFoto, verwijderFoto, fotosVanWoning, laadFotos, fotoRecord, geladenFotos,
    putExtra, verwijderExtra, extraVanWoning,
    fotoUrl, revokeUrls, sluitWoning, weesfotoSweep,
    nieuwId: dbId
  };
})();
