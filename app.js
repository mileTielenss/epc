'use strict';

/* moet gelijklopen met CACHE in sw.js; wijkt de draaiende SW af, dan draaien we
   op verouderde bestanden en herladen we onszelf (eenmalig) */
const APP_VERSIE = 'epc-v41';

/* ============================== helpers ============================== */

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function vandaag() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function nu() { return new Date().toISOString(); }
function nieuwId() { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }

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

/* ============================== IndexedDB ============================== */

let db = null;

function dbOpen() {
  return new Promise((res, rej) => {
    const q = indexedDB.open('epc-db', 1);
    q.onupgradeneeded = () => {
      q.result.createObjectStore('woningen', { keyPath: 'id' });
      q.result.createObjectStore('instellingen');
    };
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}

function tx(store, mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => res(r && 'result' in r ? r.result : undefined);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

const dbPutWoning = w => tx('woningen', 'readwrite', s => s.put(w));
const dbGetWoning = id => tx('woningen', 'readonly', s => s.get(id));
const dbAlleWoningen = () => tx('woningen', 'readonly', s => s.getAll());
const dbVerwijderWoning = id => tx('woningen', 'readwrite', s => s.delete(id));

/* ============================== woningmodel ============================== */

/* elke woning start met de standaardruimtes; extra ruimtes voeg je toe in de ruimtebalk */
function standaardRuimtes() {
  return ['Living', 'Keuken', 'Badkamer', 'WC', 'Slaapkamer 1']
    .map(naam => ({ naam, vent: 'geen', ventBeschrijving: '', opm: '', afm: null }));
}

function leegWoning() {
  return {
    id: nieuwId(),
    status: 'open',
    gemaakt: nu(),
    gewijzigd: nu(),
    algemeen: { adres: '', foto: null, datum: vandaag(), notities: '' },
    ruimtes: standaardRuimtes(),
    ramen: [],
    energie: { opwekkers: [], pvPanelen: [], zonneboiler: 'nee', zonneboilerM2: '' },
    fotodossier: [],
    teller: 0,
    tellerOpwek: 0,
    tellerDossier: 0
  };
}

/* defaults aanvullen en tellers/nrs herstellen; geen legacy-migraties
   (er bestaan geen woningen van oudere modelversies) */
function normaliseer(p) {
  const basis = leegWoning();
  const w = {
    ...basis, ...p,
    algemeen: { ...basis.algemeen, ...(p.algemeen || {}) },
    energie: { ...basis.energie, ...(p.energie || {}) }
  };

  if (!Array.isArray(w.ruimtes) || !w.ruimtes.length) w.ruimtes = standaardRuimtes();
  w.ruimtes = groepeerRuimtes(w.ruimtes.map(r => ({
    naam: String(r.naam || 'Ruimte'),
    vent: VENT_MODES.includes(r.vent) ? r.vent : 'geen',
    ventBeschrijving: r.ventBeschrijving || '',
    opm: r.opm || '',
    afm: r.afm && num(r.afm.b) && num(r.afm.d) && num(r.afm.h)
      ? { b: num(r.afm.b), d: num(r.afm.d), h: num(r.afm.h) } : null
  })));

  if (!Array.isArray(w.ramen)) w.ramen = [];
  w.teller = Math.max(w.teller || 0, ...w.ramen.map(r => r.nr || 0), 0);
  w.ramen.forEach(r => {
    if (!r.nr) r.nr = ++w.teller;
    r.aantal = Math.max(1, Math.round(num(r.aantal)) || 1);
    r.ruimte = r.ruimte || '';
  });

  if (!Array.isArray(w.energie.opwekkers)) w.energie.opwekkers = [];
  w.tellerOpwek = Math.max(w.tellerOpwek || 0, ...w.energie.opwekkers.map(o => o.nr || 0), 0);
  w.energie.opwekkers.forEach(o => {
    if (!o.nr) o.nr = ++w.tellerOpwek;
    o.ruimte = o.ruimte || '';
  });
  if (!Array.isArray(w.energie.pvPanelen)) w.energie.pvPanelen = [];
  w.energie.pvPanelen = w.energie.pvPanelen.map(p => ({ orientatie: p.orientatie || '', wp: String(p.wp || '') }));
  w.energie.zonneboiler = w.energie.zonneboiler === 'ja' ? 'ja' : 'nee';
  if (typeof w.energie.zonneboilerM2 !== 'string') w.energie.zonneboilerM2 = '';

  if (!Array.isArray(w.fotodossier)) w.fotodossier = [];
  w.tellerDossier = Math.max(w.tellerDossier || 0, ...w.fotodossier.map(f => f.nr || 0), 0);
  w.fotodossier.forEach(f => {
    if (!f.nr) f.nr = ++w.tellerDossier;
    f.ruimte = f.ruimte || '';
  });

  if (!w.id) w.id = nieuwId();
  if (!w.status) w.status = 'open';
  return w;
}

/* ============================== actieve woning + autosave ============================== */

let S = null;      // actieve woning, null = lijstscherm
let dirty = false;
let draft = null;  // invoerformulier ramen-tab

function leegDraft() {
  return { element: 'raam', gevel: 'voor', beglazing: 'dubbel', kader: 'pvc', rolluik: 'nee', foto: null, aantal: 1 };
}

function wijzig() { dirty = true; }

async function bewaar() {
  if (!S) return;
  S.gewijzigd = nu();
  try {
    await dbPutWoning(S);
    dirty = false;
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    $('#savestamp').textContent = `opgeslagen\n${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  } catch (e) {
    toast('Opslaan mislukt!');
    return;
  }
}

setInterval(() => { if (S && dirty) bewaar(); }, 3000);
window.addEventListener('pagehide', () => { if (S && dirty) bewaar(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && S && dirty) bewaar(); });

/* ============================== views ============================== */

function toonLijst() {
  $('#view-lijst').hidden = false;
  $('#app').hidden = true;
  $('#tabbar').hidden = true;
  $('#btn-terug').hidden = true;
  $('#ruimtebalk').hidden = true;
  $('#titel').textContent = 'EPC Plaatsbezoek';
  $('#savestamp').textContent = '';
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
  if (naam === 'export' && S) renderChecks();
  actieveTab = naam;
  $$('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === naam));
  $$('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + naam));
  $('#ruimtebalk').hidden = !['details', 'fotos'].includes(naam);
  /* ramen en toestellen horen altijd bij een echte ruimte (binnen het beschermd
     volume): op Details bestaat "Buiten" niet en is altijd een ruimte gekozen */
  if (naam === 'details' && S && !huidigeRuimte() && S.ruimtes.length) {
    selectedRuimte = S.ruimtes[0].naam;
  }
  if (S) renderRuimtebalk();
  window.scrollTo(0, 0);
}

function zetTitel() {
  $('#titel').textContent = (S && S.algemeen.adres) || 'Nieuwe woning';
}

async function openWoning(id) {
  const w = await dbGetWoning(id);
  if (!w) { toast('Woning niet gevonden'); return; }
  S = normaliseer(w);
  draft = leegDraft();
  draftOpwek = leegDraftOpwek();
  syncAlles();
  toonEditor();
}

async function sluitWoning() {
  if (S && dirty) await bewaar();
  S = null;
  await renderLijst();
  toonLijst();
}

$('#btn-terug').addEventListener('click', sluitWoning);
$('#btn-sluiten').addEventListener('click', sluitWoning);

/* ============================== woningenlijst ============================== */

const STATUS_NAMEN = { open: 'Open', afgewerkt: 'Af' };

async function renderLijst() {
  const alle = (await dbAlleWoningen()).sort((a, b) => (b.gewijzigd || '').localeCompare(a.gewijzigd || ''));
  const ul = $('#woninglijst');
  ul.innerHTML = '';
  if (!alle.length) {
    ul.innerHTML = '<li class="leeg">Nog geen woningen. Start hieronder een nieuwe.</li>';
    return;
  }
  alle.forEach(w => {
    const li = document.createElement('li');
    li.className = 'woning';
    li.dataset.id = w.id;
    li.innerHTML =
      (w.algemeen.foto ? `<img class="thumb" src="${w.algemeen.foto}" alt="">` : '') +
      `<div class="info">
         <div class="r1">${esc(w.algemeen.adres || 'Zonder adres')}</div>
         <div class="r3">${esc(w.algemeen.datum || '')}</div>
       </div>
       <button type="button" class="status ${w.status}" data-id="${w.id}">${STATUS_NAMEN[w.status] || 'Open'}</button>
       <button type="button" class="del" data-id="${w.id}">×</button>`;
    ul.appendChild(li);
  });
}

$('#woninglijst').addEventListener('click', async e => {
  if (e.target.closest('img.thumb')) return; /* tik op fotominiatuur: enkel lightbox */
  const del = e.target.closest('.del');
  if (del) {
    const w = await dbGetWoning(del.dataset.id);
    if (!w) return;
    if (!confirm(`"${w.algemeen.adres || 'Zonder adres'}" definitief verwijderen?`)) return;
    await dbVerwijderWoning(w.id);
    await renderLijst();
    toast('Woning verwijderd');
    return;
  }
  const st = e.target.closest('.status');
  if (st) {
    const w = await dbGetWoning(st.dataset.id);
    if (!w) return;
    w.status = w.status === 'open' ? 'afgewerkt' : 'open';
    w.gewijzigd = nu();
    await dbPutWoning(w);
    await renderLijst();
    return;
  }
  const li = e.target.closest('li.woning');
  if (li) openWoning(li.dataset.id);
});

$('#btn-nieuwewoning').addEventListener('click', async () => {
  S = leegWoning();
  draft = leegDraft();
  draftOpwek = leegDraftOpwek();
  await bewaar();
  syncAlles();
  toonEditor();
});

/* ============================== foto's ============================== */

/* bron (img/video-frame) verkleind naar JPEG-dataURL */
function naarJpeg(bron, breed, hoog, maxDim, kwaliteit) {
  const s = Math.min(1, maxDim / Math.max(breed, hoog));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(breed * s));
  c.height = Math.max(1, Math.round(hoog * s));
  c.getContext('2d').drawImage(bron, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', kwaliteit);
}

function verkleinBestand(f, maxDim, kwaliteit) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onerror = rej;
    r.onload = () => {
      const img = new Image();
      img.onerror = rej;
      img.onload = () => res(naarJpeg(img, img.width, img.height, maxDim, kwaliteit));
      img.src = r.result;
    };
    r.readAsDataURL(f);
  });
}

/* detailfoto's klein houden (opslag). Losse foto's (kenplaat, afstandhouder...)
   openen de interne camera in enkel-modus: één tik, foto zit erin. Lukt de
   camera niet, dan valt het terug op de gewone camerakiezer van het toestel. */
let fotoCb = null, fotoMaxDim = 1200, fotoKwaliteit = 0.7;
function neemFoto(cb, maxDim = 1200, kwaliteit = 0.7) {
  fotoCb = cb;
  fotoMaxDim = maxDim;
  fotoKwaliteit = kwaliteit;
  startCamera('enkel');
}
$('#fotoinput').addEventListener('change', async () => {
  const f = $('#fotoinput').files[0];
  if (!f || !fotoCb) return;
  const cb = fotoCb;
  fotoCb = null;
  try { cb(await verkleinBestand(f, fotoMaxDim, fotoKwaliteit)); } catch (e) { toast('Foto laden mislukt'); }
});

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

/* ============================== algemeen (tab Algemeen) ============================== */

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
    bewaar();
    toast('Adres ingevuld');
  }, () => toast('Locatie niet beschikbaar'), { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
});
bind('#datum', v => S.algemeen.datum = v);
bind('#notities', v => S.algemeen.notities = v);


/* roterende knop: elke tik schuift naar de volgende optie; toont dat er meer
   opties zijn via het draai-icoon. '' toont een gedimde — */
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

/* ============================== ramen & deuren (tab Details) ============================== */

let bewerkRaamNr = null; /* nr van het raam dat je aan het wijzigen bent, of null */

segInit('#seg-element', v => { draft.element = v; updateRaamFotoLabel(); });

const syncCyBeglazing = cycleInit('#cy-beglazing',
  ['enkel', 'dubbel', 'hr-dubbel', 'drievoudig', 'paneel'],
  { enkel: 'Enkel', dubbel: 'Dubbel', 'hr-dubbel': 'HR dubbel', drievoudig: 'Drievoudig', paneel: 'Vol paneel' },
  () => draft.beglazing, v => draft.beglazing = v);
const syncCyKader = cycleInit('#cy-kader', ['pvc', 'alu', 'hout'],
  { pvc: 'PVC', alu: 'Alu', hout: 'Hout' },
  () => draft.kader, v => draft.kader = v);
const syncCyRolluik = cycleInit('#cy-rolluik', ['nee', 'ja'], { nee: 'Nee', ja: 'Ja' },
  () => draft.rolluik, v => draft.rolluik = v);

/* dakramen hebben meestal een kenplaatje i.p.v. een afstandhouder */
function updateRaamFotoLabel() {
  $('#btn-raamfoto').textContent = draft.element === 'dakraam' ? '\u{1F4F7} Foto kenplaatje' : '\u{1F4F7} Foto afstandhouder';
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

$('#btn-raamfoto').addEventListener('click', () => neemFoto(data => {
  draft.foto = data;
  updateRaamThumb();
}));
$('#btn-raamfoto-del').addEventListener('click', () => {
  if (!confirm('Foto afstandhouder verwijderen?')) return;
  draft.foto = null;
  updateRaamThumb();
});
function updateRaamThumb() {
  const t = $('#raamfoto-thumb'), d = $('#btn-raamfoto-del');
  t.hidden = d.hidden = !draft.foto;
  if (draft.foto) t.src = draft.foto;
}

const ELEMENT_NAMEN = { raam: 'Raam', deur: 'Deur', dakraam: 'Dakraam' };
const GEVEL_NAMEN = { voor: 'Voor', achter: 'Achter', links: 'Links', rechts: 'Rechts' };
const GEVEL_ORDE = { voor: 0, achter: 1, links: 2, rechts: 3 };

/* lijst gesorteerd voor weergave/print: eerst alle deuren, daarna de rest;
   telkens op gevel (voor, achter, links, rechts) en dan op nr */
function isDeur(r) { return r.element === 'deur'; }
function gesorteerdeRamen() {
  return [...S.ramen].sort((a, b) =>
    (isDeur(a) ? 0 : 1) - (isDeur(b) ? 0 : 1) ||
    (GEVEL_ORDE[a.gevel] ?? 9) - (GEVEL_ORDE[b.gevel] ?? 9) || (a.nr - b.nr));
}
function raamAantal(r) { return Math.max(1, r.aantal || 1); }
const GLAS_NAMEN = { enkel: 'Enkel', dubbel: 'Dubbel', 'hr-dubbel': 'HR dubbel', drievoudig: 'Drievoudig', paneel: 'Vol paneel' };
const KADER_NAMEN = { pvc: 'PVC', alu: 'Alu', hout: 'Hout' };

$('#btn-voegtoe').addEventListener('click', () => {
  if (!S) return;
  if (!huidigeRuimte()) { toast('Kies eerst een ruimte bovenaan'); return; }
  const b = num($('#breedte').value), h = num($('#hoogte').value);
  if (!b || !h) { toast('Vul breedte en hoogte in (m)'); return; }
  const aantal = Math.max(1, Math.round(num($('#aantal').value)) || 1);
  const velden = {
    element: draft.element,
    gevel: draft.gevel,
    ruimte: selectedRuimte,
    b, h,
    beglazing: draft.beglazing,
    kader: draft.kader,
    rolluik: draft.rolluik === 'ja',
    aantal,
    foto: draft.foto
  };
  if (bewerkRaamNr !== null) {
    const r = S.ramen.find(x => x.nr === bewerkRaamNr);
    if (r) Object.assign(r, velden);
    toast(`${ELEMENT_NAMEN[draft.element]} #${bewerkRaamNr} gewijzigd`);
    stopBewerkRaam();
  } else {
    S.teller = (S.teller || 0) + 1;
    S.ramen.push({ nr: S.teller, ...velden });
    toast(`${ELEMENT_NAMEN[draft.element]} toegevoegd`);
  }
  draft.foto = null;
  updateRaamThumb();
  $('#breedte').value = '';
  $('#hoogte').value = '';
  zetAantal(1);
  updateM2Live();
  renderRamen();
  bewaar();
  flash($('#btn-voegtoe'));
});

/* een bestaand raam in het formulier laden om te wijzigen */
function startBewerkRaam(nr) {
  const r = S.ramen.find(x => x.nr === nr);
  if (!r) return;
  bewerkRaamNr = nr;
  draft.element = r.element;
  draft.gevel = r.gevel;
  draft.beglazing = r.beglazing;
  draft.kader = r.kader;
  draft.rolluik = r.rolluik ? 'ja' : 'nee';
  draft.foto = r.foto || null;
  draft.aantal = raamAantal(r);
  /* de ruimtebalk springt mee naar de ruimte van dit raam */
  if (r.ruimte && S.ruimtes.some(x => x.naam === r.ruimte)) selectedRuimte = r.ruimte;
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
  bewerkRaamNr = null;
  $('#btn-voegtoe').textContent = 'Voeg toe';
  $('#btn-annuleer-raam').hidden = true;
}

$('#btn-annuleer-raam').addEventListener('click', () => {
  stopBewerkRaam();
  draft.foto = null;
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

function renderRamen() {
  const ul = $('#ramenlijst');
  ul.innerHTML = '';
  gesorteerdeRamen().forEach(r => {
    const li = document.createElement('li');
    if (r.nr === bewerkRaamNr) li.className = 'bewerk';
    li.dataset.nr = r.nr;
    const n = raamAantal(r);
    const tags = [GLAS_NAMEN[r.beglazing] || r.beglazing, KADER_NAMEN[r.kader] || r.kader];
    if (r.rolluik) tags.push('rolluik');
    if (r.ruimte) tags.unshift(r.ruimte);
    li.innerHTML =
      `<div class="info">
         <div class="r1">#${r.nr} ${esc(ELEMENT_NAMEN[r.element] || r.element)} · ${esc(GEVEL_NAMEN[r.gevel] || r.gevel)}${n > 1 ? ` · ${n}×` : ''}</div>
         <div class="r2">${fmtM(r.b)} × ${fmtM(r.h)} m = ${fmt(r.b * r.h)} m²${n > 1 ? ` (${fmt(r.b * r.h * n)} m² totaal)` : ''}</div>
         <div class="r3">${esc(tags.join(' · '))} · tik om te wijzigen</div>
       </div>` +
      (r.foto ? `<img class="thumb" src="${r.foto}" alt="foto #${r.nr}">` : '') +
      `<button type="button" class="del" data-nr="${r.nr}">×</button>`;
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
    const nr = Number(del.dataset.nr);
    const r = S.ramen.find(x => x.nr === nr);
    if (!r) return;
    if (!confirm(`#${nr} ${ELEMENT_NAMEN[r.element]} (${fmtM(r.b)} × ${fmtM(r.h)} m) verwijderen?`)) return;
    if (bewerkRaamNr === nr) stopBewerkRaam();
    S.ramen = S.ramen.filter(x => x.nr !== nr);
    renderRamen();
    bewaar();
    return;
  }
  const li = e.target.closest('li[data-nr]');
  if (li) startBewerkRaam(Number(li.dataset.nr));
});

/* ============================== centrale verwarming (tab Algemeen) ============================== */

const OPWEK_NAMEN = { gas: 'Gas', stookolie: 'Stookolie', airco: 'Airco', kachel: 'Kachel', andere: 'Andere', 'ruimte-andere': 'Andere' };
const FUNCTIE_NAMEN = { radiatoren: 'radiatoren', vloer: 'vloerverwarming', sww: 'warm water' };

/* airco's en kachels horen bij een ruimte; de rest is centraal (tab Algemeen) */
function isRuimteToestel(o) { return o.type === 'airco' || o.type === 'kachel' || o.type === 'ruimte-andere'; }

function leegDraftOpwek() {
  return { type: 'gas', functie: [], foto: null, fotoKraan: null };
}
let draftOpwek = leegDraftOpwek();
let bewerkOpwekNr = null; /* nr van de opwekker die je aan het wijzigen bent, of null */

chipsInit('#chips-opwekfunctie', vals => { draftOpwek.functie = vals; toonOpwekVelden(); });

const syncCyOpwektype = cycleInit('#cy-opwektype', ['gas', 'stookolie', 'andere'],
  { gas: 'Gas', stookolie: 'Stookolie', andere: 'Andere' },
  () => draftOpwek.type, v => draftOpwek.type = v);

function toonOpwekVelden() {
  $('#opw-kraanfoto-rij').hidden = !draftOpwek.functie.includes('radiatoren');
}

$('#btn-opwekfoto').addEventListener('click', () => neemFoto(data => {
  draftOpwek.foto = data;
  updateOpwekThumb();
}));
$('#btn-opwekfoto-del').addEventListener('click', () => {
  if (!confirm('Foto kenplaat verwijderen?')) return;
  draftOpwek.foto = null;
  updateOpwekThumb();
});
function updateOpwekThumb() {
  const t = $('#opwekfoto-thumb'), d = $('#btn-opwekfoto-del');
  t.hidden = d.hidden = !draftOpwek.foto;
  if (draftOpwek.foto) t.src = draftOpwek.foto;
  const tk = $('#kraanfoto-thumb'), dk = $('#btn-kraanfoto-del');
  tk.hidden = dk.hidden = !draftOpwek.fotoKraan;
  if (draftOpwek.fotoKraan) tk.src = draftOpwek.fotoKraan;
}

$('#btn-kraanfoto').addEventListener('click', () => neemFoto(data => {
  draftOpwek.fotoKraan = data;
  updateOpwekThumb();
}));
$('#btn-kraanfoto-del').addEventListener('click', () => {
  if (!confirm('Foto radiatorkranen verwijderen?')) return;
  draftOpwek.fotoKraan = null;
  updateOpwekThumb();
});

function syncOpwekForm() {
  syncCyOpwektype();
  chipsSet('#chips-opwekfunctie', draftOpwek.functie);
  toonOpwekVelden();
  updateOpwekThumb();
}

$('#btn-opwek-voegtoe').addEventListener('click', () => {
  if (!S) return;
  const velden = {
    type: draftOpwek.type,
    ruimte: '',
    functie: [...draftOpwek.functie],
    beschrijving: $('#opw-beschrijving').value.trim(),
    foto: draftOpwek.foto,
    fotoKraan: draftOpwek.functie.includes('radiatoren') ? draftOpwek.fotoKraan : null
  };
  if (bewerkOpwekNr !== null) {
    const o = S.energie.opwekkers.find(x => x.nr === bewerkOpwekNr);
    if (o) Object.assign(o, velden);
    toast(`${OPWEK_NAMEN[draftOpwek.type]} #${bewerkOpwekNr} gewijzigd`);
    stopBewerkOpwek();
  } else {
    S.tellerOpwek = (S.tellerOpwek || 0) + 1;
    S.energie.opwekkers.push({ nr: S.tellerOpwek, ...velden });
    toast(`${OPWEK_NAMEN[draftOpwek.type]} toegevoegd`);
  }
  draftOpwek = leegDraftOpwek();
  syncOpwekForm();
  $('#opw-beschrijving').value = '';
  renderOpwekkers();
  bewaar();
  flash($('#btn-opwek-voegtoe'));
});

/* een bestaande centrale verwarming in het formulier laden om te wijzigen */
function startBewerkOpwek(nr) {
  const o = S.energie.opwekkers.find(x => x.nr === nr);
  if (!o) return;
  bewerkOpwekNr = nr;
  draftOpwek = {
    type: isRuimteToestel(o) ? 'andere' : o.type,
    functie: [...(o.functie || [])],
    foto: o.foto || null,
    fotoKraan: o.fotoKraan || null
  };
  draftOpwek.type = o.type in { gas: 1, stookolie: 1, andere: 1 } ? o.type : 'andere';
  syncOpwekForm();
  $('#opw-beschrijving').value = o.beschrijving || '';
  $('#btn-opwek-voegtoe').textContent = 'Bewaar wijziging';
  $('#btn-annuleer-opwek').hidden = false;
  renderOpwekkers();
  window.scrollTo(0, 0);
}

function stopBewerkOpwek() {
  bewerkOpwekNr = null;
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
  [...S.energie.opwekkers].filter(o => !isRuimteToestel(o)).reverse().forEach(o => {
    const li = document.createElement('li');
    if (o.nr === bewerkOpwekNr) li.className = 'bewerk';
    li.dataset.nr = o.nr;
    li.innerHTML =
      `<div class="info">
         <div class="r1">#${o.nr} ${esc(OPWEK_NAMEN[o.type] || o.type)}</div>
         <div class="r2">${esc((o.functie || []).map(f => FUNCTIE_NAMEN[f] || f).join(' + ') || '-')}</div>
         <div class="r3">${o.beschrijving ? esc(o.beschrijving) + ' · ' : ''}tik om te wijzigen</div>
       </div>` +
      (o.foto ? `<img class="thumb" src="${o.foto}" alt="kenplaat #${o.nr}">` : '') +
      (o.fotoKraan ? `<img class="thumb" src="${o.fotoKraan}" alt="radiatorkranen #${o.nr}">` : '') +
      `<button type="button" class="del" data-nr="${o.nr}">×</button>`;
    ul.appendChild(li);
  });
}

$('#opweklijst').addEventListener('click', e => {
  if (!S) return;
  if (e.target.closest('img.thumb')) return; /* fotominiatuur: enkel lightbox */
  const del = e.target.closest('.del');
  if (del) {
    const nr = Number(del.dataset.nr);
    const o = S.energie.opwekkers.find(x => x.nr === nr);
    if (!o) return;
    if (!confirm(`#${nr} ${OPWEK_NAMEN[o.type] || o.type} verwijderen?`)) return;
    if (bewerkOpwekNr === nr) stopBewerkOpwek();
    S.energie.opwekkers = S.energie.opwekkers.filter(x => x.nr !== nr);
    renderOpwekkers();
    bewaar();
    return;
  }
  const li = e.target.closest('li[data-nr]');
  if (li) startBewerkOpwek(Number(li.dataset.nr));
});

/* zonnepanelen: meerdere installaties, elk met orientatie en eigen Wp */
const PVOR_NAMEN = { '': '—', plat: 'Plat dak', voor: 'Voor', achter: 'Achter', links: 'Links', rechts: 'Rechts' };
let draftPvOr = 'plat';
const syncCyPvor = cycleInit('#cy-pvor', ['plat', 'voor', 'achter', 'links', 'rechts'], PVOR_NAMEN,
  () => draftPvOr, v => draftPvOr = v);

$('#btn-pv-voegtoe').addEventListener('click', () => {
  if (!S) return;
  const wp = Math.round(num($('#pv-wp').value));
  if (!wp) { toast('Vul het vermogen in Wp in'); return; }
  S.energie.pvPanelen.push({ orientatie: draftPvOr, wp: String(wp) });
  $('#pv-wp').value = '';
  renderPv();
  bewaar();
  toast(`Zonnepanelen ${PVOR_NAMEN[draftPvOr].toLowerCase()} toegevoegd`);
});

function renderPv() {
  const ul = $('#pvlijst');
  ul.innerHTML = '';
  S.energie.pvPanelen.forEach((p, i) => {
    const li = document.createElement('li');
    li.innerHTML =
      `<div class="info">
         <div class="r1">${esc(PVOR_NAMEN[p.orientatie] || '—')}</div>
         <div class="r2">${esc(p.wp)} Wp</div>
       </div>` +
      `<button type="button" class="del" data-i="${i}">×</button>`;
    ul.appendChild(li);
  });
}

$('#pvlijst').addEventListener('click', e => {
  const b = e.target.closest('.del');
  if (!b || !S) return;
  const p = S.energie.pvPanelen[Number(b.dataset.i)];
  if (!p) return;
  if (!confirm(`Zonnepanelen (${PVOR_NAMEN[p.orientatie] || '—'}, ${p.wp} Wp) verwijderen?`)) return;
  S.energie.pvPanelen.splice(Number(b.dataset.i), 1);
  renderPv();
  bewaar();
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

let draftRv = { type: 'airco', foto: null };
let bewerkRvNr = null;

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
}

$('#ruimte-opm').addEventListener('input', () => {
  const r = huidigeRuimte();
  if (!r) return;
  r.opm = $('#ruimte-opm').value;
  wijzig();
});

$('#btn-rvfoto').addEventListener('click', () => neemFoto(data => {
  draftRv.foto = data;
  updateRvThumb();
}));
$('#btn-rvfoto-del').addEventListener('click', () => {
  if (!confirm('Foto kenplaat verwijderen?')) return;
  draftRv.foto = null;
  updateRvThumb();
});
function updateRvThumb() {
  const t = $('#rvfoto-thumb'), d = $('#btn-rvfoto-del');
  t.hidden = d.hidden = !draftRv.foto;
  if (draftRv.foto) t.src = draftRv.foto;
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
    ruimte: r.naam,
    functie: [],
    beschrijving: $('#rv-beschrijving').value.trim(),
    foto: draftRv.foto,
    fotoKraan: null
  };
  if (bewerkRvNr !== null) {
    const o = S.energie.opwekkers.find(x => x.nr === bewerkRvNr);
    if (o) Object.assign(o, velden);
    toast(`${OPWEK_NAMEN[draftRv.type]} #${bewerkRvNr} gewijzigd`);
    stopBewerkRv();
  } else {
    S.tellerOpwek = (S.tellerOpwek || 0) + 1;
    S.energie.opwekkers.push({ nr: S.tellerOpwek, ...velden });
    toast(`${OPWEK_NAMEN[draftRv.type]} toegevoegd in ${r.naam}`);
  }
  draftRv = { type: draftRv.type, foto: null };
  syncRvForm();
  $('#rv-beschrijving').value = '';
  renderRv();
  bewaar();
  flash($('#btn-rv-voegtoe'));
});

function startBewerkRv(nr) {
  const o = S.energie.opwekkers.find(x => x.nr === nr);
  if (!o) return;
  bewerkRvNr = nr;
  draftRv = { type: ['kachel', 'ruimte-andere'].includes(o.type) ? o.type : 'airco', foto: o.foto || null };
  /* de ruimtebalk springt mee naar de ruimte van dit toestel */
  selectedRuimte = o.ruimte && S.ruimtes.some(x => x.naam === o.ruimte) ? o.ruimte : selectedRuimte;
  renderRuimtebalk();
  syncRuimteAfm();
  syncRvForm();
  $('#rv-beschrijving').value = o.beschrijving || '';
  $('#sec-energie').open = true;
  $('#btn-rv-voegtoe').textContent = 'Bewaar wijziging';
  $('#btn-annuleer-rv').hidden = false;
  renderRv();
  window.scrollTo(0, 0);
}

function stopBewerkRv() {
  bewerkRvNr = null;
  $('#btn-rv-voegtoe').textContent = 'Voeg toestel toe';
  $('#btn-annuleer-rv').hidden = true;
}

$('#btn-annuleer-rv').addEventListener('click', () => {
  stopBewerkRv();
  draftRv = { type: 'airco', foto: null };
  syncRvForm();
  $('#rv-beschrijving').value = '';
  renderRv();
});

function renderRv() {
  const ul = $('#rvlijst');
  ul.innerHTML = '';
  [...S.energie.opwekkers]
    .filter(o => isRuimteToestel(o) && o.ruimte === selectedRuimte)
    .sort((a, b) => a.nr - b.nr)
    .forEach(o => {
      const li = document.createElement('li');
      if (o.nr === bewerkRvNr) li.className = 'bewerk';
      li.dataset.nr = o.nr;
      const r = S.ruimtes.find(x => x.naam === o.ruimte);
      const det = [o.beschrijving, r && r.afm ? afmTekst(r.afm) : ''].filter(Boolean);
      li.innerHTML =
        `<div class="info">
           <div class="r1">#${o.nr} ${esc(OPWEK_NAMEN[o.type] || o.type)}</div>
           <div class="r2">${esc(o.ruimte || '-')}</div>
           <div class="r3">${det.length ? esc(det.join(' · ')) + ' · ' : ''}tik om te wijzigen</div>
         </div>` +
        (o.foto ? `<img class="thumb" src="${o.foto}" alt="kenplaat #${o.nr}">` : '') +
        `<button type="button" class="del" data-nr="${o.nr}">×</button>`;
      ul.appendChild(li);
    });
}

$('#rvlijst').addEventListener('click', e => {
  if (!S) return;
  if (e.target.closest('img.thumb')) return;
  const del = e.target.closest('.del');
  if (del) {
    const nr = Number(del.dataset.nr);
    const o = S.energie.opwekkers.find(x => x.nr === nr);
    if (!o) return;
    if (!confirm(`#${nr} ${OPWEK_NAMEN[o.type] || o.type} (${o.ruimte || '-'}) verwijderen?`)) return;
    if (bewerkRvNr === nr) stopBewerkRv();
    S.energie.opwekkers = S.energie.opwekkers.filter(x => x.nr !== nr);
    renderRv();
    bewaar();
    return;
  }
  const li = e.target.closest('li[data-nr]');
  if (li) startBewerkRv(Number(li.dataset.nr));
});

/* ============================== ruimtebalk (ramen/energie/foto's) ==============================
   kies bovenaan in welke ruimte je staat: alles wat je daarna toevoegt (ramen, opwekkers,
   dossierfoto's) krijgt die ruimte als label. "Algemeen" = geen specifieke ruimte.
   Per ruimte cycle je de ventilatie: geen -> natuurlijk -> mechanisch -> ander (+beschrijving). */

const VENT_MODES = ['geen', 'natuurlijk', 'mechanisch', 'mechanisch-permanent', 'ander'];
const VENT_NAMEN = {
  geen: 'geen', natuurlijk: 'natuurlijk', mechanisch: 'mechanisch',
  'mechanisch-permanent': 'mechanisch permanent', ander: 'ander'
};
let selectedRuimte = ''; /* '' = Buiten (geen specifieke ruimte) */

function huidigeRuimte() {
  return S.ruimtes.find(r => r.naam === selectedRuimte) || null;
}

/* dezelfde ruimtechips in de header en in het camerascherm; "Buiten" ('' ) bestaat
   alleen in de foto-context (gevelfoto's), nooit op de Details-tab */
function renderRuimteChips(container, metPlus, metBuiten) {
  container.innerHTML = '';
  const maak = (v, tekst, extraClass) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.v = v;
    b.textContent = tekst;
    if (extraClass) b.className = extraClass;
    if (v !== '__plus') b.classList.toggle('on', selectedRuimte === v);
    container.appendChild(b);
  };
  if (metBuiten) { maak(FOTO_ALGEMEEN, 'Algemeen'); maak('', 'Gevels'); }
  S.ruimtes.forEach(r => maak(r.naam, r.naam));
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
  selectedRuimte = b.dataset.v;
  renderRuimtebalk();
});

/* nieuwe ruimte: veelvoorkomende namen als sneltoetsen; zelfde naam krijgt
   vanzelf een nummer (Slaapkamer -> Slaapkamer 2, 3, ...) */
function voegRuimteToe(naam) {
  const zelfde = S.ruimtes.filter(r => r.naam === naam || r.naam.startsWith(naam + ' ')).length;
  const uniek = zelfde ? `${naam} ${zelfde + 1}` : naam;
  S.ruimtes.push({ naam: uniek, vent: 'geen', ventBeschrijving: '', opm: '', afm: null });
  S.ruimtes = groepeerRuimtes(S.ruimtes);
  selectedRuimte = uniek;
  $('#ruimtekeuze').hidden = true;
  renderRuimtebalk();
  $('#sec-vent').open = true; /* accordeon sluit de rest */
  bewaar();
  toast(`${uniek} toegevoegd`);
}

$('#ruimtechips').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || !S) return;
  if (b.dataset.v === '__plus') {
    $('#ruimtekeuze').hidden = !$('#ruimtekeuze').hidden;
    return;
  }
  $('#ruimtekeuze').hidden = true;
  selectedRuimte = b.dataset.v;
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
  bewaar();
});

