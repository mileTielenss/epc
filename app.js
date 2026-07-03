'use strict';

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
/* meters (intern model) tonen als cm, zonder onnodige decimalen */
function fmtCm(m) {
  const c = Math.round(m * 1000) / 10;
  return (Number.isInteger(c) ? String(c) : c.toFixed(1)).replace('.', ',');
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
const dbZetInstelling = (k, v) => tx('instellingen', 'readwrite', s => s.put(v, k));
const dbGetInstelling = k => tx('instellingen', 'readonly', s => s.get(k));

/* ============================== woningmodel ============================== */

function leegWoning() {
  return {
    id: nieuwId(),
    status: 'open',
    gemaakt: nu(),
    gewijzigd: nu(),
    bestand: null,
    algemeen: { adres: '', datum: vandaag(), gebouwtype: '', bouwjaar: '', notities: '' },
    ramen: [],
    energie: { opwekkers: [], pv: '', kwp: '' },
    ventilatie: { ruimtes: [] },
    teller: 0,
    tellerOpwek: 0
  };
}

/* opwekker uit oudere modellen omzetten naar {nr,type,functie,beschrijving,foto,kamer} */
function migreerOpwekker(o, emissie) {
  if (o.beschrijving !== undefined) return o; /* al nieuw model */
  const type = { gasketel: 'gas', stookolie: 'stookolie', airco: 'airco' }[o.type] || 'andere';
  const EXTRA = { warmtepomp: 'warmtepomp', elektrisch: 'elektrische verwarming', kachel: 'kachel' };
  const beschrijving = [EXTRA[o.type], o.wptype, o.cond, o.merk, o.jaar ? 'bouwjaar ' + o.jaar : '']
    .filter(Boolean).join(', ');
  const functie = [];
  if ((o.functie || []).includes('verwarming')) {
    if (emissie.includes('radiatoren')) functie.push('radiatoren');
    if (emissie.includes('vloerverwarming')) functie.push('vloer');
  }
  if ((o.functie || []).includes('sww')) functie.push('sww');
  return { nr: o.nr, type, functie, beschrijving, foto: o.foto || null, kamer: null };
}

const VENT_MIGRATIE = {
  geen: 'geen', natuurlijk: 'natuurlijk', mechanisch: 'mechanisch',
  raamrooster: 'natuurlijk', muurrooster: 'natuurlijk',
  afvoerventiel: 'mechanisch', toevoerventiel: 'mechanisch', 'mechanische-ventilator': 'mechanisch'
};

/* ondiepe merge zodat oudere records nieuwe velden krijgen */
function normaliseer(p) {
  const basis = leegWoning();
  const pe = p.energie || {};
  const w = {
    ...basis, ...p,
    algemeen: { ...basis.algemeen, ...(p.algemeen || {}) },
    energie: { ...basis.energie, ...pe },
    ventilatie: { ...basis.ventilatie, ...(p.ventilatie || {}) }
  };
  if (!Array.isArray(w.energie.opwekkers)) w.energie.opwekkers = [];

  /* migratie: oudste energiemodel (opwek-chips + ketel/wp/airco-panelen) naar opwekkerslijst */
  if (!w.energie.opwekkers.length && Array.isArray(pe.opwek) && pe.opwek.length) {
    pe.opwek.forEach(t => {
      const o = { nr: w.energie.opwekkers.length + 1, type: t, functie: ['verwarming'], cond: '', wptype: '', merk: '', jaar: '', foto: null };
      if ((t === 'gasketel' || t === 'stookolie') && pe.ketel) {
        o.cond = pe.ketel.cond || '';
        o.merk = pe.ketel.merk || '';
        o.jaar = pe.ketel.jaar || '';
        o.foto = pe.ketel.foto || null;
        if (pe.sww === 'cv-ketel') o.functie.push('sww');
      }
      if (t === 'warmtepomp' && pe.wp) o.wptype = pe.wp.type || '';
      if (t === 'airco' && Array.isArray(pe.airco) && pe.airco.length) o.merk = pe.airco.map(u => u.ruimte).join(', ');
      w.energie.opwekkers.push(o);
    });
  }
  w.energie.opwekkers = w.energie.opwekkers.map(o => migreerOpwekker(o, pe.emissie || []));
  delete w.energie.opwek;
  delete w.energie.ketel;
  delete w.energie.wp;
  delete w.energie.airco;
  delete w.energie.emissie;
  delete w.energie.sww;
  w.tellerOpwek = Math.max(w.tellerOpwek || 0, ...w.energie.opwekkers.map(o => o.nr || 0), 0);

  w.ventilatie.ruimtes = (w.ventilatie.ruimtes || []).map(r => ({
    naam: r.naam, voorziening: VENT_MIGRATIE[r.voorziening] || 'geen'
  }));
  delete w.ventilatie.systeem;

  if (!w.id) w.id = nieuwId();
  if (!w.status) w.status = 'open';
  return w;
}

/* ============================== actieve woning + autosave ============================== */

let S = null;      // actieve woning, null = lijstscherm
let dirty = false;
let draft = null;  // invoerformulier ramen-tab

function leegDraft() {
  return { element: 'raam', gevel: 'voor', beglazing: 'dubbel', kader: 'pvc', rolluik: 'nee', foto: null };
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
    $('#savestamp').textContent = `opgeslagen ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  } catch (e) {
    toast('Opslaan mislukt!');
    return;
  }
  schrijfBackup(S);
}

setInterval(() => { if (S && dirty) bewaar(); }, 3000);
window.addEventListener('pagehide', () => { if (S && dirty) bewaar(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && S && dirty) bewaar(); });

/* ============================== bestandsbackup (File System Access API) ============================== */

const FSA = 'showDirectoryPicker' in window;
let backupDir = null;

function bestandsnaam(w) {
  return `epc-${slug(w.algemeen.adres) || 'woning'}-${w.id}.json`;
}

async function schrijfBackup(w) {
  if (!backupDir) return;
  const naam = bestandsnaam(w);
  try {
    if (w.bestand && w.bestand !== naam) {
      try { await backupDir.removeEntry(w.bestand); } catch (e) { /* al weg */ }
    }
    const fh = await backupDir.getFileHandle(naam, { create: true });
    const ws = await fh.createWritable();
    await ws.write(JSON.stringify(w, null, 1));
    await ws.close();
    if (w.bestand !== naam) { w.bestand = naam; dbPutWoning(w); }
    backupStatus(`Backup ok: ${naam}`);
  } catch (e) {
    backupStatus('Backup mislukt: ' + e.name);
  }
}

async function verwijderBackup(w) {
  if (!backupDir || !w || !w.bestand) return;
  try { await backupDir.removeEntry(w.bestand); } catch (e) { /* al weg */ }
}

async function backupAlles() {
  if (!backupDir) return;
  const alle = await dbAlleWoningen();
  for (const w of alle) await schrijfBackup(w);
}

function backupStatus(msg) {
  $('#backupstatus').textContent = msg;
}

async function laadBackupmap() {
  if (!FSA) return;
  $('#btn-backupmap').hidden = false;
  try {
    const h = await dbGetInstelling('backupmap');
    if (!h) { backupStatus('Geen backupmap gekozen. Kies een map voor automatische JSON-backups.'); return; }
    const perm = await h.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') {
      backupDir = h;
      backupStatus(`Backupmap actief: ${h.name}`);
      backupAlles();
    } else {
      $('#btn-backupmap').textContent = '\u{1F4C1} Backup hervatten';
      backupStatus('Tik op "Backup hervatten" om de backupmap opnieuw toe te laten.');
    }
  } catch (e) {
    backupStatus('Backupmap niet beschikbaar.');
  }
}

$('#btn-backupmap').addEventListener('click', async () => {
  try {
    let h = await dbGetInstelling('backupmap');
    if (h && await h.requestPermission({ mode: 'readwrite' }) === 'granted') {
      backupDir = h;
    } else {
      h = await window.showDirectoryPicker({ mode: 'readwrite' });
      await dbZetInstelling('backupmap', h);
      backupDir = h;
    }
    $('#btn-backupmap').textContent = '\u{1F4C1} Backupmap wijzigen';
    backupStatus(`Backupmap actief: ${backupDir.name}`);
    await backupAlles();
    toast('Alle woningen gebackupt');
  } catch (e) {
    if (e.name !== 'AbortError') backupStatus('Backupmap kiezen mislukt.');
  }
});

/* ============================== views ============================== */

function toonLijst() {
  $('#view-lijst').hidden = false;
  $('#app').hidden = true;
  $('#tabbar').hidden = true;
  $('#btn-terug').hidden = true;
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

function zetTab(naam) {
  $$('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === naam));
  $$('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + naam));
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
    const tot = (w.ramen || []).reduce((a, r) => a + r.b * r.h, 0);
    const li = document.createElement('li');
    li.className = 'woning';
    li.dataset.id = w.id;
    li.innerHTML =
      `<div class="info">
         <div class="r1">${esc(w.algemeen.adres || 'Zonder adres')}</div>
         <div class="r3">${esc(w.algemeen.datum || '')} · ${(w.ramen || []).length} elementen · ${fmt(tot)} m²</div>
       </div>
       <button type="button" class="status ${w.status}" data-id="${w.id}">${STATUS_NAMEN[w.status] || 'Open'}</button>
       <button type="button" class="del" data-id="${w.id}">×</button>`;
    ul.appendChild(li);
  });
}

$('#woninglijst').addEventListener('click', async e => {
  const del = e.target.closest('.del');
  if (del) {
    const w = await dbGetWoning(del.dataset.id);
    if (!w) return;
    if (!confirm(`"${w.algemeen.adres || 'Zonder adres'}" definitief verwijderen?`)) return;
    await dbVerwijderWoning(w.id);
    await verwijderBackup(w);
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
    schrijfBackup(w);
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

let fotoCb = null;
function neemFoto(cb) {
  fotoCb = cb;
  const inp = $('#fotoinput');
  inp.value = '';
  inp.click();
}
$('#fotoinput').addEventListener('change', () => {
  const f = $('#fotoinput').files[0];
  if (!f || !fotoCb) return;
  const cb = fotoCb;
  fotoCb = null;
  const r = new FileReader();
  r.onload = () => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, 900 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * s));
      c.height = Math.max(1, Math.round(img.height * s));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      cb(c.toDataURL('image/jpeg', 0.7));
    };
    img.src = r.result;
  };
  r.readAsDataURL(f);
});

/* ============================== tabs ============================== */

$('#tabbar').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  zetTab(b.dataset.tab);
});

/* ============================== tab 1: algemeen ============================== */

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
bind('#bouwjaar', v => S.algemeen.bouwjaar = v);
bind('#notities', v => S.algemeen.notities = v);
segInit('#seg-gebouwtype', v => { S.algemeen.gebouwtype = v; wijzig(); });

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

/* ============================== tab 2: ramen & deuren ============================== */

segInit('#seg-element', v => draft.element = v);
segInit('#seg-beglazing', v => draft.beglazing = v);
segInit('#seg-kader', v => draft.kader = v);
segInit('#seg-rolluik', v => draft.rolluik = v);

$('#kompas').addEventListener('click', e => {
  const p = e.target.closest('.gevel');
  if (!p || !S) return;
  draft.gevel = p.dataset.v;
  kompasSet(draft.gevel);
});
function kompasSet(v) {
  $$('#kompas .gevel').forEach(p => p.classList.toggle('sel', p.dataset.v === v));
  $$('#kompas text').forEach(t => t.classList.toggle('sel', t.dataset.v === v));
}

function updateM2Live() {
  const b = num($('#breedte').value) / 100, h = num($('#hoogte').value) / 100;
  $('#m2live').textContent = (b && h) ? fmt(b * h) + ' m²' : '';
}
$('#breedte').addEventListener('input', updateM2Live);
$('#hoogte').addEventListener('input', updateM2Live);

$('#btn-raamfoto').addEventListener('click', () => neemFoto(data => {
  draft.foto = data;
  updateRaamThumb();
}));
$('#btn-raamfoto-del').addEventListener('click', () => {
  draft.foto = null;
  updateRaamThumb();
});
function updateRaamThumb() {
  const t = $('#raamfoto-thumb'), d = $('#btn-raamfoto-del');
  t.hidden = d.hidden = !draft.foto;
  if (draft.foto) t.src = draft.foto;
}

const ELEMENT_NAMEN = { raam: 'Raam', deur: 'Deur', dakraam: 'Dakraam', glasdeur: 'Glasdeur' };
const GEVEL_NAMEN = { voor: 'Voor', achter: 'Achter', links: 'Links', rechts: 'Rechts' };
const GLAS_NAMEN = { enkel: 'Enkel', dubbel: 'Dubbel', 'hr-dubbel': 'HR dubbel', drievoudig: 'Drievoudig', paneel: 'Vol paneel' };
const KADER_NAMEN = { pvc: 'PVC', alu: 'Alu', hout: 'Hout', 'alu-thermisch': 'Alu therm. ond.' };

$('#btn-voegtoe').addEventListener('click', () => {
  if (!S) return;
  const b = num($('#breedte').value) / 100, h = num($('#hoogte').value) / 100;
  if (!b || !h) { toast('Vul breedte en hoogte in (cm)'); return; }
  S.teller = (S.teller || 0) + 1;
  S.ramen.push({
    nr: S.teller,
    element: draft.element,
    gevel: draft.gevel,
    b, h,
    beglazing: draft.beglazing,
    kader: draft.kader,
    rolluik: draft.rolluik === 'ja',
    foto: draft.foto
  });
  draft.foto = null;
  updateRaamThumb();
  $('#breedte').value = '';
  $('#hoogte').value = '';
  updateM2Live();
  renderRamen();
  bewaar();
  flash($('#btn-voegtoe'));
  toast(`${ELEMENT_NAMEN[draft.element]} toegevoegd`);
});

$('#btn-herhaal').addEventListener('click', () => {
  if (!S) return;
  const laatste = S.ramen[S.ramen.length - 1];
  if (!laatste) { toast('Nog geen vorige invoer'); return; }
  draft.element = laatste.element;
  draft.gevel = laatste.gevel;
  draft.beglazing = laatste.beglazing;
  draft.kader = laatste.kader;
  draft.rolluik = laatste.rolluik ? 'ja' : 'nee';
  draft.foto = null;
  syncRaamForm();
  $('#breedte').value = '';
  $('#hoogte').value = '';
  updateM2Live();
  $('#breedte').focus();
});

function syncRaamForm() {
  segSet('#seg-element', draft.element);
  segSet('#seg-beglazing', draft.beglazing);
  segSet('#seg-kader', draft.kader);
  segSet('#seg-rolluik', draft.rolluik);
  kompasSet(draft.gevel);
  updateRaamThumb();
}

function renderRamen() {
  const ul = $('#ramenlijst');
  ul.innerHTML = '';
  [...S.ramen].reverse().forEach(r => {
    const li = document.createElement('li');
    const tags = [GLAS_NAMEN[r.beglazing] || r.beglazing, KADER_NAMEN[r.kader] || r.kader];
    if (r.rolluik) tags.push('rolluik');
    li.innerHTML =
      `<div class="info">
         <div class="r1">#${r.nr} ${esc(ELEMENT_NAMEN[r.element] || r.element)} · ${esc(GEVEL_NAMEN[r.gevel] || r.gevel)}</div>
         <div class="r2">${fmtCm(r.b)} × ${fmtCm(r.h)} cm = ${fmt(r.b * r.h)} m²</div>
         <div class="r3">${esc(tags.join(' · '))}</div>
       </div>` +
      (r.foto ? `<img class="thumb" src="${r.foto}" alt="foto #${r.nr}">` : '') +
      `<button type="button" class="del" data-nr="${r.nr}">×</button>`;
    ul.appendChild(li);
  });
  const tot = S.ramen.reduce((a, r) => a + r.b * r.h, 0);
  $('#ramen-totaal').textContent = S.ramen.length
    ? `Totaal: ${S.ramen.length} element${S.ramen.length === 1 ? '' : 'en'} · ${fmt(tot)} m²`
    : 'Nog geen elementen toegevoegd.';
}

$('#ramenlijst').addEventListener('click', e => {
  const b = e.target.closest('.del');
  if (!b || !S) return;
  const nr = Number(b.dataset.nr);
  const r = S.ramen.find(x => x.nr === nr);
  if (!r) return;
  if (!confirm(`#${nr} ${ELEMENT_NAMEN[r.element]} (${fmtCm(r.b)} × ${fmtCm(r.h)} cm) verwijderen?`)) return;
  S.ramen = S.ramen.filter(x => x.nr !== nr);
  renderRamen();
  bewaar();
});

