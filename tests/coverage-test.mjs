/* Dekkingssuite op Chromium (V8-coverage; WebKit heeft geen coverage-API).
   Raakt elke tak van app.js en db.js: normale flows plus alle fout- en
   fallbackpaden via mocks. De gedragstests zelf staan in flow-test.mjs
   (WebKit) en camera-test.mjs; dit bestand bewijst de volledigheid. */
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { strict as assert } from 'node:assert';
import { serveer } from './serveer.mjs';

const HIER = dirname(fileURLToPath(import.meta.url));
const DATA = join(HIER, 'data');
const UIT = join(HIER, 'uitvoer', 'v8browser');
rmSync(UIT, { recursive: true, force: true });
mkdirSync(UIT, { recursive: true });

const POORT = 8126;
const BASIS = `http://127.0.0.1:${POORT}/`;
const server = await serveer(POORT);
const FOTO = join(DATA, 'test-rgb.jpg');
const FACTUUR = join(DATA, 'test-factuur.jpg');

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
});

let dumpNr = 0;
async function bewaarDekking(page) {
  const entries = await page.coverage.stopJSCoverage();
  const relevant = entries.filter(e => /\/(app|db|maakpdf|maakzip|pdfworker|sw)\.js$/.test(e.url || ''));
  writeFileSync(join(UIT, `dump-${++dumpNr}.json`), JSON.stringify(relevant));
}

/* dialogen: wachtrij met antwoorden; default = accepteren */
const dialoogRij = [];
function antwoord(...a) { dialoogRij.push(...a); }
function koppelDialogen(page) {
  page.on('dialog', d => {
    const w = dialoogRij.length ? dialoogRij.shift() : { doe: 'accept' };
    if (w.doe === 'dismiss') d.dismiss().catch(() => { });
    else d.accept(w.tekst).catch(() => { });
  });
}

async function scenario(naam, opties, fn) {
  console.log('scenario:', naam);
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 }, acceptDownloads: true, ...(opties.context || {})
  });
  for (const s of opties.init || []) await ctx.addInitScript(s);
  const page = await ctx.newPage();
  koppelDialogen(page);
  await page.coverage.startJSCoverage({ resetOnNavigation: false });
  try {
    await fn(page, ctx);
  } finally {
    await bewaarDekking(page).catch(() => { });
    await ctx.close();
  }
}

async function nieuweWoning(page) {
  await page.goto(BASIS);
  await page.waitForSelector('#btn-nieuwewoning');
  await page.click('#btn-nieuwewoning');
  await page.waitForSelector('#app:not([hidden])');
}

