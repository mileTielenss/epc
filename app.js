'use strict';

/* ============================== app.js ==============================
   UI en applicatielogica. De app kent geen versie: VERSIE leeft enkel in
   sw.js en wordt hieronder één keer uitgelezen voor /Producer in de PDF. */

/* ============================== helpers ============================== */

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function vandaag() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function nu() { return new Date().toISOString(); }

function num(s) {
  const v = parseFloat(String(s).trim().replace(',', '.'));
  return isFinite(v) && v > 0 ? v : 0;
}
function fmt(n, d = 2) { return n.toFixed(d).replace('.', ','); }
/* meters tonen zoals de digitale meter: komma, zonder onnodige nullen (bv. 1,335 of 2,4) */
function fmtM(m) {
  return String(Math.round(m * 1000) / 1000).replace('.', ',');
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function datumUur(iso) {
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 1800);
}

function flash(btn) {
  btn.classList.add('flash');
  setTimeout(() => btn.classList.remove('flash'), 200);
}

/* versie uit sw.js (staat mee in de eigen cache, dus dit is de draaiende versie) */
let swVersie = '';
fetch('./sw.js').then(r => r.text()).then(t => {
  const m = t.match(/VERSIE\s*=\s*'([^']+)'/);
  if (m) swVersie = m[1];
}).catch(() => { /* offline zonder cache: PDF krijgt dan geen versienummer */ });

/* ============================== balken en save-bolletje (§6) ============================== */

let bolletjeTimer = null;
function toonBolletje() {
  const b = $('#bolletje');
  b.hidden = false;
  clearTimeout(bolletjeTimer);
  bolletjeTimer = setTimeout(() => { b.hidden = true; }, 400);
}

function zetRodeBalk(tekst) {
  $('#foutbalk-tekst').textContent = tekst;
  $('#foutbalk').hidden = false;
}
function wisRodeBalk() {
  if (DB.inGeheugen()) return; /* geheugenmodus: balk blijft permanent */
  $('#foutbalk').hidden = true;
}

/* ============================== woningmodel ============================== */

const VENT_MODES = ['geen', 'natuurlijk', 'mechanisch', 'mechanisch-permanent', 'ander'];
const VENT_NAMEN = {
  geen: 'geen', natuurlijk: 'natuurlijk', mechanisch: 'mechanisch',
  'mechanisch-permanent': 'mechanisch permanent', ander: 'ander'
};
const ELEMENTEN = ['raam', 'deur', 'dakraam'];
const GEVELS = ['voor', 'achter', 'links', 'rechts'];
const BEGLAZINGEN = ['enkel', 'dubbel', 'hr-dubbel', 'drievoudig', 'paneel'];
const KADERS = ['pvc', 'alu', 'hout'];
const OPWEK_TYPES = ['gas', 'stookolie', 'andere', 'airco', 'kachel', 'ruimte-andere'];
const FUNCTIES = ['radiatoren', 'vloer', 'sww'];
const PV_ORIENTATIES = ['plat', 'voor', 'achter', 'links', 'rechts', ''];

const ELEMENT_NAMEN = { raam: 'Raam', deur: 'Deur', dakraam: 'Dakraam' };
const GEVEL_NAMEN = { voor: 'Voor', achter: 'Achter', links: 'Links', rechts: 'Rechts' };
const GLAS_NAMEN = { enkel: 'Enkel', dubbel: 'Dubbel', 'hr-dubbel': 'HR dubbel', drievoudig: 'Drievoudig', paneel: 'Vol paneel' };
const KADER_NAMEN = { pvc: 'PVC', alu: 'Alu', hout: 'Hout' };
const OPWEK_NAMEN = { gas: 'Gas', stookolie: 'Stookolie', andere: 'Andere', airco: 'Airco', kachel: 'Kachel', 'ruimte-andere': 'Andere' };
const FUNCTIE_NAMEN = { radiatoren: 'radiatoren', vloer: 'vloerverwarming', sww: 'warm water' };
const PVOR_NAMEN = { '': '—', plat: 'Plat dak', voor: 'Voor', achter: 'Achter', links: 'Links', rechts: 'Rechts' };

function nieuweRuimte(naam) {
  return { id: DB.nieuwId(), naam, vent: 'geen', ventBeschrijving: '', opm: '', afm: null };
}

function standaardRuimtes() {
  return ['Living', 'Keuken', 'Badkamer', 'WC', 'Slaapkamer 1', 'Hal'].map(nieuweRuimte);
}

function leegWoning() {
  return {
    id: DB.nieuwId(),
    gemaakt: nu(),
    gewijzigd: nu(),
    pdfBewaardOp: null,
    algemeen: { adres: '', datum: vandaag(), notities: '', hoofdFotoId: null },
    ruimtes: standaardRuimtes(),
    ramen: [],
    energie: { opwekkers: [], pvPanelen: [], zonneboiler: 'nee', zonneboilerM2: '' },
    problemen: []
  };
}

/* defaults aanvullen, enums en verwijzingen controleren; elke correctie wordt
   gelogd in woning.problemen[] en gemeld — stil corrigeren is verboden (§5.1).
   Vereist dat de foto's van de woning al geladen zijn (dode fotoId's). */
function normaliseer(p) {
  const fix = [];
  const basis = leegWoning();
  const w = {
    ...basis, ...p,
    algemeen: { ...basis.algemeen, ...(p.algemeen || {}) },
    energie: { ...basis.energie, ...(p.energie || {}) }
  };
  if (!Array.isArray(w.problemen)) w.problemen = [];

  const fotoOk = id => !!id && !!DB.fotoRecord(id);
  const enumOf = (v, set, def, wat) => {
    if (set.includes(v)) return v;
    if (v !== undefined) fix.push(`${wat}: onbekende waarde "${v}" vervangen door "${def}"`);
    return def;
  };

  if (!Array.isArray(w.ruimtes) || !w.ruimtes.length) { w.ruimtes = standaardRuimtes(); fix.push('ruimtes ontbraken: standaardruimtes teruggezet'); }
  w.ruimtes = groepeerRuimtes(w.ruimtes.map(r => {
    if (!r.id) fix.push(`ruimte "${r.naam || '?'}" kreeg een nieuw id`);
    return {
      id: r.id || DB.nieuwId(),
      naam: String(r.naam || 'Ruimte'),
      vent: enumOf(r.vent, VENT_MODES, 'geen', `ventilatie van ${r.naam || 'ruimte'}`),
      ventBeschrijving: r.ventBeschrijving || '',
      opm: r.opm || '',
      afm: r.afm && num(r.afm.b) && num(r.afm.d) && num(r.afm.h)
        ? { b: num(r.afm.b), d: num(r.afm.d), h: num(r.afm.h) } : null
    };
  }));
  const ruimteIds = new Set(w.ruimtes.map(r => r.id));
  const ruimteRef = (id, wat) => {
    if (!id) return null;
    if (ruimteIds.has(id)) return id;
    fix.push(`${wat}: verwees naar een verwijderde ruimte`);
    return null;
  };
  const fotoRef = (id, wat) => {
    if (!id) return null;
    if (fotoOk(id)) return id;
    fix.push(`${wat}: foto onvindbaar, verwijzing gewist`);
    return null;
  };

  if (!Array.isArray(w.ramen)) w.ramen = [];
  w.ramen = w.ramen.map((r, i) => {
    const element = enumOf(r.element, ELEMENTEN, 'raam', `element ${i + 1}`);
    let beglazing;
    if (element === 'deur') {
      if (r.beglazing != null) fix.push(`element ${i + 1}: een deur heeft geen beglazing, waarde gewist`);
      beglazing = null;
    } else {
      beglazing = enumOf(r.beglazing, BEGLAZINGEN, 'dubbel', `beglazing van element ${i + 1}`);
    }
    return {
      id: r.id || DB.nieuwId(),
      ruimteId: ruimteRef(r.ruimteId, `element ${i + 1}`),
      element,
      gevel: enumOf(r.gevel, GEVELS, 'voor', `gevel van element ${i + 1}`),
      b: num(r.b), h: num(r.h),
      aantal: Math.max(1, Math.round(num(r.aantal)) || 1),
      beglazing,
      kader: enumOf(r.kader, KADERS, 'pvc', `kader van element ${i + 1}`),
      rolluik: !!r.rolluik,
      fotoId: fotoRef(r.fotoId, `foto van element ${i + 1}`)
    };
  });

  if (!Array.isArray(w.energie.opwekkers)) w.energie.opwekkers = [];
  w.energie.opwekkers = w.energie.opwekkers.map((o, i) => ({
    id: o.id || DB.nieuwId(),
    type: enumOf(o.type, OPWEK_TYPES, 'andere', `opwekker ${i + 1}`),
    ruimteId: ruimteRef(o.ruimteId, `opwekker ${i + 1}`),
    functie: (Array.isArray(o.functie) ? o.functie : []).filter(f => FUNCTIES.includes(f)),
    beschrijving: o.beschrijving || '',
    fotoId: fotoRef(o.fotoId, `kenplaat van opwekker ${i + 1}`),
    fotoKraanId: fotoRef(o.fotoKraanId, `kranenfoto van opwekker ${i + 1}`)
  }));
  if (!Array.isArray(w.energie.pvPanelen)) w.energie.pvPanelen = [];
  w.energie.pvPanelen = w.energie.pvPanelen.map(pv => ({
    id: pv.id || DB.nieuwId(),
    orientatie: PV_ORIENTATIES.includes(pv.orientatie) ? pv.orientatie : '',
    wp: String(pv.wp || '')
  }));
  w.energie.zonneboiler = w.energie.zonneboiler === 'ja' ? 'ja' : 'nee';
  if (typeof w.energie.zonneboilerM2 !== 'string') w.energie.zonneboilerM2 = '';

  /* hoofdfoto moet een bestaande foto met groep 'gevels' zijn */
  if (w.algemeen.hoofdFotoId) {
    const rec = DB.fotoRecord(w.algemeen.hoofdFotoId);
    if (!rec || rec.groep !== 'gevels') {
      fix.push('hoofdfoto was geen gevelfoto meer, keuze gewist');
      w.algemeen.hoofdFotoId = null;
    }
  }

  if (w.pdfBewaardOp !== null && typeof w.pdfBewaardOp !== 'string') w.pdfBewaardOp = null;
  if (!w.id) w.id = DB.nieuwId();

  if (fix.length) {
    w.problemen.push(...fix.map(f => `${nu()} ${f}`));
    toast(`${fix.length} gegeven${fix.length === 1 ? '' : 's'} hersteld`);
  }
  return w;
}

/* ============================== actieve woning + autosave (§6) ============================== */