$('#vent-besch').addEventListener('input', () => {
  const r = huidigeRuimte();
  if (!r) return;
  r.ventBeschrijving = $('#vent-besch').value;
  wijzig();
});


/* natte ruimtes eerst (keuken, badkamer, wc), daarna de rest alfabetisch;
   Slaapkamer 1/2/3 blijft zo vanzelf bij elkaar */
const VENT_NAT = ['keuken', 'badkamer', 'wc'];
function ruimteBasis(naam) { return String(naam).toLowerCase().replace(/\s*\d+\s*$/, '').trim(); }

/* zelfde basisnamen bij elkaar (alle wc's samen, slaapkamers achter elkaar...),
   op volgorde van eerste voorkomen; binnen een groep oplopend genummerd */
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
function gesorteerdeRuimtes() {
  return [...S.ruimtes].sort((a, b) => {
    const na = VENT_NAT.indexOf(ruimteBasis(a.naam)), nb = VENT_NAT.indexOf(ruimteBasis(b.naam));
    const ca = na >= 0 ? 0 : 1, cb = nb >= 0 ? 0 : 1;
    if (ca !== cb) return ca - cb;
    if (ca === 0 && na !== nb) return na - nb;
    return String(a.naam).localeCompare(String(b.naam), 'nl', { numeric: true });
  });
}