/* ============ 1. hoofdflow: alle schermen, bewerken, undo, PDF, verwijderen ============ */
await scenario('hoofdflow', {
  context: { serviceWorkers: 'block', permissions: ['geolocation'], geolocation: { latitude: 51.2, longitude: 4.4 } },
  init: [`Object.defineProperty(navigator, 'mediaDevices', { value: undefined });`]
}, async page => {
  /* Nominatim: 1e keer geldig adres, 2e keer 500, 3e keer netwerkfout */
  let geoTel = 0;
  await page.route('**/nominatim.openstreetmap.org/**', route => {
    geoTel++;
    if (geoTel === 1) route.fulfill({ json: { address: { road: 'Locatielaan', house_number: '5', town: 'Ranst' } } });
    else if (geoTel === 2) route.fulfill({ status: 500, body: 'kapot' });
    else route.abort();
  });

  await page.goto(BASIS);
  await page.waitForSelector('#woninglijst .leeg');

  /* verstopt knopje (§7.1): op de lijst (geen open dossier) doet een druk op de
     titel niets — start() valt uit op !S, stop() ziet geen actieve timer */
  const titel = page.locator('#titel');
  await titel.hover();
  await page.mouse.down();
  await page.mouse.up();

  /* volgendeIndex-catch: bij kapotte getItem valt hij terug op 1 */
  const viFout = await page.evaluate(() => {
    const g = localStorage.getItem.bind(localStorage);
    localStorage.getItem = () => { throw new Error('geen storage'); };
    try { return volgendeIndex(); } finally { localStorage.getItem = g; }
  });
  assert.equal(viFout, 1, 'volgendeIndex valt terug op 1');

  await page.click('#btn-nieuwewoning');
  await page.waitForSelector('#app:not([hidden])');
  assert.equal(await page.evaluate(() => S.nummer), 1, 'nieuwe woning krijgt nummer 1');
  assert.equal(await page.evaluate(() => localStorage.getItem('epc-volgindex')), '2', 'teller op 2');

  /* lange druk op de editortitel corrigeert het nummer van dit dossier (§7.1) */
  /* korte druk: timer gewist vóór 800 ms (stop met actieve timer) */
  await titel.hover();
  await page.mouse.down();
  await page.mouse.up();
  /* ongeldige invoer -> toast, nummer blijft 1 */
  antwoord({ doe: 'accept', tekst: 'abc' });
  await titel.hover();
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
  assert.equal(await page.evaluate(() => S.nummer), 1, 'ongeldig nummer genegeerd');
  /* geannuleerd -> geen wijziging */
  antwoord({ doe: 'dismiss' });
  await titel.hover();
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
  /* geldig nummer -> nummer gezet, globale teller volgt op nummer+1 */
  antwoord({ doe: 'accept', tekst: '30' });
  await titel.hover();
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
  await page.waitForFunction(() => S.nummer === 30);
  assert.equal(await page.evaluate(() => localStorage.getItem('epc-volgindex')), '31', 'teller volgt op 31');

  /* locatieknop: adres, dan 500 -> coördinaten, dan offline -> coördinaten */
  await page.click('#btn-locatie');
  await page.waitForFunction(() => document.querySelector('#adres').value.includes('Locatielaan'));
  await page.click('#btn-locatie');
  await page.waitForFunction(() => /51[.,]/.test(document.querySelector('#adres').value));
  await page.click('#btn-locatie');
  await page.waitForTimeout(300);
  await page.fill('#adres', 'Dekkingsstraat 1, Ranst');
  await page.fill('#datum', '2026-07-09');
  await page.locator('#datum').blur();

  /* verwarming: foto's via de toestelkiezer-fallback (geen mediaDevices) */
  await page.click('#tab-algemeen details:nth-of-type(2) summary');
  await page.click('#chips-opwekfunctie button[data-v="radiatoren"]');
  await page.click('#btn-opwekfoto');
  await page.setInputFiles('#fotoinput', FOTO);
  await page.waitForSelector('#opwekfotos .fotomini');
  await page.click('#btn-opwekfoto');           /* tweede kenplaatfoto komt erbij (§7.3) */
  await page.setInputFiles('#fotoinput', FOTO);
  await page.waitForFunction(() => document.querySelectorAll('#opwekfotos .fotomini').length === 2);
  await page.click('#btn-kraanfoto');
  await page.setInputFiles('#fotoinput', FOTO);
  await page.waitForSelector('#kraanfoto-thumb:not([hidden])');
  await page.fill('#opw-beschrijving', 'Vaillant 2015');
  await page.locator('#opw-beschrijving').blur();
  await page.click('#btn-opwek-voegtoe');
  /* bewerken: radiatoren uit -> kranenfoto genuld; daarna annuleren-tak
     (klik op .info: de rij draagt nu meerdere fotominiaturen, §7.3) */
  await page.click('#opweklijst li .info');
  await page.click('#chips-opwekfunctie button[data-v="radiatoren"]');
  await page.click('#btn-opwek-voegtoe');
  await page.click('#opweklijst li .info');
  await page.click('#btn-annuleer-opwek');
  /* kraanfoto del + undo-herstel */
  await page.click('#chips-opwekfunctie button[data-v="radiatoren"]');
  await page.click('#btn-kraanfoto');
  await page.setInputFiles('#fotoinput', FOTO);
  await page.waitForSelector('#kraanfoto-thumb:not([hidden])');
  await page.click('#btn-kraanfoto-del');
  await page.click('#btn-undo');
  await page.click('#btn-opwekfoto');
  await page.setInputFiles('#fotoinput', FOTO);
  await page.waitForTimeout(300);
  /* kenplaatfoto weg via het kruisje op de miniatuur, met undo-herstel */
  await page.click('#opwekfotos .fotomini .thumbdel');
  await page.click('#btn-undo');
  await page.waitForFunction(() => document.querySelectorAll('#opwekfotos .fotomini').length >= 1);
  await page.click('#opwekfotos .fotomini .thumbdel'); /* undo... */
  await page.click('#btn-kraanfoto-del');       /* ...en meteen nog één: commit van de vorige */
  await page.click('#btn-undo');
  /* tweede opwekker en weer weg via de kruisjes op de lijst */
  await page.click('#btn-opwek-voegtoe');
  antwoord({ doe: 'dismiss' });
  await page.click('#opweklijst li .del');      /* confirm geweigerd */
  await page.click('#opweklijst li .del');      /* echt weg */

  /* pv + zonneboiler */
  await page.click('#tab-algemeen details:nth-of-type(3) summary');
  await page.click('#btn-pv-voegtoe');          /* zonder Wp -> toast */
  await page.fill('#pv-wp', '4200');
  await page.locator('#pv-wp').blur();
  await page.click('#btn-pv-voegtoe');
  await page.click('#cy-pvor');
  await page.fill('#pv-wp', '2000');
  await page.locator('#pv-wp').blur();
  await page.click('#btn-pv-voegtoe');
  antwoord({ doe: 'dismiss' });
  await page.click('#pvlijst .del');            /* confirm geweigerd */
  await page.click('#pvlijst .del');            /* confirm ok */
  await page.click('#cy-zonneboiler');
  await page.fill('#zb-m2', '4,6');
  await page.locator('#zb-m2').blur();
  await page.click('#tab-algemeen details:nth-of-type(4) summary');
  await page.fill('#notities', 'Nota één.\nNota twee.');
  await page.locator('#notities').blur();

  /* details: ventilatie tot "ander", afmetingen, opmerking */
  await page.click('#tabbar button[data-tab="details"]');
  for (let i = 0; i < 4; i++) await page.click('#btn-vent');
  await page.waitForSelector('#fld-ventbesch:not([hidden])');
  await page.fill('#vent-besch', 'vraaggestuurd type C');
  await page.locator('#vent-besch').blur();
  await page.click('#sec-energie summary');
  await page.fill('#ruimte-b', '5');
  await page.fill('#ruimte-d', '4');
  await page.fill('#ruimte-h', '2,6');
  await page.locator('#ruimte-h').blur();
  await page.fill('#ruimte-h', '');             /* afm -> null-tak */
  await page.fill('#ruimte-h', '2,6');
  await page.locator('#ruimte-h').blur();
  await page.fill('#ruimte-opm', 'hoekkamer');
  await page.locator('#ruimte-opm').blur();

  /* toestel in de ruimte: toevoegen, bewerken, annuleren, verwijderen */
  await page.click('#btn-rvfoto');
  await page.setInputFiles('#fotoinput', FOTO);
  await page.waitForSelector('#rvfoto-thumb:not([hidden])');
  await page.click('#btn-rvfoto-del');
  await page.click('#btn-undo');
  await page.fill('#rv-beschrijving', 'Daikin split');
  await page.locator('#rv-beschrijving').blur();
  await page.click('#btn-rv-voegtoe');
  await page.click('#rvlijst li');
  await page.click('#cy-rvtype');
  await page.click('#btn-rv-voegtoe');          /* bewaar wijziging */
  await page.click('#rvlijst li');
  await page.click('#btn-annuleer-rv');
  await page.click('#cy-rvtype');
  await page.click('#btn-rv-voegtoe');          /* tweede toestel */
  antwoord({ doe: 'dismiss' });
  await page.click('#rvlijst li .del');
  await page.click('#rvlijst li .del');

  /* ramen & deuren */
  await page.click('#sec-ramen summary');
  await page.click('#seg-element button[data-v="dakraam"]');   /* kenplaatje-label */
  await page.click('#seg-element button[data-v="raam"]');
  await page.click('#aantal-plus');
  await page.click('#aantal-min');
  await page.fill('#aantal', '3');
  await page.locator('#aantal').blur();
  await page.click('#cy-beglazing');
  await page.click('#cy-kader');
  await page.click('#cy-rolluik');
  await page.click('#btn-voegtoe');             /* zonder maten -> toast */
  await page.fill('#breedte', '2,4');
  await page.fill('#hoogte', '1,335');
  await page.locator('#hoogte').blur();
  await page.click('#btn-raamfoto');
  await page.setInputFiles('#fotoinput', FOTO);
  await page.waitForSelector('#raamfoto-thumb:not([hidden])');
  await page.click('#btn-raamfoto');            /* vervangen */
  await page.setInputFiles('#fotoinput', FOTO);
  await page.waitForTimeout(300);
  await page.click('#btn-voegtoe');
  /* bewerken: foto weg met undo, annuleren, herstellen, dan echt bewaren */
  await page.click('#ramenlijst li');
  await page.click('#btn-raamfoto-del');
  await page.click('#btn-annuleer-raam');       /* render met verborgen foto */
  await page.click('#btn-undo');
  await page.click('#ramenlijst li');
  await page.fill('#breedte', '2,5');
  await page.locator('#breedte').blur();
  await page.click('#btn-voegtoe');             /* bewaar wijziging */
  /* deur erbij en weer weg (met foto-verwijdertak); beglazing-cycle is dan weg */
  await page.click('#seg-element button[data-v="deur"]');
  assert.ok(await page.locator('#cy-beglazing').isHidden(), 'beglazing-cycle weg bij deur');
  await page.fill('#breedte', '1');
  await page.fill('#hoogte', '2,1');
  await page.locator('#hoogte').blur();
  await page.click('#btn-raamfoto');
  await page.setInputFiles('#fotoinput', FOTO);
  await page.waitForTimeout(300);
  await page.click('#btn-voegtoe');
  antwoord({ doe: 'dismiss' });
  await page.click('#ramenlijst li .del');
  await page.click('#ramenlijst li .del');      /* deur (staat eerst) weg incl. foto */

  /* zonder gekozen ruimte: beide voegtoe-guards (het rv-formulier is dan
     verborgen, dus programmatisch klikken) */
  await page.evaluate(() => { ruimteSel = null; syncRuimteAfm(); });
  await page.evaluate(() => document.querySelector('#btn-voegtoe').click());
  await page.evaluate(() => document.querySelector('#btn-rv-voegtoe').click());
  await page.click('#tabbar button[data-tab="algemeen"]');
  await page.evaluate(() => { ruimteSel = null; });
  await page.click('#tabbar button[data-tab="details"]'); /* kiest eerste ruimte terug */

  /* ruimtes: toevoegen (uniek + autonummer), prompt-naam, hernoemen, verwijderen */
  await page.click('#ruimtechips button[data-v="__plus"]');
  await page.click('#ruimtekeuze button[data-v="Berging"]');
  await page.click('#ruimtechips button[data-v="__plus"]');
  await page.click('#ruimtekeuze button[data-v="Slaapkamer"]');
  antwoord({ doe: 'accept', tekst: 'Zolderkamer' });
  await page.click('#ruimtechips button[data-v="__plus"]');
  await page.click('#ruimtekeuze button[data-v="__naam"]');
  antwoord({ doe: 'accept', tekst: '' });
  await page.click('#ruimtechips button[data-v="__plus"]');
  await page.click('#ruimtekeuze button[data-v="__naam"]');   /* leeg -> niets */
  await page.click('#ruimtechips button[data-v="__plus"]');   /* keuzelijst weer dicht */
  /* lang indrukken: hernoemen, en één keer zelfde naam (geen wijziging) */
  antwoord({ doe: 'accept', tekst: 'Hobbyzolder' });
  let chip = page.locator('#ruimtechips button', { hasText: 'Zolderkamer' });
  await chip.hover();
  await page.mouse.down();
  await page.waitForTimeout(750);
  await page.mouse.up();
  await page.waitForTimeout(150);
  antwoord({ doe: 'accept', tekst: 'Hobbyzolder' });
  chip = page.locator('#ruimtechips button', { hasText: 'Hobbyzolder' });
  await chip.hover();
  await page.mouse.down();
  await page.waitForTimeout(750);
  await page.mouse.up();
  await page.waitForTimeout(150);
  /* lege ruimtes verwijderen zodat het controlelijstje ✅ kan worden */
  for (const naam of ['Hobbyzolder', 'Slaapkamer 2', 'Berging', 'Keuken', 'Badkamer', 'WC', 'Slaapkamer 1', 'Hal']) {
    await page.click(`#ruimtechips button:has-text("${naam}")`);
    await page.click('#btn-ruimte-weg');
    await page.waitForTimeout(80);
  }
  assert.equal(await page.locator('#ruimtechips button:not(.plus)').count(), 1, 'enkel Living blijft');

  /* foto's: raster, ster, verplaatsen, undo-verloop, lightbox */
  await page.click('#tabbar button[data-tab="fotos"]');
  await page.click('#ruimtechips button[data-v="gevels"]');   /* gevelfoto's voor de ster/hoofdfoto */
  const [kiezer] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('#btn-fotokies')
  ]);
  await kiezer.setFiles([FOTO, FOTO]);
  await page.waitForSelector('#dossiergrid .dfoto');
  await page.setInputFiles('#dossierinput', join(HIER, 'serveer.mjs')); /* geen afbeelding */
  await page.waitForTimeout(400);
  await page.click('#ruimtechips button[data-v="algemeen"]');
  await page.setInputFiles('#dossierinput', FACTUUR);
  await page.waitForSelector('#dossiergrid .dfoto');
  /* verplaats: annuleerknop, backdrop, zelfde groep, echte verhuis naar Living */
  await page.click('#dossiergrid .verplaats');
  await page.click('#btn-verplaats-annuleer');
  await page.click('#dossiergrid .verplaats');
  await page.locator('#verplaats').click({ position: { x: 5, y: 5 } });
  await page.click('#dossiergrid .verplaats');
  await page.click('#verplaats-chips button:has-text("Algemeen")'); /* zelfde groep */
  await page.click('#dossiergrid .verplaats');
  await page.click('#verplaats-chips button:has-text("Living")');
  await page.waitForTimeout(150);
  /* gevels: ster, hoofdfoto weg + herstel, verplaats hoofdfoto weg uit gevels */
  await page.click('#ruimtechips button[data-v="gevels"]');
  await page.click('#dossiergrid .ster >> nth=0');
  await page.click('#dossiergrid .dfoto:has(.ster.hoofd) .del');
  await page.click('#btn-undo');                 /* hoofdfoto terug */
  await page.click('#dossiergrid .dfoto:has(.ster.hoofd) .verplaats');
  await page.click('#verplaats-chips button:has-text("Living")');   /* hoofdFotoId gewist */
  await page.waitForTimeout(150);
  await page.click('#dossiergrid .ster >> nth=0'); /* nieuwe hoofdfoto */
  /* lightbox */
  await page.click('#dossiergrid img.thumb >> nth=0');
  await page.waitForSelector('#lightbox:not([hidden])');
  await page.click('#lightbox');
  /* undo laten verlopen: blob echt weg */
  await page.click('#ruimtechips button:has-text("Living")');
  const voorVerloop = await page.locator('#dossiergrid .dfoto').count();
  await page.click('#dossiergrid .del >> nth=0');
  await page.waitForTimeout(6600);
  assert.equal(await page.locator('#dossiergrid .dfoto').count(), voorVerloop - 1, 'undo verlopen: foto weg');

  /* toetsenbord verbergt de tabbalk; focus wisselen tussen velden */
  await page.click('#tabbar button[data-tab="algemeen"]');
  await page.click('#tab-algemeen details:nth-of-type(1) summary');
  await page.focus('#adres');
  assert.ok(await page.locator('#tabbar.toets').count() === 1, 'tabbalk verborgen bij typen');
  await page.focus('#datum');
  await page.waitForTimeout(120);
  await page.locator('#datum').blur();
  await page.waitForTimeout(120);

  /* afronden: eerst checks, dan PDF via download, dan lijst-lightbox, dan verwijderen */
  await page.click('#tabbar button[data-tab="afronden"]');
  assert.equal(await page.locator('#checklijst li').count(), 3);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.click('#btn-print')
  ]);
  await download.saveAs(join(HIER, 'uitvoer', 'dekking.zip'));
  await page.waitForSelector('#pdf-bewaard:not([hidden])');
  /* pagehide- en visibilitychange-takken */
  await page.evaluate(() => {
    wijzig();
    Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
  });
  await page.waitForTimeout(300);
  /* terug naar de lijst: thumb-lightbox en heropenen (normaliseer op echte data) */
  await page.click('#btn-terug');
  await page.waitForSelector('#woninglijst li.woning');
  await page.click('#woninglijst img.thumb');
  await page.waitForSelector('#lightbox:not([hidden])');
  await page.click('#lightbox');
  await page.click('#woninglijst li.woning');
  await page.waitForSelector('#app:not([hidden])');
  await page.click('#tabbar button[data-tab="afronden"]');
  antwoord({ doe: 'dismiss' });
  await page.click('#btn-verwijder-woning');    /* confirm geweigerd */
  await page.click('#btn-verwijder-woning');
  await page.waitForSelector('#view-lijst:not([hidden])');

  /* import: fout (geen zip), fout tijdens de put (opruimen), en dan geslaagd */
  await page.click('#btn-importeer');           /* kiezer openen en annuleren */
  await page.setInputFiles('#zipinput', join(HIER, 'serveer.mjs'));
  await page.waitForTimeout(400);
  assert.ok((await page.textContent('#toast')).includes('Importeren mislukt'), 'niet-zip geweigerd');
  await page.evaluate(() => {
    window.__EchtePutW = DB.putWoning;
    DB.putWoning = () => Promise.reject(new DOMException('vol', 'QuotaExceededError'));
  });
  await page.setInputFiles('#zipinput', join(HIER, 'uitvoer', 'dekking.zip'));
  await page.waitForTimeout(600);
  assert.ok((await page.textContent('#toast')).includes('Importeren mislukt'), 'halve import opgeruimd');
  await page.evaluate(() => { DB.putWoning = window.__EchtePutW; });
  await page.setInputFiles('#zipinput', []);
  await page.setInputFiles('#zipinput', join(HIER, 'uitvoer', 'dekking.zip'));
  await page.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  assert.equal(await page.inputValue('#adres'), 'Dekkingsstraat 1, Ranst', 'import zet de woning terug');
});