let S = null;            /* actieve woning, null = lijstscherm */
let dirty = false;
let bewaarTimer = null;  /* debounce 500 ms */
let wijzigStand = 0;     /* generatieteller: een wijziging tijdens een lopende
                            write blijft dirty (IDB kloont bij put, dus die
                            wijziging zit niet in de weggeschreven kopie) */
let retryTimer = null;   /* rode balk: retry elke 5 s */
let volgTeller = 0;      /* volgorde voor nieuwe dossierfoto's */

function wijzig() {
  if (!S) return;
  dirty = true;
  wijzigStand++;
  clearTimeout(bewaarTimer);
  bewaarTimer = setTimeout(bewaar, 500);
}

async function bewaar() {
  if (!S || !dirty) return;
  clearTimeout(bewaarTimer);
  const stand = wijzigStand;
  S.gewijzigd = nu();
  try {
    await DB.putWoning(S);
    if (stand === wijzigStand) dirty = false;
    wisRodeBalk();
    stopRetry();
    toonBolletje();
  } catch (e) {
    const naam = e && e.name ? e.name : 'Onbekende fout';
    zetRodeBalk(naam === 'QuotaExceededError'
      ? 'NIET OPGESLAGEN — Opslag vol — bewaar de PDF en verwijder een afgewerkte woning'
      : `NIET OPGESLAGEN — ${naam}`);
    startRetry();
  }
}

function startRetry() {
  if (retryTimer) return;
  retryTimer = setInterval(() => { if (S && dirty) bewaar(); }, 5000);
}
function stopRetry() {
  clearInterval(retryTimer);
  retryTimer = null;
}

window.addEventListener('pagehide', () => {
  commitUndo();
  if (S && dirty) bewaar();
  DB.revokeUrls();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && S && dirty) bewaar();
});

/* ============================== views ============================== */

function toonLijst() {
  $('#view-lijst').hidden = false;
  $('#app').hidden = true;
  $('#tabbar').hidden = true;
  $('#btn-terug').hidden = true;
  $('#ruimtebalk').hidden = true;
  $('#titel').textContent = 'EPC Plaatsbezoek';
}

function toonEditor() {
  $('#view-lijst').hidden = true;
  $('#app').hidden = false;
  $('#tabbar').hidden = false;
  $('#btn-terug').hidden = false;
  zetTab('algemeen');
  zetTitel();
}

let actieveTab = 'algemeen';
function zetTab(naam) {
  if (naam === 'afronden' && S) renderAfronden();
  actieveTab = naam;
  $$('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === naam));
  $$('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + naam));
  $('#ruimtebalk').hidden = !['details', 'fotos'].includes(naam);
  /* op Details is altijd één echte ruimte gekozen */
  if (naam === 'details' && S && !huidigeRuimte() && S.ruimtes.length) {
    ruimteSel = S.ruimtes[0].id;
  }
  if (S) renderRuimtebalk();
  window.scrollTo(0, 0);
}

function zetTitel() {
  $('#titel').textContent = (S && S.algemeen.adres) || 'Nieuwe woning';
}

async function openWoning(id) {
  let w;
  try { w = await DB.getWoning(id); } catch (e) { toast('Woning laden mislukt'); return; }
  if (!w) { toast('Woning niet gevonden'); return; }
  await DB.laadFotos(w.id);
  S = normaliseer(w);
  volgTeller = 0;
  DB.geladenFotos().forEach(f => { if ((f.volgorde || 0) > volgTeller) volgTeller = f.volgorde; });
  dirty = false;
  draft = leegDraft();
  draftOpwek = leegDraftOpwek();
  syncAlles();
  toonEditor();
}

async function sluitWoning() {
  commitUndo();
  if (S && dirty) await bewaar();
  DB.sluitWoning();
  S = null;
  await renderLijst();
  toonLijst();
}

$('#btn-terug').addEventListener('click', sluitWoning);
$('#btn-sluiten').addEventListener('click', sluitWoning);

/* ============================== woningenlijst (§7.1) ============================== */

let lijstUrls = [];

async function renderLijst() {
  lijstUrls.forEach(u => URL.revokeObjectURL(u));
  lijstUrls = [];
  let alle = [];
  try { alle = await DB.alleWoningen(); } catch (e) { /* lege lijst tonen */ }
  alle.sort((a, b) => (b.gewijzigd || '').localeCompare(a.gewijzigd || ''));
  const ul = $('#woninglijst');
  ul.innerHTML = '';
  if (!alle.length) {
    ul.innerHTML = '<li class="leeg">Nog geen woningen. Start hieronder een nieuwe.</li>';
    return;
  }
  for (const w of alle) {
    const li = document.createElement('li');
    li.className = 'woning';
    li.dataset.id = w.id;
    let thumb = '';
    if (w.algemeen && w.algemeen.hoofdFotoId) {
      try {
        const rec = await DB.getFoto(w.algemeen.hoofdFotoId);
        if (rec) {
          const url = URL.createObjectURL(rec.blob);
          lijstUrls.push(url);
          thumb = `<img class="thumb" src="${url}" alt="">`;
        }
      } catch (e) { /* geen thumb */ }
    }
    const klaar = !!w.pdfBewaardOp;
    li.innerHTML =
      thumb +
      `<div class="info">
         <div class="r1">${esc((w.algemeen && w.algemeen.adres) || 'Zonder adres')}</div>
         <div class="r3">${esc((w.algemeen && w.algemeen.datum) || '')}</div>
       </div>
       <span class="status ${klaar ? 'klaar' : ''}">${klaar ? 'PDF ✓' : 'Open'}</span>`;
    ul.appendChild(li);
  }
}

$('#woninglijst').addEventListener('click', e => {
  if (e.target.closest('img.thumb')) return; /* tik op fotominiatuur: enkel lightbox */
  const li = e.target.closest('li.woning');
  if (li) openWoning(li.dataset.id);
});

$('#btn-nieuwewoning').addEventListener('click', async () => {
  DB.sluitWoning();
  S = leegWoning();
  volgTeller = 0;
  draft = leegDraft();
  draftOpwek = leegDraftOpwek();
  dirty = true;
  await bewaar();
  syncAlles();
  toonEditor();
});

/* ---------- dossier importeren (§9.4): dezelfde zip komt integraal terug ---------- */

$('#btn-importeer').addEventListener('click', () => {
  $('#zipinput').value = '';
  $('#zipinput').click();
});
$('#zipinput').addEventListener('change', async () => {
  const f = $('#zipinput').files[0];
  if (!f) return;
  toast('Importeren…');
  try {
    const leden = leesZip(new Uint8Array(await f.arrayBuffer()));
    const jsonLid = leden.find(l => l.naam === 'woning.json');
    if (!jsonLid) throw new Error('geen woning.json in de zip');
    const dossier = JSON.parse(new TextDecoder().decode(jsonLid.bytes));
    if (dossier.formaat !== 'epc-plaatsbezoek-dossier') throw new Error('onbekend formaat');
    await importeerDossier(dossier.woning || {}, new Map(leden.map(l => [l.naam, l.bytes])));
  } catch (e) {
    toast(`Importeren mislukt (${(e && e.message) || e})`);
  }
});

const FUNCTIE_TERUG = { radiatoren: 'radiatoren', vloerverwarming: 'vloer', 'sanitair warm water': 'sww' };
const PV_TERUG = { 'plat dak': 'plat', voor: 'voor', achter: 'achter', links: 'links', rechts: 'rechts', '': '' };

async function importeerDossier(d, leden) {
  const w = leegWoning();
  w.algemeen.adres = d.adres || '';
  if (d.datumPlaatsbezoek) w.algemeen.datum = d.datumPlaatsbezoek;
  w.algemeen.notities = d.notities || '';

  const naamNaarId = new Map();
  w.ruimtes = (d.ruimtes || []).map(r => {
    const ruimte = nieuweRuimte(String(r.naam || 'Ruimte'));
    ruimte.vent = r.ventilatie || 'geen';
    ruimte.ventBeschrijving = r.ventilatieBeschrijving || '';
    ruimte.opm = r.opmerking || '';
    ruimte.afm = r.afmetingen ? { b: r.afmetingen.breedteM, d: r.afmetingen.diepteM, h: r.afmetingen.hoogteM } : null;
    naamNaarId.set(ruimte.naam, ruimte.id);
    return ruimte;
  });
  if (!w.ruimtes.length) w.ruimtes = standaardRuimtes();

  /* eerst de woning en de foto's, pas daarna de verwijzingen; mislukt er iets,
     dan wordt alles weer opgeruimd — geen halve import (§9.4) */
  try {
    await DB.putWoning(w);
    await DB.laadFotos(w.id);

    const fotoIdVan = new Map(); /* bestand in fotos/ -> nieuw fotoId */
    let hoofdFotoId = null;
    for (const foto of (d.fotos || [])) {
      const bytes = leden.get(foto.bestand);
      if (!bytes) continue;
      let groep = null;
      if (foto.groep === 'Gevels') groep = 'gevels';
      else if (foto.groep === 'Algemeen') groep = 'algemeen';
      else if (foto.groep) groep = naamNaarId.get(foto.groep) || null;
      const rec = {
        id: DB.nieuwId(), woningId: w.id,
        blob: new Blob([bytes], { type: 'image/jpeg' }),
        breedte: foto.breedte || 1600, hoogte: foto.hoogte || 1200,
        groep, volgorde: foto.volgorde || 0, gemaakt: nu()
      };
      await DB.putFoto(rec);
      fotoIdVan.set(foto.bestand, rec.id);
      if (foto.hoofdfoto && groep === 'gevels') hoofdFotoId = rec.id;
    }
    w.algemeen.hoofdFotoId = hoofdFotoId;

    w.ramen = (d.ramenEnDeuren || []).map(r => ({
      id: DB.nieuwId(),
      ruimteId: naamNaarId.get(r.ruimte) || null,
      element: r.element, gevel: r.gevel,
      b: num(r.breedteM), h: num(r.hoogteM),
      aantal: Math.max(1, Math.round(num(r.aantal)) || 1),
      beglazing: r.beglazing ?? null,
      kader: r.kader, rolluik: !!r.rolluik,
      fotoId: r.foto ? (fotoIdVan.get(r.foto) || null) : null
    }));

    const E = d.energie || {};
    w.energie.opwekkers = (E.opwekkers || []).map(o => ({
      id: DB.nieuwId(), type: o.type,
      ruimteId: naamNaarId.get(o.ruimte) || null,
      functie: (o.functies || []).map(f => FUNCTIE_TERUG[f] || f).filter(f => FUNCTIES.includes(f)),
      beschrijving: o.beschrijving || '',
      fotoId: o.kenplaatFoto ? (fotoIdVan.get(o.kenplaatFoto) || null) : null,
      fotoKraanId: o.kranenFoto ? (fotoIdVan.get(o.kranenFoto) || null) : null
    }));
    w.energie.pvPanelen = (E.zonnepanelen || []).map(p => ({ id: DB.nieuwId(), orientatie: PV_TERUG[p.orientatie] ?? '', wp: String(p.wp || '') }));
    w.energie.zonneboiler = E.zonneboiler && E.zonneboiler.aanwezig ? 'ja' : 'nee';
    w.energie.zonneboilerM2 = E.zonneboiler && E.zonneboiler.collectorM2 != null ? String(E.zonneboiler.collectorM2).replace('.', ',') : '';

    await DB.putWoning(w);
  } catch (e) {
    await DB.verwijderWoningMetFotos(w.id).catch(() => { });
    DB.sluitWoning();
    throw e;
  }
  toast('Dossier geïmporteerd');
  await openWoning(w.id);
}

/* ============================== foto-pijplijn (§8) ==============================
   Alles wordt via canvas hergecodeerd naar JPEG (EXIF-oriëntatie komt zo in
   de pixels terecht) en als Blob met afmetingen opgeslagen. */

const TIER = {
  document: { dim: 2400, kw: 0.80 },  /* groep 'algemeen': facturen, leesbaar */
  foto: { dim: 1600, kw: 0.70 }       /* alle andere foto's */
};
function tierVoorGroep(groep) { return groep === 'algemeen' ? TIER.document : TIER.foto; }

function canvasNaarJpeg(bron, breed, hoog, tier) {
  return new Promise((res, rej) => {
    const s = Math.min(1, tier.dim / Math.max(breed, hoog));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(breed * s));
    c.height = Math.max(1, Math.round(hoog * s));
    c.getContext('2d').drawImage(bron, 0, 0, c.width, c.height);
    c.toBlob(blob => {
      if (blob) res({ blob, breedte: c.width, hoogte: c.height });
      else rej(new Error('JPEG maken mislukt'));
    }, 'image/jpeg', tier.kw);
  });
}

/* bestand -> JPEG-blob; EXIF via createImageBitmap, anders <img> na decode() */
async function bestandNaarJpeg(file, tier) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const uit = await canvasNaarJpeg(bmp, bmp.width, bmp.height, tier);
    bmp.close();
    return uit;
  } catch (e) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.style.imageOrientation = 'from-image';
      img.src = url;
      await img.decode();
      return await canvasNaarJpeg(img, img.naturalWidth, img.naturalHeight, tier);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/* eerst de put in 'fotos', pas daarna een verwijzing/tegel — geen dode verwijzingen (§6) */
