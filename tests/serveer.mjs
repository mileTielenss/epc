/* Minimale statische server voor de app tijdens de tests (geen dependencies). */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.md': 'text/plain'
};

export function serveer(poort) {
  return new Promise(res => {
    const server = createServer(async (req, antw) => {
      try {
        let pad = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (pad.endsWith('/')) pad += 'index.html';
        const bestand = normalize(join(REPO, pad));
        if (!bestand.startsWith(REPO)) throw new Error('buiten repo');
        const data = await readFile(bestand);
        const ext = bestand.slice(bestand.lastIndexOf('.'));
        antw.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream' });
        antw.end(data);
      } catch (e) {
        antw.writeHead(404);
        antw.end('niet gevonden');
      }
    });
    server.listen(poort, '127.0.0.1', () => res(server));
  });
}