/* ============ 2. delen: share-paden, workerfouten, grote PDF, races ============ */
await scenario('delen', {
  context: { serviceWorkers: 'block' },
  init: [`
    window.__shareModus = 'none';
    navigator.canShare = () => window.__shareModus !== 'none';
    navigator.share = () => {
      const m = window.__shareModus;
      if (m === 'resolve') return Promise.resolve();
      return Promise.reject(new DOMException('geweigerd',
        m === 'abort' ? 'AbortError' : m === 'notallowed' ? 'NotAllowedError' : 'InvalidStateError'));
    };`]
}, async page => {
  await nieuweWoning(page);
  await page.fill('#adres', 'Deelstraat 1');
  await page.locator('#adres').blur();
  await page.click('#tabbar button[data-tab="afronden"]');

  const klik = async modus => {
    await page.evaluate(m => { window.__shareModus = m; }, modus);
    await page.click('#btn-print');
    await page.waitForFunction(() => !pdfBezig, null, { timeout: 30000 });
  };

  await klik('abort');                                          /* AbortError -> niet bewaard */
  assert.ok(await page.evaluate(() => S.pdfBewaardOp === null), 'abort zet niets');
  await klik('anders');                                         /* andere fout -> mislukt */
  await klik('notallowed');                                     /* gebaar-pad: Deel PDF */
  await page.waitForSelector('#btn-deel:not([hidden])');
  await page.evaluate(() => { window.__shareModus = 'abort'; });
  await page.click('#btn-deel');                                /* abort: knop blijft */
  await page.waitForSelector('#btn-deel:not([hidden])');
  await page.evaluate(() => { window.__shareModus = 'anders'; });
  await page.click('#btn-deel');                                /* fout: knop hersteld */
  await page.waitForSelector('#btn-print:not([hidden])');
  await klik('notallowed');
  await page.waitForSelector('#btn-deel:not([hidden])');
  await page.evaluate(() => { window.__shareModus = 'resolve'; });
  await page.click('#btn-deel');                                /* alsnog gedeeld */
  await page.waitForSelector('#pdf-bewaard:not([hidden])');
  await klik('resolve');                                        /* rechtstreeks pad */

  /* workerfouten: fout-bericht, onerror, constructor die gooit */
  await page.evaluate(() => {
    window.__EchteWorker = window.Worker;
    window.Worker = class { constructor() { setTimeout(() => this.onmessage({ data: { fout: 'nepfout' } })); } postMessage() { } terminate() { } };
  });
  await klik('resolve');
  await page.evaluate(() => {
    window.Worker = class { constructor() { setTimeout(() => this.onerror(new Error('boem'))); } postMessage() { } terminate() { } };
  });
  await klik('resolve');
  await page.evaluate(() => { window.Worker = function () { throw new Error('geen worker'); }; });
  await klik('resolve');
  await page.evaluate(() => { window.Worker = window.__EchteWorker; });

  /* blob > 150 MB: confirm geweigerd -> niet bewaard */
  await page.evaluate(() => {
    window.__EchteBouw = bouwInWorker;
    bouwInWorker = async () => new Blob([new ArrayBuffer(151 * 1024 * 1024)]);
  });
  antwoord({ doe: 'dismiss' });
  await klik('resolve');
  await page.evaluate(() => { bouwInWorker = window.__EchteBouw; });

  /* verwijderen dat misgaat: woning blijft bestaan */
  await page.evaluate(() => {
    window.__EchteWeg = DB.verwijderWoningMetFotos;
    DB.verwijderWoningMetFotos = () => Promise.reject(new DOMException('x', 'UnknownError'));
  });
  await page.click('#btn-verwijder-woning');
  await page.waitForTimeout(300);
  assert.ok(await page.evaluate(() => !!S), 'woning hersteld na mislukte verwijdering');
  await page.evaluate(() => { DB.verwijderWoningMetFotos = window.__EchteWeg; });

  /* schrijfrace: wijziging tijdens een lopende write houdt de dirty-vlag */
  await page.evaluate(async () => {
    const echte = DB.putWoning;
    DB.putWoning = w => new Promise(res => setTimeout(() => res(echte(w)), 300));
    wijzig();
    const klaar = bewaar();
    setTimeout(() => wijzig(), 100);
    await klaar;
    DB.putWoning = echte;
  });
  assert.ok(await page.evaluate(() => dirty), 'dirty blijft na race');
});