async function voegFotoToe(groep, jpeg) {
  const rec = {
    id: DB.nieuwId(), woningId: S.id, blob: jpeg.blob,
    breedte: jpeg.breedte, hoogte: jpeg.hoogte,
    groep, volgorde: groep ? ++volgTeller : 0, gemaakt: nu()
  };
  try {
    await DB.putFoto(rec);
  } catch (e) {
    toast('Foto niet bewaard');
    return null;
  }
  return rec;
}

/* losse foto (kenplaat, kranen, afstandhouder): interne camera in enkel-modus,
   fallback = toestelkiezer. cb krijgt het fotoId. */
let fotoCb = null;
function neemFoto(cb) {
  fotoCb = cb;
  startCamera('enkel');
}
$('#fotoinput').addEventListener('change', async () => {
  const f = $('#fotoinput').files[0];
  if (!f || !fotoCb) return;
  const cb = fotoCb;
  fotoCb = null;
  try {
    const rec = await voegFotoToe(null, await bestandNaarJpeg(f, TIER.foto));
    if (rec) cb(rec.id);
  } catch (e) { toast('Foto laden mislukt'); }
});

/* ---------- undo-toast voor foto's (§1): 6 s, blob pas gewist bij verlopen ---------- */

let undoState = null; /* {fotoId, timer, herstel} */

function undoFoto(fotoId, herstel) {
  commitUndo();
  $('#undotoast').hidden = false;
  undoState = {
    fotoId, herstel,
    timer: setTimeout(() => {
      const u = undoState;
      undoState = null;
      $('#undotoast').hidden = true;
      DB.verwijderFoto(u.fotoId).catch(() => { });
    }, 6000)
  };
}
function commitUndo() {
  if (!undoState) return;
  clearTimeout(undoState.timer);
  const u = undoState;
  undoState = null;
  $('#undotoast').hidden = true;
  DB.verwijderFoto(u.fotoId).catch(() => { });
}
$('#btn-undo').addEventListener('click', () => {
  if (!undoState) return;
  clearTimeout(undoState.timer);
  const u = undoState;
  undoState = null;
  $('#undotoast').hidden = true;
  u.herstel();
});

/* verwijderde-maar-nog-herstelbare foto's verbergen we in de renders */
function fotoVerborgen(id) { return !!(undoState && undoState.fotoId === id); }

/* ---------- lightbox: tik op een miniatuur om te vergroten ---------- */

document.addEventListener('click', e => {
  const img = e.target.closest('img.thumb');
  if (img && img.src) {
    $('#lightbox img').src = img.src;
    $('#lightbox').hidden = false;
  }
});
$('#lightbox').addEventListener('click', () => {
  $('#lightbox').hidden = true;
  $('#lightbox img').src = '';
});

/* ============================== tabs ============================== */

$('#tabbar').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  zetTab(b.dataset.tab);
});

/* ============================== tab Algemeen (§7.3) ============================== */

function bind(sel, fn) {
  $(sel).addEventListener('input', e => { if (!S) return; fn(e.target.value); wijzig(); });
}

bind('#adres', v => { S.algemeen.adres = v; zetTitel(); });

