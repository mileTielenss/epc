'use strict';

/* ============================== maakpdf.js ==============================
   Schrijft zelf een volledig PDF 1.4-document, zonder DOM en zonder
   dependencies: draait in pdfworker.js én los in Node (unit-tests).
   Invoer: woningobject + Map<fotoId, {bytes:Uint8Array, breedte, hoogte,
   groep, volgorde}>. Uitvoer: Blob. Tekst in Helvetica/Helvetica-Bold
   (WinAnsi), breedtes uit de Adobe Core14 AFM-tabellen; JPEG's gaan er
   rechtstreeks in als DCTDecode. */

(function (root) {

  const PDF_STAAND = { b: 595.28, h: 841.89 };  /* A4 in punten */
  const PDF_MARGE = 40;

  /* ---------- AFM advance widths (1/1000 em), geïndexeerd op WinAnsi-code ---------- */

  function maakBreedtes(s) {
    const a = new Uint16Array(256);
    s.trim().split(/\s+/).forEach((v, i) => { a[32 + i] = +v; });
    return a;
  }

  /* Helvetica, codes 32..255 (0 = niet toegekend in WinAnsi) */
  const HELV = maakBreedtes(`
    278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278
    556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556
    1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778
    667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556
    333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556
    556 556 333 500 278 556 500 722 500 500 500 334 260 334 584 0
    556 0 222 556 333 1000 556 556 333 1000 667 333 1000 0 611 0
    0 222 222 333 333 350 556 1000 333 1000 500 333 944 0 500 667
    278 333 556 556 556 556 260 556 333 737 370 556 584 333 737 333
    400 584 333 333 333 556 537 278 333 333 365 556 834 834 834 611
    667 667 667 667 667 667 1000 722 667 667 667 667 278 278 278 278
    722 722 778 778 778 778 778 584 778 722 722 722 722 667 667 611
    556 556 556 556 556 556 889 500 556 556 556 556 278 278 278 278
    556 556 556 556 556 556 556 584 611 556 556 556 556 500 556 500`);

  /* Helvetica-Bold, codes 32..255 */
  const HELV_VET = maakBreedtes(`
    278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278
    556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611
    975 722 722 722 722 667 611 778 722 278 556 722 611 833 722 778
    667 778 722 667 611 722 667 944 667 667 611 333 278 333 584 556
    333 556 611 556 611 556 333 611 611 278 278 556 278 889 611 611
    611 611 389 556 333 611 556 778 556 556 500 389 280 389 584 0
    556 0 278 556 500 1000 556 556 333 1000 667 333 1000 0 611 0
    0 278 278 500 500 350 556 1000 333 1000 556 333 944 0 500 667
    278 333 556 556 556 556 280 556 333 737 370 556 584 333 737 333
    400 584 333 333 333 611 556 278 333 333 365 556 834 834 834 611
    722 722 722 722 722 722 1000 722 667 667 667 667 278 278 278 278
    722 722 778 778 778 778 778 584 778 722 722 722 722 667 667 611
    556 556 556 556 556 556 889 556 556 556 556 556 278 278 278 278
    611 611 611 611 611 611 611 584 611 611 611 611 611 556 611 556`);

  /* ---------- WinAnsi (CP1252): unicode -> code ---------- */

  const CP1252 = new Map([
    [0x20AC, 128], [0x201A, 130], [0x0192, 131], [0x201E, 132], [0x2026, 133],
    [0x2020, 134], [0x2021, 135], [0x02C6, 136], [0x2030, 137], [0x0160, 138],
    [0x2039, 139], [0x0152, 140], [0x017D, 142], [0x2018, 145], [0x2019, 146],
    [0x201C, 147], [0x201D, 148], [0x2022, 149], [0x2013, 150], [0x2014, 151],
    [0x02DC, 152], [0x2122, 153], [0x0161, 154], [0x203A, 155], [0x0153, 156],
    [0x017E, 158], [0x0178, 159]
  ]);

  /* unicode-codepoint -> WinAnsi-code; NBSP wordt spatie, onbekend wordt '?' */
  function winAnsiCode(cp) {
    if (cp === 0xA0) return 32;
    if (cp >= 0x20 && cp <= 0x7E) return cp;
    if (cp >= 0xA1 && cp <= 0xFF) return cp;
    if (CP1252.has(cp)) return CP1252.get(cp);
    return 63;
  }

  /* string -> ge-escapete WinAnsi-bytestring voor in een PDF-literal */
  function pdfStr(s) {
    let uit = '';
    for (const ch of String(s)) {
      const c = winAnsiCode(ch.codePointAt(0));
      const t = String.fromCharCode(c);
      uit += (t === '(' || t === ')' || t === '\\') ? '\\' + t : t;
    }
    return uit;
  }

  /* tekstbreedte in punten uit de AFM-tabellen (geen canvas: de browser
     substitueert Arial voor "Helvetica" en meet dus verkeerd) */
  function tekstBreedte(s, size, vet) {
    const tabel = vet ? HELV_VET : HELV;
    let som = 0;
    for (const ch of String(s)) som += tabel[winAnsiCode(ch.codePointAt(0))] || 556;
    return som * size / 1000;
  }

  /* afbreken op woordgrenzen zodat elke regel binnen maxB past */
  function pdfWrap(s, size, vet, maxB) {
    const woorden = String(s).split(/\s+/).filter(Boolean);
    if (!woorden.length) return [''];
    const regels = [];
    let regel = '';
    woorden.forEach(w => {
      const probeer = regel ? regel + ' ' + w : w;
      if (tekstBreedte(probeer, size, vet) <= maxB || !regel) regel = probeer;
      else { regels.push(regel); regel = w; }
    });
    regels.push(regel);
    return regels;
  }

  function pdfLatin1(s) {
    const uit = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) uit[i] = s.charCodeAt(i) & 0xFF;
    return uit;
  }

  /* ---------- JPEG: SOF-marker lezen (kleurruimte + pixelmaten) ----------
     Enkel baseline (0xFFC0) wordt aanvaard; 1 component -> DeviceGray,
     3 -> DeviceRGB, al de rest (ook progressive) -> fout. */

  function leesJpegInfo(bytes) {
    if (!bytes || bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) throw new Error('Geen JPEG');
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xFF) { i++; continue; }
      const m = bytes[i + 1];
      if (m === 0xFF) { i++; continue; }
      if (m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
      if (m === 0xC0) {
        const comp = bytes[i + 9];
        const info = { hoogte: (bytes[i + 5] << 8) | bytes[i + 6], breedte: (bytes[i + 7] << 8) | bytes[i + 8] };
        if (comp === 1) return { ...info, kleurruimte: '/DeviceGray' };
        if (comp === 3) return { ...info, kleurruimte: '/DeviceRGB' };
        throw new Error('JPEG met ' + comp + ' kleurcomponenten wordt niet ondersteund');
      }
      if (m >= 0xC1 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
        throw new Error('Progressive JPEG wordt niet ondersteund (SOF 0x' + m.toString(16).toUpperCase() + ')');
      }
      if (m === 0xD9 || m === 0xDA) break;
      i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
    }
    throw new Error('Geen SOF-marker gevonden in JPEG');
  }

  /* ---------- sorteervolgorde ramen & deuren (§7.4) ----------
     Eén functie voor lijst, PDF en nummering: eerst alle deuren, dan de
     rest; binnen elk blok gevel voor -> achter -> links -> rechts; dan
     aanmaakvolgorde. #nr = 1-gebaseerde index in die volgorde. */

  const GEVEL_ORDE = { voor: 0, achter: 1, links: 2, rechts: 3 };

  function sorteerRamen(ramen) {
    return ramen.map((r, i) => ({ r, i }))
      .sort((a, b) =>
        (a.r.element === 'deur' ? 0 : 1) - (b.r.element === 'deur' ? 0 : 1) ||
        (GEVEL_ORDE[a.r.gevel] ?? 9) - (GEVEL_ORDE[b.r.gevel] ?? 9) ||
        a.i - b.i)
      .map(x => x.r);
  }

  /* ---------- kleine helpers (zelfstandig: geen app.js hier) ---------- */

  function fmt(n, d = 2) { return n.toFixed(d).replace('.', ','); }
  function fmtM(m) { return String(Math.round(m * 1000) / 1000).replace('.', ','); }

  const ELEMENT_NAMEN = { raam: 'Raam', deur: 'Deur', dakraam: 'Dakraam' };
  const GEVEL_NAMEN = { voor: 'Voor', achter: 'Achter', links: 'Links', rechts: 'Rechts' };
  const GLAS_NAMEN = { enkel: 'Enkel', dubbel: 'Dubbel', 'hr-dubbel': 'HR dubbel', drievoudig: 'Drievoudig', paneel: 'Vol paneel' };
  const KADER_NAMEN = { pvc: 'PVC', alu: 'Alu', hout: 'Hout' };
  const OPWEK_NAMEN = { gas: 'Gas', stookolie: 'Stookolie', andere: 'Andere', airco: 'Airco', kachel: 'Kachel', 'ruimte-andere': 'Andere' };
  const FUNCTIE_NAMEN = { radiatoren: 'radiatoren', vloer: 'vloerverwarming', sww: 'warm water' };
  const PVOR_NAMEN = { plat: 'Plat dak', voor: 'Voor', achter: 'Achter', links: 'Links', rechts: 'Rechts' };
  const VENT_NAMEN = { geen: 'geen', natuurlijk: 'natuurlijk', mechanisch: 'mechanisch', 'mechanisch-permanent': 'mechanisch permanent', ander: 'ander' };

  function raamAantal(r) { return Math.max(1, r.aantal || 1); }
  function afmTekst(k) { return `${fmtM(k.b)} × ${fmtM(k.d)} × ${fmtM(k.h)} m = ${fmt(k.b * k.d * k.h, 1)} m³`; }

  /* natte ruimtes (keuken, badkamer, wc) eerst, rest alfabetisch-numeriek */
  const NAT = ['keuken', 'badkamer', 'wc'];
  function ruimteBasis(naam) { return String(naam).toLowerCase().replace(/\s*\d+\s*$/, '').trim(); }
  function sorteerVentilatie(ruimtes) {
    return [...ruimtes].sort((a, b) => {
      const na = NAT.indexOf(ruimteBasis(a.naam)), nb = NAT.indexOf(ruimteBasis(b.naam));
      const ca = na >= 0 ? 0 : 1, cb = nb >= 0 ? 0 : 1;
      if (ca !== cb) return ca - cb;
      if (ca === 0 && na !== nb) return na - nb;
      return String(a.naam).localeCompare(String(b.naam), 'nl', { numeric: true });
    });
  }

  /* eenvoudige FNV-hash voor /ID in de trailer */
  function idHex(s) {
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < s.length; i++) {
      h1 = (h1 ^ s.charCodeAt(i)) >>> 0; h1 = (h1 * 0x01000193) >>> 0;
      h2 = (h2 + s.charCodeAt(i) * 31) >>> 0;
    }
    return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).repeat(2).slice(0, 32);
  }

  /* ============================== schrijver ============================== */

  function nieuwPdfDoc(meta) {
    const paginas = [];   /* {liggend, ops:[], fotos:Set<naam>} */
    const fotoObjs = [];  /* {naam, data, w, h, kleurruimte} per uniek beeld */
    const fotoIndex = new Map(); /* fotoId -> naam (dedupe: één XObject, meermaals getekend) */

    function pagB(p) { return p.liggend ? PDF_STAAND.h : PDF_STAAND.b; }
    function pagH(p) { return p.liggend ? PDF_STAAND.b : PDF_STAAND.h; }

    function nieuwePagina(liggend) {
      paginas.push({ liggend: !!liggend, ops: [], fotos: new Set() });
      return paginas[paginas.length - 1];
    }

    /* registreert de JPEG één keer; gooit bij progressive/exotische JPEG's */
    function registreerFoto(fotoId, bytes) {
      if (!fotoIndex.has(fotoId)) {
        const info = leesJpegInfo(bytes);
        const naam = 'Im' + (fotoObjs.length + 1);
        fotoObjs.push({ naam, data: bytes, w: info.breedte, h: info.hoogte, kleurruimte: info.kleurruimte });
        fotoIndex.set(fotoId, naam);
      }
      const naam = fotoIndex.get(fotoId);
      const f = fotoObjs.find(x => x.naam === naam);
      return { naam, w: f.w, h: f.h };
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

    /* serialiseren: array van Uint8Array-chunks met lopende byte-offset,
       op het einde één Blob — nooit één grote string, nooit base64 */
    function bouw() {
      const objs = [null]; /* index = objectnummer */
      const voeg = inhoud => { objs.push(inhoud); return objs.length - 1; };

      const catNr = voeg(null);   /* catalog (later) */
      const pagesNr = voeg(null); /* pages (later) */
      const f1 = voeg('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
      const f2 = voeg('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

      const nuDatum = new Date();
      const p2 = n => String(n).padStart(2, '0');
      const creatie = `D:${nuDatum.getFullYear()}${p2(nuDatum.getMonth() + 1)}${p2(nuDatum.getDate())}${p2(nuDatum.getHours())}${p2(nuDatum.getMinutes())}${p2(nuDatum.getSeconds())}`;
      const infoNr = voeg(
        `<< /Title (${pdfStr(meta.titel || '')}) /Producer (${pdfStr(meta.producer || '')}) /CreationDate (${creatie}) >>`);

      const fotoNrs = new Map();
      fotoObjs.forEach(f => {
        const nr = voeg({
          kop: `<< /Type /XObject /Subtype /Image /Width ${f.w} /Height ${f.h} /ColorSpace ${f.kleurruimte} /BitsPerComponent 8 /Filter /DCTDecode /Length ${f.data.length} >>`,
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

      const chunks = [pdfLatin1('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')];
      let offset = chunks[0].length;
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
        stuk.forEach(d => { chunks.push(d); offset += d.length; });
      }
      const xrefStart = offset;
      const id = idHex((meta.titel || '') + creatie + offset);
      let xref = `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
      for (let i = 1; i < objs.length; i++) xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
      xref += `trailer\n<< /Size ${objs.length} /Root ${catNr} 0 R /Info ${infoNr} 0 R /ID [<${id}> <${id}>] >>\nstartxref\n${xrefStart}\n%%EOF\n`;
      chunks.push(pdfLatin1(xref));
      return new Blob(chunks, { type: 'application/pdf' });
    }

    return { paginas, nieuwePagina, registreerFoto, tekst, lijn, rechthoek, foto, pagB, pagH, bouw };
  }

  /* ============================== opmaak van het dossier ============================== */

  /* woning: het woningrecord (§5); fotos: Map<fotoId, {bytes, breedte, hoogte,
     groep, volgorde}>; opties: {versie, voortgang(0..1)} */
  function bouwPdf(woning, fotos, opties) {
    const opt = opties || {};
    const meld = typeof opt.voortgang === 'function' ? opt.voortgang : () => { };
    const A = woning.algemeen || {};
    const E = woning.energie || { opwekkers: [], pvPanelen: [], zonneboiler: 'nee', zonneboilerM2: '' };
    const ruimtes = woning.ruimtes || [];
    const ruimteNaam = id => { const r = ruimtes.find(x => x.id === id); return r ? r.naam : ''; };
    const ruimteVanId = id => ruimtes.find(x => x.id === id) || null;

    const doc = nieuwPdfDoc({
      titel: A.adres || 'EPC Plaatsbezoek',
      producer: 'EPC Plaatsbezoek' + (opt.versie ? ' ' + opt.versie : '')
    });
    const M = PDF_MARGE;

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
              ? x + bs[i] - pad - tekstBreedte(r, size, vet)
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

    /* haalt bytes op uit de fotomap; dode verwijzing -> null (overslaan) */
    function fotoBytes(fotoId) {
      if (!fotoId || !fotos || !fotos.has(fotoId)) return null;
      return fotos.get(fotoId).bytes;
    }

    /* fotoraster: cellen van vaste hoogte, foto passend (contain) gecentreerd */
    function fotoRaster(items, perRij, celH, metCap) {
      const gap = 8;
      const celB = (binnenB() - (perRij - 1) * gap) / perRij;
      for (let i = 0; i < items.length; i += perRij) {
        const blok = items.slice(i, i + perRij);
        const capH = metCap ? 9 : 0;
        checkPagina(celH + capH + 6);
        for (let k = 0; k < blok.length; k++) {
          const f = blok[k];
          const reg = doc.registreerFoto(f.fotoId, f.bytes);
          const s = Math.min(celB / reg.w, celH / reg.h);
          const bw = reg.w * s, bh = reg.h * s;
          const x = M + k * (celB + gap) + (celB - bw) / 2;
          doc.foto(p, reg.naam, x, y + (celH - bh) / 2, bw, bh);
          if (metCap && f.cap) {
            const capregel = pdfWrap(f.cap, 6.5, false, celB)[0];
            doc.tekst(p, M + k * (celB + gap) + Math.max(0, (celB - tekstBreedte(capregel, 6.5, false)) / 2), y + celH + 1, capregel, 6.5, false, true);
          }
        }
        y += celH + capH + 4;
      }
    }

    meld(0.05);

    /* ---------- kop ---------- */
    let kopOnder = M;
    const hoofdBytes = fotoBytes(A.hoofdFotoId);
    if (hoofdBytes) {
      const reg = doc.registreerFoto(A.hoofdFotoId, hoofdBytes);
      const bw = 130, bh = Math.min(100, bw * reg.h / reg.w);
      const w = Math.min(bw, bh * reg.w / reg.h);
      doc.foto(p, reg.naam, M + binnenB() - bw + (bw - w) / 2, M, w, bh);
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
    const ramen = sorteerRamen(woning.ramen || []);
    if (ramen.length) {
      const totM2 = ramen.reduce((a, r) => a + r.b * r.h * raamAantal(r), 0);
      const totAantal = ramen.reduce((a, r) => a + raamAantal(r), 0);
      tabel(
        [{ kop: '#', b: 16 }, { kop: 'Type', b: 42 }, { kop: 'Ruimte', b: 62 }, { kop: 'Gevel', b: 36 },
        { kop: 'Aant.', b: 26, uitlijn: 'r' }, { kop: 'B (m)', b: 32, uitlijn: 'r' }, { kop: 'H (m)', b: 32, uitlijn: 'r' },
        { kop: 'm²', b: 32, uitlijn: 'r' }, { kop: 'Beglazing', b: 52 }, { kop: 'Kader', b: 34 }, { kop: 'Rolluik', b: 34 }],
        ramen.map((r, i) => [i + 1, ELEMENT_NAMEN[r.element] || r.element, ruimteNaam(r.ruimteId), GEVEL_NAMEN[r.gevel] || '',
        raamAantal(r), fmtM(r.b), fmtM(r.h), fmt(r.b * r.h * raamAantal(r)),
        GLAS_NAMEN[r.beglazing] || '', KADER_NAMEN[r.kader] || '', r.rolluik ? 'ja' : 'nee']),
        ['Totaal', '', '', '', totAantal, '', '', fmt(totM2), '', '', '']
      );
      fotoRaster(ramen.filter(r => fotoBytes(r.fotoId)).map(r => ({
        fotoId: r.fotoId,
        bytes: fotoBytes(r.fotoId),
        cap: `${ELEMENT_NAMEN[r.element] || r.element} ${(GEVEL_NAMEN[r.gevel] || '').toLowerCase()}${r.ruimteId ? ' – ' + ruimteNaam(r.ruimteId) : ''}, ${r.element === 'dakraam' ? 'kenplaatje' : 'afstandhouder'}`
      })), 4, 82, true);
    } else {
      kvRegel('Geen elementen opgemeten.', '');
    }
    meld(0.25);

    /* ---------- energie ---------- */
    sectieKop('Energie');
    if (E.opwekkers.length) {
      tabel(
        [{ kop: '#', b: 16 }, { kop: 'Opwekker', b: 60 }, { kop: 'Ruimte', b: 70 }, { kop: 'Doet', b: 110 }, { kop: 'Beschrijving', b: 200 }],
        E.opwekkers.map((o, i) => {
          const r = ruimteVanId(o.ruimteId);
          const vol = r && r.afm ? 'ruimte ' + afmTekst(r.afm) : '';
          return [i + 1, OPWEK_NAMEN[o.type] || o.type, ruimteNaam(o.ruimteId),
          (o.functie || []).map(f => FUNCTIE_NAMEN[f] || f).join(' + '),
          [o.beschrijving, vol].filter(Boolean).join(' – ')];
        })
      );
      const opwekFotos = [];
      E.opwekkers.forEach(o => {
        const naam = `${OPWEK_NAMEN[o.type] || o.type}${o.ruimteId ? ' – ' + ruimteNaam(o.ruimteId) : ''}`;
        if (fotoBytes(o.fotoId)) opwekFotos.push({ fotoId: o.fotoId, bytes: fotoBytes(o.fotoId), cap: `${naam}, kenplaat` });
        if (fotoBytes(o.fotoKraanId)) opwekFotos.push({ fotoId: o.fotoKraanId, bytes: fotoBytes(o.fotoKraanId), cap: `${naam}, radiatorkranen` });
      });
      fotoRaster(opwekFotos, 4, 82, true);
    } else {
      kvRegel('Geen opwekkers genoteerd.', '');
    }
    kvRegel('Zonnepanelen', E.pvPanelen.length
      ? E.pvPanelen.map(pv => `${PVOR_NAMEN[pv.orientatie] || '?'} ${pv.wp} Wp`).join(' · ')
      : '—');
    if (E.zonneboiler === 'ja') kvRegel('Zonneboiler', `ja${E.zonneboilerM2 ? ', ' + E.zonneboilerM2 + ' m²' : ''}`);
    meld(0.4);

    /* ---------- ventilatie ---------- */
    sectieKop('Ventilatie');
    tabel(
      [{ kop: 'Ruimte', b: 90 }, { kop: 'Ventilatie', b: 120 }, { kop: 'Afmetingen', b: 130 }, { kop: 'Opmerking', b: 175 }],
      sorteerVentilatie(ruimtes).map(r => [
        r.naam,
        (VENT_NAMEN[r.vent] || r.vent) + (r.vent === 'ander' && r.ventBeschrijving ? ` (${r.ventBeschrijving})` : ''),
        r.afm ? afmTekst(r.afm) : '',
        r.opm || ''])
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
    meld(0.5);

    /* ---------- fotodossier ----------
       dossier = foto's met groep gevels/algemeen/ruimteId (groep null hangt
       aan een element en staat al bij zijn sectie) */
    const dossier = [];
    if (fotos) fotos.forEach((f, id) => {
      if (f.groep === 'gevels' || f.groep === 'algemeen' || ruimtes.some(r => r.id === f.groep)) {
        dossier.push({ fotoId: id, bytes: f.bytes, groep: f.groep, volgorde: f.volgorde || 0 });
      }
    });
    if (dossier.length) {
      const groepOrde = new Map([['gevels', -1], ['algemeen', 999]]);
      ruimtes.forEach((r, i) => groepOrde.set(r.id, i));
      dossier.sort((a, b) => (groepOrde.get(a.groep) ?? 998) - (groepOrde.get(b.groep) ?? 998) || a.volgorde - b.volgorde);
      const groepNaam = g => g === 'gevels' ? 'Gevels' : g === 'algemeen' ? 'Algemeen' : ruimteNaam(g);

      const groepen = [];
      dossier.forEach(f => {
        if (!groepen.length || groepen[groepen.length - 1].groep !== f.groep) groepen.push({ groep: f.groep, fotos: [] });
        groepen[groepen.length - 1].fotos.push(f);
      });

      p = doc.nieuwePagina(false);
      y = M;
      doc.tekst(p, M, y, 'FOTODOSSIER', 12, true);
      y += 16;
      doc.tekst(p, M, y, `${A.adres || ''} · plaatsbezoek ${A.datum || ''} · ${dossier.length} foto's`, 8.5, false, true);
      y += 16;

      let klaarFotos = 0;
      for (const g of groepen) {
        if (g.groep === 'algemeen') {
          /* facturen: eigen liggende pagina's, 2 per pagina, paginavullend */
          for (let i = 0; i < g.fotos.length; i += 2) {
            p = doc.nieuwePagina(true);
            y = M;
            doc.tekst(p, M, y, 'ALGEMEEN', 10.5, true);
            y += 14;
            const blok = g.fotos.slice(i, i + 2);
            const celB = (binnenB() - 16) / 2;
            const celH = doc.pagH(p) - y - M - 14;
            for (let k = 0; k < blok.length; k++) {
              const reg = doc.registreerFoto(blok[k].fotoId, blok[k].bytes);
              const s = Math.min(celB / reg.w, celH / reg.h);
              doc.foto(p, reg.naam, M + k * (celB + 16) + (celB - reg.w * s) / 2, y + (celH - reg.h * s) / 2, reg.w * s, reg.h * s);
              klaarFotos++;
              meld(0.5 + 0.4 * klaarFotos / dossier.length);
            }
            y += celH;
          }
          p = doc.nieuwePagina(false);
          y = M;
        } else {
          /* titel nooit alleen onderaan: titel + eerste fotorij horen samen */
          checkPagina(14 + 100 + 6);
          doc.tekst(p, M, y, groepNaam(g.groep).toUpperCase(), 10.5, true);
          y += 14;
          fotoRaster(g.fotos, 4, 95, false);
          klaarFotos += g.fotos.length;
          meld(0.5 + 0.4 * klaarFotos / dossier.length);
        }
      }
      /* lege slotpagina vermijden */
      if (!doc.paginas[doc.paginas.length - 1].ops.length) doc.paginas.pop();
    }

    /* ---------- voetregel op elke pagina ---------- */
    const n = doc.paginas.length;
    doc.paginas.forEach((pag, i) => {
      const voet = `${A.adres || 'EPC'} · pagina ${i + 1}/${n}`;
      doc.tekst(pag, (doc.pagB(pag) - tekstBreedte(voet, 7, false)) / 2, doc.pagH(pag) - 22, voet, 7, false, true);
    });

    meld(0.95);
    const blob = doc.bouw();
    meld(1);
    return blob;
  }

  /* export: worker en app via globals, Node-tests via dezelfde globals */
  root.bouwPdf = bouwPdf;
  root.sorteerRamen = sorteerRamen;
  root.MAAKPDF = {
    bouwPdf, sorteerRamen, leesJpegInfo, tekstBreedte, pdfStr, pdfWrap,
    breedtes: { helvetica: HELV, helveticaVet: HELV_VET },
    namen: { ELEMENT_NAMEN, GEVEL_NAMEN, GLAS_NAMEN, KADER_NAMEN, OPWEK_NAMEN, FUNCTIE_NAMEN, PVOR_NAMEN, VENT_NAMEN }
  };

})(typeof self !== 'undefined' ? self : globalThis);
