'use strict';

/* ============================== pdfworker.js ==============================
   Web Worker: bouwt het dossier buiten de main thread. Krijgt {woning,
   fotos, versie, naam} binnen, meldt voortgang via postMessage en levert
   op het einde de dossier-zip af: <naam>.pdf + hoofdfoto.jpg + woning.json
   (§9.3). */

importScripts('maakpdf.js', 'maakzip.js');

self.onmessage = async e => {
  const { woning, fotos, versie, naam } = e.data;
  try {
    const pdf = self.bouwPdf(woning, fotos, {
      versie,
      voortgang: v => self.postMessage({ voortgang: v * 0.9 })
    });
    /* pdf + hoofdfoto + woning.json + alle foto's in fotos/ (§9.3) */
    const leden = self.dossierLeden(woning, fotos, new Uint8Array(await pdf.arrayBuffer()), naam || 'epc', versie, self.sorteerRamen);
    self.postMessage({ voortgang: 0.97 });
    self.postMessage({ klaar: self.bouwZip(leden) });
  } catch (fout) {
    self.postMessage({ fout: (fout && fout.message) || String(fout) });
  }
};
