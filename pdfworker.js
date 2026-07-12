'use strict';

/* ============================== pdfworker.js ==============================
   Web Worker: bouwt het dossier buiten de main thread, strikt json-first
   (§9.3): het interne woningobject → woning.json → PDF uit die json →
   zip(pdf + hoofdfoto + woning.json + fotos/). Krijgt {woning, fotos,
   versie, naam} binnen, meldt voortgang via postMessage. */

importScripts('maakpdf.js', 'maakzip.js');

self.onmessage = async e => {
  const { woning, fotos, versie, naam } = e.data;
  try {
    /* 1. interne woning → paden toekennen → woning.json (de enige bron) */
    const bestandVan = new Map();
    let n = 0;
    fotos.forEach((f, id) => bestandVan.set(id, `fotos/${String(++n).padStart(4, '0')}.jpg`));
    const dossier = self.woningExport(woning, self.sorteerRamen, fotos, bestandVan);

    /* 2. foto's op pad grijpbaar maken en de PDF VOLLEDIG uit de json bouwen */
    const fotosOpPad = new Map();
    fotos.forEach((f, id) => fotosOpPad.set(bestandVan.get(id), { bytes: f.bytes }));
    const pdf = self.bouwPdf(dossier.woning, fotosOpPad, {
      versie,
      voortgang: v => self.postMessage({ voortgang: v * 0.9 })
    });

    /* 3. zip: pdf + hoofdfoto + woning.json + alle foto's in fotos/ */
    const jsonBytes = new TextEncoder().encode(JSON.stringify(dossier, null, 2));
    const leden = [{ naam: (naam || 'epc') + '.pdf', bytes: new Uint8Array(await pdf.arrayBuffer()) }];
    const hoofd = dossier.woning.hoofdfoto;
    if (hoofd && fotosOpPad.has(hoofd)) leden.push({ naam: 'hoofdfoto.jpg', bytes: fotosOpPad.get(hoofd).bytes });
    leden.push({ naam: 'woning.json', bytes: jsonBytes });
    fotos.forEach((f, id) => leden.push({ naam: bestandVan.get(id), bytes: f.bytes }));

    self.postMessage({ voortgang: 0.97 });
    self.postMessage({ klaar: self.bouwZip(leden) });
  } catch (fout) {
    self.postMessage({ fout: (fout && fout.message) || String(fout) });
  }
};
