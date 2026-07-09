/* Dekkingsrapport: draait de Node-tests (NODE_V8_COVERAGE) en de
   Chromium-dekkingssuite, voegt alle V8-dekking samen en eist 100%
   regeldekking op de vijf JS-bestanden van de app (SPEC.md §11). */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import v8toIstanbul from 'v8-to-istanbul';
import libCoverage from 'istanbul-lib-coverage';

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = join(HIER, '..');
const V8NODE = join(HIER, 'uitvoer', 'v8node');
const V8BROWSER = join(HIER, 'uitvoer', 'v8browser');
const BESTANDEN = ['app.js', 'db.js', 'maakpdf.js', 'pdfworker.js', 'sw.js'];

/* ---- 1. Node-tests met V8-dekking ---- */
rmSync(V8NODE, { recursive: true, force: true });
mkdirSync(V8NODE, { recursive: true });
for (const t of ['unittest-maakpdf.mjs', 'test-pdfworker.mjs', 'test-sw.mjs']) {
  const r = spawnSync('node', [join(HIER, t)], {
    env: { ...process.env, NODE_V8_COVERAGE: V8NODE }, stdio: 'inherit'
  });
  if (r.status !== 0) { console.error(`${t} faalde`); process.exit(1); }
}

/* ---- 2. Chromium-dekkingssuite ---- */
{
  const r = spawnSync('node', [join(HIER, 'coverage-test.mjs')], { stdio: 'inherit' });
  if (r.status !== 0) { console.error('coverage-test.mjs faalde'); process.exit(1); }
}

/* ---- 3. alles samenvoegen ---- */
const map = libCoverage.createCoverageMap({});
const bronnen = new Map(BESTANDEN.map(b => [b, readFileSync(join(REPO, b), 'utf8')]));

function bestandVoorUrl(url) {
  const m = /\/(app|db|maakpdf|pdfworker|sw)\.js$/.exec(url || '');
  return m ? `${m[1]}.js` : null;
}

async function voegToe(url, functions, source) {
  const bestand = bestandVoorUrl(url);
  if (!bestand) return;
  const pad = join(REPO, bestand);
  const conv = v8toIstanbul(pad, 0, { source: source || bronnen.get(bestand) });
  await conv.load();
  conv.applyCoverage(functions);
  map.merge(conv.toIstanbul());
}

for (const f of readdirSync(V8NODE).filter(f => f.endsWith('.json'))) {
  const dump = JSON.parse(readFileSync(join(V8NODE, f), 'utf8'));
  for (const entry of dump.result || []) await voegToe(entry.url, entry.functions);
}
for (const f of readdirSync(V8BROWSER).filter(f => f.endsWith('.json'))) {
  for (const entry of JSON.parse(readFileSync(join(V8BROWSER, f), 'utf8'))) {
    await voegToe(entry.url, entry.functions, entry.source);
  }
}

/* ---- 4. rapport ---- */
let alles100 = true;
console.log('\nregeldekking:');
for (const bestand of BESTANDEN) {
  const pad = join(REPO, bestand);
  if (!map.files().includes(pad)) { console.log(`  ${bestand}: GEEN DEKKING`); alles100 = false; continue; }
  const fc = map.fileCoverageFor(pad);
  const s = fc.toSummary();
  const gemist = Object.entries(fc.getLineCoverage()).filter(([, n]) => n === 0).map(([l]) => l);
  console.log(`  ${bestand}: ${s.lines.pct}% lijnen (${s.lines.covered}/${s.lines.total}) · ${s.branches.pct}% takken · ${s.functions.pct}% functies` +
    (gemist.length ? ` · gemist: ${gemist.join(', ')}` : ''));
  if (s.lines.pct !== 100) alles100 = false;
}
if (!alles100) { console.error('\ndekking is geen 100% — zie de gemiste regels hierboven'); process.exit(1); }
console.log('\n100% regeldekking op alle vijf bestanden ✔');
