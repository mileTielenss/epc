/* Klikflows op WebKit, iPhone-viewport (SPEC.md §11).
   Draaien: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node flow-test.mjs */
import { webkit } from 'playwright-core';
import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serveer } from './serveer.mjs';

const HIER = dirname(fileURLToPath(import.meta.url));
const MAP = join(HIER, 'uitvoer');
mkdirSync(MAP, { recursive: true });
const POORT = 8123;
const BASIS = `http://127.0.0.1:${POORT}/`;
const server = await serveer(POORT);
const FOTO = join(HIER, 'data', 'test-rgb.jpg');
const FACTUUR = join(HIER, 'data', 'test-factuur.jpg');

let promptAntwoord = '';
function koppelDialogen(page) {
  page.on('dialog', d => d.accept(d.type() === 'prompt' ? promptAntwoord : undefined));
}

/* WebKit op Linux kan geen Blobs in IndexedDB bewaren in een tijdelijk profiel
   (echte Safari/iOS wel): daarom een persistent profiel per flow, vers gewist */
let profielNr = 0;
async function nieuwePagina() {
  const dir = `${MAP}/wk-profiel-${++profielNr}`;
  rmSync(dir, { recursive: true, force: true });
  const ctx = await webkit.launchPersistentContext(dir, {
    viewport: { width: 393, height: 852 }, acceptDownloads: true
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  koppelDialogen(page);
  return { ctx, page };
}
let ok = 0;
const check = (naam, cond) => { assert.ok(cond, naam); ok++; console.log('  ✓', naam); };

/* ================= flow 1: volledige woning, persistentie, PDF, verwijderen ================= */
{
  console.log('flow 1: woning invullen → PDF → verwijderen');
  const { ctx, page } = await nieuwePagina();
  await page.goto(BASIS);
  await page.waitForSelector('#btn-nieuwewoning');
  check('lege lijst', await page.locator('#woninglijst .leeg').count() === 1);

  await page.click('#btn-nieuwewoning');
  await page.waitForSelector('#app:not([hidden])');
  await page.fill('#adres', 'Teststraat 12, Ranst');
  await page.locator('#adres').blur();
  check('titel volgt adres met nummerprefix', (await page.textContent('#titel')) === '1. Teststraat 12, Ranst');

  /* verstopt knopje (§7.1): lange druk op de woningnaam in de lijst corrigeert
     het dossiernummer; de klik die volgt opent de woning niet */
  await page.click('#btn-terug');
  await page.waitForSelector('#woninglijst li.woning');
  promptAntwoord = '7';
  await page.locator('#woninglijst li.woning .r1').hover();
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('#woninglijst .r1').textContent.startsWith('7. '));
  check('lange druk op de lijstnaam zet dossiernummer', (await page.textContent('#woninglijst .r1')) === '7. Teststraat 12, Ranst');
  check('lange druk opent de woning niet', await page.locator('#app').isHidden());
  /* terug naar het standaardnummer voor de rest van de flow (zip-naam) */
  promptAntwoord = '1';
  await page.locator('#woninglijst li.woning .r1').hover();
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('#woninglijst .r1').textContent.startsWith('1. '));
  promptAntwoord = '';
  await page.click('#woninglijst li.woning .info');
  await page.waitForSelector('#app:not([hidden])');
  check('gewone tik opent de woning weer', (await page.textContent('#titel')) === '1. Teststraat 12, Ranst');

  /* extra bestanden (§7.3): toevoegen via de +, reizen mee in extra/ (§9.3) */
  writeFileSync(`${MAP}/epb-aangifte.txt`, 'epb-aangifte inhoud');
  await page.click('#tab-algemeen details:nth-of-type(6) summary');
  check('extra-lijst start leeg', await page.locator('#extralijst .leeg').count() === 1);
  await page.setInputFiles('#extrainput', `${MAP}/epb-aangifte.txt`);
  await page.waitForSelector('#extralijst li:not(.leeg)');
  check('extra bestand in de lijst', (await page.textContent('#extralijst .r1')) === 'epb-aangifte.txt');

  /* verwarming (accordeon) */
  await page.click('#tab-algemeen details:nth-of-type(2) summary');
  await page.click('#chips-opwekfunctie button[data-v="radiatoren"]');
  check('kraanfoto-rij verschijnt bij radiatoren', await page.locator('#opw-kraanfoto-rij').isVisible());
  await page.fill('#opw-beschrijving', 'Vaillant 2015');
  await page.locator('#opw-beschrijving').blur();
  await page.click('#btn-opwek-voegtoe');
  check('opwekker in lijst', await page.locator('#opweklijst li').count() === 1);

  /* extra installaties */
  await page.click('#tab-algemeen details:nth-of-type(3) summary');
  await page.fill('#pv-wp', '4200');
  await page.locator('#pv-wp').blur();
  await page.click('#btn-pv-voegtoe');
  check('pv in lijst', await page.locator('#pvlijst li').count() === 1);
  await page.click('#cy-zonneboiler');
  check('zonneboiler ja toont m2-veld', await page.locator('#fld-zbm2').isVisible());
  await page.fill('#zb-m2', '4,6');
  await page.locator('#zb-m2').blur();

  /* details: ventilatie + ramen */
  await page.click('#tabbar button[data-tab="details"]');
  check('ruimtebalk zichtbaar', await page.locator('#ruimtebalk').isVisible());
  check('Living geselecteerd', (await page.locator('#ruimtechips button.on').textContent()) === 'Living');
  check('geen Gevels/Algemeen op Details', await page.locator('#ruimtechips button[data-v="gevels"]').count() === 0);
  await page.click('#btn-vent');
  check('ventilatie cycle naar natuurlijk', (await page.textContent('#btn-vent .cv')) === 'natuurlijk');

  await page.click('#sec-ramen summary');
  await page.fill('#breedte', '2,4');
  await page.fill('#hoogte', '1,335');
  await page.locator('#hoogte').blur();
  check('m² live', (await page.textContent('#m2live')).includes('3,20'));
  await page.click('#btn-voegtoe');
  check('raam toegevoegd', await page.locator('#ramenlijst li').count() === 1);
  /* deur toevoegen: moet vóór het raam komen (sorteervolgorde §7.4);
     een deur heeft geen beglazingswaarde, dus de cycle verdwijnt */
  await page.click('#seg-element button[data-v="deur"]');
  check('beglazing-cycle weg bij deur', await page.locator('#cy-beglazing').isHidden());
  await page.fill('#breedte', '1');
  await page.fill('#hoogte', '2,1');
  await page.locator('#hoogte').blur();
  await page.click('#btn-voegtoe');
  const eerste = await page.locator('#ramenlijst li .r1').first().textContent();
  check('deur staat eerst met #1', eerste.includes('#1') && eerste.includes('Deur'));
  check('totaalregel', (await page.textContent('#ramen-totaal')).includes('2 elementen'));

  /* nieuwe ruimte met autonummering; ventilatie klapt open */
  await page.click('#ruimtechips button[data-v="__plus"]');
  await page.click('#ruimtekeuze button[data-v="Slaapkamer"]');
  check('Slaapkamer 2 aangemaakt en geselecteerd', (await page.locator('#ruimtechips button.on').textContent()) === 'Slaapkamer 2');
  check('ventilatie-accordeon open', await page.locator('#sec-vent').evaluate(d => d.open));

  /* hernoemen via lang indrukken */
  promptAntwoord = 'Hobbykamer';
  const chip = page.locator('#ruimtechips button.on');
  await chip.hover();
  await page.mouse.down();
  await page.waitForTimeout(750);
  await page.mouse.up();
  await page.waitForTimeout(200);
  check('ruimte hernoemd', await page.locator('#ruimtechips button', { hasText: 'Hobbykamer' }).count() === 1);

  /* lege ruimte verwijderen kan; met inhoud niet */
  check('verwijderknop zichtbaar voor lege ruimte', await page.locator('#btn-ruimte-weg').isVisible());
  await page.click('#ruimtechips button:has-text("Living")');
  check('verwijderknop weg voor ruimte met ramen', await page.locator('#btn-ruimte-weg').isHidden());
  await page.click('#ruimtechips button:has-text("Hobbykamer")');
  await page.click('#btn-ruimte-weg');
  await page.waitForTimeout(100);
  check('lege ruimte verwijderd', await page.locator('#ruimtechips button', { hasText: 'Hobbykamer' }).count() === 0);

  /* de gekozen ruimte loopt mee tussen Details en Foto's (§7.2) — één selectie */
  await page.click('#tabbar button[data-tab="fotos"]');
  const chips = await page.locator('#ruimtechips button').allTextContents();
  check('Algemeen en Gevels vooraan', chips[0] === 'Algemeen' && chips[1] === 'Gevels');
  check('gekozen ruimte loopt mee naar Foto\'s', (await page.locator('#ruimtechips button.on').textContent()) === 'Living');
  /* een fotogroep kiezen op Foto\'s; terug naar Details valt terug op een echte ruimte */
  await page.click('#ruimtechips button[data-v="gevels"]');
  await page.click('#tabbar button[data-tab="details"]');
  const detSel = await page.locator('#ruimtechips button.on').textContent();
  check('Gevels-keuze valt op Details terug op een echte ruimte', detSel !== 'Gevels' && detSel !== 'Algemeen');
  /* terug naar Foto\'s: de ruimte loopt mee, dan expliciet Gevels voor gevelfoto\'s */
  await page.click('#tabbar button[data-tab="fotos"]');
  check('ruimte loopt mee terug naar Foto\'s', (await page.locator('#ruimtechips button.on').textContent()) === detSel);
  await page.click('#ruimtechips button[data-v="gevels"]');
  /* foto's: kiezen uit bibliotheek, ster, verplaatsen, undo */
  await page.setInputFiles('#dossierinput', [FOTO, FOTO]);
  await page.waitForSelector('#dossiergrid .dfoto');
  check('2 gevelfoto\'s in raster', await page.locator('#dossiergrid .dfoto').count() === 2);
  check('ster op gevels-foto', await page.locator('#dossiergrid .ster').count() === 2);
  await page.locator('#dossiergrid .ster').first().click();
  check('hoofdfoto geel', await page.locator('#dossiergrid .ster.hoofd').count() === 1);

  /* factuur naar Algemeen */
  await page.click('#ruimtechips button[data-v="algemeen"]');
  await page.setInputFiles('#dossierinput', [FACTUUR]);
  await page.waitForSelector('#dossiergrid .dfoto');
  check('factuur in Algemeen', (await page.textContent('#dossier-totaal')).includes('1 foto in Algemeen'));

  /* verplaatsen: factuur naar Living */
  await page.click('#dossiergrid .verplaats');
  await page.waitForSelector('#verplaats:not([hidden])');
  await page.click('#verplaats-chips button:has-text("Living")');
  await page.waitForTimeout(100);
  check('raster leeg na verplaatsen', await page.locator('#dossiergrid .dfoto').count() === 0);
  await page.click('#ruimtechips button:has-text("Living")');
  check('foto zit nu in Living', await page.locator('#dossiergrid .dfoto').count() === 1);

  /* verwijderen met undo-toast */
  await page.click('#dossiergrid .del');
  check('undo-toast zichtbaar', await page.locator('#undotoast').isVisible());
  check('tegel meteen weg', await page.locator('#dossiergrid .dfoto').count() === 0);
  await page.click('#btn-undo');
  check('herstel brengt foto terug', await page.locator('#dossiergrid .dfoto').count() === 1);
  await page.click('#dossiergrid .del');
  await page.waitForTimeout(6500);
  check('na 6 s definitief weg', await page.locator('#dossiergrid .dfoto').count() === 0);

  /* persistentie na reload */
  await page.reload();
  await page.waitForSelector('#woninglijst li.woning');
  check('statuspill Open', (await page.locator('#woninglijst .status').textContent()).trim() === 'Open');
  check('geen verwijderknop in de lijst', await page.locator('#woninglijst .del').count() === 0);
  await page.click('#woninglijst li.woning');
  await page.waitForSelector('#app:not([hidden])');
  check('adres bewaard', await page.inputValue('#adres') === 'Teststraat 12, Ranst');
  await page.click('#tabbar button[data-tab="details"]');
  check('ramen bewaard', await page.locator('#ramenlijst li').count() === 2);
  await page.click('#tabbar button[data-tab="fotos"]');
  await page.click('#ruimtechips button[data-v="gevels"]');
  check('gevelfoto\'s bewaard', await page.locator('#dossiergrid .dfoto').count() === 2);

  /* afronden: checks + delete geblokkeerd + PDF via download */
  await page.click('#tabbar button[data-tab="afronden"]');
  check('3 controlepunten', await page.locator('#checklijst li').count() === 3);
  check('hoofdfoto-check ok', (await page.locator('#checklijst li').nth(2).textContent()).includes('✅'));
  const delKnop = page.locator('#btn-verwijder-woning');
  check('verwijderen geblokkeerd zonder dossier', await delKnop.isDisabled() && (await delKnop.textContent()) === 'Bewaar eerst het dossier');

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.click('#btn-print')
  ]);
  const zipPad = `${MAP}/flowtest.zip`;
  await download.saveAs(zipPad);
  /* eerste dossier van een vers profiel: nummer 1. De zip draagt het nummer,
     de pdf ín de zip is nummervrij (§7.1, §9.3). */
  check('zip-bestandsnaam = "<nummer>. <adres>.zip"', download.suggestedFilename() === '1. Teststraat 12, Ranst.zip');
  const pdfBasis = 'Teststraat 12, Ranst';
  execSync(`unzip -t "${zipPad}"`);
  check('zip uitpakbaar (CRC ok)', true);
  execSync(`rm -rf ${MAP}/flowzip && mkdir -p ${MAP}/flowzip && unzip -o -q "${zipPad}" -d ${MAP}/flowzip`);
  execSync(`qpdf --check "${MAP}/flowzip/${pdfBasis}.pdf"`);
  check('qpdf --check groen op de PDF in de zip', true);
  check('pdf in de zip is nummervrij (adres)', existsSync(`${MAP}/flowzip/${pdfBasis}.pdf`) && !existsSync(`${MAP}/flowzip/1. ${pdfBasis}.pdf`));
  const pdfTekst = readFileSync(`${MAP}/flowzip/${pdfBasis}.pdf`, 'latin1');
  check('/Producer bevat sw-versie', /\/Producer \(EPC Plaatsbezoek epc-v\d+\)/.test(pdfTekst));
  const dossierJson = JSON.parse(readFileSync(`${MAP}/flowzip/woning.json`, 'utf8'));
  check('woning.json bevat het adres', dossierJson.woning.adres === 'Teststraat 12, Ranst');
  check('woning.json bevat GEEN nummer', !('nummer' in dossierJson.woning));
  const jLiving = dossierJson.woning.ruimtes.find(r => r.naam === 'Living');
  check('woning.json: elementen genest onder de ruimte, deur eerst', jLiving.elementen[0].type === 'deur');
  check('woning.json: geen afgeleide m² of nr', !('oppervlakteM2' in jLiving.elementen[0]) && !('nr' in jLiving.elementen[0]));
  check('woning.json: Gevels als pseudo-ruimte met foto\'s', dossierJson.woning.ruimtes[0].naam === 'Gevels' && dossierJson.woning.ruimtes[0].fotos.length === 2);
  check('woning.json: hoofdfoto op woningniveau', dossierJson.woning.hoofdfoto === 'fotos/0001.jpg');
  check('hoofdfoto.jpg zit in de zip', readFileSync(`${MAP}/flowzip/hoofdfoto.jpg`).length > 1000);
  check('fotos/ zit in de zip', readFileSync(`${MAP}/flowzip/fotos/0001.jpg`).length > 1000);
  check('extra/ zit in de zip met het bestand erin', readFileSync(`${MAP}/flowzip/extra/epb-aangifte.txt`, 'utf8') === 'epb-aangifte inhoud');

  await page.waitForSelector('#pdf-bewaard:not([hidden])');
  check('grijze regel "Dossier bewaard op"', (await page.textContent('#pdf-bewaard')).startsWith('Dossier bewaard op'));
  check('verwijderen nu mogelijk', !(await delKnop.isDisabled()) && (await delKnop.textContent()) === 'Woning verwijderen');

  await page.click('#btn-verwijder-woning');
  await page.waitForSelector('#view-lijst:not([hidden])');
  check('woning + foto\'s verwijderd', await page.locator('#woninglijst .leeg').count() === 1);
  const dbLeeg = await page.evaluate(() => new Promise(res => {
    const q = indexedDB.open('epc-db');
    q.onsuccess = () => {
      const t = q.result.transaction(['woningen', 'fotos', 'extra'], 'readonly');
      let w, f, x;
      t.objectStore('woningen').count().onsuccess = e => w = e.target.result;
      t.objectStore('fotos').count().onsuccess = e => f = e.target.result;
      t.objectStore('extra').count().onsuccess = e => x = e.target.result;
      t.oncomplete = () => res({ w, f, x });
    };
  }));
  check('stores leeg (één transactie wiste alles, ook extra)', dbLeeg.w === 0 && dbLeeg.f === 0 && dbLeeg.x === 0);

  /* round-trip: dezelfde zip importeren en alles terugvinden (§9.4) */
  await page.setInputFiles('#zipinput', zipPad);
  await page.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  check('import opent de woning', await page.inputValue('#adres') === 'Teststraat 12, Ranst');
  await page.click('#tabbar button[data-tab="details"]');
  check('ramen terug na import', await page.locator('#ramenlijst li').count() === 2);
  await page.click('#tabbar button[data-tab="fotos"]');
  await page.click('#ruimtechips button[data-v="gevels"]');
  check('gevelfoto\'s terug na import', await page.locator('#dossiergrid .dfoto').count() === 2);
  check('hoofdfoto terug na import', await page.locator('#dossiergrid .ster.hoofd').count() === 1);
  await page.click('#tabbar button[data-tab="afronden"]');
  check('geïmporteerde woning is een nieuw open dossier',
    (await page.locator('#btn-verwijder-woning').textContent()) === 'Bewaar eerst het dossier');
  await page.click('#tabbar button[data-tab="algemeen"]');
  await page.click('#tab-algemeen details:nth-of-type(6) summary');
  check('extra bestand terug na import', (await page.textContent('#extralijst .r1')) === 'epb-aangifte.txt');

  /* herzipt dossier (§9.4): uitgepakt, extra bestand erbij (los én in extra/),
     opnieuw gezipt met de zip-cli (deflate + mappen) — moet exact zo importeren */
  execSync(`cp -r "${MAP}/flowzip" "${MAP}/herzip" && echo "losse nota" > "${MAP}/herzip/extra-nota.txt"` +
    ` && echo "factuur" > "${MAP}/herzip/extra/factuur.txt"`);
  execSync(`cd "${MAP}/herzip" && zip -r -q "${MAP}/herzip.zip" .`);
  await page.click('#btn-terug');
  await page.waitForSelector('#view-lijst:not([hidden])');
  await page.setInputFiles('#zipinput', `${MAP}/herzip.zip`);
  await page.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  check('herzipt dossier (deflate + extra bestand) importeert', await page.inputValue('#adres') === 'Teststraat 12, Ranst');
  await page.click('#tabbar button[data-tab="details"]');
  check('ramen ook terug uit het herzipte dossier', await page.locator('#ramenlijst li').count() === 2);
  await page.click('#tabbar button[data-tab="algemeen"]');
  await page.click('#tab-algemeen details:nth-of-type(6) summary');
  check('zelf in extra/ gedropt bestand komt mee bij import', await page.locator('#extralijst li').count() === 2);

  /* Finder-stijl (§9.4): macOS zipt de mápp mee (prefix "dossier/") en voegt
     __MACOSX/, ._x en .DS_Store toe — de import moet daar dwars doorheen kijken */
  execSync(`cd "${MAP}" && rm -rf macstijl macstijl.zip && mkdir macstijl && cp -r herzip macstijl/dossier` +
    ` && touch "macstijl/dossier/.DS_Store" && mkdir -p "macstijl/__MACOSX/dossier"` +
    ` && printf 'AppleDouble' > "macstijl/__MACOSX/dossier/._woning.json"` +
    ` && cd macstijl && zip -r -q ../macstijl.zip .`);
  await page.click('#btn-terug');
  await page.waitForSelector('#view-lijst:not([hidden])');
  await page.setInputFiles('#zipinput', `${MAP}/macstijl.zip`);
  await page.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  check('Finder-zip met map-prefix en macOS-metadata importeert', await page.inputValue('#adres') === 'Teststraat 12, Ranst');
  await page.click('#tabbar button[data-tab="fotos"]');
  await page.click('#ruimtechips button[data-v="gevels"]');
  check('foto\'s gevonden ondanks map-prefix', await page.locator('#dossiergrid .dfoto').count() === 2);
  await ctx.close();
}