/* ============ 3. camera: torch, fallbacks, foutpaden ============ */
await scenario('camera', {
  init: [`
    MediaStreamTrack.prototype.getCapabilities = () => ({ torch: true });
    window.__torchFaalt = false;
    MediaStreamTrack.prototype.applyConstraints = function () {
      return window.__torchFaalt ? Promise.reject(new Error('geen torch')) : Promise.resolve();
    };`]
}, async page => {
  await nieuweWoning(page);
  await page.click('#tabbar button[data-tab="fotos"]');

  /* dossier-modus met torch aan/uit en een mislukkende toggle */
  await page.click('#btn-camera');
  await page.waitForSelector('#camera:not([hidden])');
  await page.waitForSelector('#btn-flits:not([hidden])');
  await page.click('#btn-flits');
  assert.ok(await page.locator('#btn-flits.on').count() === 1, 'torch aan');
  await page.evaluate(() => { window.__torchFaalt = true; });
  await page.click('#btn-flits');                        /* catch-tak */
  await page.waitForFunction(() => document.querySelector('#camvideo').videoWidth > 0);
  await page.click('#btn-sluiter');
  await page.waitForFunction(() => document.querySelector('#camteller').textContent.includes('1'));
  await page.click('#camruimtes button[data-v="algemeen"]');   /* wisselen zonder sluiten */
  /* mislukkende opslag: putFoto weigert even */
  await page.evaluate(() => {
    window.__EchtePutFoto = DB.putFoto;
    DB.putFoto = () => Promise.reject(new DOMException('x', 'UnknownError'));
  });
  await page.click('#btn-sluiter');                      /* 'Foto niet bewaard' */
  await page.waitForTimeout(300);
  await page.evaluate(() => { DB.putFoto = window.__EchtePutFoto; });
  /* achtergrond: visibilitychange stopt de camera en bewaart */
  await page.evaluate(() => {
    wijzig();
    Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
  });
  await page.waitForSelector('#camera', { state: 'hidden' });
  /* opnieuw open, meteen Klaar (0 foto's), en pagehide-tak */
  await page.click('#btn-camera');
  await page.waitForSelector('#camera:not([hidden])');
  await page.click('#btn-camklaar');
  await page.click('#btn-camera');
  await page.waitForSelector('#camera:not([hidden])');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.waitForSelector('#camera', { state: 'hidden' });

  /* ultragroothoek (§7.6): label-mock -> app wisselt naar de 0,5×-lens.
     De hoofdlens meldt torch, de 0,5×-lens niet (caps-rij: eerste peiling
     true, daarna leeg) -> de flitsknop moet van lens wisselen. */
  await page.evaluate(async () => {
    const echte = (await navigator.mediaDevices.enumerateDevices()).find(a => a.kind === 'videoinput');
    window.__EchteEnum = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
    window.__EchteSettings = MediaStreamTrack.prototype.getSettings;
    /* de actieve lens meldt een ander id, zodat de wissel doorgaat */
    MediaStreamTrack.prototype.getSettings = () => ({ deviceId: 'hoofdlens' });
    navigator.mediaDevices.enumerateDevices = async () =>
      [{ kind: 'videoinput', label: 'Back Ultra Wide Camera', deviceId: echte.deviceId }];
    window.__torchFaalt = false;
    window.__capsRij = [{ torch: true }];
    MediaStreamTrack.prototype.getCapabilities = () => window.__capsRij.length ? window.__capsRij.shift() : {};
  });
  await page.click('#btn-camera');
  await page.waitForSelector('#camera:not([hidden])');
  await page.waitForFunction(() => document.querySelector('#camvideo').videoWidth > 0);
  /* flitsknop zichtbaar dankzij de hoofdlens; aan = wissel naar hoofdlens */
  await page.waitForSelector('#btn-flits:not([hidden])');
  await page.click('#btn-flits');
  await page.waitForSelector('#btn-flits.on');
  assert.ok(await page.evaluate(() => camFlitsLens), 'hoofdlens staat er tijdelijk voor de flits');
  /* uit = terug naar de 0,5×-lens */
  await page.click('#btn-flits');
  await page.waitForFunction(() => !document.querySelector('#btn-flits').classList.contains('on'));
  assert.ok(await page.evaluate(() => !camFlitsLens), 'terug naar de ultragroothoek');
  await page.evaluate(() => { MediaStreamTrack.prototype.getCapabilities = () => ({ torch: true }); });
  await page.click('#btn-camklaar');
  /* lens weigert (onbestaand id) -> catch, standaardlens blijft staan */
  await page.evaluate(() => {
    navigator.mediaDevices.enumerateDevices = async () =>
      [{ kind: 'videoinput', label: 'Achtercamera met ultragroothoek', deviceId: 'bestaat-niet' }];
  });
  await page.click('#btn-camera');
  await page.waitForSelector('#camera:not([hidden])');
  await page.click('#btn-camklaar');
  /* enumerateDevices kapot -> zoekUltrawide-catch, camera opent gewoon */
  await page.evaluate(() => { navigator.mediaDevices.enumerateDevices = () => Promise.reject(new Error('kapot')); });
  await page.click('#btn-camera');
  await page.waitForSelector('#camera:not([hidden])');
  await page.click('#btn-camklaar');
  await page.evaluate(() => {
    navigator.mediaDevices.enumerateDevices = window.__EchteEnum;
    MediaStreamTrack.prototype.getSettings = window.__EchteSettings;
  });

  /* enkel-modus: annuleren, en toBlob die faalt bij de sluiter */
  await page.click('#tabbar button[data-tab="algemeen"]');
  await page.click('#tab-algemeen details:nth-of-type(2) summary');
  await page.click('#btn-opwekfoto');
  await page.waitForSelector('#camera:not([hidden])');
  await page.click('#btn-camklaar');                     /* Annuleer */
  await page.click('#btn-opwekfoto');
  await page.waitForSelector('#camera:not([hidden])');
  await page.waitForFunction(() => document.querySelector('#camvideo').videoWidth > 0);
  await page.evaluate(() => {
    window.__EchteToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (cb) { cb(null); };
  });
  await page.click('#btn-sluiter');                      /* JPEG maken mislukt -> catch */
  await page.waitForSelector('#camera', { state: 'hidden' });
  await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = window.__EchteToBlob; });
  /* enkel-modus geslaagd via de echte nepcamera */
  await page.click('#btn-opwekfoto');
  await page.waitForSelector('#camera:not([hidden])');
  await page.waitForFunction(() => document.querySelector('#camvideo').videoWidth > 0);
  await page.click('#btn-sluiter');
  await page.waitForSelector('#opwekfotos .fotomini');

  /* dossier-modus zonder cameratoegang: toast + bibliotheek */
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('nee', 'NotAllowedError'));
  });
  await page.click('#tabbar button[data-tab="fotos"]');
  await page.click('#btn-camera');
  await page.waitForTimeout(300);
  assert.ok((await page.textContent('#toast')).includes('Geen cameratoegang'), 'fallback-toast');
  /* EXIF-fallback: createImageBitmap faalt -> <img>-pad */
  await page.evaluate(() => { window.createImageBitmap = () => Promise.reject(new Error('niet hier')); });
  await page.setInputFiles('#dossierinput', FOTO);
  await page.waitForSelector('#dossiergrid .dfoto');
});