/* huidige locatie -> adres (enige externe call in de app, enkel op tik; offline: coördinaten) */
$('#btn-locatie').addEventListener('click', () => {
  if (!S) return;
  if (!('geolocation' in navigator)) { toast('Locatie niet beschikbaar'); return; }
  toast('Locatie ophalen…');
  navigator.geolocation.getCurrentPosition(async pos => {
    const lat = pos.coords.latitude, lon = pos.coords.longitude;
    let adres = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&accept-language=nl&zoom=18`);
      if (r.ok) {
        const a = (await r.json()).address || {};
        const straat = [a.road, a.house_number].filter(Boolean).join(' ');
        const plaats = a.town || a.village || a.city || a.municipality || '';
        if (straat || plaats) adres = [straat, plaats].filter(Boolean).join(', ');
      }
    } catch (e) { /* offline: hou coördinaten als adres */ }
    if (!S) return;
    $('#adres').value = adres;
    S.algemeen.adres = adres;
    zetTitel();
    wijzig();
    toast('Adres ingevuld');
  }, () => toast('Locatie niet beschikbaar'), { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
});
bind('#datum', v => S.algemeen.datum = v);
bind('#notities', v => S.algemeen.notities = v);

/* roterende knop: elke tik schuift naar de volgende optie; '' toont een gedimde — */
function cycleInit(sel, opties, labels, get, set) {
  const btn = $(sel);
  const sync = () => {
    const v = get();
    const cv = btn.querySelector('.cv');
    cv.textContent = labels[v] || '—';
    cv.classList.toggle('leeg', !v);
  };
  btn.addEventListener('click', () => {
    if (!S) return;
    const i = opties.indexOf(get());
    set(opties[(i + 1) % opties.length]);
    sync();
  });
  return sync;
}

/* segmented control */
function segInit(sel, cb) {
  $(sel).addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !S) return;
    segSet(sel, b.dataset.v);
    cb(b.dataset.v);
  });
}
function segSet(sel, v) {
  $$(sel + ' button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
}

/* chips multi-select */
function chipsInit(sel, cb) {
  $(sel).addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !S) return;
    b.classList.toggle('on');
    cb(chipsVals(sel));
  });
}
function chipsVals(sel) { return $$(sel + ' button.on').map(b => b.dataset.v); }
function chipsSet(sel, vals) {
  $$(sel + ' button').forEach(b => b.classList.toggle('on', vals.includes(b.dataset.v)));
}

/* thumb + verwijderknop van een losse foto in een formulier */
function zetFormThumb(thumbSel, delSel, fotoId) {
  const t = $(thumbSel), d = $(delSel);
  const url = fotoId && !fotoVerborgen(fotoId) ? DB.fotoUrl(fotoId) : null;
  t.hidden = d.hidden = !url;
  if (url) t.src = url;
}

/* ============================== ramen & deuren (tab Details, §7.4) ============================== */

let bewerkRaamId = null; /* id van het raam dat je aan het wijzigen bent, of null */
let draft = null;

function leegDraft() {
  return { element: 'raam', gevel: 'voor', beglazing: 'dubbel', kader: 'pvc', rolluik: 'nee', fotoId: null, aantal: 1 };
}
draft = leegDraft();

segInit('#seg-element', v => { draft.element = v; updateRaamFotoLabel(); });

const syncCyBeglazing = cycleInit('#cy-beglazing', BEGLAZINGEN, GLAS_NAMEN,
  () => draft.beglazing, v => draft.beglazing = v);
const syncCyKader = cycleInit('#cy-kader', KADERS, KADER_NAMEN,
  () => draft.kader, v => draft.kader = v);
const syncCyRolluik = cycleInit('#cy-rolluik', ['nee', 'ja'], { nee: 'Nee', ja: 'Ja' },
  () => draft.rolluik, v => draft.rolluik = v);

/* dakramen hebben meestal een kenplaatje i.p.v. een afstandhouder; een deur
   heeft enkel een profiel, dus geen beglazing-cycle (§7.4) */
function updateRaamFotoLabel() {
  $('#btn-raamfoto').textContent = draft.element === 'dakraam' ? '\u{1F4F7} Foto kenplaatje' : '\u{1F4F7} Foto afstandhouder';
  $('#cy-beglazing').hidden = draft.element === 'deur';
}

/* aantal-stepper */
function zetAantal(n) {
  draft.aantal = Math.max(1, n);
  $('#aantal').value = draft.aantal;
}
$('#aantal-min').addEventListener('click', () => zetAantal((Math.round(num($('#aantal').value)) || 1) - 1));
$('#aantal-plus').addEventListener('click', () => zetAantal((Math.round(num($('#aantal').value)) || 1) + 1));
$('#aantal').addEventListener('input', () => { draft.aantal = Math.max(1, Math.round(num($('#aantal').value)) || 1); });
$('#aantal').addEventListener('blur', () => zetAantal(Math.round(num($('#aantal').value)) || 1));

segInit('#seg-gevel', v => draft.gevel = v);

function updateM2Live() {
  const b = num($('#breedte').value), h = num($('#hoogte').value);
  $('#m2live').textContent = (b && h) ? fmt(b * h) + ' m²' : '';
}
$('#breedte').addEventListener('input', updateM2Live);
$('#hoogte').addEventListener('input', updateM2Live);

$('#btn-raamfoto').addEventListener('click', () => neemFoto(fotoId => {
  if (draft.fotoId) DB.verwijderFoto(draft.fotoId).catch(() => { });
  draft.fotoId = fotoId;
  updateRaamThumb();
}));
$('#btn-raamfoto-del').addEventListener('click', () => {
  const oud = draft.fotoId;
  if (!oud) return;
  draft.fotoId = null;
  updateRaamThumb();
  undoFoto(oud, () => { draft.fotoId = oud; updateRaamThumb(); });
});
function updateRaamThumb() {
  zetFormThumb('#raamfoto-thumb', '#btn-raamfoto-del', draft.fotoId);
}

function raamAantal(r) { return Math.max(1, r.aantal || 1); }

/* sorteervolgorde §7.4: één functie (uit maakpdf.js), gedeeld met de PDF */
function gesorteerdeRamen() { return sorteerRamen(S.ramen); }

$('#btn-voegtoe').addEventListener('click', () => {
  if (!S) return;
  const ruimte = huidigeRuimte();
  if (!ruimte) { toast('Kies eerst een ruimte bovenaan'); return; }
  const b = num($('#breedte').value), h = num($('#hoogte').value);
  if (!b || !h) { toast('Vul breedte en hoogte in (m)'); return; }
  const aantal = Math.max(1, Math.round(num($('#aantal').value)) || 1);
  const velden = {
    element: draft.element,
    gevel: draft.gevel,
    ruimteId: ruimte.id,
    b, h,
    beglazing: draft.element === 'deur' ? null : draft.beglazing,
    kader: draft.kader,
    rolluik: draft.rolluik === 'ja',
    aantal,
    fotoId: draft.fotoId
  };
  if (bewerkRaamId !== null) {
    const r = S.ramen.find(x => x.id === bewerkRaamId);
    if (r) Object.assign(r, velden);
    toast(`${ELEMENT_NAMEN[draft.element]} gewijzigd`);
    stopBewerkRaam();
  } else {
    S.ramen.push({ id: DB.nieuwId(), ...velden });
    toast(`${ELEMENT_NAMEN[draft.element]} toegevoegd`);
  }
  /* na toevoegen blijven de keuzes staan; afmetingen, aantal en foto leeg (§7.4) */
  draft.fotoId = null;
  updateRaamThumb();
  $('#breedte').value = '';
  $('#hoogte').value = '';
  zetAantal(1);
  updateM2Live();
  renderRamen();
  wijzig();
  flash($('#btn-voegtoe'));
});

/* een bestaand raam in het formulier laden om te wijzigen */
function startBewerkRaam(id) {
  const r = S.ramen.find(x => x.id === id);
  if (!r) return;
  bewerkRaamId = id;
  draft.element = r.element;
  draft.gevel = r.gevel;
  draft.beglazing = r.beglazing || draft.beglazing;
  draft.kader = r.kader;
  draft.rolluik = r.rolluik ? 'ja' : 'nee';
  draft.fotoId = r.fotoId || null;
  draft.aantal = raamAantal(r);
  /* de ruimtebalk springt mee naar de ruimte van dit raam */
  if (r.ruimteId && S.ruimtes.some(x => x.id === r.ruimteId)) ruimteSel = r.ruimteId;
  renderRuimtebalk();
  syncRaamForm();
  $('#breedte').value = fmtM(r.b);
  $('#hoogte').value = fmtM(r.h);
  $('#aantal').value = draft.aantal;
  updateM2Live();
  $('#sec-ramen').open = true;
  $('#btn-voegtoe').textContent = 'Bewaar wijziging';
  $('#btn-annuleer-raam').hidden = false;
  renderRamen();
  window.scrollTo(0, 0);
}

function stopBewerkRaam() {
  bewerkRaamId = null;
  $('#btn-voegtoe').textContent = 'Voeg toe';
  $('#btn-annuleer-raam').hidden = true;
}

$('#btn-annuleer-raam').addEventListener('click', () => {
  stopBewerkRaam();
  draft.fotoId = null;
  updateRaamThumb();
  $('#breedte').value = '';
  $('#hoogte').value = '';
  zetAantal(1);
  updateM2Live();
  renderRamen();
});

function syncRaamForm() {
  segSet('#seg-element', draft.element);
  syncCyBeglazing();
  syncCyKader();
  syncCyRolluik();
  segSet('#seg-gevel', draft.gevel);
  updateRaamFotoLabel();
  updateRaamThumb();
}

function ruimteNaam(id) {
  const r = S.ruimtes.find(x => x.id === id);
  return r ? r.naam : '';
}

function renderRamen() {
  const ul = $('#ramenlijst');
  ul.innerHTML = '';
  gesorteerdeRamen().forEach((r, i) => {
    const li = document.createElement('li');
    if (r.id === bewerkRaamId) li.className = 'bewerk';
    li.dataset.id = r.id;
    const n = raamAantal(r);
    const tags = [];
    if (r.beglazing) tags.push(GLAS_NAMEN[r.beglazing] || r.beglazing);
    tags.push(KADER_NAMEN[r.kader] || r.kader);
    if (r.rolluik) tags.push('rolluik');
    if (r.ruimteId) tags.unshift(ruimteNaam(r.ruimteId));
    const fotoUrl = r.fotoId && !fotoVerborgen(r.fotoId) ? DB.fotoUrl(r.fotoId) : null;
    li.innerHTML =
      `<div class="info">
         <div class="r1">#${i + 1} ${esc(ELEMENT_NAMEN[r.element] || r.element)} · ${esc(GEVEL_NAMEN[r.gevel] || r.gevel)}${n > 1 ? ` · ${n}×` : ''}</div>
         <div class="r2">${fmtM(r.b)} × ${fmtM(r.h)} m = ${fmt(r.b * r.h)} m²${n > 1 ? ` (${fmt(r.b * r.h * n)} m² totaal)` : ''}</div>
         <div class="r3">${esc(tags.join(' · '))} · tik om te wijzigen</div>
       </div>` +
      (fotoUrl ? `<img class="thumb" src="${fotoUrl}" alt="foto element">` : '') +
      `<button type="button" class="del" data-id="${r.id}">×</button>`;
    ul.appendChild(li);
  });
  const totM2 = S.ramen.reduce((a, r) => a + r.b * r.h * raamAantal(r), 0);
  const totAantal = S.ramen.reduce((a, r) => a + raamAantal(r), 0);
  $('#ramen-totaal').textContent = S.ramen.length
    ? `Totaal: ${totAantal} element${totAantal === 1 ? '' : 'en'} · ${fmt(totM2)} m²`
    : 'Nog geen elementen toegevoegd.';
}

$('#ramenlijst').addEventListener('click', e => {
  if (!S) return;
  if (e.target.closest('img.thumb')) return; /* fotominiatuur: enkel lightbox */
  const del = e.target.closest('.del');
  if (del) {
    const r = S.ramen.find(x => x.id === del.dataset.id);
    if (!r) return;
    if (!confirm(`${ELEMENT_NAMEN[r.element]} (${fmtM(r.b)} × ${fmtM(r.h)} m) verwijderen?`)) return;
    if (bewerkRaamId === r.id) stopBewerkRaam();
    S.ramen = S.ramen.filter(x => x.id !== r.id);
    if (r.fotoId) DB.verwijderFoto(r.fotoId).catch(() => { });
    renderRamen();
    wijzig();
    return;
  }
  const li = e.target.closest('li[data-id]');
  if (li) startBewerkRaam(li.dataset.id);
});

/* ============================== centrale verwarming (tab Algemeen) ============================== */

/* airco's en kachels horen bij een ruimte; de rest is centraal (ruimteId null) */
function isRuimteToestel(o) { return o.type === 'airco' || o.type === 'kachel' || o.type === 'ruimte-andere'; }

function leegDraftOpwek() {
  return { type: 'gas', functie: [], fotoId: null, fotoKraanId: null };
}
let draftOpwek = leegDraftOpwek();
let bewerkOpwekId = null;

chipsInit('#chips-opwekfunctie', vals => { draftOpwek.functie = vals; toonOpwekVelden(); });

const syncCyOpwektype = cycleInit('#cy-opwektype', ['gas', 'stookolie', 'andere'],
  { gas: 'Gas', stookolie: 'Stookolie', andere: 'Andere' },
  () => draftOpwek.type, v => draftOpwek.type = v);

function toonOpwekVelden() {
  $('#opw-kraanfoto-rij').hidden = !draftOpwek.functie.includes('radiatoren');
}

$('#btn-opwekfoto').addEventListener('click', () => neemFoto(fotoId => {
  if (draftOpwek.fotoId) DB.verwijderFoto(draftOpwek.fotoId).catch(() => { });
  draftOpwek.fotoId = fotoId;
  updateOpwekThumb();
}));
$('#btn-opwekfoto-del').addEventListener('click', () => {
  const oud = draftOpwek.fotoId;
  if (!oud) return;
  draftOpwek.fotoId = null;
  updateOpwekThumb();
  undoFoto(oud, () => { draftOpwek.fotoId = oud; updateOpwekThumb(); });
});
function updateOpwekThumb() {
  zetFormThumb('#opwekfoto-thumb', '#btn-opwekfoto-del', draftOpwek.fotoId);
  zetFormThumb('#kraanfoto-thumb', '#btn-kraanfoto-del', draftOpwek.fotoKraanId);
}

$('#btn-kraanfoto').addEventListener('click', () => neemFoto(fotoId => {
  if (draftOpwek.fotoKraanId) DB.verwijderFoto(draftOpwek.fotoKraanId).catch(() => { });
  draftOpwek.fotoKraanId = fotoId;
  updateOpwekThumb();
}));
$('#btn-kraanfoto-del').addEventListener('click', () => {
  const oud = draftOpwek.fotoKraanId;
  if (!oud) return;
  draftOpwek.fotoKraanId = null;
  updateOpwekThumb();
  undoFoto(oud, () => { draftOpwek.fotoKraanId = oud; updateOpwekThumb(); });
});

function syncOpwekForm() {
  syncCyOpwektype();
  chipsSet('#chips-opwekfunctie', draftOpwek.functie);
  toonOpwekVelden();
  updateOpwekThumb();
}

$('#btn-opwek-voegtoe').addEventListener('click', () => {
  if (!S) return;
  /* radiatoren weg -> kranenfoto genuld en blob gewist (§7.3) */
  let kraanId = draftOpwek.fotoKraanId;
  if (!draftOpwek.functie.includes('radiatoren') && kraanId) {
    DB.verwijderFoto(kraanId).catch(() => { });
    kraanId = null;
  }
  const velden = {
    type: draftOpwek.type,
    ruimteId: null,
    functie: [...draftOpwek.functie],
    beschrijving: $('#opw-beschrijving').value.trim(),
    fotoId: draftOpwek.fotoId,
    fotoKraanId: kraanId
  };
  if (bewerkOpwekId !== null) {
    const o = S.energie.opwekkers.find(x => x.id === bewerkOpwekId);
    if (o) Object.assign(o, velden);
    toast(`${OPWEK_NAMEN[draftOpwek.type]} gewijzigd`);
    stopBewerkOpwek();
  } else {
    S.energie.opwekkers.push({ id: DB.nieuwId(), ...velden });
    toast(`${OPWEK_NAMEN[draftOpwek.type]} toegevoegd`);
  }
  draftOpwek = leegDraftOpwek();
  syncOpwekForm();
  $('#opw-beschrijving').value = '';
  renderOpwekkers();
  wijzig();
  flash($('#btn-opwek-voegtoe'));
});

/* een bestaande centrale verwarming in het formulier laden om te wijzigen */
function startBewerkOpwek(id) {
  const o = S.energie.opwekkers.find(x => x.id === id);
  if (!o) return;
  bewerkOpwekId = id;
  draftOpwek = {
    type: o.type in { gas: 1, stookolie: 1, andere: 1 } ? o.type : 'andere',
    functie: [...(o.functie || [])],
    fotoId: o.fotoId || null,
    fotoKraanId: o.fotoKraanId || null
  };
  syncOpwekForm();
  $('#opw-beschrijving').value = o.beschrijving || '';
  $('#btn-opwek-voegtoe').textContent = 'Bewaar wijziging';
  $('#btn-annuleer-opwek').hidden = false;
  renderOpwekkers();
  window.scrollTo(0, 0);
}

function stopBewerkOpwek() {
  bewerkOpwekId = null;
  $('#btn-opwek-voegtoe').textContent = 'Voeg verwarming toe';
  $('#btn-annuleer-opwek').hidden = true;
}

$('#btn-annuleer-opwek').addEventListener('click', () => {
  stopBewerkOpwek();
  draftOpwek = leegDraftOpwek();
  syncOpwekForm();
  $('#opw-beschrijving').value = '';
  renderOpwekkers();
});

function afmTekst(k) {
  return `${fmtM(k.b)} × ${fmtM(k.d)} × ${fmtM(k.h)} m = ${fmt(k.b * k.d * k.h, 1)} m³`;
}

function renderOpwekkers() {
  const ul = $('#opweklijst');
  ul.innerHTML = '';
  /* nieuwste eerst (§7.3) */
  [...S.energie.opwekkers].filter(o => !isRuimteToestel(o)).reverse().forEach(o => {
    const li = document.createElement('li');
    if (o.id === bewerkOpwekId) li.className = 'bewerk';
    li.dataset.id = o.id;
    const foto = o.fotoId && !fotoVerborgen(o.fotoId) ? DB.fotoUrl(o.fotoId) : null;
    const kraan = o.fotoKraanId && !fotoVerborgen(o.fotoKraanId) ? DB.fotoUrl(o.fotoKraanId) : null;
    li.innerHTML =
      `<div class="info">
         <div class="r1">${esc(OPWEK_NAMEN[o.type] || o.type)}</div>
         <div class="r2">${esc((o.functie || []).map(f => FUNCTIE_NAMEN[f] || f).join(' + ') || '-')}</div>
         <div class="r3">${o.beschrijving ? esc(o.beschrijving) + ' · ' : ''}tik om te wijzigen</div>
       </div>` +
      (foto ? `<img class="thumb" src="${foto}" alt="kenplaat">` : '') +
      (kraan ? `<img class="thumb" src="${kraan}" alt="radiatorkranen">` : '') +
      `<button type="button" class="del" data-id="${o.id}">×</button>`;
    ul.appendChild(li);
  });
}

function verwijderOpwekker(o) {
  S.energie.opwekkers = S.energie.opwekkers.filter(x => x.id !== o.id);
  if (o.fotoId) DB.verwijderFoto(o.fotoId).catch(() => { });
  if (o.fotoKraanId) DB.verwijderFoto(o.fotoKraanId).catch(() => { });
  wijzig();
}

$('#opweklijst').addEventListener('click', e => {
  if (!S) return;
  if (e.target.closest('img.thumb')) return; /* fotominiatuur: enkel lightbox */
  const del = e.target.closest('.del');
  if (del) {
    const o = S.energie.opwekkers.find(x => x.id === del.dataset.id);
    if (!o) return;
    if (!confirm(`${OPWEK_NAMEN[o.type] || o.type} verwijderen?`)) return;
    if (bewerkOpwekId === o.id) stopBewerkOpwek();
    verwijderOpwekker(o);
    renderOpwekkers();
    return;
  }
  const li = e.target.closest('li[data-id]');
  if (li) startBewerkOpwek(li.dataset.id);
});

/* zonnepanelen: meerdere installaties, elk met orientatie en eigen Wp; geen bewerken */
let draftPvOr = 'plat';
const syncCyPvor = cycleInit('#cy-pvor', ['plat', 'voor', 'achter', 'links', 'rechts'], PVOR_NAMEN,
  () => draftPvOr, v => draftPvOr = v);

$('#btn-pv-voegtoe').addEventListener('click', () => {
  if (!S) return;
  const wp = Math.round(num($('#pv-wp').value));
  if (!wp) { toast('Vul het vermogen in Wp in'); return; }
  S.energie.pvPanelen.push({ id: DB.nieuwId(), orientatie: draftPvOr, wp: String(wp) });
  $('#pv-wp').value = '';
  renderPv();
  wijzig();
  toast(`Zonnepanelen ${PVOR_NAMEN[draftPvOr].toLowerCase()} toegevoegd`);
});

function renderPv() {
  const ul = $('#pvlijst');
  ul.innerHTML = '';
  S.energie.pvPanelen.forEach(p => {
    const li = document.createElement('li');
    li.innerHTML =
      `<div class="info">
         <div class="r1">${esc(PVOR_NAMEN[p.orientatie] || '—')}</div>
         <div class="r2">${esc(p.wp)} Wp</div>
       </div>` +
      `<button type="button" class="del" data-id="${p.id}">×</button>`;
    ul.appendChild(li);
  });
}

$('#pvlijst').addEventListener('click', e => {
  const b = e.target.closest('.del');
  if (!b || !S) return;
  const p = S.energie.pvPanelen.find(x => x.id === b.dataset.id);
  if (!p) return;
  if (!confirm(`Zonnepanelen (${PVOR_NAMEN[p.orientatie] || '—'}, ${p.wp} Wp) verwijderen?`)) return;
  S.energie.pvPanelen = S.energie.pvPanelen.filter(x => x.id !== p.id);
  renderPv();
  wijzig();
});

const syncCyZonneboiler = cycleInit('#cy-zonneboiler', ['nee', 'ja'], { nee: 'Nee', ja: 'Ja' },
  () => S.energie.zonneboiler, v => { S.energie.zonneboiler = v; toonZbM2(); wijzig(); });
function toonZbM2() {
  $('#fld-zbm2').hidden = S.energie.zonneboiler !== 'ja';
}
bind('#zb-m2', v => S.energie.zonneboilerM2 = v);

/* ============================== verwarming per ruimte (tab Details) ==============================
   airco's en kachels horen bij de gekozen ruimte; de afmetingen van de ruimte
   geef je maar één keer in (op de ruimte zelf), hoeveel toestellen er ook hangen */

let draftRv = { type: 'airco', fotoId: null };
let bewerkRvId = null;

const syncCyRvtype = cycleInit('#cy-rvtype', ['airco', 'kachel', 'ruimte-andere'],
  { airco: 'Airco', kachel: 'Kachel', 'ruimte-andere': 'Andere' },
  () => draftRv.type, v => draftRv.type = v);

/* afmetingen van de gekozen ruimte: rechtstreeks op de ruimte bewaard */
function updateRuimteM3() {
  const b = num($('#ruimte-b').value), d = num($('#ruimte-d').value), h = num($('#ruimte-h').value);
  $('#ruimtem3').textContent = (b && d && h) ? fmt(b * d * h, 1) + ' m³' : '';
}
function leesRuimteAfm() {
  const r = huidigeRuimte();
  if (!r) return;
  const b = num($('#ruimte-b').value), d = num($('#ruimte-d').value), h = num($('#ruimte-h').value);
  r.afm = (b && d && h) ? { b, d, h } : null;
  updateRuimteM3();
  wijzig();
}
['#ruimte-b', '#ruimte-d', '#ruimte-h'].forEach(sel => $(sel).addEventListener('input', leesRuimteAfm));

/* formulier volgt de gekozen ruimte */
function syncRuimteAfm() {
  const r = huidigeRuimte();
  $('#ruimte-info').hidden = !r;
  $('#rv-geen').hidden = !!r;
  $('#rv-form').hidden = !r;
  $('#ruimte-b').value = r && r.afm ? fmtM(r.afm.b) : '';
  $('#ruimte-d').value = r && r.afm ? fmtM(r.afm.d) : '';
  $('#ruimte-h').value = r && r.afm ? fmtM(r.afm.h) : '';
  $('#ruimte-opm').value = r ? (r.opm || '') : '';
  updateRuimteM3();
  updateRuimteWeg();
}

$('#ruimte-opm').addEventListener('input', () => {
  const r = huidigeRuimte();
  if (!r) return;
  r.opm = $('#ruimte-opm').value;
  wijzig();
});

$('#btn-rvfoto').addEventListener('click', () => neemFoto(fotoId => {
  if (draftRv.fotoId) DB.verwijderFoto(draftRv.fotoId).catch(() => { });
  draftRv.fotoId = fotoId;
  updateRvThumb();
}));
$('#btn-rvfoto-del').addEventListener('click', () => {
  const oud = draftRv.fotoId;
  if (!oud) return;
  draftRv.fotoId = null;
  updateRvThumb();
  undoFoto(oud, () => { draftRv.fotoId = oud; updateRvThumb(); });
});
function updateRvThumb() {
  zetFormThumb('#rvfoto-thumb', '#btn-rvfoto-del', draftRv.fotoId);
}

function syncRvForm() {
  syncCyRvtype();
  updateRvThumb();
}

$('#btn-rv-voegtoe').addEventListener('click', () => {
  if (!S) return;
  const r = huidigeRuimte();
  if (!r) { toast('Kies eerst een ruimte bovenaan'); return; }
  const velden = {
    type: draftRv.type,
    ruimteId: r.id,
    functie: [],
    beschrijving: $('#rv-beschrijving').value.trim(),
    fotoId: draftRv.fotoId,
    fotoKraanId: null
  };
  if (bewerkRvId !== null) {
    const o = S.energie.opwekkers.find(x => x.id === bewerkRvId);
    if (o) Object.assign(o, velden);
    toast(`${OPWEK_NAMEN[draftRv.type]} gewijzigd`);
    stopBewerkRv();
  } else {
    S.energie.opwekkers.push({ id: DB.nieuwId(), ...velden });
    toast(`${OPWEK_NAMEN[draftRv.type]} toegevoegd in ${r.naam}`);
  }
  draftRv = { type: draftRv.type, fotoId: null };
  syncRvForm();
  $('#rv-beschrijving').value = '';
  renderRv();
  wijzig();
  flash($('#btn-rv-voegtoe'));
});

function startBewerkRv(id) {
  const o = S.energie.opwekkers.find(x => x.id === id);
  if (!o) return;
  bewerkRvId = id;
  draftRv = { type: ['kachel', 'ruimte-andere'].includes(o.type) ? o.type : 'airco', fotoId: o.fotoId || null };
  /* de ruimtebalk springt mee naar de ruimte van dit toestel */
  if (o.ruimteId && S.ruimtes.some(x => x.id === o.ruimteId)) ruimteSel = o.ruimteId;
  renderRuimtebalk();
  syncRvForm();
  $('#rv-beschrijving').value = o.beschrijving || '';
  $('#sec-energie').open = true;
  $('#btn-rv-voegtoe').textContent = 'Bewaar wijziging';
  $('#btn-annuleer-rv').hidden = false;
  renderRv();
  window.scrollTo(0, 0);
}

function stopBewerkRv() {
  bewerkRvId = null;
  $('#btn-rv-voegtoe').textContent = 'Voeg toestel toe';
  $('#btn-annuleer-rv').hidden = true;
}

$('#btn-annuleer-rv').addEventListener('click', () => {
  stopBewerkRv();
  draftRv = { type: 'airco', fotoId: null };
  syncRvForm();
  $('#rv-beschrijving').value = '';
  renderRv();
});

function renderRv() {
  const ul = $('#rvlijst');
  ul.innerHTML = '';
  S.energie.opwekkers
    .filter(o => isRuimteToestel(o) && o.ruimteId === ruimteSel)
    .forEach(o => {
      const li = document.createElement('li');
      if (o.id === bewerkRvId) li.className = 'bewerk';
      li.dataset.id = o.id;
      const r = S.ruimtes.find(x => x.id === o.ruimteId);
      const det = [o.beschrijving, r && r.afm ? afmTekst(r.afm) : ''].filter(Boolean);
      const foto = o.fotoId && !fotoVerborgen(o.fotoId) ? DB.fotoUrl(o.fotoId) : null;
      li.innerHTML =
        `<div class="info">
           <div class="r1">${esc(OPWEK_NAMEN[o.type] || o.type)}</div>
           <div class="r2">${esc(r ? r.naam : '-')}</div>
           <div class="r3">${det.length ? esc(det.join(' · ')) + ' · ' : ''}tik om te wijzigen</div>
         </div>` +
        (foto ? `<img class="thumb" src="${foto}" alt="kenplaat">` : '') +
        `<button type="button" class="del" data-id="${o.id}">×</button>`;
      ul.appendChild(li);
    });
}

$('#rvlijst').addEventListener('click', e => {
  if (!S) return;
  if (e.target.closest('img.thumb')) return;
  const del = e.target.closest('.del');
  if (del) {
    const o = S.energie.opwekkers.find(x => x.id === del.dataset.id);
    if (!o) return;
    if (!confirm(`${OPWEK_NAMEN[o.type] || o.type} (${ruimteNaam(o.ruimteId) || '-'}) verwijderen?`)) return;
    if (bewerkRvId === o.id) stopBewerkRv();
    verwijderOpwekker(o);
    renderRv();
    return;
  }
  const li = e.target.closest('li[data-id]');
  if (li) startBewerkRv(li.dataset.id);
});

/* ============================== ruimtebalk (§7.2) ==============================
   Details: enkel echte ruimtes, altijd één geselecteerd. Foto's en camera:
   vooraan "Algemeen" en "Gevels". Lang indrukken op een ruimtechip = hernoemen. */

let ruimteSel = null;   /* ruimteId, voor de Details-tab */
let fotoSel = 'gevels'; /* 'gevels' | 'algemeen' | ruimteId, voor Foto's en camera */

function huidigeRuimte() {
  return S.ruimtes.find(r => r.id === ruimteSel) || null;
}

function fotoGroepLabel(v) {
  if (v === 'algemeen') return 'Algemeen';
  if (v === 'gevels') return 'Gevels';
  return ruimteNaam(v) || '?';
}

function renderRuimteChips(container, metPlus, fotoContext) {
  container.innerHTML = '';
  const sel = fotoContext ? fotoSel : ruimteSel;
  const maak = (v, tekst, extraClass) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.v = v;
    b.textContent = tekst;
    if (extraClass) b.className = extraClass;
    if (v !== '__plus') b.classList.toggle('on', sel === v);
    container.appendChild(b);
  };
  if (fotoContext) { maak('algemeen', 'Algemeen'); maak('gevels', 'Gevels'); }
  S.ruimtes.forEach(r => maak(r.id, r.naam));
  if (metPlus) maak('__plus', '+ Ruimte', 'plus');
  /* de actieve chip in beeld houden */
  const on = container.querySelector('button.on');
  if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'center' });
}

function renderRuimtebalk() {
  renderRuimteChips($('#ruimtechips'), true, actieveTab !== 'details');
  renderRuimteChips($('#camruimtes'), false, true);
  syncRuimteAfm();
  renderRv();
  renderDossier();
  syncVent();
}

/* ventilatie-sectie volgt de gekozen ruimte */
function syncVent() {
  const r = huidigeRuimte();
  $('#btn-vent .cv').textContent = r ? (VENT_NAMEN[r.vent] || r.vent) : '—';
  $('#fld-ventbesch').hidden = !r || r.vent !== 'ander';
  if (r && r.vent === 'ander') $('#vent-besch').value = r.ventBeschrijving || '';
}

/* ruimte wisselen zonder de camera te sluiten */
$('#camruimtes').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || !S) return;
  fotoSel = b.dataset.v;
  renderRuimtebalk();
});

/* nieuwe ruimte: veelvoorkomende namen als sneltoetsen; zelfde naam krijgt
   vanzelf een nummer (Slaapkamer -> Slaapkamer 2, 3, ...) */
function voegRuimteToe(naam) {
  const zelfde = S.ruimtes.filter(r => r.naam === naam || r.naam.startsWith(naam + ' ')).length;
  const uniek = zelfde ? `${naam} ${zelfde + 1}` : naam;
  const r = nieuweRuimte(uniek);
  S.ruimtes.push(r);
  S.ruimtes = groepeerRuimtes(S.ruimtes);
  ruimteSel = r.id;
  $('#ruimtekeuze').hidden = true;
  renderRuimtebalk();
  $('#sec-vent').open = true; /* accordeon sluit de rest */
  wijzig();
  toast(`${uniek} toegevoegd`);
}

/* lang indrukken op een ruimtechip = hernoemen via prompt() (§7.2) */
let langDrukTimer = null;
let langGedrukt = false;

function koppelLangDruk(container) {
  container.addEventListener('pointerdown', e => {
    const b = e.target.closest('button');
    langGedrukt = false;
    if (!b || !S || b.dataset.v === '__plus') return;
    const r = S.ruimtes.find(x => x.id === b.dataset.v);
    if (!r) return; /* Algemeen/Gevels hernoem je niet */
    langDrukTimer = setTimeout(() => {
      langGedrukt = true;
      const naam = (prompt(`Nieuwe naam voor "${r.naam}"?`, r.naam) || '').trim();
      if (naam && naam !== r.naam) {
        r.naam = naam;
        S.ruimtes = groepeerRuimtes(S.ruimtes);
        renderRuimtebalk();
        wijzig();
        toast('Ruimte hernoemd');
      }
    }, 550);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev =>
    container.addEventListener(ev, () => clearTimeout(langDrukTimer)));
}
koppelLangDruk($('#ruimtechips'));

$('#ruimtechips').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || !S) return;
  if (langGedrukt) { langGedrukt = false; return; }
  if (b.dataset.v === '__plus') {
    $('#ruimtekeuze').hidden = !$('#ruimtekeuze').hidden;
    return;
  }
  $('#ruimtekeuze').hidden = true;
  if (actieveTab === 'details') ruimteSel = b.dataset.v;
  else fotoSel = b.dataset.v;
  renderRuimtebalk();
});

$('#ruimtekeuze').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || !S) return;
  if (b.dataset.v === '__naam') {
    const naam = (prompt('Naam van de nieuwe ruimte?') || '').trim();
    if (naam) voegRuimteToe(naam);
    return;
  }
  voegRuimteToe(b.dataset.v);
});

/* ventilatie van de huidige ruimte doorschuiven; bij "ander" verschijnt een
   beschrijvingsveld onder de knop (geen popup) */
$('#btn-vent').addEventListener('click', () => {
  const r = huidigeRuimte();
  if (!r) return;
  r.vent = VENT_MODES[(VENT_MODES.indexOf(r.vent) + 1) % VENT_MODES.length];
  syncVent();
  if (r.vent === 'ander') $('#vent-besch').focus();
  wijzig();
});

$('#vent-besch').addEventListener('input', () => {
  const r = huidigeRuimte();
  if (!r) return;
  r.ventBeschrijving = $('#vent-besch').value;
  wijzig();
});

/* ruimte verwijderen kan enkel als ze geen ramen, toestellen of foto's heeft (§7.2) */
function ruimteIsLeeg(r) {
  if (S.ramen.some(x => x.ruimteId === r.id)) return false;
  if (S.energie.opwekkers.some(x => x.ruimteId === r.id)) return false;
  let fotos = false;
  DB.geladenFotos().forEach(f => { if (f.groep === r.id && !fotoVerborgen(f.id)) fotos = true; });
  return !fotos;
}

function updateRuimteWeg() {
  const r = huidigeRuimte();
  $('#btn-ruimte-weg').hidden = !r || !ruimteIsLeeg(r);
}

$('#btn-ruimte-weg').addEventListener('click', () => {
  const r = huidigeRuimte();
  if (!r || !ruimteIsLeeg(r)) return;
  if (!confirm(`Ruimte "${r.naam}" verwijderen?`)) return;
  S.ruimtes = S.ruimtes.filter(x => x.id !== r.id);
  if (!S.ruimtes.length) S.ruimtes = [nieuweRuimte('Living')];
  ruimteSel = S.ruimtes[0].id;
  renderRuimtebalk();
  wijzig();
  toast('Ruimte verwijderd');
});

/* zelfde basisnamen bij elkaar (alle wc's samen, slaapkamers achter elkaar...),
   op volgorde van eerste voorkomen; binnen een groep oplopend genummerd */
function ruimteBasis(naam) { return String(naam).toLowerCase().replace(/\s*\d+\s*$/, '').trim(); }

function groepeerRuimtes(lijst) {
  const volgorde = [];
  const groepen = new Map();
  lijst.forEach(r => {
    const b = ruimteBasis(r.naam);
    if (!groepen.has(b)) { groepen.set(b, []); volgorde.push(b); }
    groepen.get(b).push(r);
  });
  return volgorde.flatMap(b =>
    groepen.get(b).sort((a, c) => String(a.naam).localeCompare(String(c.naam), 'nl', { numeric: true })));
}

/* ============================== fotodossier (tab Foto's, §7.5) ============================== */

/* dossierfoto's van één groep, op volgorde van nemen */
function dossierFotos(groep) {
  const uit = [];
  DB.geladenFotos().forEach(f => {
    if (f.groep === groep && !fotoVerborgen(f.id)) uit.push(f);
  });
  return uit.sort((a, b) => (a.volgorde || 0) - (b.volgorde || 0));
}

function dossierTotaal() {
  let n = 0;
  DB.geladenFotos().forEach(f => {
    if (!fotoVerborgen(f.id) && (f.groep === 'gevels' || f.groep === 'algemeen' || S.ruimtes.some(r => r.id === f.groep))) n++;
  });
  return n;
}

/* het raster toont alleen de foto's van de geselecteerde chip;
   de ster (hoofdfoto kiezen) staat alleen op gevels-foto's */
function renderDossier() {
  const grid = $('#dossiergrid');
  grid.innerHTML = '';
  const hier = dossierFotos(fotoSel);
  hier.forEach(f => {
    const d = document.createElement('div');
    d.className = 'dfoto';
    d.innerHTML =
      `<img class="thumb" src="${DB.fotoUrl(f.id)}" alt="dossierfoto">` +
      (f.groep === 'gevels' ? `<button type="button" class="ster${f.id === S.algemeen.hoofdFotoId ? ' hoofd' : ''}" data-id="${f.id}" title="Gebruik als hoofdfoto">&#9733;</button>` : '') +
      `<button type="button" class="verplaats" data-id="${f.id}" title="Verplaats naar andere groep">&#8644;</button>` +
      `<button type="button" class="del" data-id="${f.id}">×</button>`;
    grid.appendChild(d);
  });
  const totaal = dossierTotaal();
  $('#dossier-totaal').textContent = totaal
    ? `${hier.length} foto${hier.length === 1 ? '' : "'s"} in ${fotoGroepLabel(fotoSel)} · ${totaal} in totaal${fotoSel === 'gevels' ? ' · ★ = hoofdfoto' : ''}`
    : "Nog geen foto's. Start de camera en tik ze snel na elkaar.";
}

$('#dossiergrid').addEventListener('click', e => {
  if (!S) return;
  /* ster: deze foto wordt de hoofdfoto van de woning — geen confirm (§7.5) */
  const ster = e.target.closest('.ster');
  if (ster) {
    const f = DB.fotoRecord(ster.dataset.id);
    if (!f || f.groep !== 'gevels') return;
    S.algemeen.hoofdFotoId = f.id;
    renderDossier();
    wijzig();
    toast('Hoofdfoto ingesteld');
    return;
  }
  /* verplaatsen naar een andere groep, zodat je de foto niet opnieuw moet nemen */
  const vp = e.target.closest('.verplaats');
  if (vp) {
    openVerplaats(vp.dataset.id);
    return;
  }
  const b = e.target.closest('.del');
  if (!b) return;
  const f = DB.fotoRecord(b.dataset.id);
  if (!f) return;
  const wasHoofd = S.algemeen.hoofdFotoId === f.id;
  if (wasHoofd) { S.algemeen.hoofdFotoId = null; wijzig(); }
  undoFoto(f.id, () => {
    if (wasHoofd) { S.algemeen.hoofdFotoId = f.id; wijzig(); }
    renderDossier();
  });
  renderDossier();
});

/* ---------- foto verplaatsen naar een andere groep ---------- */

let verplaatsId = null;

function openVerplaats(id) {
  const f = DB.fotoRecord(id);
  if (!f) return;
  verplaatsId = id;
  const chips = $('#verplaats-chips');
  chips.innerHTML = '';
  const maak = (v, tekst) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.v = v;
    b.textContent = tekst;
    b.classList.toggle('on', f.groep === v);
    chips.appendChild(b);
  };
  maak('algemeen', 'Algemeen');
  maak('gevels', 'Gevels');
  S.ruimtes.forEach(r => maak(r.id, r.naam));
  $('#verplaats').hidden = false;
}

