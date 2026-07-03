'use strict';

/* ============================== state ============================== */

const LSKEY = 'epc-plaatsbezoek-v1';

function leegState() {
  return {
    algemeen: { adres: '', datum: vandaag(), gebouwtype: '', bouwjaar: '', notities: '' },
    ramen: [],
    energie: {
      opwek: [],
      ketel: { cond: '', merk: '', jaar: '', foto: null },
      wp: { type: '' },
      airco: [],
      emissie: [],
      sww: '',
      pv: '',
      kwp: ''
    },
    ventilatie: { systeem: '', ruimtes: [] },
    teller: 0
  };
}

function vandaag() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

let S = laad() || leegState();
let dirty = false;

/* draft voor het ramen-invoerformulier */
let draft = { element: 'raam', gevel: 'voor', beglazing: 'dubbel', kader: 'pvc', rolluik: 'nee', foto: null };

function laad() {
  try {
    const raw = localStorage.getItem(LSKEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    // ondiepe merge zodat oudere opslag nieuwe velden krijgt
    const basis = leegState();
    return {
      ...basis, ...p,
      algemeen: { ...basis.algemeen, ...(p.algemeen || {}) },
      energie: {
        ...basis.energie, ...(p.energie || {}),
        ketel: { ...basis.energie.ketel, ...((p.energie || {}).ketel || {}) },
        wp: { ...basis.energie.wp, ...((p.energie || {}).wp || {}) }
      },
      ventilatie: { ...basis.ventilatie, ...(p.ventilatie || {}) }
    };
  } catch (e) { return null; }
}

function bewaar() {
  try {
    localStorage.setItem(LSKEY, JSON.stringify(S));
    dirty = false;
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    $('#savestamp').textContent = `opgeslagen ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  } catch (e) {
    toast('Opslag vol! Exporteer JSON en start opnieuw.');
  }
}

function wijzig() { dirty = true; }

setInterval(() => { if (dirty) bewaar(); }, 3000);
window.addEventListener('pagehide', () => { if (dirty) bewaar(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && dirty) bewaar(); });

/* ============================== helpers ============================== */

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function num(s) {
  const v = parseFloat(String(s).trim().replace(',', '.'));
  return isFinite(v) && v > 0 ? v : 0;
}
function fmt(n, d = 2) { return n.toFixed(d).replace('.', ','); }
function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
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

/* segmented control: init met callback, waarde zetten */
function segInit(sel, cb) {
  $(sel).addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
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
    if (!b) return;
    b.classList.toggle('on');
    cb(chipsVals(sel));
  });
}
function chipsVals(sel) { return $$(sel + ' button.on').map(b => b.dataset.v); }
function chipsSet(sel, vals) {
  $$(sel + ' button').forEach(b => b.classList.toggle('on', vals.includes(b.dataset.v)));
}

/* tekstveld binden aan state */
function bind(sel, fn) {
  $(sel).addEventListener('input', e => { fn(e.target.value); wijzig(); });
}

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
  $$('#tabbar button').forEach(x => x.classList.toggle('on', x === b));
  $$('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
  window.scrollTo(0, 0);
  if (b.dataset.tab === 'export') renderSamenvatting();
});

/* ============================== tab 1: algemeen ============================== */

bind('#adres', v => S.algemeen.adres = v);
bind('#datum', v => S.algemeen.datum = v);
bind('#bouwjaar', v => S.algemeen.bouwjaar = v);
bind('#notities', v => S.algemeen.notities = v);
segInit('#seg-gebouwtype', v => { S.algemeen.gebouwtype = v; wijzig(); });

/* ============================== tab 2: ramen & deuren ============================== */

segInit('#seg-element', v => draft.element = v);
segInit('#seg-beglazing', v => draft.beglazing = v);
segInit('#seg-kader', v => draft.kader = v);
segInit('#seg-rolluik', v => draft.rolluik = v);

$('#kompas').addEventListener('click', e => {
  const p = e.target.closest('.gevel');
  if (!p) return;
  draft.gevel = p.dataset.v;
  kompasSet(draft.gevel);
});
function kompasSet(v) {
  $$('#kompas .gevel').forEach(p => p.classList.toggle('sel', p.dataset.v === v));
  $$('#kompas text').forEach(t => t.classList.toggle('sel', t.dataset.v === v));
}

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
  const b = num($('#breedte').value), h = num($('#hoogte').value);
  if (!b || !h) { toast('Vul breedte en hoogte in'); return; }
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
         <div class="r2">${fmt(r.b)} × ${fmt(r.h)} m = ${fmt(r.b * r.h)} m²</div>
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
  if (!b) return;
  const nr = Number(b.dataset.nr);
  const r = S.ramen.find(x => x.nr === nr);
  if (!r) return;
  if (!confirm(`#${nr} ${ELEMENT_NAMEN[r.element]} (${fmt(r.b)} × ${fmt(r.h)}) verwijderen?`)) return;
  S.ramen = S.ramen.filter(x => x.nr !== nr);
  renderRamen();
  bewaar();
});

/* ============================== tab 3: energie ============================== */

chipsInit('#chips-opwek', vals => { S.energie.opwek = vals; toonEnergiePanelen(); wijzig(); });
chipsInit('#chips-emissie', vals => { S.energie.emissie = vals; wijzig(); });

function toonEnergiePanelen() {
  const o = S.energie.opwek;
  $('#panel-ketel').hidden = !(o.includes('gasketel') || o.includes('stookolie'));
  $('#panel-wp').hidden = !o.includes('warmtepomp');
  $('#panel-airco').hidden = !o.includes('airco');
}

segInit('#seg-ketelcond', v => { S.energie.ketel.cond = v; wijzig(); });
bind('#ketelmerk', v => S.energie.ketel.merk = v);
bind('#keteljaar', v => S.energie.ketel.jaar = v);

$('#btn-ketelfoto').addEventListener('click', () => neemFoto(data => {
  S.energie.ketel.foto = data;
  updateKetelThumb();
  bewaar();
}));
$('#btn-ketelfoto-del').addEventListener('click', () => {
  S.energie.ketel.foto = null;
  updateKetelThumb();
  bewaar();
});
function updateKetelThumb() {
  const t = $('#ketelfoto-thumb'), d = $('#btn-ketelfoto-del');
  t.hidden = d.hidden = !S.energie.ketel.foto;
  if (S.energie.ketel.foto) t.src = S.energie.ketel.foto;
}

segInit('#seg-wptype', v => { S.energie.wp.type = v; wijzig(); });

$('#btn-airco-voegtoe').addEventListener('click', () => {
  const ruimte = $('#airco-ruimte').value.trim();
  const m2 = num($('#airco-m2').value);
  if (!ruimte) { toast('Vul de ruimte in'); return; }
  S.energie.airco.push({ ruimte, m2 });
  $('#airco-ruimte').value = '';
  $('#airco-m2').value = '';
  renderAirco();
  bewaar();
});

function renderAirco() {
  const ul = $('#aircolijst');
  ul.innerHTML = '';
  S.energie.airco.forEach((u, i) => {
    const li = document.createElement('li');
    li.innerHTML =
      `<div class="info"><div class="r1">${esc(u.ruimte)}</div>` +
      `<div class="r3">${u.m2 ? fmt(u.m2) + ' m²' : 'oppervlakte onbekend'}</div></div>` +
      `<button type="button" class="del" data-i="${i}">×</button>`;
    ul.appendChild(li);
  });
}
$('#aircolijst').addEventListener('click', e => {
  const b = e.target.closest('.del');
  if (!b) return;
  S.energie.airco.splice(Number(b.dataset.i), 1);
  renderAirco();
  bewaar();
});

const SWW_NAMEN = {
  'cv-ketel': 'Via cv-ketel', 'elektrische-boiler': 'Elektrische boiler',
  'warmtepompboiler': 'Warmtepompboiler', 'zonneboiler': 'Zonneboiler', 'doorstromer': 'Doorstromer'
};
segInit('#seg-sww', v => { S.energie.sww = v; wijzig(); });

segInit('#seg-pv', v => {
  S.energie.pv = v;
  $('#fld-kwp').hidden = v !== 'ja';
  wijzig();
});
bind('#kwp', v => S.energie.kwp = v);

/* ============================== tab 4: ventilatie ============================== */

segInit('#seg-ventsysteem', v => { S.ventilatie.systeem = v; wijzig(); });

$('#vent-chips').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  const basis = b.dataset.v;
  const zelfde = S.ventilatie.ruimtes.filter(r => r.naam === basis || r.naam.startsWith(basis + ' ')).length;
  const naam = zelfde ? `${basis} ${zelfde + 1}` : basis;
  S.ventilatie.ruimtes.push({ naam, voorziening: 'geen' });
  renderVent();
  bewaar();
});

