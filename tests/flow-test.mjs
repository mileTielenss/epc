/* Klikflows op WebKit, iPhone-viewport (SPEC.md §11).
   Draaien: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node flow-test.mjs */
import { webkit } from 'playwright-core';
import { readFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
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

  /* verstopt knopje (§7.1): lange druk op de titel corrigeert het dossiernummer */
  promptAntwoord = '7';
  await page.locator('#titel').hover();
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('#titel').textContent === '7. Teststraat 12, Ranst');
  check('lange druk zet dossiernummer', (await page.textContent('#titel')) === '7. Teststraat 12, Ranst');
  /* terug naar het standaardnummer voor de rest van de flow (zip-naam) */
  promptAntwoord = '1';
  await page.locator('#titel').hover();
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('#titel').textContent === '1. Teststraat 12, Ranst');
  promptAntwoord = '';

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

  await page.waitForSelector('#pdf-bewaard:not([hidden])');
  check('grijze regel "Dossier bewaard op"', (await page.textContent('#pdf-bewaard')).startsWith('Dossier bewaard op'));
  check('verwijderen nu mogelijk', !(await delKnop.isDisabled()) && (await delKnop.textContent()) === 'Woning verwijderen');

  await page.click('#btn-verwijder-woning');
  await page.waitForSelector('#view-lijst:not([hidden])');
  check('woning + foto\'s verwijderd', await page.locator('#woninglijst .leeg').count() === 1);
  const dbLeeg = await page.evaluate(() => new Promise(res => {
    const q = indexedDB.open('epc-db');
    q.onsuccess = () => {
      const t = q.result.transaction(['woningen', 'fotos'], 'readonly');
      let w, f;
      t.objectStore('woningen').count().onsuccess = e => w = e.target.result;
      t.objectStore('fotos').count().onsuccess = e => f = e.target.result;
      t.oncomplete = () => res({ w, f });
    };
  }));
  check('stores leeg (één transactie wiste alles)', dbLeeg.w === 0 && dbLeeg.f === 0);

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

/* ================= flow 3: DB versie 3, geen upgradepad, geen opslagbanner ================= */
{
  console.log('flow 3: DB v3 zonder upgradepad');
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
        index: d.transaction('fotos').objectStore('fotos').indexNames.contains('woningId'),
        aantalWoningen: w
      });
    };
  }));
  check('DB op versie 3', info.versie === 3);
  check('stores woningen + fotos, geen instellingen', info.stores.join(',') === 'fotos,woningen');
  check('index woningId aanwezig', info.index);
  check('oude records leeggemaakt (clean start)', info.aantalWoningen === 0);
  check('lijst toont geen oude woning', await page.locator('#woninglijst .leeg').count() === 1);
  check('geen opslagbanner in de DOM', await page.locator('#opslagbalk').count() === 0);
  check('app start gewoon (nieuwe woning kan)', await page.locator('#btn-nieuwewoning').isVisible());
  await ctx.close();
}

server.close();
console.log(`flow-test: ${ok} checks OK`);