/* ============ 4. geheugenmodus: geblokkeerde databank, alles op RAM ============ */
await scenario('geheugen', {
  init: [`delete window.requestIdleCallback; Object.defineProperty(navigator, 'storage', { value: undefined });`]
}, async (page, ctx) => {
  /* pagina 1 houdt een v1-verbinding open zodat de upgrade blokkeert */
  const houder = await ctx.newPage();
  await houder.goto(BASIS + 'manifest.json');
  await houder.evaluate(() => new Promise(res => {
    const q = indexedDB.open('epc-db', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('woningen', { keyPath: 'id' });
    q.onsuccess = () => { window.__houvast = q.result; res(); };
  }));

  /* de app zelf: sw.js-fetch geblokkeerd -> versie-catch en register-catch */
  await page.route('**/sw.js', route => route.abort());
  await page.goto(BASIS);
  await page.waitForSelector('#foutbalk:not([hidden])', { timeout: 15000 });
  assert.ok((await page.textContent('#foutbalk-tekst')).includes('databank niet beschikbaar'), 'rode balk zonder DB');

  /* werken op het geheugen: woning, foto, PDF; de balk blijft */
  await page.click('#btn-nieuwewoning');
  await page.waitForSelector('#app:not([hidden])');
  await page.fill('#adres', 'Geheugenlaan 9');
  await page.locator('#adres').blur();
  await page.waitForTimeout(700);
  assert.ok(await page.locator('#foutbalk:not([hidden])').count(), 'balk blijft in geheugenmodus');
  await page.click('#tabbar button[data-tab="fotos"]');
  await page.click('#ruimtechips button[data-v="gevels"]');   /* gevelfoto voor de ster */
  await page.setInputFiles('#dossierinput', FOTO);
  await page.waitForSelector('#dossiergrid .dfoto');
  await page.click('#dossiergrid .ster');
  await page.click('#btn-terug');                       /* memory alleWoningen + thumb via getFoto */
  await page.waitForSelector('#woninglijst li.woning');
  await page.click('#woninglijst li.woning');           /* memory getWoning + fotosVanWoning */
  await page.waitForSelector('#app:not([hidden])');
  await page.click('#tabbar button[data-tab="afronden"]');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.click('#btn-noodpdf')                          /* noodklep op het geheugen */
  ]);
  await download.saveAs(join(HIER, 'uitvoer', 'geheugen.pdf'));
  await page.waitForSelector('#pdf-bewaard:not([hidden])');
  await page.click('#btn-verwijder-woning');            /* memory verwijderWoningMetFotos */
  await page.waitForSelector('#view-lijst:not([hidden])');
  await page.evaluate(() => DB.weesfotoSweep());        /* geheugen-tak van de sweep */
  await houder.close();                                 /* laadt zelf geen app-scripts */
});