const VOORZIENINGEN = [
  ['geen', 'Geen'],
  ['afvoerventiel', 'Afvoerventiel'],
  ['toevoerventiel', 'Toevoerventiel'],
  ['raamrooster', 'Raamrooster'],
  ['muurrooster', 'Muurrooster'],
  ['mechanische-ventilator', 'Mechanische ventilator']
];
const VOORZIENING_NAMEN = Object.fromEntries(VOORZIENINGEN);

function renderVent() {
  const ul = $('#ventlijst');
  ul.innerHTML = '';
  S.ventilatie.ruimtes.forEach((r, i) => {
    const li = document.createElement('li');
    const opts = VOORZIENINGEN
      .map(([v, n]) => `<option value="${v}"${r.voorziening === v ? ' selected' : ''}>${n}</option>`)
      .join('');
    li.innerHTML =
      `<span class="naam">${esc(r.naam)}</span>` +
      `<select data-i="${i}">${opts}</select>` +
      `<button type="button" class="del" data-i="${i}">×</button>`;
    ul.appendChild(li);
  });
}
$('#ventlijst').addEventListener('change', e => {
  const s = e.target.closest('select');
  if (!s) return;
  S.ventilatie.ruimtes[Number(s.dataset.i)].voorziening = s.value;
  bewaar();
});
$('#ventlijst').addEventListener('click', e => {
  const b = e.target.closest('.del');
  if (!b) return;
  S.ventilatie.ruimtes.splice(Number(b.dataset.i), 1);
  renderVent();
  bewaar();
});

