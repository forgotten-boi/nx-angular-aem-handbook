/**
 * Bumps the CACHE constant in www/sw.js.
 *
 * The book is one HTML file with no content hash in its name, so the
 * cache name is the only thing that invalidates an installed copy.
 * Forgetting to bump it means shipping an update nobody sees, so it is
 * wired into `npm run cap:sync` rather than left to memory.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SW = resolve(dirname(fileURLToPath(import.meta.url)), '../www/sw.js');
const src = await readFile(SW, 'utf8');

const re = /const CACHE = 'mm-handbook-v(\d+)';/;
const m = src.match(re);
if (!m) {
  console.error('tools/bump-cache.mjs: could not find the CACHE constant in www/sw.js');
  process.exit(1);
}

const next = Number(m[1]) + 1;
await writeFile(SW, src.replace(re, `const CACHE = 'mm-handbook-v${next}';`), 'utf8');
console.log(`sw.js: CACHE mm-handbook-v${m[1]} -> mm-handbook-v${next}`);
