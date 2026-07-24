/* Unit-tests voor maakpdf.js in Node, zonder browser (SPEC.md §11).
   Draaien: node unittest-maakpdf.mjs  (of via dekking.mjs voor het rapport) */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { strict as assert } from 'node:assert';

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = join(HIER, '..');
const DATA = join(HIER, 'data');
const UIT = join(HIER, 'uitvoer');
mkdirSync(UIT, { recursive: true });

await import(join(REPO, 'maakpdf.js'));
await import(join(REPO, 'maakzip.js'));
const M = globalThis.MAAKPDF;
const MZ = globalThis.MAAKZIP;
assert.ok(M && typeof M.bouwPdf === 'function', 'maakpdf.js exporteert MAAKPDF.bouwPdf');

/* json-first: intern woningobject → woning.json → PDF uit die json (§9.3),
   net zoals pdfworker.js het doet */
function pdfViaJson(woning, fotosById, opts) {
  const bestandVan = new Map();
  let n = 0;
  if (fotosById) fotosById.forEach((f, id) => bestandVan.set(id, `fotos/${String(++n).padStart(4, '0')}.jpg`));
  const dossier = MZ.woningExport(woning, globalThis.sorteerRamen, fotosById, bestandVan);
  const fotosByPath = new Map();
  if (fotosById) fotosById.forEach((f, id) => fotosByPath.set(bestandVan.get(id), { bytes: f.bytes }));
  return { blob: M.bouwPdf(dossier.woning, fotosByPath, opts), dossier };
}

/* ---- AFM-waarden (SPEC §11) ---- */
const H = M.breedtes.helvetica, HB = M.breedtes.helveticaVet;
assert.equal(H[32], 278, 'Helvetica spatie 278');
assert.equal(H['A'.charCodeAt(0)], 667, 'Helvetica A 667');
assert.equal(H['i'.charCodeAt(0)], 222, 'Helvetica i 222');
assert.equal(HB[32], 278, 'Helvetica-Bold spatie 278');
assert.equal(HB['A'.charCodeAt(0)], 722, 'Helvetica-Bold A 722');
/* extra ijkpunten */
assert.equal(H[0x80], 556, 'Helvetica euro (0x80) 556');
assert.equal(H[0x96], 556, 'Helvetica en-dash (0x96) 556');
assert.equal(H[0xB7], 278, 'Helvetica middendot (0xB7) 278');
assert.equal(Math.round(M.tekstBreedte('Ai', 10, false) * 100) / 100, (667 + 222) / 100, 'tekstBreedte telt op');
assert.ok(M.tekstBreedte('é²', 8, true) > 0, 'vet + hoge codes meetbaar');

/* ---- CP1252-encoding ---- */
assert.equal(M.pdfStr('€'), '\x80', 'euro -> 0x80');
assert.equal(M.pdfStr('’'), '\x92', 'rechter apostrof -> 0x92');
assert.equal(M.pdfStr(' '), ' ', 'NBSP -> spatie');
assert.equal(M.pdfStr('é'), '\xE9', '0xA1-0xFF rechtstreeks');
assert.equal(M.pdfStr('中'), '?', 'onbekend teken -> ?');
assert.equal(M.pdfStr('(a)\\'), '\\(a\\)\\\\', 'haakjes en backslash ge-escaped');

/* ---- pdfWrap ---- */
assert.deepEqual(M.pdfWrap('', 8, false, 100), [''], 'lege string -> één lege regel');
assert.ok(M.pdfWrap('een redelijk lange zin die zeker moet afbreken op woordgrenzen', 10, false, 80).length > 2, 'wrap breekt af');
assert.equal(M.pdfWrap('supercalifragilisticexpialidocious', 10, false, 20).length, 1, 'te lang woord blijft één regel');