/* ============================== tab 3: energie ============================== */

const OPWEK_NAMEN = { gas: 'Gas', stookolie: 'Stookolie', airco: 'Airco', andere: 'Andere' };
const FUNCTIE_NAMEN = { radiatoren: 'radiatoren', vloer: 'vloerverwarming', sww: 'warm water' };

function leegDraftOpwek() {
  return { type: 'gas', functie: [], foto: null };
}
let draftOpwek = leegDraftOpwek();

chipsInit('#chips-opwekfunctie', vals => { draftOpwek.functie = vals; });

segInit('#seg-opwektype', v => { draftOpwek.type = v; toonOpwekVelden(); });

function toonOpwekVelden() {
  $('#opw-kamer').hidden = draftOpwek.type !== 'airco';
}

function updateM3Live() {
  const b = num($('#kamer-b').value) / 100, d = num($('#kamer-d').value) / 100, h = num($('#kamer-h').value) / 100;
  $('#m3live').textContent = (b && d && h) ? fmt(b * d * h, 1) + ' m³' : '';
}
$('#kamer-b').addEventListener('input', updateM3Live);
$('#kamer-d').addEventListener('input', updateM3Live);
$('#kamer-h').addEventListener('input', updateM3Live);

$('#btn-opwekfoto').addEventListener('click', () => neemFoto(data => {
  draftOpwek.foto = data;
  updateOpwekThumb();
}));
$('#btn-opwekfoto-del').addEventListener('click', () => {
  draftOpwek.foto = null;
  updateOpwekThumb();
});
function updateOpwekThumb() {
  const t = $('#opwekfoto-thumb'), d = $('#btn-opwekfoto-del');
  t.hidden = d.hidden = !draftOpwek.foto;
  if (draftOpwek.foto) t.src = draftOpwek.foto;
}