$('#verplaats-chips').addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b || !S || verplaatsId === null) return;
  const f = DB.fotoRecord(verplaatsId);
  verplaatsId = null;
  $('#verplaats').hidden = true;
  if (!f || f.groep === b.dataset.v) return;
  /* hoofdfoto die gevels verlaat, is geen hoofdfoto meer (§7.5) */
  if (S.algemeen.hoofdFotoId === f.id && b.dataset.v !== 'gevels') {
    S.algemeen.hoofdFotoId = null;
    wijzig();
  }
  f.groep = b.dataset.v;
  try {
    await DB.putFoto(f);
    toast(`Foto verplaatst naar ${b.textContent}`);
  } catch (err) { toast('Foto niet bewaard'); }
  renderDossier();
});

$('#btn-verplaats-annuleer').addEventListener('click', () => {
  verplaatsId = null;
  $('#verplaats').hidden = true;
});
$('#verplaats').addEventListener('click', e => {
  if (e.target === $('#verplaats')) { verplaatsId = null; $('#verplaats').hidden = true; }
});

/* ---------- meerdere foto's uit de bibliotheek ---------- */

$('#btn-fotokies').addEventListener('click', () => {
  if (!S) return;
  $('#dossierinput').value = '';
  $('#dossierinput').click();
});
$('#dossierinput').addEventListener('change', async () => {
  const files = [...$('#dossierinput').files];
  if (!files.length || !S) return;
  let n = 0;
  for (const f of files) {
    try {
      const rec = await voegFotoToe(fotoSel, await bestandNaarJpeg(f, tierVoorGroep(fotoSel)));
      if (rec) n++;
    } catch (e) { /* geen afbeelding: overslaan */ }
  }
  renderDossier();
  toast(n ? `${n} foto${n === 1 ? '' : "'s"} toegevoegd` : 'Geen foto kunnen laden');
});

