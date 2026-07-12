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

/* ---- woningExport: nummering van §7.4, deuren zonder beglazing, eenheden ---- */
const woning = {
  algemeen: { adres: 'Exportstraat 3', datum: '2026-07-12', notities: 'nota', hoofdFotoId: 'x' },
  ruimtes: [
    { id: 'r1', naam: 'Living', vent: 'ander', ventBeschrijving: 'type C', opm: 'hoek', afm: { b: 5, d: 4, h: 2.5 } },
    { id: 'r2', naam: 'Keuken', vent: 'geen', ventBeschrijving: '', opm: '', afm: null }
  ],
  ramen: [
    { id: 'a', ruimteId: 'r1', element: 'raam', gevel: 'achter', b: 2, h: 1, aantal: 2, beglazing: 'dubbel', kader: 'pvc', rolluik: true, fotoId: null },
    { id: 'b', ruimteId: 'r2', element: 'deur', gevel: 'voor', b: 1, h: 2.2, aantal: 1, beglazing: null, kader: 'hout', rolluik: false, fotoId: null }
  ],
  energie: {
    opwekkers: [{ id: 'o', type: 'stookolie', ruimteId: null, functie: ['radiatoren'], beschrijving: 'ACV', fotoId: null, fotoKraanId: null }],
    pvPanelen: [{ id: 'p', orientatie: 'plat', wp: '4200' }],
    zonneboiler: 'ja', zonneboilerM2: '4,6'
  }
};
const e = Z.woningExport(woning, 'epc-vTEST', globalThis.sorteerRamen).woning;
assert.equal(e.adres, 'Exportstraat 3');
assert.equal(e.ramenEnDeuren[0].element, 'deur', 'deur eerst (§7.4)');
assert.equal(e.ramenEnDeuren[0].nr, 1);
assert.equal(e.ramenEnDeuren[0].beglazing, null, 'deur zonder beglazing');
assert.equal(e.ramenEnDeuren[1].oppervlakteM2, 4, '2 × 1 m × 2 stuks = 4 m²');
assert.equal(e.totaalRamenEnDeuren.aantal, 3);
assert.equal(e.ruimtes[0].afmetingen.volumeM3, 50, 'm³ berekend');
assert.equal(e.ruimtes[0].ventilatieBeschrijving, 'type C', 'beschrijving enkel bij ander');
assert.equal(e.ruimtes[1].ventilatieBeschrijving, null);
assert.equal(e.energie.zonneboiler.collectorM2, 4.6, 'komma-decimaal als getal');
assert.equal(e.energie.zonnepanelen[0].wp, 4200);
assert.equal(e.energie.opwekkers[0].functies[0], 'radiatoren');
const kaal = Z.woningExport({ algemeen: {} }, null, globalThis.sorteerRamen).woning;
assert.equal(kaal.totaalRamenEnDeuren.aantal, 0, 'kale woning exporteert leeg');
assert.deepEqual(e.fotos, [], 'zonder fotomap een lege fotolijst, geen beeldbytes');

/* ---- dossierLeden + leesZip: volledige rondreis ---- */
const rgb = new Uint8Array(readFileSync(join(HIER, 'data', 'test-rgb.jpg')));
const fotos = new Map([
  ['fA', { bytes: rgb, breedte: 640, hoogte: 480, groep: 'gevels', volgorde: 1 }],
  ['fB', { bytes: rgb.slice(0, 5000), breedte: 640, hoogte: 480, groep: null, volgorde: 0 }]
]);
woning.algemeen.hoofdFotoId = 'fA';
woning.ramen[0].fotoId = 'fB';
const leden = Z.dossierLeden(woning, fotos, new TextEncoder().encode('%PDF-nep'), 'exportstraat-3', 'epc-vTEST', globalThis.sorteerRamen);
const namen = leden.map(l => l.naam);
assert.deepEqual(namen, ['exportstraat-3.pdf', 'hoofdfoto.jpg', 'woning.json', 'fotos/0001.jpg', 'fotos/0002.jpg'], 'ledenvolgorde');
const dossierJson = JSON.parse(new TextDecoder().decode(leden[2].bytes));
assert.equal(dossierJson.woning.fotos.length, 2, 'fotolijst in de json');
assert.ok(dossierJson.woning.fotos[0].hoofdfoto, 'hoofdfoto gemarkeerd');
assert.equal(dossierJson.woning.ramenEnDeuren.find(r => r.element === 'raam').foto, 'fotos/0002.jpg', 'elementfoto gekoppeld');
const terug = Z.leesZip(new Uint8Array(await Z.bouwZip(leden).arrayBuffer()));
assert.equal(terug.length, leden.length, 'leesZip vindt alle leden terug');
assert.deepEqual([...terug[3].bytes], [...rgb], 'fotobytes ongeschonden na de rondreis');
assert.throws(() => Z.leesZip(new TextEncoder().encode('geen zip hoor')), /geen zip/, 'leesZip weigert niet-zips');

console.log('test-maakzip: alles OK');
