/* Unit-tests voor maakzip.js in Node (SPEC.md §11): CRC-32-ijkwaarde, een
   met `unzip` verifieerbare zip, en de woning.json-export met de §7.4-nummering. */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { strict as assert } from 'node:assert';

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = join(HIER, '..');
const UIT = join(HIER, 'uitvoer');
mkdirSync(UIT, { recursive: true });

await import(join(REPO, 'maakpdf.js'));   /* voor sorteerRamen */
await import(join(REPO, 'maakzip.js'));
const Z = globalThis.MAAKZIP;
assert.ok(Z && typeof Z.bouwZip === 'function', 'maakzip.js exporteert MAAKZIP');

/* ---- CRC-32: de standaard-ijkwaarde ---- */
assert.equal(Z.crc32(new Uint8Array(0)), 0, 'crc32 van niets is 0');
assert.equal(Z.crc32(new TextEncoder().encode('123456789')), 0xCBF43926, 'crc32-ijkwaarde "123456789"');

/* ---- zip bouwen en met unzip verifiëren ---- */
const zip = Z.bouwZip([
  { naam: 'test.txt', bytes: new TextEncoder().encode('hallo dossier') },
  { naam: 'leeg.bin', bytes: new Uint8Array(0) },
  { naam: 'données.json', bytes: new TextEncoder().encode('{"ok":true}') }
]);
const zipPad = join(UIT, 'maakzip-test.zip');
writeFileSync(zipPad, Buffer.from(await zip.arrayBuffer()));
execSync(`unzip -t ${zipPad}`);                       /* CRC's en structuur */
const lijst = execSync(`unzip -Z1 ${zipPad}`).toString();
assert.ok(lijst.includes('test.txt') && lijst.includes('leeg.bin'), 'ledenlijst klopt');
execSync(`rm -rf ${UIT}/maakzip-uitgepakt && mkdir -p ${UIT}/maakzip-uitgepakt && unzip -o -q ${zipPad} -d ${UIT}/maakzip-uitgepakt`);
assert.equal(readFileSync(join(UIT, 'maakzip-uitgepakt', 'test.txt'), 'utf8'), 'hallo dossier', 'inhoud overleeft de rondreis');