/* ---------- eigen camerascherm (§7.6): blijft open, foto per tik ---------- */

let camStream = null;
let camFlits = false;
let camModus = 'dossier'; /* 'dossier' = meerdere foto's; 'enkel' = één foto, meteen dicht */

async function startCamera(modus) {
  camModus = modus || 'dossier';
  if (!S) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { camFallback(); return; }
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 2560 }, height: { ideal: 1920 } },
      audio: false
    });
    $('#camvideo').srcObject = camStream;
    $('#camera').hidden = false;
    $('#camruimtes').hidden = camModus === 'enkel';
    $('#btn-camklaar').textContent = camModus === 'enkel' ? 'Annuleer' : 'Klaar';
    updateCamTeller(0);
    /* flits (torch) alleen tonen als het toestel het via de browser toelaat;
       iOS doet dat meestal niet: gebruik daar "Kies foto's" voor donkere ruimtes */
    camFlits = false;
    $('#btn-flits').classList.remove('on');
    const track = camStream.getVideoTracks()[0];
    const kan = track && track.getCapabilities ? track.getCapabilities() : {};
    $('#btn-flits').hidden = !kan.torch;
  } catch (e) {
    camFallback(e && e.name);
  }
}

/* geen cameratoegang: losse foto via de toestelkiezer, dossier via de bibliotheek
   (die op iOS ook de native camera aanbiedt) */