function ventTekst(r) {
  return (VENT_NAMEN[r.vent] || r.vent) + (r.vent === 'ander' && r.ventBeschrijving ? ` (${r.ventBeschrijving})` : '');
}


/* ============================== fotodossier (tab Foto's) ============================== */

/* minimaal fotodossier voor het projectdossier (10 jaar bewaarplicht): veel foto's,
   snel na elkaar, met alleen een grove categorie als bijschrift in de PDF */

const DOSSIER_MAXDIM = 2000, DOSSIER_KWALITEIT = 0.7;
/* facturen/documenten moeten leesbaar blijven: hogere resolutie */
const ALGEMEEN_MAXDIM = 2600, ALGEMEEN_KWALITEIT = 0.75;
/* sentinel voor algemene foto's (facturen e.d.); '' blijft Gevels */
const FOTO_ALGEMEEN = '__algemeen';

/* nette naam voor een fotocontext-waarde (nooit de interne sentinel tonen) */
function ruimteLabel(v) {
  if (v === FOTO_ALGEMEEN) return 'Algemeen';
  return v || 'Gevels';
}
function dossierDim() { return selectedRuimte === FOTO_ALGEMEEN ? ALGEMEEN_MAXDIM : DOSSIER_MAXDIM; }
function dossierKw() { return selectedRuimte === FOTO_ALGEMEEN ? ALGEMEEN_KWALITEIT : DOSSIER_KWALITEIT; }