function syncOpwekForm() {
  segSet('#seg-opwektype', draftOpwek.type);
  chipsSet('#chips-opwekfunctie', draftOpwek.functie);
  toonOpwekVelden();
  updateOpwekThumb();
}

$('#btn-opwek-voegtoe').addEventListener('click', () => {
  if (!S) return;
  let kamer = null;
  if (draftOpwek.type === 'airco') {
    const b = num($('#kamer-b').value) / 100, d = num($('#kamer-d').value) / 100, h = num($('#kamer-h').value) / 100;
    if (b && d && h) kamer = { b, d, h };
  }
  S.tellerOpwek = (S.tellerOpwek || 0) + 1;
  S.energie.opwekkers.push({
    nr: S.tellerOpwek,
    type: draftOpwek.type,
    functie: [...draftOpwek.functie],
    beschrijving: $('#opw-beschrijving').value.trim(),
    foto: draftOpwek.foto,
    kamer
  });
  draftOpwek.foto = null;
  updateOpwekThumb();
  $('#opw-beschrijving').value = '';
  $('#kamer-b').value = '';
  $('#kamer-d').value = '';
  $('#kamer-h').value = '';
  updateM3Live();
  renderOpwekkers();
  bewaar();
  flash($('#btn-opwek-voegtoe'));
  toast(`${OPWEK_NAMEN[draftOpwek.type]} toegevoegd`);
});

