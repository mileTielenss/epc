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

  /* ---------- woning.json: alle gegevens, machineleesbaar (§9.3) ----------
     sorteer = de gedeelde sorteerfunctie uit maakpdf.js, zodat de #nrs in de
     json exact die van de lijst en de PDF zijn; bestandVan koppelt fotoId's
     aan hun bestand in fotos/. */

  const FUNCTIE_LABELS = { radiatoren: 'radiatoren', vloer: 'vloerverwarming', sww: 'sanitair warm water' };
  const PV_LABELS = { plat: 'plat dak', voor: 'voor', achter: 'achter', links: 'links', rechts: 'rechts', '': '' };

  function woningExport(woning, versie, sorteer, fotos, bestandVan) {
    const ruimtes = woning.ruimtes || [];
    const naamVan = id => { const r = ruimtes.find(x => x.id === id); return r ? r.naam : null; };
    const bestand = id => (bestandVan && id && bestandVan.has(id)) ? bestandVan.get(id) : null;
    const E = woning.energie || { opwekkers: [], pvPanelen: [], zonneboiler: 'nee', zonneboilerM2: '' };

    const ramen = sorteer(woning.ramen || []).map((r, i) => ({
      nr: i + 1,
      element: r.element,
      gevel: r.gevel,
      ruimte: naamVan(r.ruimteId),
      aantal: r.aantal || 1,
      breedteM: r.b,
      hoogteM: r.h,
      oppervlakteM2: Math.round(r.b * r.h * (r.aantal || 1) * 10000) / 10000,
      beglazing: r.beglazing,   /* null bij deuren */
      kader: r.kader,
      rolluik: !!r.rolluik,
      foto: bestand(r.fotoId)
    }));

    /* fotolijst voor de import: bestand, groep (label), volgorde, maten */
    const fotoLijst = [];
    if (fotos && bestandVan) fotos.forEach((f, id) => {
      let groep = null;
      if (f.groep === 'gevels') groep = 'Gevels';
      else if (f.groep === 'algemeen') groep = 'Algemeen';
      else if (f.groep) groep = naamVan(f.groep);
      fotoLijst.push({
        bestand: bestandVan.get(id),
        groep,
        volgorde: f.volgorde || 0,
        breedte: f.breedte, hoogte: f.hoogte,
        hoofdfoto: !!(woning.algemeen && woning.algemeen.hoofdFotoId === id)
      });
    });

    return {
      formaat: 'epc-plaatsbezoek-dossier',
      appVersie: versie || null,
      geexporteerd: new Date().toISOString(),
      woning: {
        adres: (woning.algemeen && woning.algemeen.adres) || '',
        datumPlaatsbezoek: (woning.algemeen && woning.algemeen.datum) || '',
        notities: (woning.algemeen && woning.algemeen.notities) || '',
        ruimtes: ruimtes.map(r => ({
          naam: r.naam,
          ventilatie: r.vent,
          ventilatieBeschrijving: r.vent === 'ander' ? (r.ventBeschrijving || '') : null,
          opmerking: r.opm || null,
          afmetingen: r.afm ? {
            breedteM: r.afm.b, diepteM: r.afm.d, hoogteM: r.afm.h,
            volumeM3: Math.round(r.afm.b * r.afm.d * r.afm.h * 1000) / 1000
          } : null
        })),
        ramenEnDeuren: ramen,
        totaalRamenEnDeuren: {
          aantal: ramen.reduce((a, r) => a + r.aantal, 0),
          oppervlakteM2: Math.round(ramen.reduce((a, r) => a + r.oppervlakteM2, 0) * 10000) / 10000
        },
        energie: {
          opwekkers: (E.opwekkers || []).map(o => ({
            type: o.type,
            ruimte: naamVan(o.ruimteId),
            functies: (o.functie || []).map(f => FUNCTIE_LABELS[f] || f),
            beschrijving: o.beschrijving || '',
            kenplaatFoto: bestand(o.fotoId),
            kranenFoto: bestand(o.fotoKraanId)
          })),
          zonnepanelen: (E.pvPanelen || []).map(p => ({
            orientatie: PV_LABELS[p.orientatie] ?? p.orientatie,
            wp: Math.round(Number(String(p.wp).replace(',', '.'))) || 0
          })),
          zonneboiler: {
            aanwezig: E.zonneboiler === 'ja',
            collectorM2: E.zonneboiler === 'ja' && E.zonneboilerM2
              ? Number(String(E.zonneboilerM2).replace(',', '.')) || null : null
          }
        },
        fotos: fotoLijst
      }
    };
  }

  /* ---------- alle leden van de dossier-zip (§9.3) ---------- */

  function dossierLeden(woning, fotos, pdfBytes, basisnaam, versie, sorteer) {
    const leden = [{ naam: basisnaam + '.pdf', bytes: pdfBytes }];

    const bestandVan = new Map();
    let n = 0;
    if (fotos) fotos.forEach((f, id) => bestandVan.set(id, `fotos/${String(++n).padStart(4, '0')}.jpg`));

    /* hoofdfoto ook als apart, direct grijpbaar lid */
    const hoofdId = woning.algemeen && woning.algemeen.hoofdFotoId;
    if (hoofdId && fotos && fotos.has(hoofdId)) {
      leden.push({ naam: 'hoofdfoto.jpg', bytes: fotos.get(hoofdId).bytes });
    }

    const json = JSON.stringify(woningExport(woning, versie, sorteer, fotos, bestandVan), null, 2);
    leden.push({ naam: 'woning.json', bytes: new TextEncoder().encode(json) });

    if (fotos) fotos.forEach((f, id) => leden.push({ naam: bestandVan.get(id), bytes: f.bytes }));
    return leden;
  }

  root.bouwZip = bouwZip;
  root.leesZip = leesZip;
  root.woningExport = woningExport;
  root.dossierLeden = dossierLeden;
  root.MAAKZIP = { bouwZip, leesZip, woningExport, dossierLeden, crc32 };

})(typeof self !== 'undefined' ? self : globalThis);