/* ================= flow 2: failsafes — QuotaExceededError en rode balk ================= */
{
  console.log('flow 2: failsafes');
  const { ctx, page } = await nieuwePagina();
  await page.goto(BASIS);
  await page.click('#btn-nieuwewoning');
  await page.waitForSelector('#app:not([hidden])');
  await page.fill('#adres', 'Foutstraat 1');
  await page.locator('#adres').blur();
  await page.waitForTimeout(800);
  check('rode balk verborgen bij geslaagde write', await page.locator('#foutbalk').isHidden());

  /* injecteer QuotaExceededError op elke put */
  await page.evaluate(() => {
    window.__origPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () { throw new DOMException('vol', 'QuotaExceededError'); };
  });
  await page.fill('#adres', 'Foutstraat 1b');
  await page.locator('#adres').blur();
  await page.waitForSelector('#foutbalk:not([hidden])', { timeout: 3000 });
  const balk = await page.textContent('#foutbalk-tekst');
  check('rode balk met quota-boodschap', balk.includes('NIET OPGESLAGEN') && balk.includes('Opslag vol'));
  const dirtyNa = await page.evaluate(() => dirty);
  check('dirty-vlag blijft staan', dirtyNa === true);

  /* noodklep: Bewaar PDF nu levert een geldige PDF uit het geheugen */
  const [nood] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.click('#btn-noodpdf')
  ]);
  const noodPad = `${MAP}/noodtest.zip`;
  await nood.saveAs(noodPad);
  execSync(`rm -rf ${MAP}/noodzip && mkdir -p ${MAP}/noodzip && unzip -o -q ${noodPad} -d ${MAP}/noodzip && qpdf --check ${MAP}/noodzip/*.pdf`);
  check('nood-dossier geldig (zip + qpdf)', true);
  execSync(`test ! -f ${MAP}/noodzip/hoofdfoto.jpg`);
  check('geen hoofdfoto-lid zonder hoofdfoto', true);

  /* herstel: retry (elke 5 s) doet de write alsnog slagen, balk verdwijnt */
  await page.evaluate(() => { IDBObjectStore.prototype.put = window.__origPut; });
  await page.waitForFunction(() => document.querySelector('#foutbalk').hidden, null, { timeout: 8000 });
  check('balk weg na geslaagde retry', true);
  await ctx.close();
}

