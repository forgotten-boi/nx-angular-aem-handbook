/**
 * A static server for www/, with no dependencies.
 *
 *   npm start                 -> http://localhost:4173
 *   PORT=8080 npm start
 *
 * Serves the correct content types for .webmanifest and for the service
 * worker, and sends no-store for sw.js so a refresh always picks up a
 * new worker during development.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../www');
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';

    // Contain the served path inside ROOT.
    const target = normalize(join(ROOT, pathname));
    if (target !== ROOT && !target.startsWith(ROOT + sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    const info = await stat(target).catch(() => null);
    if (!info || !info.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }

    const ext = extname(target).toLowerCase();
    const headers = { 'content-type': TYPES[ext] ?? 'application/octet-stream' };

    // Never let a stale worker or shell hang around in development.
    if (target.endsWith('sw.js') || ext === '.html') {
      headers['cache-control'] = 'no-store';
    } else {
      headers['cache-control'] = 'no-cache';
    }
    if (target.endsWith('sw.js')) headers['service-worker-allowed'] = '/';

    res.writeHead(200, headers).end(await readFile(target));
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain' }).end(String(err));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`The Monorepo and the Machine -> http://${HOST}:${PORT}`);
  console.log(`serving ${ROOT}`);
});
