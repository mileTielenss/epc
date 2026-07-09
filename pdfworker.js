'use strict';

/* ============================== pdfworker.js ==============================
   Web Worker: bouwt de PDF buiten de main thread. Krijgt {woning, fotos,
   versie} binnen, meldt voortgang via postMessage en levert op het einde
   de Blob af. */

importScripts('maakpdf.js');

self.onmessage = e => {
  const { woning, fotos, versie } = e.data;
  try {
    const blob = self.bouwPdf(woning, fotos, {
      versie,
      voortgang: v => self.postMessage({ voortgang: v })
    });
    self.postMessage({ klaar: blob });
  } catch (fout) {
    self.postMessage({ fout: (fout && fout.message) || String(fout) });
  }
};