function kamerTekst(k) {
  return `kamer ${fmtCm(k.b)} × ${fmtCm(k.d)} × ${fmtCm(k.h)} cm = ${fmt(k.b * k.d * k.h, 1)} m³`;
}

function renderOpwekkers() {
  const ul = $('#opweklijst');
  ul.innerHTML = '';
  [...S.energie.opwekkers].reverse().forEach(o => {
    const li = document.createElement('li');
    const det = [o.beschrijving, o.kamer ? kamerTekst(o.kamer) : ''].filter(Boolean);
    li.innerHTML =
      `<div class="info">
         <div class="r1">#${o.nr} ${esc(OPWEK_NAMEN[o.type] || o.type)}</div>
         <div class="r2">${esc((o.functie || []).map(f => FUNCTIE_NAMEN[f] || f).join(' + ') || '-')}</div>
         ${det.length ? `<div class="r3">${esc(det.join(' · '))}</div>` : ''}
       </div>` +
      (o.foto ? `<img class="thumb" src="${o.foto}" alt="kenplaat #${o.nr}">` : '') +
      `<button type="button" class="del" data-nr="${o.nr}">×</button>`;
    ul.appendChild(li);
  });
}

$('#opweklijst').addEventListener('click', e => {
  const b = e.target.closest('.del');
  if (!b || !S) return;
  const nr = Number(b.dataset.nr);
  const o = S.energie.opwekkers.find(x => x.nr === nr);
  if (!o) return;
  if (!confirm(`#${nr} ${OPWEK_NAMEN[o.type] || o.type} verwijderen?`)) return;
  S.energie.opwekkers = S.energie.opwekkers.filter(x => x.nr !== nr);
  renderOpwekkers();
  bewaar();
});

