/* Echte-serverproef (SPEC.md §11): een draaiende https-WebDAV-server met een
   zelfondertekend certificaat, en de échte app ertegenaan. Bewijst twee dingen:
   1. met een NIET-vertrouwd certificaat faalt elke fetch — geen app-fout;
   2. met een vertrouwd certificaat werkt de upload wél.
   Draaien: node nas-echt.mjs */
import { chromium } from 'playwright-core';
import { createServer } from 'node:https';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { strict as assert } from 'node:assert';
import { serveer } from './serveer.mjs';

const HIER = dirname(fileURLToPath(import.meta.url));
const CERT = join(HIER, 'uitvoer', 'nascert');
const NAS_POORT = 5006;
const APP_POORT = 8129;
const NAS = `https://127.0.0.1:${NAS_POORT}`;

/* minimale WebDAV-NAS mét nette CORS-headers, zodat enkel het certificaat
   het verschil maakt tussen de twee proeven */
const ontvangen = [];
const nas = createServer(
  { key: readFileSync(join(CERT, 'key.pem')), cert: readFileSync(join(CERT, 'cert.pem')) },
  (req, res) => {
    let n = 0;
    req.on('data', c => { n += c.length; });
    req.on('end', () => {
      ontvangen.push({ methode: req.method, pad: decodeURIComponent(req.url), bytes: n, auth: req.headers.authorization || '' });
      const cors = {
        'Access-Control-Allow-Origin': req.headers.origin || '*',
        'Access-Control-Allow-Methods': 'GET,PUT,DELETE,PROPFIND,MKCOL,OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization,Depth,Content-Type'
      };
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
      if (req.method === 'PROPFIND') {
        res.writeHead(207, { ...cors, 'Content-Type': 'application/xml' });
        return res.end('<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">' +
          `<d:response><d:href>${req.url}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>` +
          `<d:response><d:href>${req.url.replace(/\/?$/, '/')}EPC</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>` +
          '</d:multistatus>');
      }
      res.writeHead(req.method === 'PUT' ? 201 : 204, cors);
      res.end();
    });
  }
);
await new Promise(r => nas.listen(NAS_POORT, '127.0.0.1', r));
const app = await serveer(APP_POORT);

/* de app draait op http://127.0.0.1 — door browsers als veilige oorsprong
   behandeld, net als de echte https-oorsprong op GitHub Pages */
async function proef(vertrouwd) {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, ignoreHTTPSErrors: vertrouwd });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${APP_POORT}/`);
  await page.waitForSelector('#btn-instellingen');
  await page.evaluate(nas => localStorage.setItem('epc-nas', JSON.stringify(
    { aan: true, server: nas, gebruiker: 'mile', wachtwoord: 'geheim', map: 'home/EPC' })), NAS);
  await page.click('#btn-instellingen');
  await page.click('#btn-nas-test');
  await page.waitForFunction(() => !document.querySelector('#nas-uitslag').hidden, null, { timeout: 30000 });
  const uitslag = await page.textContent('#nas-uitslag');
  await browser.close();
  return uitslag;
}

console.log('proef 1: certificaat NIET vertrouwd (zoals een verse iPhone)');
ontvangen.length = 0;
const zonder = await proef(false);
console.log('   uitslag in de app :', zonder);
console.log('   server zag        :', ontvangen.length ? ontvangen.map(o => o.methode).join(', ') : '(niets — de browser belde nooit)');
assert.ok(/niet bereikbaar/.test(zonder), 'onvertrouwd certificaat -> onbereikbaar');
assert.equal(ontvangen.length, 0, 'de browser stuurt niets: het blokkeert vóór het netwerk');

console.log('proef 2: zelfde server, certificaat WEL vertrouwd');
ontvangen.length = 0;
const met = await proef(true);
console.log('   uitslag in de app :', met);
console.log('   server zag        :', ontvangen.map(o => `${o.methode} ${o.pad}`).join(' | '));
assert.ok(/Verbinding ok/.test(met), 'vertrouwd certificaat -> verbinding ok');
assert.ok(ontvangen.some(o => o.methode === 'PUT' && o.auth.startsWith('Basic ')), 'PUT met Basic-auth aangekomen');

nas.close();
app.close();
console.log('nas-echt: bewezen — het certificaat is de blokkade, niet de app');