function voegDossierFoto(dataUrl) {
  S.tellerDossier = (S.tellerDossier || 0) + 1;
  S.fotodossier.push({ nr: S.tellerDossier, ruimte: selectedRuimte, foto: dataUrl });
  wijzig();
  renderDossier();
}

/* titel/bijschrift: Gevels ('' ), Algemeen (sentinel) of de ruimtenaam */
function dossierCap(f) {
  return ruimteLabel(f.ruimte);
}

/* dossier gesorteerd per ruimte: Gevels eerst, dan de ruimtes in hun eigen
   volgorde; binnen een ruimte op volgorde van nemen (voor de PDF) */
function gesorteerdDossier() {
  const orde = new Map(S.ruimtes.map((r, i) => [r.naam, i]));
  const idx = f => {
    if (!f.ruimte) return -1;                       /* Gevels eerst */
    if (f.ruimte === FOTO_ALGEMEEN) return 999;     /* Algemeen (facturen) altijd laatst */
    return orde.has(f.ruimte) ? orde.get(f.ruimte) : 98;
  };
  return [...S.fotodossier].sort((a, b) => idx(a) - idx(b) || a.nr - b.nr);
}

/* het raster toont alleen de foto's van de geselecteerde ruimte (of Gevels);
   de ster (hoofdfoto kiezen) staat alleen op Gevels-foto's */