segInit('#seg-pv', v => {
  S.energie.pv = v;
  $('#fld-kwp').hidden = v !== 'ja';
  wijzig();
});
bind('#kwp', v => S.energie.kwp = v);

/* ============================== tab 4: ventilatie ============================== */

/* gekozen modus geldt voor elke ruimte die je daarna aantikt */
const VENT_MODES = ['geen', 'natuurlijk', 'mechanisch'];
let ventMode = 'geen';

segInit('#seg-ventmode', v => { ventMode = v; });

$('#vent-chips').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || !S) return;
  const basis = b.dataset.v;
  const zelfde = S.ventilatie.ruimtes.filter(r => r.naam === basis || r.naam.startsWith(basis + ' ')).length;
  const naam = zelfde ? `${basis} ${zelfde + 1}` : basis;
  S.ventilatie.ruimtes.push({ naam, voorziening: ventMode });
  renderVent();
  bewaar();
  toast(`${naam}: ${ventMode}`);
});

function renderVent() {
  const ul = $('#ventlijst');
  ul.innerHTML = '';
  S.ventilatie.ruimtes.forEach((r, i) => {
    const li = document.createElement('li');
    li.innerHTML =
      `<div class="info">
         <div class="r1">${esc(r.naam)}</div>
         <div class="r3">${esc(r.voorziening)} · tik om te wisselen</div>
       </div>` +
      `<button type="button" class="del" data-i="${i}">×</button>`;
    li.dataset.i = i;
    ul.appendChild(li);
  });
}

