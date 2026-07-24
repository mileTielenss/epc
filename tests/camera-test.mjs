/* Camera-flows: de fake-camera-vlaggen bestaan enkel in Chromium, dus dit
   deel draait daar (SPEC.md §11 noteert al: WebKit ≠ mobile Safari). */
import { chromium } from 'playwright-core';
import { strict as assert } from 'node:assert';
import { serveer } from './serveer.mjs';

const POORT = 8124;
const BASIS = `http://127.0.0.1:${POORT}/`;
const server = await serveer(POORT);
let ok = 0;
const check = (naam, cond) => { assert.ok(cond, naam); ok++; console.log('  ✓', naam); };

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
});
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, permissions: ['camera'] });
const page = await ctx.newPage();
page.on('dialog', d => d.accept());
await page.goto(BASIS);
await page.click('#btn-nieuwewoning');
await page.waitForSelector('#app:not([hidden])');

/* dossier-modus: overlay blijft open, elke tik een foto in de actieve groep */
await page.click('#tabbar button[data-tab="fotos"]');
await page.click('#btn-camera');
await page.waitForSelector('#camera:not([hidden])');
check('camera-overlay open', true);
check('ruimtechips in camera', await page.locator('#camruimtes button').count() >= 3);
/* de camera opent in de gedeelde ruimteselectie (eerste ruimte, §7.2):
   voor deze flow eerst expliciet naar Gevels wisselen */
await page.click('#camruimtes button[data-v="gevels"]');
await page.waitForFunction(() => document.querySelector('#camvideo').videoWidth > 0);
await page.click('#btn-sluiter');
await page.waitForFunction(() => document.querySelector('#camteller').textContent.includes('1'));
await page.click('#btn-sluiter');
await page.waitForFunction(() => document.querySelector('#camteller').textContent.includes('2'));
check('teller telt 2 foto\'s', true);
/* wisselen van groep zonder sluiten */
await page.click('#camruimtes button[data-v="algemeen"]');
await page.waitForFunction(() => document.querySelector('#camvideo').videoWidth > 0);
await page.click('#btn-sluiter');
await page.waitForTimeout(600);
await page.click('#btn-camklaar');
check('camera dicht na Klaar', await page.locator('#camera').isHidden());
check('1 foto in Algemeen (gewisseld in camera)', await page.locator('#dossiergrid .dfoto').count() === 1);
await page.click('#ruimtechips button[data-v="gevels"]');
check('2 foto\'s in Gevels', await page.locator('#dossiergrid .dfoto').count() === 2);

/* enkel-modus: één tik, foto op zijn plek, camera dicht */
await page.click('#tabbar button[data-tab="algemeen"]');
await page.click('#tab-algemeen details:nth-of-type(2) summary');
await page.click('#btn-opwekfoto');
await page.waitForSelector('#camera:not([hidden])');
check('enkel-modus: geen chips', await page.locator('#camruimtes').isHidden());
check('enkel-modus: knop Annuleer', (await page.textContent('#btn-camklaar')) === 'Annuleer');
await page.waitForFunction(() => document.querySelector('#camvideo').videoWidth > 0);
await page.click('#btn-sluiter');
await page.waitForSelector('#opwekfotos .fotomini');
check('kenplaatfoto op zijn plek, camera dicht', await page.locator('#camera').isHidden());

/* persistentie van de camerafoto's na reload */
await page.reload();
await page.click('#woninglijst li.woning');
await page.waitForSelector('#app:not([hidden])');
await page.click('#tabbar button[data-tab="fotos"]');
await page.click('#ruimtechips button[data-v="gevels"]');
check('camerafoto\'s bewaard na reload', await page.locator('#dossiergrid .dfoto').count() === 2);

await browser.close();
server.close();
console.log(`camera-test: ${ok} checks OK`);