function renderDossier() {
  const grid = $('#dossiergrid');
  grid.innerHTML = '';
  const hier = S.fotodossier.filter(f => (f.ruimte || '') === selectedRuimte);
  hier.forEach(f => {
    const d = document.createElement('div');
    d.className = 'dfoto';
    d.innerHTML =
      `<img class="thumb" src="${f.foto}" alt="dossierfoto ${f.nr}">` +
      (f.ruimte ? '' : `<button type="button" class="ster${f.foto === S.algemeen.foto ? ' hoofd' : ''}" data-nr="${f.nr}" title="Gebruik als hoofdfoto">&#9733;</button>`) +
      `<button type="button" class="verplaats" data-nr="${f.nr}" title="Verplaats naar andere ruimte">&#8644;</button>` +
      `<button type="button" class="del" data-nr="${f.nr}">×</button>` +
      `<div class="cap">${esc(dossierCap(f))}</div>`;
    grid.appendChild(d);
  });
  const label = ruimteLabel(selectedRuimte);
  $('#dossier-totaal').textContent = S.fotodossier.length
    ? `${hier.length} foto${hier.length === 1 ? '' : "'s"} in ${label} · ${S.fotodossier.length} in totaal${selectedRuimte ? '' : ' · ★ = hoofdfoto'}`
    : "Nog geen foto's. Start de camera en tik ze snel na elkaar.";
}