/* ================= flow 3: DB-migraties — v1 = clean start, v3 = gegevens behouden ================= */
{
  console.log('flow 3: DB-migraties');
  const { ctx, page } = await nieuwePagina();
  /* oude v1-database zaaien: de app moet die negeren (clean start), niet migreren */
  await page.goto(BASIS + 'manifest.json');
  await page.evaluate(() => new Promise((res, rej) => {
    const q = indexedDB.open('epc-db', 1);
    q.onupgradeneeded = () => {
      q.result.createObjectStore('woningen', { keyPath: 'id' });
      q.result.createObjectStore('instellingen');
    };
    q.onsuccess = () => {
      const t = q.result.transaction('woningen', 'readwrite');
      t.objectStore('woningen').put({ id: 'oud-1', status: 'open', algemeen: { adres: 'Oud record' } });
      t.oncomplete = () => { q.result.close(); res(); };
      t.onerror = () => rej(t.error);
    };
    q.onerror = () => rej(q.error);
  }));

  await page.goto(BASIS);
  await page.waitForSelector('#btn-nieuwewoning');
  const info = await page.evaluate(() => new Promise(res => {
    const q = indexedDB.open('epc-db');
    q.onsuccess = () => {
      const d = q.result;
      const t = d.transaction(['woningen', 'fotos'], 'readonly');
      let w = -1;
      t.objectStore('woningen').count().onsuccess = ev => w = ev.target.result;
      t.oncomplete = () => res({
        versie: d.version,
        stores: [...d.objectStoreNames].sort(),
        index: d.transaction('extra').objectStore('extra').indexNames.contains('woningId'),
        aantalWoningen: w
      });
    };
  }));
  check('DB op versie 4', info.versie === 4);
  check('stores woningen + fotos + extra, geen instellingen', info.stores.join(',') === 'extra,fotos,woningen');
  check('index woningId op extra aanwezig', info.index);
  check('records van vóór v3 leeggemaakt (clean start)', info.aantalWoningen === 0);
  check('lijst toont geen oude woning', await page.locator('#woninglijst .leeg').count() === 1);
  check('geen opslagbanner in de DOM', await page.locator('#opslagbalk').count() === 0);
  check('app start gewoon (nieuwe woning kan)', await page.locator('#btn-nieuwewoning').isVisible());
  await ctx.close();
}

