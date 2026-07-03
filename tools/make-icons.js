'use strict';
// Genereert de PWA-iconen (icon-180/192/512.png) met enkel node builtins.
// Gebruik: node tools/make-icons.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---- minimale PNG-writer (RGBA, geen filter) ---- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function pngEncode(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bitdiepte
  ihdr[9] = 6;  // kleurtype RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---- tekenen ---- */

function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function makeIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const P = pts => pts.map(([x, y]) => [x * size, y * size]);

  const BG = [10, 107, 61];      // #0a6b3d
  const WIT = [255, 255, 255];
  const GEEL = [255, 205, 40];

  const dak = P([[0.50, 0.13], [0.12, 0.46], [0.88, 0.46]]);
  const romp = P([[0.20, 0.44], [0.80, 0.44], [0.80, 0.87], [0.20, 0.87]]);
  const bliksem = P([[0.56, 0.48], [0.40, 0.68], [0.49, 0.68], [0.44, 0.84], [0.62, 0.62], [0.52, 0.62]]);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5, py = y + 0.5;
      let c = BG;
      if (inPoly(px, py, romp) || inPoly(px, py, dak)) c = WIT;
      if (inPoly(px, py, bliksem)) c = GEEL;
      const o = (y * size + x) * 4;
      rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255;
    }
  }
  return pngEncode(size, rgba);
}

const root = path.join(__dirname, '..');
for (const size of [180, 192, 512]) {
  fs.writeFileSync(path.join(root, `icon-${size}.png`), makeIcon(size));
  console.log(`icon-${size}.png geschreven`);
}