/* ============ clean-start: de app opent een oude v1-databank en maakt ze leeg (db.js) ============ */
await scenario('cleanstart', { context: { serviceWorkers: 'block' } }, async page => {
  await page.goto(BASIS + 'manifest.json');
  await page.evaluate(() => new Promise(res => {
    const q = indexedDB.open('epc-db', 1);
    q.onupgradeneeded = () => {
      q.result.createObjectStore('woningen', { keyPath: 'id' });
      q.result.createObjectStore('instellingen');
    };
    q.onsuccess = () => {
      const t = q.result.transaction('woningen', 'readwrite');
      t.objectStore('woningen').put({ id: 'stokoud', algemeen: { adres: 'Oud' } });
      t.oncomplete = () => { q.result.close(); res(); };
    };
  }));
  /* de app zelf opent nu op v3: onupgradeneeded wist het oude record (db.js §5) */
  await page.goto(BASIS);
  await page.waitForSelector('#btn-nieuwewoning');
  const info = await page.evaluate(() => new Promise(res => {
    const q = indexedDB.open('epc-db');
    q.onsuccess = () => {
      const d = q.result;
      d.transaction('woningen').objectStore('woningen').count().onsuccess =
        e => res({ versie: d.version, aantal: e.target.result, instellingen: d.objectStoreNames.contains('instellingen') });
    };
  }));
  assert.equal(info.versie, 3, 'DB op v3');
  assert.equal(info.aantal, 0, 'oud record gewist (clean start)');
  assert.ok(!info.instellingen, 'instellingen-store weg');
});