$('#dossiergrid').addEventListener('click', e => {
  if (!S) return;
  /* ster: deze foto wordt de hoofdfoto van de woning (blijft ook in het dossier) */
  const ster = e.target.closest('.ster');
  if (ster) {
    const f = S.fotodossier.find(x => x.nr === Number(ster.dataset.nr));
    if (!f) return;
    if (!confirm(`Deze foto (${dossierCap(f)}) als hoofdfoto van de woning gebruiken?`)) return;
    S.algemeen.foto = f.foto;
    renderDossier();
    bewaar();
    toast('Hoofdfoto ingesteld');
    return;
  }
  /* verplaatsen naar een andere ruimte, zodat je de foto niet opnieuw moet nemen */
  const vp = e.target.closest('.verplaats');
  if (vp) {
    openVerplaats(Number(vp.dataset.nr));
    return;
  }
  const b = e.target.closest('.del');
  if (!b) return;
  const nr = Number(b.dataset.nr);
  const f = S.fotodossier.find(x => x.nr === nr);
  if (!f) return;
  if (!confirm(`Foto (${dossierCap(f)}) verwijderen?`)) return;
  S.fotodossier = S.fotodossier.filter(x => x.nr !== nr);
  renderDossier();
  bewaar();
});

/* ---------- foto verplaatsen naar een andere ruimte ---------- */