$('#ventlijst').addEventListener('click', e => {
  if (!S) return;
  const b = e.target.closest('.del');
  if (b) {
    S.ventilatie.ruimtes.splice(Number(b.dataset.i), 1);
    renderVent();
    bewaar();
    return;
  }
  /* tik op de ruimte zelf: wissel geen -> natuurlijk -> mechanisch */
  const li = e.target.closest('li');
  if (!li) return;
  const r = S.ventilatie.ruimtes[Number(li.dataset.i)];
  r.voorziening = VENT_MODES[(VENT_MODES.indexOf(r.voorziening) + 1) % VENT_MODES.length];
  renderVent();
  bewaar();
});

/* ============================== tab 5: afronden ============================== */

const GEBOUW_NAMEN = { open: 'Open bebouwing', halfopen: 'Halfopen bebouwing', gesloten: 'Gesloten bebouwing', appartement: 'Appartement' };

/* ---------- one-pager / print ---------- */

$('#btn-print').addEventListener('click', () => {
  if (!S) return;
  buildPrint();
  requestAnimationFrame(() => setTimeout(() => window.print(), 60));
});

function buildPrint() {
  const A = S.algemeen;
  const totM2 = S.ramen.reduce((a, r) => a + r.b * r.h, 0);

  let html = `<h1>EPC Plaatsbezoek</h1>
    <p class="sub">${esc(A.adres || 'Adres onbekend')} · ${esc(A.datum || '')} · ${esc(GEBOUW_NAMEN[A.gebouwtype] || '')}${A.bouwjaar ? ' · bouwjaar ' + esc(A.bouwjaar) : ''}</p>`;

  /* ramen & deuren */
  html += '<h2>Ramen &amp; deuren</h2>';
  if (S.ramen.length) {
    html += `<table><tr><th>#</th><th>Type</th><th>Gevel</th><th class="num">B (cm)</th><th class="num">H (cm)</th><th class="num">m²</th><th>Beglazing</th><th>Kader</th><th>Rolluik</th></tr>`;
    S.ramen.forEach(r => {
      html += `<tr><td>${r.nr}</td><td>${ELEMENT_NAMEN[r.element] || ''}</td><td>${GEVEL_NAMEN[r.gevel] || ''}</td>` +
        `<td class="num">${fmtCm(r.b)}</td><td class="num">${fmtCm(r.h)}</td><td class="num">${fmt(r.b * r.h)}</td>` +
        `<td>${GLAS_NAMEN[r.beglazing] || ''}</td><td>${KADER_NAMEN[r.kader] || ''}</td><td>${r.rolluik ? 'ja' : 'nee'}</td></tr>`;
    });
    html += `<tr class="tot"><td colspan="5">Totaal (${S.ramen.length} elementen)</td><td class="num">${fmt(totM2)}</td><td colspan="3"></td></tr></table>`;
  } else {
    html += '<p class="kv">Geen elementen opgemeten.</p>';
  }

  /* energie */
  html += '<h2>Energie</h2>';
  const E = S.energie;
  if (E.opwekkers.length) {
    html += '<table><tr><th>#</th><th>Opwekker</th><th>Doet</th><th>Beschrijving</th></tr>' +
      E.opwekkers.map(o =>
        `<tr><td>${o.nr}</td><td>${OPWEK_NAMEN[o.type] || esc(o.type)}</td>` +
        `<td>${esc((o.functie || []).map(f => FUNCTIE_NAMEN[f] || f).join(' + '))}</td>` +
        `<td>${esc([o.beschrijving, o.kamer ? kamerTekst(o.kamer) : ''].filter(Boolean).join(' · '))}</td></tr>`).join('') +
      '</table>';
  } else {
    html += '<p class="kv">Geen opwekkers genoteerd.</p>';
  }
  html += `<p class="kv"><b>PV-panelen</b> ${E.pv === 'ja' ? 'ja' + (E.kwp ? ', ' + esc(E.kwp) + ' kWp' : '') : (E.pv === 'nee' ? 'nee' : '-')}</p>`;

  /* ventilatie */
  html += '<h2>Ventilatie</h2>';
  if (S.ventilatie.ruimtes.length) {
    html += '<table><tr><th>Ruimte</th><th>Ventilatie</th></tr>' +
      S.ventilatie.ruimtes.map(r => `<tr><td>${esc(r.naam)}</td><td>${esc(r.voorziening)}</td></tr>`).join('') +
      '</table>';
  } else {
    html += '<p class="kv">Geen ruimtes genoteerd.</p>';
  }

  /* notities */
  if (A.notities.trim()) {
    html += `<h2>Notities</h2><p class="kv">${esc(A.notities).replace(/\n/g, '<br>')}</p>`;
  }

  /* foto's */
  const fotos = [];
  S.ramen.forEach(r => {
    if (r.foto) fotos.push({ src: r.foto, cap: `#${r.nr} ${ELEMENT_NAMEN[r.element]} ${GEVEL_NAMEN[r.gevel].toLowerCase()}, afstandhouder` });
  });
  S.energie.opwekkers.forEach(o => {
    if (o.foto) fotos.push({ src: o.foto, cap: `#${o.nr} ${OPWEK_NAMEN[o.type] || o.type}, kenplaat` });
  });
  if (fotos.length) {
    html += '<h2>Foto’s</h2><div class="fotos">' +
      fotos.map(f => `<div class="foto"><img src="${f.src}" alt=""><div class="cap">${esc(f.cap)}</div></div>`).join('') +
      '</div>';
  }

  $('#printview').innerHTML = html;
}