/* ============ 5. databankfouten, normaliseer en de weesfotosweep ============ */
await scenario('dbfouten', {
  context: { serviceWorkers: 'block' },
  init: [`
    /* durability-optie afwijzen: transactie() valt terug op de tweede vorm */
    const echteTx = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (stores, modus, opties) {
      if (opties) throw new TypeError('geen opties hier');
      return echteTx.call(this, stores, modus);
    };`]
}, async (page, ctx) => {
  /* rommelige woning + weesfoto's zaaien in een verse v3-databank */
  await page.goto(BASIS + 'manifest.json');
  await page.evaluate(() => new Promise((res, rej) => {
    const q = indexedDB.open('epc-db', 3);
    q.onupgradeneeded = () => {
      const d = q.result;
      d.createObjectStore('woningen', { keyPath: 'id' });
      d.createObjectStore('fotos', { keyPath: 'id' }).createIndex('woningId', 'woningId');
    };
    q.onsuccess = () => {
      const t = q.result.transaction(['woningen', 'fotos'], 'readwrite');
      t.objectStore('woningen').put({
        id: 'rommel-1',
        algemeen: { adres: 'Rommelstraat 3', datum: '2026-01-01', notities: '', hoofdFotoId: 'dode-foto' },
        ruimtes: [{ naam: 'Naamloos zonder id', vent: 'straalventilator', afm: { b: 'x' } }],
        ramen: [
          { element: 'poort', gevel: 'boven', b: 1, h: 1, aantal: 0, beglazing: 'quadruple', kader: 'goud', fotoId: 'weg', ruimteId: 'weg' },
          { element: 'deur', gevel: 'voor', b: 1, h: 2, aantal: 1, beglazing: 'dubbel', kader: 'hout', fotoId: null, ruimteId: null }
        ],
        energie: { opwekkers: [{ type: 'kernfusie', ruimteId: 'weg', functie: ['radiatoren', 'niets'], fotoId: 'weg', fotoKraanId: 'weg' }], pvPanelen: [{ orientatie: 'onder', wp: 5 }], zonneboiler: 'misschien', zonneboilerM2: 7 },
        pdfBewaardOp: 12345, problemen: 'geen-array'
      });
      const blob = new Blob([new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9])], { type: 'image/jpeg' });
      t.objectStore('fotos').put({ id: 'wees-dode-woning', woningId: 'bestaat-niet', blob, breedte: 1, hoogte: 1, groep: 'gevels', volgorde: 1, gemaakt: '' });
      t.objectStore('fotos').put({ id: 'wees-zonder-verwijzing', woningId: 'rommel-1', blob, breedte: 1, hoogte: 1, groep: null, volgorde: 0, gemaakt: '' });
      t.oncomplete = () => { q.result.close(); res(); };
      t.onerror = () => rej(t.error);
    };
    q.onerror = () => rej(q.error);
  }));

  await page.goto(BASIS);
  await page.waitForSelector('#woninglijst li.woning');
  /* de sweep draait op idle en ruimt beide wezen op */
  await page.waitForFunction(() => new Promise(res => {
    const q = indexedDB.open('epc-db');
    q.onsuccess = () => {
      q.result.transaction('fotos').objectStore('fotos').count().onsuccess =
        e => { q.result.close(); res(e.target.result === 0); };
    };
  }), null, { timeout: 15000 });

  /* normaliseer herstelt de rommel en meldt dat één keer */
  await page.click('#woninglijst li.woning');
  await page.waitForSelector('#app:not([hidden])');
  const problemen = await page.evaluate(() => S.problemen.length);
  assert.ok(problemen >= 5, `normaliseer logde correcties (${problemen})`);
  assert.ok((await page.textContent('#toast')).includes('hersteld'), 'toast N gegevens hersteld');
  await page.click('#btn-terug');

  /* renderLijst-catchpaden */
  await page.evaluate(async () => {
    const echteAlle = DB.alleWoningen;
    DB.alleWoningen = () => Promise.reject(new Error('leesfout'));
    await renderLijst();
    DB.alleWoningen = echteAlle;
    const echteFoto = DB.getFoto;
    DB.getFoto = () => Promise.reject(new Error('fotofout'));
    await renderLijst();
    DB.getFoto = echteFoto;
    await renderLijst();
  });
  /* openWoning-randen: onbestaand id en een lezing die afbreekt */
  await page.evaluate(() => openWoning('bestaat-niet'));
  await page.waitForTimeout(200);
  await page.evaluate(async () => {
    const echteGet = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (k) { const r = echteGet.call(this, k); this.transaction.abort(); return r; };
    await openWoning('rommel-1');
    IDBObjectStore.prototype.get = echteGet;
  });
  await page.waitForTimeout(200);

  /* QuotaExceededError: het foutkanaal toont de opslag-vol-boodschap */
  await page.click('#woninglijst li.woning');
  await page.waitForSelector('#app:not([hidden])');
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    window.__EchtePut0 = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () { throw new DOMException('vol', 'QuotaExceededError'); };
  });
  await page.fill('#adres', 'Rommelstraat 3-quota');
  await page.locator('#adres').blur();
  await page.waitForSelector('#foutbalk:not([hidden])', { timeout: 5000 });
  assert.ok((await page.textContent('#foutbalk-tekst')).includes('Opslag vol'), 'quota-boodschap');
  await page.evaluate(() => { IDBObjectStore.prototype.put = window.__EchtePut0; });
  await page.waitForFunction(() => document.querySelector('#foutbalk').hidden, null, { timeout: 8000 });

  /* asynchrone schrijffout: put gedraagt zich als add -> ConstraintError, retry herstelt */
  await page.evaluate(() => {
    window.__EchtePut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (w) { return IDBObjectStore.prototype.add.call(this, w); };
  });
  await page.fill('#adres', 'Rommelstraat 3b');
  await page.locator('#adres').blur();
  await page.waitForSelector('#foutbalk:not([hidden])', { timeout: 5000 });
  const balkTekst = await page.textContent('#foutbalk-tekst');
  assert.ok(balkTekst.includes('ConstraintError'), 'asynchrone fout op de balk, kreeg: ' + balkTekst);
  await page.evaluate(() => { IDBObjectStore.prototype.put = window.__EchtePut; });
  await page.waitForFunction(() => document.querySelector('#foutbalk').hidden, null, { timeout: 8000 });

  /* db.js-API-randen rechtstreeks */
  await page.evaluate(async () => {
    assert2(DB.fotoUrl(null) === null);
    assert2(DB.fotoUrl('bestaat-niet') === null);
    assert2(DB.fotoRecord('bestaat-niet') === null);
    function assert2(x) { if (!x) throw new Error('db-rand faalde'); }
    /* dubbele put op fotos: async fout, verwijzing opgeruimd */
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    const rec = { id: 'dubbel', woningId: S.id, blob, breedte: 1, hoogte: 1, groep: null, volgorde: 0, gemaakt: '' };
    await DB.putFoto(rec);
    window.__EchtePut2 = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (w) { return IDBObjectStore.prototype.add.call(this, w); };
    DB.zetFoutmelder(null);                      /* meldFout zonder melder */
    let gefaald = false;
    await DB.putFoto(rec).catch(() => { gefaald = true; });
    IDBObjectStore.prototype.put = window.__EchtePut2;
    if (!gefaald) throw new Error('dubbele put had moeten falen');
    await DB.verwijderFoto('dubbel');
    /* sweep die stil faalt */
    window.__EchteGetAll = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = function () { throw new Error('kapot'); };
    await DB.weesfotoSweep();
    IDBObjectStore.prototype.getAll = window.__EchteGetAll;
  });

  /* onversionchange: een hogere versie elders sluit onze verbinding netjes */
  await page.evaluate(() => { indexedDB.open('epc-db', 99); });
  await page.waitForTimeout(300);
});