let verplaatsNr = null;

function openVerplaats(nr) {
  const f = S.fotodossier.find(x => x.nr === nr);
  if (!f) return;
  verplaatsNr = nr;
  const chips = $('#verplaats-chips');
  chips.innerHTML = '';
  const maak = (v, tekst) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.v = v;
    b.textContent = tekst;
    b.classList.toggle('on', f.ruimte === v);
    chips.appendChild(b);
  };
  maak(FOTO_ALGEMEEN, 'Algemeen');
  maak('', 'Gevels');
  S.ruimtes.forEach(r => maak(r.naam, r.naam));
  $('#verplaats').hidden = false;
}

$('#verplaats-chips').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || !S || verplaatsNr === null) return;
  const f = S.fotodossier.find(x => x.nr === verplaatsNr);
  if (f) {
    f.ruimte = b.dataset.v;
    renderDossier();
    bewaar();
    toast(`Foto verplaatst naar ${b.textContent}`);
  }
  verplaatsNr = null;
  $('#verplaats').hidden = true;
});

$('#btn-verplaats-annuleer').addEventListener('click', () => {
  verplaatsNr = null;
  $('#verplaats').hidden = true;
});
$('#verplaats').addEventListener('click', e => {
  if (e.target === $('#verplaats')) { verplaatsNr = null; $('#verplaats').hidden = true; }
});

/* ---------- meerdere foto's uit de bibliotheek (zoals bij een zoekertje) ---------- */

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
      voegDossierFoto(await verkleinBestand(f, dossierDim(), dossierKw()));
      n++;
    } catch (e) { /* geen afbeelding: overslaan */ }
  }
  bewaar();
  toast(n ? `${n} foto${n === 1 ? '' : "'s"} toegevoegd` : 'Geen foto kunnen laden');
});

/* ---------- eigen camerascherm: blijft open, foto per tik op de sluiter ---------- */

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
   (die op iOS ook de native camera aanbiedt) + tip waar de toestemming staat */