/* ============================== tab 5: export ============================== */

const OPWEK_NAMEN = {
  gasketel: 'Gasketel', stookolie: 'Stookolieketel', warmtepomp: 'Warmtepomp',
  airco: 'Airco', elektrisch: 'Elektrisch', kachel: 'Kachel'
};
const EMISSIE_NAMEN = { radiatoren: 'Radiatoren', vloerverwarming: 'Vloerverwarming', convectoren: 'Convectoren', lucht: 'Lucht' };
const GEBOUW_NAMEN = { open: 'Open bebouwing', halfopen: 'Halfopen bebouwing', gesloten: 'Gesloten bebouwing', appartement: 'Appartement' };

function fotoCount() {
  return S.ramen.filter(r => r.foto).length + (S.energie.ketel.foto ? 1 : 0);
}

function renderSamenvatting() {
  const totM2 = S.ramen.reduce((a, r) => a + r.b * r.h, 0);
  const rijen = [
    ['Adres', S.algemeen.adres || '-'],
    ['Datum', S.algemeen.datum || '-'],
    ['Type', GEBOUW_NAMEN[S.algemeen.gebouwtype] || '-'],
    ['Bouwjaar', S.algemeen.bouwjaar || '-'],
    ['Ramen & deuren', S.ramen.length ? `${S.ramen.length} elementen, ${fmt(totM2)} m²` : '-'],
    ['Opwekking', S.energie.opwek.map(v => OPWEK_NAMEN[v]).join(', ') || '-'],
    ['Afgifte', S.energie.emissie.map(v => EMISSIE_NAMEN[v]).join(', ') || '-'],
    ['Warm water', SWW_NAMEN[S.energie.sww] || '-'],
    ['PV', S.energie.pv === 'ja' ? `Ja${S.energie.kwp ? `, ${S.energie.kwp} kWp` : ''}` : (S.energie.pv === 'nee' ? 'Nee' : '-')],
    ['Ventilatie', (S.ventilatie.systeem ? `Systeem ${S.ventilatie.systeem === 'geen' ? 'geen' : S.ventilatie.systeem}` : '-') +
      (S.ventilatie.ruimtes.length ? `, ${S.ventilatie.ruimtes.length} ruimtes` : '')],
    ['Foto’s', String(fotoCount())]
  ];
  $('#samenvatting').innerHTML =
    '<h3>Samenvatting</h3><table>' +
    rijen.map(([k, v]) => `<tr><td>${k}</td><td>${esc(v)}</td></tr>`).join('') +
    '</table>';
}