/* ============ 6. versiefout op de databank + service-workerregistratie ============ */
await scenario('versiefout-en-sw', {}, async (page, ctx) => {
  /* databank op een hogere versie -> open() faalt met VersionError -> geheugenmodus */
  await page.goto(BASIS + 'manifest.json');
  await page.evaluate(() => new Promise(res => {
    const q = indexedDB.open('epc-db', 99);
    q.onupgradeneeded = () => {
      q.result.createObjectStore('woningen', { keyPath: 'id' });
      q.result.createObjectStore('fotos', { keyPath: 'id' }).createIndex('woningId', 'woningId');
    };
    q.onsuccess = () => { q.result.close(); res(); };
  }));
  await page.goto(BASIS);
  await page.waitForSelector('#foutbalk:not([hidden])');

  /* service worker: registratie + update bij zichtbaar worden */
  await page.waitForFunction(() => navigator.serviceWorker.controller || true);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(500);

  /* updatemelding (§9.5): herladen zodat de SW de pagina controleert */
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller && !!swVersie);
  /* zelfde versie online -> geen balk */
  await page.evaluate(() => controleerVersie());
  await page.waitForTimeout(300);
  assert.ok(await page.locator('#updatebalk').isHidden(), 'geen balk bij gelijke versie');
  /* offline -> check faalt stil */
  await page.route('**/sw.js?*', route => route.abort());
  await page.evaluate(() => controleerVersie());
  await page.waitForTimeout(300);
  assert.ok(await page.locator('#updatebalk').isHidden(), 'offline: geen balk');
  /* nieuwere versie online -> balk zichtbaar */
  await page.unroute('**/sw.js?*');
  await page.route('**/sw.js?*', route => route.fulfill({ contentType: 'application/javascript', body: "const VERSIE = 'epc-v999';" }));
  await page.evaluate(() => controleerVersie());
  await page.waitForSelector('#updatebalk:not([hidden])');
  /* "Nu bijwerken": registratie + caches weg, pagina herlaadt vers */
  await page.unroute('**/sw.js?*');
  await Promise.all([
    page.waitForEvent('load'),
    page.click('#btn-bijwerken')
  ]);
  await page.waitForSelector('#updatebalk', { state: 'hidden' });
  assert.ok(await page.locator('#updatebalk').isHidden(), 'balk weg na bijwerken (verse pagina)');
});

await browser.close();
server.close();
console.log(`coverage-test: ${dumpNr} dekkingsdumps geschreven naar ${UIT}`);
