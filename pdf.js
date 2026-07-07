'use strict';

/* ============================== PDF-generator ==============================
   Schrijft zelf een volledig PDF-bestand (geen dependencies): Helvetica
   (base-14, WinAnsi) voor tekst, JPEG-foto's rechtstreeks als DCTDecode.
   bouwPdf(S) -> Promise<Blob>. Leest de woning via de globale helpers uit
   app.js (gesorteerdeRamen, afmTekst, namen-tabellen, ...). */

const PDF_STAAND = { b: 595.28, h: 841.89 };  /* A4 in punten */
const PDF_MARGE = 40;

/* ---------- tekstbreedte meten via canvas (Helvetica-metriek) ---------- */

const pdfMeetCtx = (() => {
  const c = document.createElement('canvas');
  return c.getContext('2d');
})();

function pdfBreedte(s, size, vet) {
  pdfMeetCtx.font = `${vet ? 'bold ' : ''}${size}px Helvetica, Arial, sans-serif`;
  return pdfMeetCtx.measureText(String(s)).width;
}

/* tekst afbreken op woordgrenzen zodat elke regel binnen maxB past */
function pdfWrap(s, size, vet, maxB) {
  const woorden = String(s).split(/\s+/).filter(Boolean);
  if (!woorden.length) return [''];
  const regels = [];
  let regel = '';
  woorden.forEach(w => {
    const probeer = regel ? regel + ' ' + w : w;
    if (pdfBreedte(probeer, size, vet) <= maxB || !regel) regel = probeer;
    else { regels.push(regel); regel = w; }
  });
  regels.push(regel);
  return regels;
}

/* ---------- bytes en encoding ---------- */

function pdfLatin1(s) {
  const uit = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) uit[i] = s.charCodeAt(i) & 0xFF;
  return uit;
}

/* WinAnsi: tekens boven 255 worden '?', ( ) \ ge-escaped */
function pdfStr(s) {
  let uit = '';
  for (const ch of String(s)) {
    let c = ch.codePointAt(0);
    if (c === 0x2019) c = 39;      /* ’ -> ' */
    if (c === 0x2013) c = 150;     /* – */
    if (c === 0x20AC) c = 128;     /* € */
    if (c > 255) c = 63;
    const t = String.fromCharCode(c);
    if (t === '(' || t === ')' || t === '\\') uit += '\\' + t;
    else uit += t;
  }
  return uit;
}