function camFallback(fout) {
  if (camModus === 'enkel') {
    const inp = $('#fotoinput');
    inp.value = '';
    inp.click();
  } else {
    toast(`Geen cameratoegang${fout ? ' (' + fout + ')' : ''} – bibliotheek geopend`);
    const inp = $('#dossierinput');
    inp.value = '';
    inp.click();
  }
}

$('#btn-flits').addEventListener('click', async () => {
  if (!camStream) return;
  const track = camStream.getVideoTracks()[0];
  try {
    camFlits = !camFlits;
    await track.applyConstraints({ advanced: [{ torch: camFlits }] });
    $('#btn-flits').classList.toggle('on', camFlits);
  } catch (e) {
    camFlits = false;
    $('#btn-flits').classList.remove('on');
    toast('Flits niet beschikbaar op dit toestel');
  }
});

function stopCamera() {
  if (camStream) {
    camStream.getTracks().forEach(t => t.stop());
    camStream = null;
  }
  camFlits = false;
  $('#btn-flits').classList.remove('on');
  $('#camvideo').srcObject = null;
  $('#camera').hidden = true;
}

let camSessieFotos = 0;
function updateCamTeller(n) {
  camSessieFotos = n;
  $('#camteller').textContent = n ? `${n} foto${n === 1 ? '' : "'s"}` : '';
}

$('#btn-camera').addEventListener('click', () => startCamera('dossier'));

$('#btn-sluiter').addEventListener('click', async () => {
  const v = $('#camvideo');
  if (!S || !camStream || !v.videoWidth) return;
  if (camModus === 'enkel') {
    const cb = fotoCb;
    fotoCb = null;
    try {
      const jpeg = await canvasNaarJpeg(v, v.videoWidth, v.videoHeight, TIER.foto);
      stopCamera();
      const rec = await voegFotoToe(null, jpeg);
      if (rec && cb) cb(rec.id);
    } catch (e) {
      stopCamera();
      toast('Foto niet bewaard');
    }
    return;
  }
  flash($('#btn-sluiter'));
  try {
    const jpeg = await canvasNaarJpeg(v, v.videoWidth, v.videoHeight, tierVoorGroep(fotoSel));
    const rec = await voegFotoToe(fotoSel, jpeg);
    if (rec) {
      updateCamTeller(camSessieFotos + 1);
      renderDossier();
    }
  } catch (e) { toast('Foto niet bewaard'); }
});

$('#btn-camklaar').addEventListener('click', () => {
  if (camModus === 'enkel') {
    fotoCb = null;
    stopCamera();
    return;
  }
  stopCamera();
  if (camSessieFotos) toast(`${camSessieFotos} foto${camSessieFotos === 1 ? '' : "'s"} toegevoegd`);
});

