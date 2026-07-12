'use strict';

/* ============================== maakzip.js ==============================
   Zip-schrijver zonder dependencies (store-methode + CRC-32, geen
   compressie: PDF en JPEG zijn al gecomprimeerd) en de machineleesbare
   export voor woning.json — geen foto-info, wel alle afmetingen en
   keuzes, om de VEKA-invoer later te automatiseren. Puur: draait in de
   worker én los in Node (unit-tests). */

(function (root) {

  /* ---------- CRC-32 (standaard polynoom 0xEDB88320) ---------- */

  const CRC_TABEL = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABEL[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ---------- zip bouwen: items = [{naam, bytes:Uint8Array}] ---------- */

  function dosTijd(d) {
    return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF;
  }
  function dosDatum(d) {
    return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
  }

  function bouwZip(items) {
    const nu = new Date();
    const enc = new TextEncoder();
    const chunks = [];
    const centraal = [];
    let offset = 0;

    const u16 = n => new Uint8Array([n & 0xFF, (n >> 8) & 0xFF]);
    const u32 = n => new Uint8Array([n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF, (n >>> 24) & 0xFF]);
    const voeg = (...delen) => delen.forEach(d => { chunks.push(d); offset += d.length; });

    items.forEach(item => {
      const naam = enc.encode(item.naam);
      const data = item.bytes;
      const crc = crc32(data);
      const kopStart = offset;
      /* local file header: versie 20, vlag 0x0800 (UTF-8-namen), methode 0 (store) */
      voeg(
        u32(0x04034B50), u16(20), u16(0x0800), u16(0),
        u16(dosTijd(nu)), u16(dosDatum(nu)),
        u32(crc), u32(data.length), u32(data.length),
        u16(naam.length), u16(0), naam, data
      );
      centraal.push({ naam, crc, lengte: data.length, kopStart });
    });

    const cdStart = offset;
    centraal.forEach(c => {
      voeg(
        u32(0x02014B50), u16(20), u16(20), u16(0x0800), u16(0),
        u16(dosTijd(nu)), u16(dosDatum(nu)),
        u32(c.crc), u32(c.lengte), u32(c.lengte),
        u16(c.naam.length), u16(0), u16(0), u16(0), u16(0),
        u32(0), u32(c.kopStart), c.naam
      );
    });
    const cdLengte = offset - cdStart;
    voeg(
      u32(0x06054B50), u16(0), u16(0),
      u16(items.length), u16(items.length),
      u32(cdLengte), u32(cdStart), u16(0)
    );
    return new Blob(chunks, { type: 'application/zip' });
  }

  /* ---------- zip lezen (enkel store-leden: onze eigen dossiers, §9.4) ---------- */

  function leesZip(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const dec = new TextDecoder();
    const leden = [];
    let p = 0;
    while (p + 4 <= bytes.length && dv.getUint32(p, true) === 0x04034B50) {
      const methode = dv.getUint16(p + 8, true);
      const lengte = dv.getUint32(p + 18, true);
      const naamLen = dv.getUint16(p + 26, true);
      const extraLen = dv.getUint16(p + 28, true);
      const naam = dec.decode(bytes.subarray(p + 30, p + 30 + naamLen));
      if (methode !== 0) throw new Error('gecomprimeerd lid: geen dossier van deze app');
      const start = p + 30 + naamLen + extraLen;
      leden.push({ naam, bytes: bytes.subarray(start, start + lengte) });
      p = start + lengte;
    }
    if (!leden.length) throw new Error('geen zip');
    return leden;
  }

  /* ---------- woning.json: genest, zonder afgeleide waarden of ruis (§9.3.1) ----------
     sorteer = de gedeelde sorteerfunctie uit maakpdf.js (elementen per ruimte in
     dezelfde volgorde als de PDF); bestandVan koppelt fotoId's aan hun bestand
     in fotos/. Optionele velden ontbreken gewoon i.p.v. op null te staan. */

  const FUNCTIE_LABELS = { radiatoren: 'radiatoren', vloer: 'vloerverwarming', sww: 'sanitair warm water' };
  const PV_LABELS = { plat: 'plat dak', voor: 'voor', achter: 'achter', links: 'links', rechts: 'rechts' };

  function isRuimteToestel(o) { return o.type === 'airco' || o.type === 'kachel' || o.type === 'ruimte-andere'; }

  function woningExport(woning, sorteer, fotos, bestandVan) {
    const A = woning.algemeen || {};
    const ruimtes = woning.ruimtes || [];
    const E = woning.energie || { opwekkers: [], pvPanelen: [], zonneboiler: 'nee', zonneboilerM2: '' };
    const bestand = id => (bestandVan && id && bestandVan.has(id)) ? bestandVan.get(id) : undefined;

    /* dossierfoto's van één groep, op volgorde, als bestandspaden */
    function fotosVanGroep(groep) {
      if (!fotos || !bestandVan) return [];
      const lijst = [];
      fotos.forEach((f, id) => { if (f.groep === groep) lijst.push({ pad: bestandVan.get(id), v: f.volgorde || 0 }); });
      return lijst.sort((a, c) => a.v - c.v).map(x => x.pad);
    }

    function elementObj(r) {
      const o = { type: r.element, gevel: r.gevel, breedteM: r.b, hoogteM: r.h, aantal: r.aantal || 1, kader: r.kader, rolluik: !!r.rolluik };
      if (r.element !== 'deur' && r.beglazing) o.beglazing = r.beglazing;
      const f = bestand(r.fotoId); if (f) o.foto = f;
      return o;
    }

    function ruimteObj(r) {
      const o = { naam: r.naam };
      if (r.vent && r.vent !== 'geen') {
        o.ventilatie = r.vent;
        if (r.vent === 'ander' && r.ventBeschrijving) o.ventilatieBeschrijving = r.ventBeschrijving;
      }
      if (r.opm) o.opmerking = r.opm;
      if (r.afm) o.afmetingen = { breedteM: r.afm.b, diepteM: r.afm.d, hoogteM: r.afm.h };
      const els = sorteer((woning.ramen || []).filter(x => x.ruimteId === r.id)).map(elementObj);
      if (els.length) o.elementen = els;
      const toestellen = (E.opwekkers || []).filter(x => isRuimteToestel(x) && x.ruimteId === r.id).map(x => {
        const t = { type: x.type };
        if (x.beschrijving) t.beschrijving = x.beschrijving;
        const kf = bestand(x.fotoId); if (kf) t.kenplaatFoto = kf;
        return t;
      });
      if (toestellen.length) o.toestellen = toestellen;
      const fs = fotosVanGroep(r.id);
      if (fs.length) o.fotos = fs;
      return o;
    }

    /* Gevels en Algemeen zijn gewone ruimtes met enkel foto's (§9.3.1) */
    const ruimteLijst = [];
    const gevels = fotosVanGroep('gevels');
    if (gevels.length) ruimteLijst.push({ naam: 'Gevels', fotos: gevels });
    ruimtes.forEach(r => ruimteLijst.push(ruimteObj(r)));
    const algemeen = fotosVanGroep('algemeen');
    if (algemeen.length) ruimteLijst.push({ naam: 'Algemeen', fotos: algemeen });

    const w = { adres: A.adres || '', datumPlaatsbezoek: A.datum || '' };
    if (A.notities) w.notities = A.notities;
    const hoofd = bestand(A.hoofdFotoId); if (hoofd) w.hoofdfoto = hoofd;
    w.ruimtes = ruimteLijst;

    /* energie: enkel de centrale opwekkers (ruimtetoestellen staan bij hun ruimte) */
    const energie = {};
    const centrale = (E.opwekkers || []).filter(o => !isRuimteToestel(o)).map(o => {
      const x = { type: o.type };
      if ((o.functie || []).length) x.functies = o.functie.map(f => FUNCTIE_LABELS[f] || f);
      if (o.beschrijving) x.beschrijving = o.beschrijving;
      const kf = bestand(o.fotoId); if (kf) x.kenplaatFoto = kf;
      const rf = bestand(o.fotoKraanId); if (rf) x.kranenFoto = rf;
      return x;
    });
    if (centrale.length) energie.opwekkers = centrale;
    const pv = (E.pvPanelen || []).map(p => {
      const x = { wp: Math.round(Number(String(p.wp).replace(',', '.'))) || 0 };
      if (PV_LABELS[p.orientatie]) x.orientatie = PV_LABELS[p.orientatie];
      return x;
    });
    if (pv.length) energie.zonnepanelen = pv;
    if (E.zonneboiler === 'ja') {
      energie.zonneboiler = {};
      const m2 = E.zonneboilerM2 ? Number(String(E.zonneboilerM2).replace(',', '.')) : 0;
      if (m2) energie.zonneboiler.collectorM2 = m2;
    }
    if (Object.keys(energie).length) w.energie = energie;

    return { formaat: 'epc-plaatsbezoek-dossier', geexporteerd: new Date().toISOString(), woning: w };
  }

  /* de zip zelf (pdf + hoofdfoto + woning.json + fotos/) wordt in pdfworker.js
     samengesteld, strikt json-first: woningExport → bouwPdf(json) → bouwZip */

  root.bouwZip = bouwZip;
  root.leesZip = leesZip;
  root.woningExport = woningExport;
  root.MAAKZIP = { bouwZip, leesZip, woningExport, crc32 };

})(typeof self !== 'undefined' ? self : globalThis);