function dataUrlBytes(u) {
  const bin = atob(u.slice(u.indexOf(',') + 1));
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

/* natuurlijke afmetingen van een dataURL-foto */
function fotoDims(dataUrl) {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => res({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
    img.onerror = () => res({ w: 4, h: 3 });
    img.src = dataUrl;
  });
}

/* ============================== schrijver ============================== */

function nieuwPdfDoc() {
  const paginas = [];   /* {liggend, ops:[], fotos:Map<naam,objNr>} */
  const fotoObjs = [];  /* {data, w, h} per uniek beeld; objNr later */
  const fotoIndex = new Map(); /* dataUrl -> {naam, i} */

  function pagB(p) { return p.liggend ? PDF_STAAND.h : PDF_STAAND.b; }
  function pagH(p) { return p.liggend ? PDF_STAAND.b : PDF_STAAND.h; }

  function nieuwePagina(liggend) {
    paginas.push({ liggend: !!liggend, ops: [], fotos: new Set() });
    return paginas[paginas.length - 1];
  }

  function registreerFoto(dataUrl, dims) {
    if (!fotoIndex.has(dataUrl)) {
      const naam = 'Im' + (fotoObjs.length + 1);
      fotoObjs.push({ naam, data: dataUrlBytes(dataUrl), w: dims.w, h: dims.h });
      fotoIndex.set(dataUrl, naam);
    }
    return fotoIndex.get(dataUrl);
  }

  /* y is afstand vanaf de bovenkant; intern draaien we om naar PDF-coördinaten */
  function tekst(p, x, y, s, size, vet, grijs) {
    const Y = pagH(p) - y - size;
    p.ops.push(`BT /${vet ? 'F2' : 'F1'} ${size} Tf ${grijs ? '0.42 g' : '0 g'} ${x.toFixed(2)} ${Y.toFixed(2)} Td (${pdfStr(s)}) Tj ET`);
  }
  function lijn(p, x1, y1, x2, y2, dikte) {
    p.ops.push(`${(dikte || 0.5)} w 0.62 G ${x1.toFixed(2)} ${(pagH(p) - y1).toFixed(2)} m ${x2.toFixed(2)} ${(pagH(p) - y2).toFixed(2)} l S`);
  }
  function rechthoek(p, x, y, b, h) {
    p.ops.push(`0.5 w 0.62 G ${x.toFixed(2)} ${(pagH(p) - y - h).toFixed(2)} ${b.toFixed(2)} ${h.toFixed(2)} re S`);
  }
  function foto(p, naam, x, y, b, h) {
    p.fotos.add(naam);
    p.ops.push(`q ${b.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${(pagH(p) - y - h).toFixed(2)} cm /${naam} Do Q`);
  }

  /* alles serialiseren tot één PDF-bestand */
  function bouw() {
    const objs = [null]; /* index = objectnummer */
    const voeg = inhoud => { objs.push(inhoud); return objs.length - 1; };

    const catNr = voeg(null);   /* 1: catalog (later) */
    const pagesNr = voeg(null); /* 2: pages (later) */
    const f1 = voeg('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = voeg('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

    const fotoNrs = new Map();
    fotoObjs.forEach(f => {
      const nr = voeg({
        kop: `<< /Type /XObject /Subtype /Image /Width ${f.w} /Height ${f.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${f.data.length} >>`,
        stream: f.data
      });
      fotoNrs.set(f.naam, nr);
    });

    const pagNrs = [];
    paginas.forEach(p => {
      const inhoud = pdfLatin1(p.ops.join('\n'));
      const cNr = voeg({ kop: `<< /Length ${inhoud.length} >>`, stream: inhoud });
      const xo = [...p.fotos].map(n => `/${n} ${fotoNrs.get(n)} 0 R`).join(' ');
      const nr = voeg(
        `<< /Type /Page /Parent ${pagesNr} 0 R /MediaBox [0 0 ${pagB(p).toFixed(2)} ${pagH(p).toFixed(2)}] ` +
        `/Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >>${xo ? ` /XObject << ${xo} >>` : ''} >> ` +
        `/Contents ${cNr} 0 R >>`);
      pagNrs.push(nr);
    });

    objs[catNr] = `<< /Type /Catalog /Pages ${pagesNr} 0 R >>`;
    objs[pagesNr] = `<< /Type /Pages /Kids [${pagNrs.map(n => `${n} 0 R`).join(' ')}] /Count ${pagNrs.length} >>`;

    const delen = [pdfLatin1('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')];
    let offset = delen[0].length;
    const offsets = [0];
    for (let i = 1; i < objs.length; i++) {
      offsets.push(offset);
      const o = objs[i];
      let stuk;
      if (typeof o === 'string') {
        stuk = [pdfLatin1(`${i} 0 obj\n${o}\nendobj\n`)];
      } else {
        stuk = [pdfLatin1(`${i} 0 obj\n${o.kop}\nstream\n`), o.stream, pdfLatin1('\nendstream\nendobj\n')];
      }
      stuk.forEach(d => { delen.push(d); offset += d.length; });
    }
    const xrefStart = offset;
    let xref = `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
    for (let i = 1; i < objs.length; i++) xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    xref += `trailer\n<< /Size ${objs.length} /Root ${catNr} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
    delen.push(pdfLatin1(xref));
    return new Blob(delen, { type: 'application/pdf' });
  }

  return { paginas, nieuwePagina, registreerFoto, tekst, lijn, rechthoek, foto, pagB, pagH, bouw };
}

/* ============================== opmaak van het dossier ============================== */

async function bouwPdf(S) {
  const doc = nieuwPdfDoc();
  const M = PDF_MARGE;

  /* alle foto-afmetingen vooraf bepalen */
  const dimsCache = new Map();
  async function dims(u) {
    if (!dimsCache.has(u)) dimsCache.set(u, await fotoDims(u));
    return dimsCache.get(u);
  }

  let p = doc.nieuwePagina(false);
  let y = M;
  const binnenB = () => doc.pagB(p) - 2 * M;

  function checkPagina(hoogte) {
    if (y + hoogte > doc.pagH(p) - M - 16) {
      p = doc.nieuwePagina(p.liggend);
      y = M;
    }
  }

  function sectieKop(s) {
    checkPagina(30);
    y += 8;
    doc.tekst(p, M, y, s.toUpperCase(), 10.5, true);
    y += 14;
    doc.lijn(p, M, y, M + binnenB(), y, 1);
    y += 6;
  }

  function kvRegel(label, waarde) {
    checkPagina(14);
    doc.tekst(p, M, y, label, 8.5, true);
    doc.tekst(p, M + 110, y, waarde, 8.5, false);
    y += 13;
  }

  /* tabel: kolommen [{kop, b (relatief), uitlijn}] en rijen [[cel,...]]; laatste rij optioneel vet */
  function tabel(kolommen, rijen, totRij) {
    const schaal = binnenB() / kolommen.reduce((a, k) => a + k.b, 0);
    const bs = kolommen.map(k => k.b * schaal);
    const size = 7.5, pad = 3, lh = size * 1.3;

    function rij(cellen, vet) {
      const gewrapt = cellen.map((c, i) => pdfWrap(c == null ? '' : String(c), size, vet, bs[i] - 2 * pad));
      const regels = Math.max(...gewrapt.map(g => g.length));
      const h = regels * lh + 2 * pad;
      checkPagina(h);
      let x = M;
      gewrapt.forEach((g, i) => {
        doc.rechthoek(p, x, y, bs[i], h);
        g.forEach((r, ri) => {
          const tx = kolommen[i].uitlijn === 'r'
            ? x + bs[i] - pad - pdfBreedte(r, size, vet)
            : x + pad;
          doc.tekst(p, tx, y + pad + ri * lh, r, size, vet);
        });
        x += bs[i];
      });
      y += h;
    }

    rij(kolommen.map(k => k.kop), true);
    rijen.forEach(r => rij(r, false));
    if (totRij) rij(totRij, true);
    y += 6;
  }

  /* fotoraster: cellen van vaste hoogte, foto passend (contain) gecentreerd */
  async function fotoRaster(fotos, perRij, celH, metCap) {
    const gap = 8;
    const celB = (binnenB() - (perRij - 1) * gap) / perRij;
    for (let i = 0; i < fotos.length; i += perRij) {
      const blok = fotos.slice(i, i + perRij);
      const capH = metCap ? 9 : 0;
      checkPagina(celH + capH + 6);
      for (let k = 0; k < blok.length; k++) {
        const f = blok[k];
        const d = await dims(f.src);
        const naam = doc.registreerFoto(f.src, d);
        const s = Math.min(celB / d.w, celH / d.h);
        const bw = d.w * s, bh = d.h * s;
        const x = M + k * (celB + gap) + (celB - bw) / 2;
        doc.foto(p, naam, x, y + (celH - bh) / 2, bw, bh);
        if (metCap && f.cap) {
          const capregel = pdfWrap(f.cap, 6.5, false, celB)[0];
          doc.tekst(p, M + k * (celB + gap) + Math.max(0, (celB - pdfBreedte(capregel, 6.5, false)) / 2), y + celH + 1, capregel, 6.5, false, true);
        }
      }
      y += celH + capH + 4;
    }
  }

  /* ---------- kop ---------- */
  const A = S.algemeen;
  let kopOnder = M;
  if (A.foto) {
    const d = await dims(A.foto);
    const naam = doc.registreerFoto(A.foto, d);
    const bw = 130, bh = Math.min(100, bw * d.h / d.w);
    doc.foto(p, naam, M + binnenB() - bw + (bw - Math.min(bw, bh * d.w / d.h)) / 2, M, Math.min(bw, bh * d.w / d.h), bh);
    kopOnder = M + bh;
  }
  doc.tekst(p, M, y, 'EPC Plaatsbezoek', 9, false, true);
  y += 14;
  pdfWrap(A.adres || 'Adres onbekend', 15, true, binnenB() - 150).forEach(r => {
    doc.tekst(p, M, y, r, 15, true);
    y += 19;
  });
  doc.tekst(p, M, y, `Datum plaatsbezoek: ${A.datum || '-'}`, 9.5, false);
  y += 14;
  y = Math.max(y, kopOnder) + 4;

  /* ---------- ramen & deuren ---------- */
  sectieKop('Ramen & deuren');
  const ramen = gesorteerdeRamen();
  if (ramen.length) {
    const totM2 = S.ramen.reduce((a, r) => a + r.b * r.h * raamAantal(r), 0);
    const totAantal = S.ramen.reduce((a, r) => a + raamAantal(r), 0);
    tabel(
      [{ kop: '#', b: 16 }, { kop: 'Type', b: 42 }, { kop: 'Ruimte', b: 62 }, { kop: 'Gevel', b: 36 },
       { kop: 'Aant.', b: 26, uitlijn: 'r' }, { kop: 'B (m)', b: 32, uitlijn: 'r' }, { kop: 'H (m)', b: 32, uitlijn: 'r' },
       { kop: 'm2', b: 32, uitlijn: 'r' }, { kop: 'Beglazing', b: 52 }, { kop: 'Kader', b: 34 }, { kop: 'Rolluik', b: 34 }],
      ramen.map(r => [r.nr, ELEMENT_NAMEN[r.element] || r.element, r.ruimte || '', GEVEL_NAMEN[r.gevel] || '',
        raamAantal(r), fmtM(r.b), fmtM(r.h), fmt(r.b * r.h * raamAantal(r)),
        GLAS_NAMEN[r.beglazing] || '', KADER_NAMEN[r.kader] || '', r.rolluik ? 'ja' : 'nee']),
      [`Totaal`, '', '', '', totAantal, '', '', fmt(totM2), '', '', '']
    );
    await fotoRaster(ramen.filter(r => r.foto).map(r => ({
      src: r.foto,
      cap: `${ELEMENT_NAMEN[r.element] || r.element} ${(GEVEL_NAMEN[r.gevel] || '').toLowerCase()}${r.ruimte ? ' - ' + r.ruimte : ''}, ${r.element === 'dakraam' ? 'kenplaatje' : 'afstandhouder'}`
    })), 4, 82, true);
  } else {
    kvRegel('Geen elementen opgemeten.', '');
  }

  /* ---------- energie ---------- */
  sectieKop('Energie');
  const E = S.energie;
  if (E.opwekkers.length) {
    tabel(
      [{ kop: '#', b: 16 }, { kop: 'Opwekker', b: 60 }, { kop: 'Ruimte', b: 70 }, { kop: 'Doet', b: 110 }, { kop: 'Beschrijving', b: 200 }],
      E.opwekkers.map(o => {
        const r = S.ruimtes.find(x => x.naam === o.ruimte);
        const vol = isRuimteToestel(o) && r && r.afm ? 'ruimte ' + afmTekst(r.afm) : '';
        return [o.nr, OPWEK_NAMEN[o.type] || o.type, o.ruimte || '',
          (o.functie || []).map(f => FUNCTIE_NAMEN[f] || f).join(' + '),
          [o.beschrijving, vol].filter(Boolean).join(' - ')];
      })
    );
    const opwekFotos = [];
    E.opwekkers.forEach(o => {
      const naam = `${OPWEK_NAMEN[o.type] || o.type}${o.ruimte ? ' - ' + o.ruimte : ''}`;
      if (o.foto) opwekFotos.push({ src: o.foto, cap: `${naam}, kenplaat` });
      if (o.fotoKraan) opwekFotos.push({ src: o.fotoKraan, cap: `${naam}, radiatorkranen` });
    });
    await fotoRaster(opwekFotos, 4, 82, true);
  } else {
    kvRegel('Geen opwekkers genoteerd.', '');
  }
  kvRegel('Zonnepanelen', E.pvPanelen.length
    ? E.pvPanelen.map(pv => `${PVOR_NAMEN[pv.orientatie] || '?'} ${pv.wp} Wp`).join(' - ')
    : '-');
  if (E.zonneboiler === 'ja') kvRegel('Zonneboiler', `ja${E.zonneboilerM2 ? ', ' + E.zonneboilerM2 + ' m2' : ''}`);

  /* ---------- ventilatie ---------- */
  sectieKop('Ventilatie');
  tabel(
    [{ kop: 'Ruimte', b: 90 }, { kop: 'Ventilatie', b: 120 }, { kop: 'Afmetingen', b: 130 }, { kop: 'Opmerking', b: 175 }],
    gesorteerdeRuimtes().map(r => [r.naam, ventTekst(r), r.afm ? afmTekst(r.afm) : '', r.opm || ''])
  );

  /* ---------- notities ---------- */
  if ((A.notities || '').trim()) {
    sectieKop('Notities');
    A.notities.split('\n').forEach(alinea => {
      pdfWrap(alinea, 8.5, false, binnenB()).forEach(r => {
        checkPagina(12);
        doc.tekst(p, M, y, r, 8.5, false);
        y += 11.5;
      });
    });
  }

  /* ---------- fotodossier ---------- */
  if (S.fotodossier.length) {
    const dossier = gesorteerdDossier();
    const groepen = [];
    dossier.forEach(f => {
      const naam = dossierCap(f);
      if (!groepen.length || groepen[groepen.length - 1].naam !== naam) groepen.push({ naam, fotos: [] });
      groepen[groepen.length - 1].fotos.push(f);
    });

    p = doc.nieuwePagina(false);
    y = M;
    doc.tekst(p, M, y, 'FOTODOSSIER', 12, true);
    y += 16;
    doc.tekst(p, M, y, `${A.adres || ''} - plaatsbezoek ${A.datum || ''} - ${dossier.length} foto's`, 8.5, false, true);
    y += 16;

    for (const g of groepen) {
      const liggend = g.fotos.length && g.fotos[0].ruimte === FOTO_ALGEMEEN;
      if (liggend) {
        /* facturen: eigen liggende pagina's, 2 per pagina, paginavullend */
        for (let i = 0; i < g.fotos.length; i += 2) {
          p = doc.nieuwePagina(true);
          y = M;
          doc.tekst(p, M, y, g.naam.toUpperCase(), 10.5, true);
          y += 14;
          const blok = g.fotos.slice(i, i + 2);
          const celB = (binnenB() - 16) / 2;
          const celH = doc.pagH(p) - y - M - 14;
          for (let k = 0; k < blok.length; k++) {
            const d = await dims(blok[k].foto);
            const naam = doc.registreerFoto(blok[k].foto, d);
            const s = Math.min(celB / d.w, celH / d.h);
            doc.foto(p, naam, M + k * (celB + 16) + (celB - d.w * s) / 2, y + (celH - d.h * s) / 2, d.w * s, d.h * s);
          }
          y += celH;
        }
        p = doc.nieuwePagina(false);
        y = M;
      } else {
        /* titel nooit alleen onderaan: titel + eerste fotorij horen samen */
        checkPagina(14 + 100 + 6);
        doc.tekst(p, M, y, g.naam.toUpperCase(), 10.5, true);
        y += 14;
        await fotoRaster(g.fotos.map(f => ({ src: f.foto })), 4, 95, false);
      }
    }
    /* lege slotpagina vermijden */
    if (!doc.paginas[doc.paginas.length - 1].ops.length) doc.paginas.pop();
  }

  /* ---------- paginanummers ---------- */
  const n = doc.paginas.length;
  doc.paginas.forEach((pag, i) => {
    const voet = `${A.adres || 'EPC'} - pagina ${i + 1}/${n}`;
    doc.tekst(pag, (doc.pagB(pag) - pdfBreedte(voet, 7, false)) / 2, doc.pagH(pag) - 22, voet, 7, false, true);
  });

  return doc.bouw();
}