/* app naar de achtergrond: camera netjes loslaten (iOS stopt de stream toch) */
document.addEventListener('visibilitychange', () => { if (document.hidden && camStream) { stopCamera(); if (S && dirty) bewaar(); } });
window.addEventListener('pagehide', () => { if (camStream) stopCamera(); });

/* ============================== tab Afronden (§7.7) ============================== */

function renderAfronden() {
  renderChecks();
  /* grijze regel + verwijderknop volgen pdfBewaardOp (§6) */
  const klaar = !!S.pdfBewaardOp;
  $('#pdf-bewaard').hidden = !klaar;
  if (klaar) $('#pdf-bewaard').textContent = `Dossier bewaard op ${datumUur(S.pdfBewaardOp)}`;
  const del = $('#btn-verwijder-woning');
  del.disabled = !klaar;
  del.textContent = klaar ? 'Woning verwijderen' : 'Bewaar eerst het dossier';
}

/* controlelijstje: informatief, nooit blokkerend, vers berekend bij openen */
function renderChecks() {
  const ul = $('#checklijst');
  ul.innerHTML = '';
  const zonderFoto = S.ruimtes.filter(r => !dossierFotos(r.id).length).map(r => r.naam);
  const items = [
    { ok: !zonderFoto.length, tekst: 'Elke ruimte minstens één foto', detail: zonderFoto.join(', ') },
    { ok: S.energie.opwekkers.length > 0, tekst: 'Verwarming ingevuld', detail: 'nog geen opwekker of toestel' },
    { ok: !!S.algemeen.hoofdFotoId, tekst: 'Hoofdfoto gekozen', detail: 'ster op een gevelfoto' }
  ];
  items.forEach(i => {
    const li = document.createElement('li');
    li.innerHTML =
      `<div class="info">
         <div class="r1">${i.ok ? '✅' : '❌'} ${esc(i.tekst)}</div>
         ${!i.ok && i.detail ? `<div class="r3">${esc(i.detail)}</div>` : ''}
       </div>`;
    ul.appendChild(li);
  });
}

/* ---------- PDF bewaren (§9.3): worker met voortgang, dan share/download ---------- */

let pdfBezig = false;
let pdfKlaarFile = null; /* Blob wacht op een user gesture na NotAllowedError */

function zetVoortgang(v) {
  const p = $('#pdf-voortgang');
  p.hidden = false;
  p.value = v;
}
function verbergVoortgang() {
  $('#pdf-voortgang').hidden = true;
}

function bouwInWorker(woning, fotos) {
  return new Promise((res, rej) => {
    let w;
    try { w = new Worker('pdfworker.js'); } catch (e) { rej(e); return; }
    w.onmessage = ev => {
      if (ev.data.voortgang !== undefined) { zetVoortgang(ev.data.voortgang); return; }
      if (ev.data.fout) { w.terminate(); rej(new Error(ev.data.fout)); return; }
      if (ev.data.klaar) { w.terminate(); res(ev.data.klaar); }
    };
    w.onerror = e => { w.terminate(); rej(new Error(e.message || 'Worker-fout')); };
    const buffers = [...fotos.values()].map(f => f.bytes.buffer);
    w.postMessage({ woning: JSON.parse(JSON.stringify(woning)), fotos, versie: swVersie, naam: slug(woning.algemeen.adres) || 'epc' }, buffers);
  });
}

async function bewaarPdf() {
  if (!S || pdfBezig) return;
  pdfBezig = true;
  toast('Dossier maken…');
  zetVoortgang(0);
  try {
    const fotos = new Map();
    for (const [id, rec] of DB.geladenFotos()) {
      if (fotoVerborgen(id)) continue;
      const buf = await rec.blob.arrayBuffer();
      fotos.set(id, { bytes: new Uint8Array(buf), breedte: rec.breedte, hoogte: rec.hoogte, groep: rec.groep, volgorde: rec.volgorde });
    }
    const blob = await bouwInWorker(S, fotos);
    if (blob.size > 150 * 1024 * 1024 && !confirm('Groot dossier, delen kan mislukken. Toch doorgaan?')) {
      toast('Niet bewaard');
      return;
    }
    const naam = (slug(S.algemeen.adres) || 'epc') + '.zip';
    const file = new File([blob], naam, { type: 'application/zip' });
    await deelOfDownload(file);
  } catch (e) {
    toast('Dossier maken mislukt' + (e && (e.name || e.message) ? ` (${e.name || e.message})` : ''));
  } finally {
    pdfBezig = false;
    verbergVoortgang();
  }
}

async function deelOfDownload(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      zetPdfBewaard();
      return;
    } catch (e) {
      if (e.name === 'AbortError') { toast('Niet bewaard'); return; }
      if (e.name === 'NotAllowedError') {
        /* iOS eist een user gesture: Blob blijft in het geheugen, de knop
           wordt "Deel PDF" die share() rechtstreeks vanuit een tik aanroept */
        pdfKlaarFile = file;
        $('#btn-print').hidden = true;
        $('#btn-deel').hidden = false;
        toast('Tik op "Deel dossier" om te delen');
        return;
      }
      throw e;
    }
  }
  downloadBlob(file.name, file);
  zetPdfBewaard();
}

function zetPdfBewaard() {
  S.pdfBewaardOp = nu();
  wijzig();
  bewaar();
  renderAfronden();
  toast('Dossier bewaard');
}

$('#btn-print').addEventListener('click', bewaarPdf);
$('#btn-noodpdf').addEventListener('click', bewaarPdf);

$('#btn-deel').addEventListener('click', async () => {
  if (!pdfKlaarFile) return;
  try {
    await navigator.share({ files: [pdfKlaarFile] });
    pdfKlaarFile = null;
    $('#btn-deel').hidden = true;
    $('#btn-print').hidden = false;
    zetPdfBewaard();
  } catch (e) {
    if (e.name === 'AbortError') { toast('Niet bewaard'); return; } /* knop blijft: opnieuw proberen kan */
    pdfKlaarFile = null;
    $('#btn-deel').hidden = true;
    $('#btn-print').hidden = false;
    toast('Delen mislukt' + (e && e.name ? ` (${e.name})` : ''));
  }
});

/* ---------- bestand downloaden (zonder deelmenu) ---------- */

function downloadBlob(naam, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = naam;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ---------- woning verwijderen: pas na een geslaagde PDF (§6) ---------- */

$('#btn-verwijder-woning').addEventListener('click', async () => {
  if (!S || !S.pdfBewaardOp) return;
  if (!confirm(`"${S.algemeen.adres || 'Zonder adres'}" definitief verwijderen?\nPDF bewaard op ${datumUur(S.pdfBewaardOp)}.`)) return;
  commitUndo();
  const w = S;
  S = null;
  dirty = false;
  try {
    await DB.verwijderWoningMetFotos(w.id);
  } catch (e) {
    S = w;
    toast('Verwijderen mislukt' + (e && e.name ? ` (${e.name})` : ''));
    return;
  }
  DB.sluitWoning();
  await renderLijst();
  toonLijst();
  toast('Woning verwijderd');
});

/* accordeon: per tab maximaal één sectie tegelijk open */
['#tab-algemeen', '#tab-details'].forEach(container => {
  $$(container + ' details.sectie').forEach(d => {
    d.addEventListener('toggle', () => {
      if (!d.open) return;
      $$(container + ' details.sectie').forEach(x => { if (x !== d) x.open = false; });
    });
  });
});

/* iOS: de vaste onderbalk springt mee met het toetsenbord; verberg hem tijdens het typen */
document.addEventListener('focusin', e => {
  if (e.target.matches('input, textarea')) $('#tabbar').classList.add('toets');
});
document.addEventListener('focusout', () => setTimeout(() => {
  const a = document.activeElement;
  if (!a || !a.matches('input, textarea')) $('#tabbar').classList.remove('toets');
}, 60));

/* ============================== UI sync ============================== */

function syncAlles() {
  /* algemeen */
  $('#adres').value = S.algemeen.adres;
  $('#datum').value = S.algemeen.datum;
  $('#notities').value = S.algemeen.notities;

  /* ramen: formulier volgt draft, geen openstaande wijziging */
  stopBewerkRaam();
  draft = leegDraft();
  syncRaamForm();
  $('#breedte').value = '';
  $('#hoogte').value = '';
  $('#aantal').value = draft.aantal;
  updateM2Live();
  renderRamen();

  /* centrale verwarming (tab Algemeen) */
  stopBewerkOpwek();
  draftOpwek = leegDraftOpwek();
  syncOpwekForm();
  $('#opw-beschrijving').value = '';
  renderOpwekkers();

  /* extra installaties */
  draftPvOr = 'plat';
  syncCyPvor();
  $('#pv-wp').value = '';
  renderPv();
  syncCyZonneboiler();
  toonZbM2();
  $('#zb-m2').value = S.energie.zonneboilerM2;

  /* verwarming per ruimte (tab Details) */
  stopBewerkRv();
  draftRv = { type: 'airco', fotoId: null };
  syncRvForm();
  $('#rv-beschrijving').value = '';

  /* ruimtebalk: Details start op de eerste ruimte, Foto's op Gevels */
  ruimteSel = S.ruimtes.length ? S.ruimtes[0].id : null;
  fotoSel = 'gevels';
  renderRuimtebalk();

  /* PDF-knoppen terug in de basisstand */
  pdfKlaarFile = null;
  $('#btn-deel').hidden = true;
  $('#btn-print').hidden = false;
  verbergVoortgang();
}

/* ============================== start ============================== */

(async function init() {
  DB.zetFoutmelder(naam => {
    if (naam === 'QuotaExceededError') {
      zetRodeBalk('NIET OPGESLAGEN — Opslag vol — bewaar de PDF en verwijder een afgewerkte woning');
    }
  });

  try {
    await DB.open();
  } catch (e) {
    /* niets wissen: rode balk + read-only geheugenmodus, enkel "Bewaar PDF" werkt nog (§6) */
    DB.startGeheugenmodus();
    zetRodeBalk(`NIET OPGESLAGEN — databank niet beschikbaar (${(e && e.name) || 'fout'})`);
  }

  /* persistente opslag aanvragen tegen eviction, in een try (§6); geen banner:
     echte quotaproblemen melden zich via de rode balk bij een gefaalde write */
  try {
    if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
  } catch (e) { /* geen storage-API */ }

  await renderLijst();
  toonLijst();

  /* weesfotosweep op idle; faalt stil (§5.1) */
  const idle = window.requestIdleCallback || (fn => setTimeout(fn, 3000));
  idle(() => DB.weesfotoSweep());

  /* service worker: registreren en updates checken bij start en terugkeer.
     Verder niets — de nieuwe versie draait na het wegvegen uit de app-switcher. */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then(reg => {
        reg.update();
        document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update(); });
      })
      .catch(() => { /* offline install vereist https of localhost */ });
  }
})();