function camFallback(fout) {
  if (camModus === 'enkel') {
    const inp = $('#fotoinput');
    inp.value = '';
    inp.click();
  } else {
    toast(`Geen cameratoegang${fout ? ' (' + fout + ')' : ''} – bibliotheek geopend. Tip: Instellingen ▸ Apps ▸ Safari ▸ Camera → Vraag.`);
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

$('#btn-sluiter').addEventListener('click', () => {
  const v = $('#camvideo');
  if (!S || !camStream || !v.videoWidth) return;
  if (camModus === 'enkel') {
    const data = naarJpeg(v, v.videoWidth, v.videoHeight, fotoMaxDim, fotoKwaliteit);
    const cb = fotoCb;
    fotoCb = null;
    stopCamera();
    if (cb) cb(data);
    return;
  }
  voegDossierFoto(naarJpeg(v, v.videoWidth, v.videoHeight, dossierDim(), dossierKw()));
  updateCamTeller(camSessieFotos + 1);
  flash($('#btn-sluiter'));
});

$('#btn-camklaar').addEventListener('click', () => {
  if (camModus === 'enkel') {
    fotoCb = null;
    stopCamera();
    return;
  }
  stopCamera();
  bewaar();
  if (camSessieFotos) toast(`${camSessieFotos} foto${camSessieFotos === 1 ? '' : "'s"} toegevoegd`);
});

/* app naar de achtergrond: camera netjes loslaten (iOS stopt de stream toch) */
document.addEventListener('visibilitychange', () => { if (document.hidden && camStream) { stopCamera(); bewaar(); } });
window.addEventListener('pagehide', () => { if (camStream) stopCamera(); });

/* ============================== afronden ============================== */


/* ---------- controlelijstje op Afronden: informatief, nooit blokkerend ---------- */

function renderChecks() {
  const ul = $('#checklijst');
  ul.innerHTML = '';
  const zonderFoto = S.ruimtes.filter(r => !S.fotodossier.some(f => f.ruimte === r.naam)).map(r => r.naam);
  const items = [
    { ok: !zonderFoto.length, tekst: 'Elke ruimte minstens één foto', detail: zonderFoto.join(', ') },
    { ok: S.energie.opwekkers.length > 0, tekst: 'Verwarming ingevuld', detail: 'nog geen opwekker of toestel' },
    { ok: !!S.algemeen.foto, tekst: 'Hoofdfoto gekozen', detail: 'ster op een gevelfoto' }
  ];
  items.forEach(i => {
    const li = document.createElement('li');
    li.innerHTML =
      `<div class="info">
         <div class="r1">${i.ok ? '\u2705' : '\u274C'} ${esc(i.tekst)}</div>
         ${!i.ok && i.detail ? `<div class="r3">${esc(i.detail)}</div>` : ''}
       </div>`;
    ul.appendChild(li);
  });
}

/* ---------- PDF bewaren (zie pdf.js voor de generator) ---------- */

/* de PDF krijgt het adres als bestandsnaam */
function pdfNaam() {
  return (S.algemeen.adres || 'EPC plaatsbezoek').trim();
}

$('#btn-print').addEventListener('click', async () => {
  if (!S) return;
  toast('PDF maken\u2026');
  try {
    const blob = await bouwPdf(S);
    const naam = (slug(pdfNaam()) || 'epc') + '.pdf';
    const file = new File([blob], naam, { type: 'application/pdf' });
    /* deelmenu (iPhone: Bewaar in Bestanden); zonder deelmenu gewoon downloaden */
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    downloadBlob(naam, file);
  } catch (e) {
    toast('PDF maken mislukt' + (e && e.name ? ' (' + e.name + ')' : ''));
  }
});

/* ---------- bestand downloaden (desktop zonder deelmenu) ---------- */

function downloadBlob(naam, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = naam;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

$('#btn-verwijder-woning').addEventListener('click', async () => {
  if (!S) return;
  if (!confirm(`"${S.algemeen.adres || 'Zonder adres'}" definitief verwijderen?`)) return;
  const w = S;
  S = null;
  dirty = false;
  await dbVerwijderWoning(w.id);
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
  syncRaamForm();
  $('#breedte').value = '';
  $('#hoogte').value = '';
  $('#aantal').value = draft.aantal || 1;
  updateM2Live();
  renderRamen();

  /* centrale verwarming (tab Algemeen) */
  stopBewerkOpwek();
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
  draftRv = { type: 'airco', foto: null };
  syncRvForm();
  $('#rv-beschrijving').value = '';
  renderRv();

  /* ruimtebalk: start op Algemeen */
  selectedRuimte = '';
  renderRuimtebalk();

  /* fotodossier */
  renderDossier();
}

/* ============================== start ============================== */

(async function init() {
  try {
    db = await dbOpen();
  } catch (e) {
    toast('Opslag niet beschikbaar in deze browser');
    return;
  }

  /* vraag persistente opslag aan tegen eviction */
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

  /* staand vergrendelen waar de browser het toelaat (iOS negeert dit; daar vangt #draai het op) */
  try { screen.orientation.lock('portrait').catch(() => {}); } catch (e) { /* niet ondersteund */ }

  await renderLijst();
  toonLijst();

  /* nieuwe versie: check bij elke start en bij terugkeer naar de app, en herlaad automatisch */
  if ('serviceWorker' in navigator) {
    let swReg = null;
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then(reg => {
        swReg = reg;
        reg.update();
        document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update(); });
        vraagVersie();
      })
      .catch(() => { /* offline install vereist https of localhost */ });

    const hadController = !!navigator.serviceWorker.controller;
    let herladen = false;
    navigator.serviceWorker.addEventListener('controllerchange', async () => {
      if (!hadController || herladen) { vraagVersie(); return; } /* eerste installatie: niet herladen */
      herladen = true;
      if (S && dirty) await bewaar();
      location.reload();
    });

    /* toon welke versie er op dit toestel echt draait */
    function vraagVersie() {
      if (navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage('versie');
    }
    navigator.serviceWorker.addEventListener('message', e => {
      if (!e.data || !e.data.versie) return;
      $('#versie').textContent = 'Versie ' + String(e.data.versie).replace('epc-', '');
      /* zelfherstel: SW nieuwer dan de geladen bestanden -> eenmalig herladen */
      if (e.data.versie !== APP_VERSIE) {
        if (!sessionStorage.getItem('herlaadpoging')) {
          sessionStorage.setItem('herlaadpoging', '1');
          location.reload();
        }
      } else {
        sessionStorage.removeItem('herlaadpoging');
      }
    });

    /* handmatig een update forceren, met duidelijke feedback */
    let updateBezig = false;
    $('#btn-update').addEventListener('click', async () => {
      if (updateBezig) return;
      updateBezig = true;
      toast('Zoeken naar update…');
      try {
        const reg = swReg || await navigator.serviceWorker.getRegistration();
        if (!reg) { toast('App nog niet geïnstalleerd'); return; }
        await reg.update();
        if (reg.waiting) { reg.waiting.postMessage('skip'); return; } /* activeert en herlaadt vanzelf */
        if (reg.installing) { toast('Update gevonden, app herlaadt zo…'); return; }
        toast('Je hebt al de nieuwste versie');
      } catch (e) {
        toast('Update checken mislukt. Ben je online?');
      } finally {
        updateBezig = false;
      }
    });
  } else {
    $('#versierij').hidden = true;
  }
})();
