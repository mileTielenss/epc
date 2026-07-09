/* pdfworker.js in Node: worker-omgeving nagebootst met stubs (SPEC.md §11). */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { strict as assert } from 'node:assert';

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = join(HIER, '..');
const require = createRequire(import.meta.url);

/* worker-globalen: importScripts laadt maakpdf.js op dezelfde globalThis */
const berichten = [];
globalThis.self = globalThis;
globalThis.postMessage = m => berichten.push(m);
globalThis.importScripts = naam => { require(join(REPO, naam)); };

require(join(REPO, 'pdfworker.js'));
assert.equal(typeof self.onmessage, 'function', 'worker registreert onmessage');

const rgb = new Uint8Array(readFileSync(join(HIER, 'data', 'test-rgb.jpg')));
const prog = new Uint8Array(readFileSync(join(HIER, 'data', 'test-progressive.jpg')));
const woning = {
  id: 'w', algemeen: { adres: 'Workerstraat 1', datum: '2026-01-01', notities: '', hoofdFotoId: null },
  ruimtes: [{ id: 'x', naam: 'Living', vent: 'geen', ventBeschrijving: '', opm: '', afm: null }],
  ramen: [], energie: { opwekkers: [], pvPanelen: [], zonneboiler: 'nee', zonneboilerM2: '' }
};

/* geslaagde bouw: voortgang + klaar */
self.onmessage({ data: { woning, fotos: new Map([['g', { bytes: rgb, breedte: 640, hoogte: 480, groep: 'gevels', volgorde: 1 }]]), versie: 'epc-vW' } });
assert.ok(berichten.some(m => m.voortgang !== undefined), 'voortgang gemeld');
const klaar = berichten.find(m => m.klaar);
assert.ok(klaar && klaar.klaar.size > 1000, 'klaar met Blob');

/* fout: progressive JPEG -> foutbericht, geen crash */
berichten.length = 0;
self.onmessage({ data: { woning, fotos: new Map([['p', { bytes: prog, breedte: 640, hoogte: 480, groep: 'gevels', volgorde: 1 }]]), versie: 'epc-vW' } });
const foutB = berichten.find(m => m.fout);
assert.ok(foutB && /Progressive/i.test(foutB.fout), 'fout gemeld bij progressive JPEG');

/* fout zonder message-eigenschap (String-tak) */
berichten.length = 0;
const echteBouw = self.bouwPdf;
self.bouwPdf = () => { throw 'kale-string-fout'; };
self.onmessage({ data: { woning, fotos: new Map(), versie: '' } });
assert.equal(berichten.find(m => m.fout).fout, 'kale-string-fout', 'string-fout doorgegeven');
self.bouwPdf = echteBouw;

console.log('test-pdfworker: alles OK');