/* ================= flow 4: v3 → v4 behoudt de gegevens (echte dossiers!) ================= */
{
  console.log('flow 4: v3 -> v4 met behoud van data');
  const { ctx, page } = await nieuwePagina();
  await page.goto(BASIS + 'manifest.json');
  await page.evaluate(() => new Promise((res, rej) => {
    const q = indexedDB.open('epc-db', 3);
    q.onupgradeneeded = () => {
      q.result.createObjectStore('woningen', { keyPath: 'id' });
      q.result.createObjectStore('fotos', { keyPath: 'id' }).createIndex('woningId', 'woningId');
    };
    q.onsuccess = () => {
      const t = q.result.transaction('woningen', 'readwrite');
      t.objectStore('woningen').put({
        id: 'v3-woning', nummer: 12, gemaakt: '2026-01-01', gewijzigd: '2026-01-01',
        pdfBewaardOp: null, algemeen: { adres: 'Migratiestraat 3', datum: '2026-01-01', notities: '', hoofdFotoId: null },
        ruimtes: [], ramen: [], energie: { opwekkers: [], pvPanelen: [], zonneboiler: 'nee', zonneboilerM2: '' }, problemen: []
      });
      t.oncomplete = () => { q.result.close(); res(); };
      t.onerror = () => rej(t.error);
    };
    q.onerror = () => rej(q.error);
  }));
  await page.goto(BASIS);
  await page.waitForSelector('#woninglijst li.woning');
  check('v3-woning overleeft de upgrade naar v4', (await page.textContent('#woninglijst .r1')) === '12. Migratiestraat 3');
  await ctx.close();
}