/* ---- JPEG SOF-parser ---- */
const rgb = new Uint8Array(readFileSync(join(DATA, 'test-rgb.jpg')));
const grijs = new Uint8Array(readFileSync(join(DATA, 'test-grijs.jpg')));
const prog = new Uint8Array(readFileSync(join(DATA, 'test-progressive.jpg')));
const cmyk = new Uint8Array(readFileSync(join(DATA, 'test-cmyk.jpg')));
const factuur = new Uint8Array(readFileSync(join(DATA, 'test-factuur.jpg')));
const iRgb = M.leesJpegInfo(rgb);
assert.equal(iRgb.kleurruimte, '/DeviceRGB', 'RGB-JPEG -> DeviceRGB');
assert.equal(iRgb.breedte, 640);
assert.equal(iRgb.hoogte, 480);
assert.equal(M.leesJpegInfo(grijs).kleurruimte, '/DeviceGray', 'grijswaarde-JPEG -> DeviceGray');
assert.throws(() => M.leesJpegInfo(prog), /Progressive/i, 'progressive JPEG -> fout');
assert.throws(() => M.leesJpegInfo(cmyk), /kleurcomponenten/, 'CMYK (4 componenten) -> fout');
assert.throws(() => M.leesJpegInfo(null), /Geen JPEG/, 'null -> fout');
assert.throws(() => M.leesJpegInfo(new Uint8Array([0, 1, 2, 3, 4])), /Geen JPEG/, 'geen SOI -> fout');
/* handgemaakte randgevallen: vulbytes, TEM/RST, SOS vóór SOF, afgekapt */
const geenSof = new Uint8Array([0xFF, 0xD8, 0x00, 0xFF, 0xFF, 0xFF, 0x01, 0xFF, 0xD0, 0xFF, 0xDA, 0x00, 0x04, 0x00, 0x00, 0, 0, 0, 0, 0, 0]);
assert.throws(() => M.leesJpegInfo(geenSof), /Geen SOF/, 'SOS vóór SOF -> fout');
const afgekapt = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
assert.throws(() => M.leesJpegInfo(afgekapt), /Geen SOF/, 'afgekapte JPEG -> fout');

/* ---- sorteerRamen: deuren eerst, gevel voor->achter->links->rechts, dan aanmaakvolgorde ---- */
const ramen = [
  { id: 'a', element: 'raam', gevel: 'achter' },
  { id: 'b', element: 'deur', gevel: 'rechts' },
  { id: 'c', element: 'raam', gevel: 'voor' },
  { id: 'd', element: 'deur', gevel: 'voor' },
  { id: 'e', element: 'raam', gevel: 'voor' },
  { id: 'f', element: 'dakraam', gevel: 'links' },
  { id: 'g', element: 'raam', gevel: 'onbekend' }
];
assert.deepEqual(M.sorteerRamen(ramen).map(r => r.id), ['d', 'b', 'c', 'e', 'a', 'f', 'g'], 'sorteervolgorde §7.4 (onbekende gevel laatst)');