/* ---------- JSON export / import ---------- */

function downloadJson(naam, data) {
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = naam;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function alleWoningenBundel(alle) {
  return { type: 'epc-alle-woningen', geexporteerd: nu(), woningen: alle };
}

async function stempelExport() {
  await dbZetInstelling('laatsteExport', nu());
  toonExportStatus();
}

async function toonExportStatus() {
  if (FSA) return; /* op desktop toont de backupmap zijn eigen status */
  const t = await dbGetInstelling('laatsteExport');
  backupStatus(t
    ? `Laatste export: ${new Date(t).toLocaleString('nl-BE')}`
    : 'Nog geen export gemaakt. Bewaar regelmatig alles in Bestanden.');
}

$('#btn-exportalles').addEventListener('click', async () => {
  const alle = await dbAlleWoningen();
  if (!alle.length) { toast('Nog geen woningen'); return; }
  downloadJson(`epc-alle-woningen-${vandaag()}.json`, alleWoningenBundel(alle));
  await stempelExport();
  toast(`${alle.length} woning${alle.length === 1 ? '' : 'en'} geëxporteerd`);
});

/* iOS: deel de bundel naar de Files-app via het deelmenu */
$('#btn-deelalles').addEventListener('click', async () => {
  const alle = await dbAlleWoningen();
  if (!alle.length) { toast('Nog geen woningen'); return; }
  const naam = `epc-alle-woningen-${vandaag()}.json`;
  const file = new File([JSON.stringify(alleWoningenBundel(alle), null, 1)], naam, { type: 'application/json' });
  try {
    await navigator.share({ files: [file], title: naam });
    await stempelExport();
    toast(`${alle.length} woning${alle.length === 1 ? '' : 'en'} gedeeld`);
  } catch (e) {
    if (e.name !== 'AbortError') {
      downloadJson(naam, alleWoningenBundel(alle));
      await stempelExport();
    }
  }
});

function kanDelen() {
  try {
    const f = new File(['{}'], 'test.json', { type: 'application/json' });
    return !!(navigator.canShare && navigator.canShare({ files: [f] }));
  } catch (e) { return false; }
}

/* een geparste JSON kan 1 woning of een alle-woningen-bundel zijn */
async function importeerData(p) {
  const lijst = Array.isArray(p.woningen) ? p.woningen : (p.algemeen ? [p] : null);
  if (!lijst) throw new Error('geen epc-bestand');
  let n = 0;
  for (const item of lijst) {
    const w = normaliseer(item);
    await dbPutWoning(w);
    schrijfBackup(w);
    n++;
  }
  return n;
}

async function importeerBestanden(files) {
  let n = 0, fout = 0;
  for (const f of files) {
    try {
      n += await importeerData(JSON.parse(await f.text()));
    } catch (e) { fout++; }
  }
  await renderLijst();
  if (n) toast(`${n} woning${n === 1 ? '' : 'en'} geïmporteerd${fout ? `, ${fout} bestand(en) overgeslagen` : ''}`);
  else toast('Import mislukt: geen geldig bestand');
}

$('#btn-importeer').addEventListener('click', () => {
  $('#importinput').value = '';
  $('#importinput').click();
});
$('#importinput').addEventListener('change', () => {
  importeerBestanden([...$('#importinput').files]);
});

/* desktop: lees alle epc-json-bestanden uit een gekozen map */
$('#btn-importmap').addEventListener('click', async () => {
  try {
    const dir = await window.showDirectoryPicker();
    const files = [];
    for await (const h of dir.values()) {
      if (h.kind === 'file' && h.name.toLowerCase().endsWith('.json')) files.push(await h.getFile());
    }
    if (!files.length) { toast('Geen JSON-bestanden in deze map'); return; }
    await importeerBestanden(files);
  } catch (e) {
    if (e.name !== 'AbortError') toast('Map importeren mislukt');
  }
});

$('#btn-verwijder-woning').addEventListener('click', async () => {
  if (!S) return;
  if (!confirm(`"${S.algemeen.adres || 'Zonder adres'}" definitief verwijderen?`)) return;
  const w = S;
  S = null;
  dirty = false;
  await dbVerwijderWoning(w.id);
  await verwijderBackup(w);
  await renderLijst();
  toonLijst();
  toast('Woning verwijderd');
});

/* ============================== UI sync ============================== */

function syncAlles() {
  /* algemeen */
  $('#adres').value = S.algemeen.adres;
  $('#datum').value = S.algemeen.datum;
  $('#bouwjaar').value = S.algemeen.bouwjaar;
  $('#notities').value = S.algemeen.notities;
  segSet('#seg-gebouwtype', S.algemeen.gebouwtype);

  /* ramen: formulier volgt draft */
  syncRaamForm();
  $('#breedte').value = '';
  $('#hoogte').value = '';
  updateM2Live();
  renderRamen();

  /* energie: formulier volgt draftOpwek */
  syncOpwekForm();
  $('#opw-beschrijving').value = '';
  $('#kamer-b').value = '';
  $('#kamer-d').value = '';
  $('#kamer-h').value = '';
  updateM3Live();
  renderOpwekkers();
  segSet('#seg-pv', S.energie.pv);
  $('#fld-kwp').hidden = S.energie.pv !== 'ja';
  $('#kwp').value = S.energie.kwp;

  /* ventilatie: modus terug naar geen */
  ventMode = 'geen';
  segSet('#seg-ventmode', ventMode);
  renderVent();
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

  if (FSA) $('#btn-importmap').hidden = false;
  else if (kanDelen()) $('#btn-deelalles').hidden = false;

  await laadBackupmap();
  await toonExportStatus();
  await renderLijst();
  toonLijst();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline install vereist https of localhost */ });
  }
})();