/* ---- woningExport: genest, geen afgeleide waarden, geen ruis (§9.3.1) ---- */
const rgb = new Uint8Array(readFileSync(join(HIER, 'data', 'test-rgb.jpg')));
const woning = {
  algemeen: { adres: 'Exportstraat 3', datum: '2026-07-12', notities: 'nota', hoofdFotoId: 'fA' },
  ruimtes: [
    { id: 'r1', naam: 'Living', vent: 'ander', ventBeschrijving: 'type C', opm: 'hoek', afm: { b: 5, d: 4, h: 2.5 } },
    { id: 'r2', naam: 'Keuken', vent: 'geen', ventBeschrijving: '', opm: '', afm: null }
  ],
  ramen: [
    { id: 'a', ruimteId: 'r1', element: 'raam', gevel: 'achter', b: 2, h: 1, aantal: 2, beglazing: 'dubbel', kader: 'pvc', rolluik: true, fotoId: 'fB' },
    { id: 'b', ruimteId: 'r2', element: 'deur', gevel: 'voor', b: 1, h: 2.2, aantal: 1, beglazing: null, kader: 'hout', rolluik: false, fotoId: null }
  ],
  energie: {
    opwekkers: [
      { id: 'o', type: 'stookolie', ruimteId: null, functie: ['radiatoren'], beschrijving: 'ACV', fotoIds: ['fD', 'fE'], fotoKraanId: null },
      { id: 'a1', type: 'airco', ruimteId: 'r1', functie: [], beschrijving: 'Daikin', fotoIds: [], fotoKraanId: null }
    ],
    pvPanelen: [{ id: 'p', orientatie: 'plat', wp: '4200' }],
    zonneboiler: 'ja', zonneboilerM2: '4,6'
  }
};
const fotos = new Map([
  ['fA', { bytes: rgb, breedte: 640, hoogte: 480, groep: 'gevels', volgorde: 1 }],
  ['fB', { bytes: rgb.slice(0, 5000), breedte: 640, hoogte: 480, groep: null, volgorde: 0 }],
  ['fC', { bytes: rgb.slice(0, 4000), breedte: 640, hoogte: 480, groep: 'r1', volgorde: 2 }],
  ['fD', { bytes: rgb.slice(0, 3000), breedte: 640, hoogte: 480, groep: null, volgorde: 0 }],
  ['fE', { bytes: rgb.slice(0, 2000), breedte: 640, hoogte: 480, groep: null, volgorde: 0 }]
]);
const bestandVan = new Map([
  ['fA', 'fotos/0001.jpg'], ['fB', 'fotos/0002.jpg'], ['fC', 'fotos/0003.jpg'],
  ['fD', 'fotos/0004.jpg'], ['fE', 'fotos/0005.jpg']
]);
const e = Z.woningExport(woning, globalThis.sorteerRamen, fotos, bestandVan).woning;
assert.equal(e.adres, 'Exportstraat 3');
assert.equal(e.hoofdfoto, 'fotos/0001.jpg', 'hoofdfoto op woningniveau');
assert.equal(e.ruimtes[0].naam, 'Gevels', 'Gevels als pseudo-ruimte vooraan');
assert.deepEqual(e.ruimtes[0].fotos, ['fotos/0001.jpg'], 'gevelfoto genest onder Gevels');
const living = e.ruimtes.find(r => r.naam === 'Living');
assert.equal(living.elementen[0].type, 'raam', 'element genest onder ruimte, geen ruimte-string');
assert.ok(!('oppervlakteM2' in living.elementen[0]) && !('nr' in living.elementen[0]), 'geen afgeleide m² of nr');
assert.equal(living.elementen[0].foto, 'fotos/0002.jpg', 'elementfoto op het element');
assert.deepEqual(living.fotos, ['fotos/0003.jpg'], 'ruimtefoto genest onder de ruimte');
assert.equal(living.toestellen[0].type, 'airco', 'ruimtetoestel genest onder de ruimte');
assert.equal(living.ventilatieBeschrijving, 'type C', 'beschrijving enkel bij ander');
assert.ok(!('volumeM3' in living.afmetingen), 'geen afgeleid volume in afmetingen');
const keuken = e.ruimtes.find(r => r.naam === 'Keuken');
assert.ok(!('ventilatie' in keuken), 'ventilatie ontbreekt bij geen');
assert.ok(!('beglazing' in keuken.elementen[0]), 'deur zonder beglazing-sleutel');
assert.equal(e.energie.opwekkers.length, 1, 'enkel de centrale opwekker in energie');
assert.deepEqual(e.energie.opwekkers[0].kenplaatFotos, ['fotos/0004.jpg', 'fotos/0005.jpg'], 'meerdere kenplaatfoto\'s als lijst');
assert.ok(!('kenplaatFotos' in living.toestellen[0]), 'toestel zonder foto: sleutel ontbreekt');
assert.ok(!('ruimteEnDeuren' in e) && !('fotos' in e), 'geen platte lijsten meer');
assert.equal(e.energie.zonneboiler.collectorM2, 4.6, 'komma-decimaal als getal');
assert.equal(e.energie.zonnepanelen[0].orientatie, 'plat dak');
const kaal = Z.woningExport({ algemeen: {} }, globalThis.sorteerRamen).woning;
assert.deepEqual(kaal.ruimtes, [], 'kale woning: geen ruimtes');
assert.ok(!('energie' in kaal), 'kale woning: geen energie-blok');

/* ---- leesZip: volledige rondreis van een zip ---- */
const leden = [
  { naam: 'test.pdf', bytes: new TextEncoder().encode('%PDF-nep') },
  { naam: 'fotos/0001.jpg', bytes: rgb }
];
const terug = Z.leesZip(new Uint8Array(await Z.bouwZip(leden).arrayBuffer()));
assert.equal(terug.length, 2, 'leesZip vindt alle leden terug');
assert.deepEqual([...terug[1].bytes], [...rgb], 'fotobytes ongeschonden na de rondreis');
assert.throws(() => Z.leesZip(new TextEncoder().encode('geen zip hoor')), /geen zip/, 'leesZip weigert niet-zips');

console.log('test-maakzip: alles OK');