/* ---- volledige bouw: voorbeeldwoning met dossier, facturen en elementfoto's ---- */
const r1 = 'ruimte-living', r2 = 'ruimte-keuken', r3 = 'ruimte-badkamer', r4 = 'ruimte-bureau';
const woning = {
  id: 'test-woning',
  gemaakt: '2026-07-09T08:00:00Z', gewijzigd: '2026-07-09T09:00:00Z',
  pdfBewaardOp: null,
  algemeen: { adres: 'Teststraat 12, Ranst', datum: '2026-07-09', notities: 'Zolder niet toegankelijk — ladder ontbrak.\nTweede alinea.', hoofdFotoId: 'f-gevel1' },
  ruimtes: [
    { id: r1, naam: 'Living', vent: 'natuurlijk', ventBeschrijving: '', opm: 'hoekraam', afm: { b: 5, d: 4, h: 2.6 } },
    { id: r2, naam: 'Keuken', vent: 'mechanisch', ventBeschrijving: '', opm: '', afm: null },
    { id: r3, naam: 'Badkamer', vent: 'ander', ventBeschrijving: 'vraaggestuurd', opm: '', afm: null },
    { id: r4, naam: 'Bureau', vent: 'geen', ventBeschrijving: '', opm: '', afm: null }
  ],
  ramen: [
    { id: 'w1', ruimteId: r1, element: 'raam', gevel: 'achter', b: 2.4, h: 1.335, aantal: 2, beglazing: 'hr-dubbel', kader: 'pvc', rolluik: true, fotoId: 'f-raam' },
    { id: 'w2', ruimteId: r2, element: 'deur', gevel: 'voor', b: 1, h: 2.1, aantal: 1, beglazing: null, kader: 'hout', rolluik: false, fotoId: null },
    { id: 'w3', ruimteId: null, element: 'dakraam', gevel: 'links', b: 0.78, h: 1.18, aantal: 1, beglazing: 'drievoudig', kader: 'alu', rolluik: false, fotoId: 'f-dood' }
  ],
  energie: {
    opwekkers: [
      { id: 'o1', type: 'gas', ruimteId: null, functie: ['radiatoren', 'sww'], beschrijving: 'Vaillant 2015', fotoIds: ['f-kenplaat', 'f-kenplaat2'], fotoKraanId: 'f-kraan' },
      { id: 'o2', type: 'airco', ruimteId: r1, functie: [], beschrijving: 'Daikin split met een behoorlijk lange beschrijving die in de cel moet wrappen', fotoIds: [], fotoKraanId: null },
      { id: 'o3', type: 'kachel', ruimteId: r2, beschrijving: '', fotoIds: [], fotoKraanId: null }
    ],
    pvPanelen: [{ id: 'p1', orientatie: 'plat', wp: '4200' }, { id: 'p2', orientatie: 'voor', wp: '2000' }],
    zonneboiler: 'ja', zonneboilerM2: '4,6'
  },
  problemen: []
};
const fotos = new Map([
  ['f-gevel1', { bytes: rgb, breedte: 640, hoogte: 480, groep: 'gevels', volgorde: 1 }],
  ['f-gevel2', { bytes: grijs, breedte: 640, hoogte: 480, groep: 'gevels', volgorde: 2 }],
  ['f-living', { bytes: rgb, breedte: 640, hoogte: 480, groep: r1, volgorde: 3 }],
  ['f-factuur1', { bytes: factuur, breedte: 800, hoogte: 600, groep: 'algemeen', volgorde: 4 }],
  ['f-factuur2', { bytes: factuur, breedte: 800, hoogte: 600, groep: 'algemeen', volgorde: 5 }],
  ['f-factuur3', { bytes: factuur, breedte: 800, hoogte: 600, groep: 'algemeen', volgorde: 6 }],
  ['f-raam', { bytes: rgb, breedte: 640, hoogte: 480, groep: null, volgorde: 0 }],
  ['f-kenplaat', { bytes: grijs, breedte: 640, hoogte: 480, groep: null, volgorde: 0 }],
  ['f-kenplaat2', { bytes: rgb, breedte: 640, hoogte: 480, groep: null, volgorde: 0 }],
  ['f-kraan', { bytes: rgb, breedte: 640, hoogte: 480, groep: null, volgorde: 0 }]
]);

const stappen = [];
const { blob, dossier } = pdfViaJson(woning, fotos, { versie: 'epc-vTEST', voortgang: v => stappen.push(v) });
assert.ok(blob.size > 10000, 'PDF heeft inhoud');
assert.ok(stappen.length >= 4 && stappen[stappen.length - 1] === 1, 'voortgang gemeld tot 1');
const buf = Buffer.from(await blob.arrayBuffer());
writeFileSync(join(UIT, 'unittest.pdf'), buf);
assert.ok(buf.subarray(0, 8).toString('latin1').startsWith('%PDF-1.4'), 'PDF 1.4-header');
const tekst = buf.toString('latin1');
assert.ok(tekst.includes('/Producer (EPC Plaatsbezoek epc-vTEST)'), '/Producer met versie');
assert.ok(tekst.includes('/Title (Teststraat 12, Ranst)'), '/Title = adres');
assert.ok(/\/ID \[<[0-9a-f]{32}> <[0-9a-f]{32}>\]/.test(tekst), '/ID in trailer');
assert.ok(tekst.includes('/DeviceGray'), 'grijswaarde-XObject als DeviceGray');
assert.ok(tekst.includes('(2,40)') && tekst.includes('(1,34)') /* 1,335 correct afgerond */ && tekst.includes('(1,00)'), 'maten met exact 2 decimalen');
/* json-controle: genest, geen afgeleide waarden, geen ruis (§9.3.1) */
const dw = dossier.woning;
assert.equal(dossier.formaat, 'epc-plaatsbezoek-dossier');
assert.ok(!('appVersie' in dossier), 'geen appVersie meer');
assert.equal(dw.ruimtes[0].naam, 'Gevels', 'Gevels als eerste pseudo-ruimte');
assert.equal(dw.ruimtes[dw.ruimtes.length - 1].naam, 'Algemeen', 'Algemeen laatst');
const living = dw.ruimtes.find(r => r.naam === 'Living');
assert.ok(living.elementen && living.elementen[0].breedteM === 2.4, 'elementen genest onder ruimte');
assert.ok(!('oppervlakteM2' in living.elementen[0]), 'geen afgeleide m² per element');
assert.ok(!('nr' in living.elementen[0]), 'geen nr');
assert.ok(living.toestellen && living.toestellen[0].type === 'airco', 'ruimtetoestel genest onder ruimte');
const keukenDeur = dw.ruimtes.find(r => r.naam === 'Keuken').elementen[0];
assert.ok(!('beglazing' in keukenDeur), 'deur zonder beglazing-sleutel');
assert.equal(dw.hoofdfoto, 'fotos/0001.jpg', 'hoofdfoto op woningniveau');
assert.equal(dw.energie.opwekkers.length, 1, 'enkel de centrale opwekker in energie');
assert.ok(!('ruimte' in dw.energie.opwekkers[0]), 'geen ruimte-string op de centrale opwekker');
/* dedupe op pad: 10 records → 10 XObjects (f-gevel1 is hoofdfoto én gevelfoto = 1) */
const nXobj = (tekst.match(/\/Subtype \/Image/g) || []).length;
assert.equal(nXobj, 10, `10 unieke foto's -> 10 XObjects (kreeg ${nXobj})`);