/* ================= flow 5: gemene delen — Hal, privatief raam, verlichting, rondreis ================= */
{
  console.log('flow 5: gemene delen');
  const { ctx, page } = await nieuwePagina();
  await page.goto(BASIS);
  await page.click('#btn-nieuwgd');
  await page.waitForSelector('#app:not([hidden])');
  await page.fill('#adres', 'Residentie Zonnedauw, Geel');
  await page.locator('#adres').blur();

  /* enkel Hal als startruimte */
  await page.click('#tabbar button[data-tab="details"]');
  check('gemene delen starten met enkel Hal',
    (await page.locator('#ruimtechips button:not(.plus)').allTextContents()).join(',') === 'Hal');

  /* verlichting (enkel bij GD zichtbaar) */
  await page.click('#tabbar button[data-tab="algemeen"]');
  check('verlichting-accordeon zichtbaar bij GD', await page.locator('#sec-verlichting').isVisible());
  await page.click('#sec-verlichting summary');
  await page.click('#cy-lamptype');                       /* led -> tl */
  await page.fill('#verl-aantal', '5');
  await page.fill('#verl-watt', '10');
  await page.locator('#verl-watt').blur();
  await page.click('#btn-verl-voegtoe');
  await page.click('#cy-lamptype');                       /* tl -> spaarlamp */
  await page.click('#cy-lamptype');                       /* spaarlamp -> halogeen */
  await page.fill('#verl-aantal', '2');
  await page.locator('#verl-aantal').blur();
  await page.click('#btn-verl-voegtoe');
  check('twee verlichtingsregels', await page.locator('#verllijst li').count() === 2);
  check('totaal lichtpunten en vermogen', (await page.textContent('#verl-totaal')).includes('7 lichtpunten') &&
    (await page.textContent('#verl-totaal')).includes('50 W'));

  /* ramen: één gemeen, één privatief (enkel oppervlakte) */
  await page.click('#tabbar button[data-tab="details"]');
  await page.click('#sec-ramen summary');
  await page.fill('#breedte', '1');
  await page.fill('#hoogte', '2,2');
  await page.locator('#hoogte').blur();
  await page.click('#btn-voegtoe');
  check('privatief-cycle zichtbaar bij GD', await page.locator('#cy-privatief').isVisible());
  await page.click('#cy-privatief');                      /* gemeen -> privatief */
  check('privatief verbergt beglazing/kader/rolluik',
    await page.locator('#cy-beglazing').isHidden() && await page.locator('#cy-kader').isHidden() && await page.locator('#cy-rolluik').isHidden());
  await page.fill('#breedte', '1,2');
  await page.fill('#hoogte', '1,5');
  await page.fill('#aantal', '6');
  await page.locator('#aantal').blur();
  await page.click('#btn-voegtoe');
  check('privatief element met tag in de lijst', (await page.textContent('#ramenlijst')).includes('privatief'));

  /* afronden: GD-controlelijst */
  await page.click('#tabbar button[data-tab="afronden"]');
  const checks = await page.locator('#checklijst li').allTextContents();
  check('GD-checklist: ramen ingegeven ✅', checks[0].includes('✅') && checks[0].includes('Ramen & deuren'));
  check('GD-checklist: verlichting ✅', checks[1].includes('✅') && checks[1].includes('Verlichting'));
  check('GD-checklist: hoofdfoto ❌', checks[2].includes('❌') && checks[2].includes('Hoofdfoto'));

  /* export: json bevat soort, privatief en verlichting */
  const [gdDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.click('#btn-print')
  ]);
  check('zip-naam met GD-voorvoegsel', gdDownload.suggestedFilename() === '1. GD Residentie Zonnedauw, Geel.zip');
  const gdZip = `${MAP}/gdtest.zip`;
  await gdDownload.saveAs(gdZip);
  execSync(`rm -rf ${MAP}/gdzip && mkdir -p ${MAP}/gdzip && unzip -o -q "${gdZip}" -d ${MAP}/gdzip`);
  const gdJson = JSON.parse(readFileSync(`${MAP}/gdzip/woning.json`, 'utf8')).woning;
  check('json: soort gemene-delen', gdJson.soort === 'gemene-delen');
  const gdEls = gdJson.ruimtes.find(r => r.naam === 'Hal').elementen;
  const priv = gdEls.find(e => e.privatief);
  check('json: privatief element enkel oppervlakte', priv && priv.aantal === 6 && !('kader' in priv) && !('beglazing' in priv) && !('rolluik' in priv));
  check('json: verlichting met wattPerLamp', gdJson.energie.verlichting.length === 2 && gdJson.energie.verlichting[0].wattPerLamp === 10 && !('wattPerLamp' in gdJson.energie.verlichting[1]));

  /* rondreis: import geeft opnieuw een gemene-delen-dossier */
  await page.click('#btn-terug');
  await page.waitForSelector('#view-lijst:not([hidden])');
  await page.setInputFiles('#zipinput', gdZip);
  await page.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  check('import: verlichting terug', (await page.textContent('#verl-totaal')).includes('7 lichtpunten'));
  await page.click('#tabbar button[data-tab="details"]');
  check('import: privatief element terug', (await page.textContent('#ramenlijst')).includes('privatief'));
  await page.click('#btn-terug');
  await page.waitForSelector('#view-lijst:not([hidden])');
  check('lijst toont "GD " voor het adres bij gemene delen', /\d+\. GD Residentie Zonnedauw/.test(await page.textContent('#woninglijst')));
  await ctx.close();
}

server.close();
console.log(`flow-test: ${ok} checks OK`);
