'use strict';

/* ============================== db.js ==============================
   IndexedDB: openen, migratie v1→v2, CRUD, blob-URL-cache en foutkanaal.
   Stores: 'woningen' (record zonder beeldbytes) en 'fotos'
   ({id, woningId, blob, breedte, hoogte, groep, volgorde, gemaakt}).
   Foto's die aan een element hangen (raam, kenplaat, kranen) hebben
   groep null en verschijnen niet in het dossier. */

const DB = (() => {
  const DB_NAAM = 'epc-db';
  const DB_VERSIE = 2;

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

  /* ---------- JPEG-header lezen: afmetingen uit de SOF-marker ---------- */

  function jpegAfmetingen(bytes) {
    try {
      if (bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null;
      let i = 2;
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xFF) { i++; continue; }
        const m = bytes[i + 1];
        if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
          return { hoogte: (bytes[i + 5] << 8) | bytes[i + 6], breedte: (bytes[i + 7] << 8) | bytes[i + 8] };
        }
        if (m === 0xD8 || (m >= 0xD0 && m <= 0xD9)) { i += 2; continue; }
        i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
      }
    } catch (e) { /* kapotte header: val terug op 4:3 */ }
    return null;
  }

  function dataUrlNaarBytes(u) {
    const bin = atob(String(u).slice(String(u).indexOf(',') + 1));
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  /* ---------- migratie v1 → v2 (§5.2, eenmalig) ----------
     Zodra het toestel gemigreerd is: deze functie schrappen en DB_VERSIE
     naar 3 zonder upgradepad. */

  function migreerWoning(oud, fotoStore) {
    const problemen = [];
    const w = { ...oud };

    /* ruimtes krijgen ids; naam -> id voor de verwijzingen */
    const naamNaarId = new Map();
    w.ruimtes = (Array.isArray(oud.ruimtes) ? oud.ruimtes : []).map(r => {
      const id = dbId();
      naamNaarId.set(String(r.naam || ''), id);
      return { id, naam: String(r.naam || 'Ruimte'), vent: r.vent || 'geen', ventBeschrijving: r.ventBeschrijving || '', opm: r.opm || '', afm: r.afm || null };
    });

    function ruimteId(naam, wat) {
      if (!naam) return null;
      if (naamNaarId.has(naam)) return naamNaarId.get(naam);
      problemen.push(`migratie: ${wat} verwees naar onbekende ruimte "${naam}"`);
      return null;
    }

    function schrijfFoto(dataUrl, groep, volgorde) {
      if (!dataUrl) return null;
      let bytes;
      try { bytes = dataUrlNaarBytes(dataUrl); } catch (e) { problemen.push('migratie: onleesbare foto overgeslagen'); return null; }
      const afm = jpegAfmetingen(bytes) || { breedte: 1600, hoogte: 1200 };
      const rec = {
        id: dbId(), woningId: w.id, blob: new Blob([bytes], { type: 'image/jpeg' }),
        breedte: afm.breedte, hoogte: afm.hoogte, groep, volgorde, gemaakt: oud.gewijzigd || oud.gemaakt || ''
      };
      fotoStore.put(rec);
      return rec.id;
    }

    /* fotodossier -> fotostore; hoofdfoto (zelfde dataURL) hergebruikt het gevels-record */
    let hoofdFotoId = null;
    const hoofdDataUrl = oud.algemeen && oud.algemeen.foto ? oud.algemeen.foto : null;
    (Array.isArray(oud.fotodossier) ? [...oud.fotodossier].sort((a, b) => (a.nr || 0) - (b.nr || 0)) : []).forEach((f, i) => {
      let groep = 'gevels';
      if (f.ruimte === '__algemeen') groep = 'algemeen';
      else if (f.ruimte) {
        const rid = ruimteId(f.ruimte, 'dossierfoto');
        groep = rid || 'gevels';
      }
      const id = schrijfFoto(f.foto, groep, i + 1);
      if (id && hoofdDataUrl && f.foto === hoofdDataUrl && groep === 'gevels' && !hoofdFotoId) hoofdFotoId = id;
    });
    if (hoofdDataUrl && !hoofdFotoId) hoofdFotoId = schrijfFoto(hoofdDataUrl, 'gevels', 0);

    w.algemeen = {
      adres: (oud.algemeen && oud.algemeen.adres) || '',
      datum: (oud.algemeen && oud.algemeen.datum) || '',
      notities: (oud.algemeen && oud.algemeen.notities) || '',
      hoofdFotoId
    };

    /* ramen: nr-volgorde wordt aanmaakvolgorde, naam wordt ruimteId, foto wordt fotoId */
    w.ramen = (Array.isArray(oud.ramen) ? [...oud.ramen].sort((a, b) => (a.nr || 0) - (b.nr || 0)) : []).map(r => ({
      id: dbId(), ruimteId: ruimteId(r.ruimte, `raam #${r.nr || '?'}`),
      element: r.element, gevel: r.gevel, b: r.b, h: r.h, aantal: r.aantal || 1,
      beglazing: r.beglazing, kader: r.kader, rolluik: !!r.rolluik,
      fotoId: schrijfFoto(r.foto, null, 0)
    }));

    const oudE = oud.energie || {};
    w.energie = {
      opwekkers: (Array.isArray(oudE.opwekkers) ? [...oudE.opwekkers].sort((a, b) => (a.nr || 0) - (b.nr || 0)) : []).map(o => ({
        id: dbId(), type: o.type, ruimteId: ruimteId(o.ruimte, `opwekker #${o.nr || '?'}`),
        functie: Array.isArray(o.functie) ? o.functie : [],
        beschrijving: o.beschrijving || '',
        fotoId: schrijfFoto(o.foto, null, 0),
        fotoKraanId: schrijfFoto(o.fotoKraan, null, 0)
      })),
      pvPanelen: (Array.isArray(oudE.pvPanelen) ? oudE.pvPanelen : []).map(p => ({ id: dbId(), orientatie: p.orientatie || '', wp: String(p.wp || '') })),
      zonneboiler: oudE.zonneboiler === 'ja' ? 'ja' : 'nee',
      zonneboilerM2: oudE.zonneboilerM2 || ''
    };

    w.pdfBewaardOp = oud.status === 'afgewerkt' ? (oud.gewijzigd || null) : null;
    w.problemen = problemen;
    delete w.status;
    delete w.fotodossier;
    delete w.teller;
    delete w.tellerOpwek;
    delete w.tellerDossier;
    return w;
  }

  /* ---------- openen ---------- */

  function open() {
    return new Promise((res, rej) => {
      let q;
      try { q = indexedDB.open(DB_NAAM, DB_VERSIE); } catch (e) { rej(e); return; }
      q.onupgradeneeded = e => {
        const d = q.result;
        const txu = q.transaction;
        if (!d.objectStoreNames.contains('woningen')) d.createObjectStore('woningen', { keyPath: 'id' });
        const fotoStore = d.objectStoreNames.contains('fotos')
          ? txu.objectStore('fotos')
          : d.createObjectStore('fotos', { keyPath: 'id' });
        if (!fotoStore.indexNames.contains('woningId')) fotoStore.createIndex('woningId', 'woningId');
        if (d.objectStoreNames.contains('instellingen')) d.deleteObjectStore('instellingen');
        if (e.oldVersion === 1) {
          const ws = txu.objectStore('woningen');
          ws.openCursor().onsuccess = ev => {
            const cur = ev.target.result;
            if (!cur) return;
            try { cur.update(migreerWoning(cur.value, fotoStore)); }
            catch (fout) { /* onmigreerbaar record: laten staan, nooit wissen */ }
            cur.continue();
          };
        }
      };
      q.onsuccess = () => { db = q.result; db.onversionchange = () => db.close(); res(); };
      q.onerror = () => rej(q.error);
      q.onblocked = () => rej(new Error('DB geblokkeerd'));
    });
  }

  /* geen DB: alles in het geheugen zodat "Bewaar PDF" blijft werken (§6) */
  function startGeheugenmodus() {
    geheugen = { woningen: new Map(), fotos: new Map() };
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
      t.onerror = () => { meldFout(t.error); rej(t.error); };
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
      t.onerror = () => rej(t.error);
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

  /* woning + alle bijhorende foto's in één transactie (§6) */
  function verwijderWoningMetFotos(woningId) {
    return schrijf(['woningen', 'fotos'], (t, mem) => {
      if (mem) {
        mem.woningen.delete(woningId);
        [...mem.fotos.values()].filter(f => f.woningId === woningId).forEach(f => mem.fotos.delete(f.id));
        return;
      }
      t.objectStore('woningen').delete(woningId);
      const idx = t.objectStore('fotos').index('woningId');
      idx.openKeyCursor(IDBKeyRange.only(woningId)).onsuccess = e => {
        const cur = e.target.result;
        if (!cur) return;
        t.objectStore('fotos').delete(cur.primaryKey);
        cur.continue();
      };
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
          if (o.fotoId) verwezen.add(o.fotoId);
          if (o.fotoKraanId) verwezen.add(o.fotoKraanId);
        });
        if (w.algemeen && w.algemeen.hoofdFotoId) verwezen.add(w.algemeen.hoofdFotoId);
        const inDossier = f.groep === 'gevels' || f.groep === 'algemeen' || ruimteIds.has(f.groep);
        if (!inDossier && !verwezen.has(f.id)) dood.push(f.id);
      });
      for (const id of dood) await verwijderFoto(id);
    } catch (e) { /* faalt stil */ }
  }

  return {
    open, startGeheugenmodus,
    inGeheugen: () => !!geheugen,
    zetFoutmelder: fn => { foutmelder = fn; },
    alleWoningen, getWoning, putWoning, verwijderWoningMetFotos,
    putFoto, getFoto, verwijderFoto, fotosVanWoning, laadFotos, fotoRecord, geladenFotos,
    fotoUrl, revokeUrls, sluitWoning, weesfotoSweep,
    nieuwId: dbId
  };
})();