/* ---- kale woning: alle "leeg"-takken, geen fotomap, geen opties ---- */
const kaal = { algemeen: {}, ruimtes: undefined, ramen: undefined, energie: undefined };
const blobKaal = pdfViaJson(kaal).blob;
const tekstKaal = Buffer.from(await blobKaal.arrayBuffer()).toString('latin1');
assert.ok(tekstKaal.includes(M.pdfStr('Adres onbekend')), 'kale woning: adres onbekend');
assert.ok(tekstKaal.includes('Geen elementen opgemeten'), 'kale woning: geen elementen');
assert.ok(tekstKaal.includes('Geen opwekkers genoteerd'), 'kale woning: geen opwekkers');
assert.ok(!tekstKaal.includes('FOTODOSSIER'), 'kale woning: geen fotodossier');
assert.ok(!tekstKaal.includes('Zonneboiler'), 'kale woning: geen zonneboiler');

/* ---- zonneboiler ja zonder m², dossier zonder algemeen-groep (geen slotpagina-pop) ---- */
const klein = {
  algemeen: { adres: 'Kort 1', datum: '2026-01-01', notities: '', hoofdFotoId: null },
  ruimtes: [{ id: 'x', naam: 'Living', vent: 'geen', ventBeschrijving: '', opm: '', afm: null }],
  ramen: [],
  energie: { opwekkers: [], pvPanelen: [], zonneboiler: 'ja', zonneboilerM2: '' }
};
const blobKlein = pdfViaJson(klein, new Map([['g1', { bytes: rgb, breedte: 640, hoogte: 480, groep: 'gevels', volgorde: 1 }]]), {}).blob;
const tekstKlein = Buffer.from(await blobKlein.arrayBuffer()).toString('latin1');
assert.ok(tekstKlein.includes('FOTODOSSIER'), 'klein dossier aanwezig');
assert.ok(/Zonneboiler/.test(tekstKlein) && !/4,6/.test(tekstKlein), 'zonneboiler ja zonder oppervlakte');

/* ---- lange tabel forceert paginabreuken ---- */
const veel = {
  ...klein,
  ramen: Array.from({ length: 70 }, (_, i) => ({
    id: 'r' + i, ruimteId: 'x', element: 'raam', gevel: 'voor', b: 1, h: 1, aantal: 1,
    beglazing: 'dubbel', kader: 'pvc', rolluik: false, fotoId: null
  }))
};
const blobVeel = pdfViaJson(veel, new Map(), {}).blob;
assert.ok(blobVeel.size > 5000, 'lange tabel bouwt');

/* ---- progressive JPEG in de invoer -> bouwPdf gooit ---- */
const fout = new Map([['f-prog', { bytes: prog, breedte: 640, hoogte: 480, groep: 'gevels', volgorde: 1 }]]);
assert.throws(() => pdfViaJson(woning, fout, {}), /Progressive/i, 'progressive in dossier -> fout');

console.log('unittest-maakpdf: alles OK, PDF', blob.size, 'bytes,', stappen.length, 'voortgangsmeldingen');