/* ---------- one-pager / print ---------- */

$('#btn-print').addEventListener('click', () => {
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
    html += `<table><tr><th>#</th><th>Type</th><th>Gevel</th><th class="num">B (m)</th><th class="num">H (m)</th><th class="num">m²</th><th>Beglazing</th><th>Kader</th><th>Rolluik</th></tr>`;
    S.ramen.forEach(r => {
      html += `<tr><td>${r.nr}</td><td>${ELEMENT_NAMEN[r.element] || ''}</td><td>${GEVEL_NAMEN[r.gevel] || ''}</td>` +
        `<td class="num">${fmt(r.b)}</td><td class="num">${fmt(r.h)}</td><td class="num">${fmt(r.b * r.h)}</td>` +
        `<td>${GLAS_NAMEN[r.beglazing] || ''}</td><td>${KADER_NAMEN[r.kader] || ''}</td><td>${r.rolluik ? 'ja' : 'nee'}</td></tr>`;
    });
    html += `<tr class="tot"><td colspan="5">Totaal (${S.ramen.length} elementen)</td><td class="num">${fmt(totM2)}</td><td colspan="3"></td></tr></table>`;
  } else {
    html += '<p class="kv">Geen elementen opgemeten.</p>';
  }

  /* energie */
  html += '<h2>Energie</h2>';
  const E = S.energie;
  html += `<p class="kv"><b>Opwekking</b> ${E.opwek.map(v => OPWEK_NAMEN[v]).join(', ') || '-'}</p>`;
  if (E.opwek.includes('gasketel') || E.opwek.includes('stookolie')) {
    const k = E.ketel;
    html += `<p class="kv"><b>Ketel</b> ${[k.cond, k.merk ? esc(k.merk) : '', k.jaar ? 'bouwjaar ' + esc(k.jaar) : ''].filter(Boolean).join(', ') || 'details onbekend'}</p>`;
  }
  if (E.opwek.includes('warmtepomp')) {
    html += `<p class="kv"><b>Warmtepomp</b> ${E.wp.type || 'type onbekend'}</p>`;
  }
  if (E.opwek.includes('airco') && E.airco.length) {
    html += `<table><tr><th>Airco binnenunit</th><th class="num">Oppervlakte</th></tr>` +
      E.airco.map(u => `<tr><td>${esc(u.ruimte)}</td><td class="num">${u.m2 ? fmt(u.m2) + ' m²' : '-'}</td></tr>`).join('') +
      '</table>';
  }
  html += `<p class="kv"><b>Afgifte</b> ${E.emissie.map(v => EMISSIE_NAMEN[v]).join(', ') || '-'}</p>`;
  html += `<p class="kv"><b>Sanitair warm water</b> ${SWW_NAMEN[E.sww] || '-'}</p>`;
  html += `<p class="kv"><b>PV-panelen</b> ${E.pv === 'ja' ? 'ja' + (E.kwp ? ', ' + esc(E.kwp) + ' kWp' : '') : (E.pv === 'nee' ? 'nee' : '-')}</p>`;

  /* ventilatie */
  html += '<h2>Ventilatie</h2>';
  html += `<p class="kv"><b>Systeem</b> ${S.ventilatie.systeem ? (S.ventilatie.systeem === 'geen' ? 'geen' : 'systeem ' + S.ventilatie.systeem) : '-'}</p>`;
  if (S.ventilatie.ruimtes.length) {
    html += '<table><tr><th>Ruimte</th><th>Voorziening</th></tr>' +
      S.ventilatie.ruimtes.map(r => `<tr><td>${esc(r.naam)}</td><td>${VOORZIENING_NAMEN[r.voorziening] || ''}</td></tr>`).join('') +
      '</table>';
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
  if (S.energie.ketel.foto) fotos.push({ src: S.energie.ketel.foto, cap: 'Ketel kenplaat' });
  if (fotos.length) {
    html += '<h2>Foto’s</h2><div class="fotos">' +
      fotos.map(f => `<div class="foto"><img src="${f.src}" alt=""><div class="cap">${esc(f.cap)}</div></div>`).join('') +
      '</div>';
  }

  $('#printview').innerHTML = html;
}

/* ---------- JSON export / import ---------- */

$('#btn-export').addEventListener('click', () => {
  const slug = (S.algemeen.adres || 'woning').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'woning';
  const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `epc-${slug}-${S.algemeen.datum || 'export'}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('JSON geëxporteerd');
});

$('#btn-import').addEventListener('click', () => {
  $('#importinput').value = '';
  $('#importinput').click();
});
$('#importinput').addEventListener('change', () => {
  const f = $('#importinput').files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const p = JSON.parse(r.result);
      if (!p || typeof p !== 'object' || !p.algemeen) throw new Error('geen epc-bestand');
      const basis = leegState();
      S = {
        ...basis, ...p,
        algemeen: { ...basis.algemeen, ...(p.algemeen || {}) },
        energie: {
          ...basis.energie, ...(p.energie || {}),
          ketel: { ...basis.energie.ketel, ...((p.energie || {}).ketel || {}) },
          wp: { ...basis.energie.wp, ...((p.energie || {}).wp || {}) }
        },
        ventilatie: { ...basis.ventilatie, ...(p.ventilatie || {}) }
      };
      syncAlles();
      bewaar();
      toast('Import gelukt');
    } catch (e) {
      toast('Import mislukt: geen geldig bestand');
    }
  };
  r.readAsText(f);
});

$('#btn-nieuw').addEventListener('click', () => {
  if (!confirm('Alle gegevens van deze woning wissen en opnieuw starten?')) return;
  S = leegState();
  draft = { element: 'raam', gevel: 'voor', beglazing: 'dubbel', kader: 'pvc', rolluik: 'nee', foto: null };
  syncAlles();
  bewaar();
  toast('Nieuwe woning gestart');
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

  /* energie */
  chipsSet('#chips-opwek', S.energie.opwek);
  toonEnergiePanelen();
  segSet('#seg-ketelcond', S.energie.ketel.cond);
  $('#ketelmerk').value = S.energie.ketel.merk;
  $('#keteljaar').value = S.energie.ketel.jaar;
  updateKetelThumb();
  segSet('#seg-wptype', S.energie.wp.type);
  renderAirco();
  chipsSet('#chips-emissie', S.energie.emissie);
  segSet('#seg-sww', S.energie.sww);
  segSet('#seg-pv', S.energie.pv);
  $('#fld-kwp').hidden = S.energie.pv !== 'ja';
  $('#kwp').value = S.energie.kwp;

  /* ventilatie */
  segSet('#seg-ventsysteem', S.ventilatie.systeem);
  renderVent();

  /* export */
  renderSamenvatting();
}

syncAlles();

/* ============================== service worker ============================== */

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline install vereist https of localhost */ });
}
