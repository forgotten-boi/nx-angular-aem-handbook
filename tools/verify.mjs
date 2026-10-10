/**
 * Verification, not vibes.
 *
 *   node tools/verify.mjs
 *
 * Boots the real static server, drives a real Chromium at phone size and
 * asserts the things that actually broke while this was being built.
 * Writes screenshots to screenshots/. Exits non-zero on any failure.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SHOTS = resolve(ROOT, 'screenshots');
const PORT = Number(process.env.VERIFY_PORT || 4178);
const BASE = `http://127.0.0.1:${PORT}`;
const PINNED = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

const results = [];
let failures = 0;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${name}${detail ? '  ::  ' + detail : ''}`);
}

/* ---------------------------------------------------------------
   1. Structural checks on the file itself, before any browser.
   --------------------------------------------------------------- */
const html = await readFile(resolve(ROOT, 'www/index.html'), 'utf8');

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
  'meta', 'param', 'source', 'track', 'wbr', 'path', 'circle', 'rect',
  'line', 'polygon', 'polyline', 'ellipse', 'use', 'stop', 'image',
]);

function balance(src) {
  // Strip the parts that legitimately contain angle brackets as text.
  const stripped = src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '<script></script>')
    .replace(/<style[\s\S]*?<\/style>/gi, '<style></style>')
    .replace(/<pre[\s\S]*?<\/pre>/gi, '<pre></pre>');

  const stack = [];
  const problems = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(stripped)) !== null) {
    const [, closing, rawName, attrs, selfClose] = m;
    const name = rawName.toLowerCase();
    if (name === '!doctype') continue;
    if (VOID.has(name) || selfClose === '/') continue;
    if (closing) {
      if (!stack.length) { problems.push(`stray </${name}>`); continue; }
      const open = stack.pop();
      if (open !== name) problems.push(`</${name}> closes <${open}>`);
    } else {
      stack.push(name);
    }
    void attrs;
  }
  while (stack.length) problems.push(`unclosed <${stack.pop()}>`);
  return problems;
}

const problems = balance(html);
check('HTML tags balanced', problems.length === 0, problems.slice(0, 6).join(' | '));

const articleOpen = (html.match(/<article\b/g) || []).length;
const articleClose = (html.match(/<\/article>/g) || []).length;
check('25 articles in source', articleOpen === 25 && articleClose === 25,
  `open=${articleOpen} close=${articleClose}`);

check('no external subresources', !/(src|href)\s*=\s*["'](https?:)?\/\//i.test(
  html.replace(/<pre[\s\S]*?<\/pre>/gi, '').replace(/<!--[\s\S]*?-->/g, '')),
  'ignoring code samples and comments');

/* ---------------------------------------------------------------
   2. Independent recomputation of the affected closure.
   --------------------------------------------------------------- */
{
  const deps = {
    'shared-util-format': [], 'shared-ui': ['shared-util-format'],
    'shared-data-access-aem': ['shared-util-format'],
    'checkout-feature-cart': ['shared-ui', 'shared-data-access-aem'],
    'account-feature-profile': ['shared-ui', 'shared-data-access-aem'],
    'site': ['checkout-feature-cart', 'account-feature-profile', 'shared-ui'],
    'portal': ['account-feature-profile', 'shared-ui'],
    'api': ['shared-data-access-aem', 'shared-util-format'],
  };
  const names = Object.keys(deps);
  const reaches = (from, target, seen = new Set()) => {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return deps[from].some((d) => reaches(d, target, seen));
  };
  const expected = Object.fromEntries(
    names.map((n) => [n, names.filter((c) => reaches(c, n)).sort()]),
  );
  await writeFile(resolve(SHOTS, '..', 'tools/.expected-closure.json'),
    JSON.stringify(expected, null, 2), 'utf8').catch(() => {});
  globalThis.__expectedClosure = expected;
  check('closure sizes as designed',
    expected['shared-util-format'].length === 8 &&
    expected['shared-ui'].length === 5 &&
    expected['shared-data-access-aem'].length === 6 &&
    expected['checkout-feature-cart'].length === 2 &&
    expected['account-feature-profile'].length === 3 &&
    expected['site'].length === 1 &&
    expected['portal'].length === 1 &&
    expected['api'].length === 1,
    'util=8 ui=5 daa=6 cart=2 profile=3 site=1 portal=1 api=1');
}

/* ---------------------------------------------------------------
   3. Boot the server.
   --------------------------------------------------------------- */
await mkdir(SHOTS, { recursive: true });

const server = spawn(process.execPath, [resolve(HERE, 'serve.mjs')], {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((ok, bad) => {
  const t = setTimeout(() => bad(new Error('server did not start')), 10000);
  server.stdout.on('data', (d) => {
    if (String(d).includes('http://')) { clearTimeout(t); ok(); }
  });
  server.on('error', bad);
});

const browser = await chromium.launch(
  existsSync(PINNED) ? { executablePath: PINNED } : {},
);

try {
  /* -------------------------------------------------------------
     4. Phone-sized render: console errors and failed requests.
     ------------------------------------------------------------- */
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    serviceWorkers: 'allow',
  });
  const page = await ctx.newPage();

  const consoleErrors = [];
  const failedRequests = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => failedRequests.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) failedRequests.push(`${r.url()} ${r.status()}`); });

  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(600);

  check('no console errors at 390x844', consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join(' | '));
  check('no failed requests', failedRequests.length === 0,
    failedRequests.slice(0, 3).join(' | '));

  const articleCount = await page.locator('main > article.ch').count();
  check('25 articles in the DOM', articleCount === 25, `found ${articleCount}`);

  /* -------------------------------------------------------------
     5. Trap 2: fresh load must sit at scroll 0 with the title
        clear of the sticky bar.
     ------------------------------------------------------------- */
  const geom = await page.evaluate(() => {
    const bar = document.querySelector('.topbar');
    const h1 = document.querySelector('#cover h1');
    return {
      scrollY: window.scrollY,
      barBottom: bar.getBoundingClientRect().bottom,
      h1Top: h1.getBoundingClientRect().top,
      scrollMargin: getComputedStyle(document.querySelector('#cover')).scrollMarginTop,
    };
  });
  check('fresh load is at scrollY 0', geom.scrollY === 0, `scrollY=${geom.scrollY}`);
  check('title page clear of the sticky bar', geom.h1Top >= geom.barBottom,
    `h1Top=${geom.h1Top.toFixed(1)} barBottom=${geom.barBottom.toFixed(1)}`);
  check('scroll-margin-top guard present on chapters',
    parseFloat(geom.scrollMargin) > 500, `scroll-margin-top=${geom.scrollMargin}`);

  await page.screenshot({ path: resolve(SHOTS, '01-cover-day-390.png') });

  /* -------------------------------------------------------------
     6. Deep link.
     ------------------------------------------------------------- */
  const deep = await ctx.newPage();
  const deepErrors = [];
  deep.on('pageerror', (e) => deepErrors.push(e.message));
  await deep.goto(BASE + '/index.html#ch14', { waitUntil: 'load' });
  await deep.waitForTimeout(900);
  const deepState = await deep.evaluate(() => {
    const on = document.querySelector('main > article.ch.is-on');
    const bar = document.querySelector('.topbar').getBoundingClientRect().bottom;
    const num = on ? on.querySelector('.numeral') : null;
    return {
      id: on ? on.id : null,
      scrollY: window.scrollY,
      numTop: num ? num.getBoundingClientRect().top : -1,
      barBottom: bar,
      runhead: document.getElementById('runhead').textContent.trim(),
    };
  });
  check('#ch14 opens chapter 14', deepState.id === 'ch14', `on=${deepState.id}`);
  check('#ch14 lands at scrollY 0', deepState.scrollY === 0, `scrollY=${deepState.scrollY}`);
  check('#ch14 numeral clear of the sticky bar', deepState.numTop >= deepState.barBottom,
    `numTop=${deepState.numTop.toFixed(1)} barBottom=${deepState.barBottom.toFixed(1)}`);
  check('running head follows the chapter',
    /Where the workspace lives/.test(deepState.runhead), deepState.runhead);
  check('deep link raises no page errors', deepErrors.length === 0, deepErrors.join(' | '));
  await deep.screenshot({ path: resolve(SHOTS, '02-ch14-deeplink-390.png') });
  await deep.close();

  /* -------------------------------------------------------------
     7. Affected simulator, driven through the UI.
     ------------------------------------------------------------- */
  await page.goto(BASE + '/index.html#ch2', { waitUntil: 'load' });
  await page.waitForTimeout(500);

  const expected = globalThis.__expectedClosure;
  let simOk = true;
  const simDetail = [];
  for (const name of Object.keys(expected)) {
    await page.locator(`#sim .node[data-p="${name}"]`).click();
    await page.waitForTimeout(120);
    const got = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#sim-out .chips li'))
        .map((li) => li.textContent.trim()).sort());
    const want = expected[name];
    const same = JSON.stringify(got) === JSON.stringify(want);
    if (!same) { simOk = false; simDetail.push(`${name}: got ${got.length} want ${want.length}`); }
    await page.locator(`#sim .node[data-p="${name}"]`).click();
    await page.waitForTimeout(60);
  }
  check('affected simulator matches the independent closure', simOk, simDetail.join(' | '));

  await page.locator('#sim .node[data-p="shared-util-format"]').click();
  await page.waitForTimeout(200);
  const fanout = await page.locator('#sim-out .sim-count').textContent();
  check('touching shared-util-format rebuilds everything', /8 of 8/.test(fanout), fanout);
  await page.locator('#sim').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(SHOTS, '03-affected-simulator-390.png') });

  /* -------------------------------------------------------------
     8. Pattern chooser reaches all four verdicts.
     ------------------------------------------------------------- */
  await page.goto(BASE + '/index.html#ch9', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  const paths = [[0, 0], [0, 1, 0], [1, 1], [1, 0, 0]];
  const verdicts = [];
  for (const path of paths) {
    await page.evaluate(() => {
      const again = document.querySelector('#chooser-body [data-restart]');
      if (again) again.click();
    });
    await page.waitForTimeout(120);
    for (const i of path) {
      await page.locator(`#chooser-body .choice`).nth(i).click();
      await page.waitForTimeout(120);
    }
    verdicts.push(await page.evaluate(() => {
      const h = document.querySelector('#chooser-body .verdict h4');
      return h ? h.textContent.trim() : null;
    }));
  }
  check('chooser reaches all four patterns',
    new Set(verdicts.filter(Boolean)).size === 4, verdicts.join(' / '));
  await page.locator('#chooser').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await page.screenshot({ path: resolve(SHOTS, '04-pattern-chooser-390.png') });

  /* -------------------------------------------------------------
     9. Night mode, including code blocks and quizzes.
     ------------------------------------------------------------- */
  await page.goto(BASE + '/index.html#ch11', { waitUntil: 'load' });
  await page.waitForTimeout(300);
  await page.locator('#btn-theme').click();
  await page.waitForTimeout(300);
  await page.locator('#ch11 [data-quiz] .opt').first().click();
  await page.waitForTimeout(250);

  const night = await page.evaluate(() => {
    const rgb = (s) => (s.match(/\d+/g) || []).map(Number);
    const lum = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    const code = document.querySelector('#ch11 figure.code pre code');
    const codeBg = getComputedStyle(document.querySelector('#ch11 figure.code')).backgroundColor;
    const quiz = document.querySelector('#ch11 [data-quiz]');
    const why = quiz.querySelector('.why');
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      bodyLum: lum(rgb(bodyBg)),
      codeInkLum: lum(rgb(getComputedStyle(code).color)),
      codeBgLum: lum(rgb(codeBg)),
      quizAnswered: quiz.classList.contains('answered'),
      whyVisible: getComputedStyle(why).display !== 'none',
      themeColorMeta: (document.querySelector('meta[name="theme-color"]') || {}).content,
    };
  });
  check('night mode is applied', night.theme === 'night', night.theme);
  check('night page is dark', night.bodyLum < 0.2, `bodyLum=${night.bodyLum.toFixed(3)}`);
  check('night code block is dark with light ink',
    night.codeBgLum < 0.2 && night.codeInkLum > 0.5,
    `bg=${night.codeBgLum.toFixed(3)} ink=${night.codeInkLum.toFixed(3)}`);
  check('code ink contrasts with code background',
    Math.abs(night.codeInkLum - night.codeBgLum) > 0.4, 'luminance delta');
  check('quiz reveals explanations when answered',
    night.quizAnswered && night.whyVisible, `answered=${night.quizAnswered}`);
  check('theme-color meta follows the toggle', night.themeColorMeta === '#16181A',
    String(night.themeColorMeta));
  await page.screenshot({ path: resolve(SHOTS, '05-ch11-night-390.png') });

  /* -------------------------------------------------------------
     10. Drawer, search and keyboard.
     ------------------------------------------------------------- */
  await page.keyboard.press('/');
  await page.waitForTimeout(400);
  await page.locator('#search').fill('dispatcher');
  await page.waitForTimeout(250);
  const searchHits = await page.locator('#toc .toc-a:not([hidden])').count();
  check('search filters the contents', searchHits > 0 && searchHits < 25, `${searchHits} of 25`);
  await page.screenshot({ path: resolve(SHOTS, '06-search-night-390.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
  const drawerShut = await page.evaluate(() => !document.body.classList.contains('nav-open'));
  check('Escape closes the drawer', drawerShut);

  /* -------------------------------------------------------------
     11. Persistence: night mode plus a chapter marked read.
     ------------------------------------------------------------- */
  await page.evaluate(() => { document.querySelector('#ch11 [data-read-for]').click(); });
  await page.waitForTimeout(200);
  const beforeReload = await page.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    stored: window.localStorage.getItem('mm.handbook.read'),
  }));
  check('read set persists as a real array, not []',
    beforeReload.stored === '["ch11"]', String(beforeReload.stored));

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(600);
  const afterReload = await page.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    marked: document.querySelector('#ch11 [data-read-for]').getAttribute('aria-pressed'),
    readout: document.getElementById('readout').textContent,
  }));
  check('night mode survives reload', afterReload.theme === 'night', afterReload.theme);
  check('marked-as-read survives reload', afterReload.marked === 'true',
    afterReload.readout.trim());

  /* -------------------------------------------------------------
     12. Service worker reaches active.
     ------------------------------------------------------------- */
  const swState = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'unsupported';
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return 'none';
    for (let i = 0; i < 60; i++) {
      if (reg.active && reg.active.state === 'activated') return 'activated';
      await new Promise((r) => setTimeout(r, 200));
      await navigator.serviceWorker.getRegistration();
    }
    return reg.active ? reg.active.state : 'pending';
  });
  check('service worker reaches active', swState === 'activated', swState);

  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    if (!names.length) return { names, keys: [] };
    const c = await caches.open(names[0]);
    return { names, keys: (await c.keys()).map((r) => new URL(r.url).pathname).sort() };
  });
  check('precache populated', cached.keys.length >= 6,
    `${cached.names.join(',')} :: ${cached.keys.length} entries`);

  /* -------------------------------------------------------------
     13. Offline.
     ------------------------------------------------------------- */
  await ctx.setOffline(true);
  const offlineFailures = [];
  page.on('requestfailed', (r) => offlineFailures.push(r.url()));
  await page.reload({ waitUntil: 'load' }).catch(() => {});
  await page.waitForTimeout(1200);

  const offline = await page.evaluate(async () => {
    const iconOk = await fetch('icons/icon-192.png')
      .then((r) => r.ok && r.headers.get('content-type') === 'image/png')
      .catch(() => false);
    const manifestOk = await fetch('manifest.webmanifest').then((r) => r.ok).catch(() => false);
    return {
      articles: document.querySelectorAll('main > article.ch').length,
      onChapter: (document.querySelector('main > article.ch.is-on') || {}).id,
      title: document.title,
      iconOk,
      manifestOk,
      online: navigator.onLine,
    };
  });
  check('book opens offline', offline.articles === 25 && /Monorepo/.test(offline.title),
    `articles=${offline.articles} chapter=${offline.onChapter} online=${offline.online}`);
  check('icons resolve offline', offline.iconOk === true, `iconOk=${offline.iconOk}`);
  check('manifest resolves offline', offline.manifestOk === true, `manifestOk=${offline.manifestOk}`);
  await page.screenshot({ path: resolve(SHOTS, '07-offline-night-390.png') });
  await ctx.setOffline(false);
  await ctx.close();

  /* -------------------------------------------------------------
     14. Desktop render, day mode, margin notes in the rail.
     ------------------------------------------------------------- */
  const wide = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const wp = await wide.newPage();
  const wideErrors = [];
  wp.on('pageerror', (e) => wideErrors.push(e.message));
  await wp.goto(BASE + '/index.html#ch2', { waitUntil: 'load' });
  await wp.waitForTimeout(600);
  const rail = await wp.evaluate(() => {
    const note = document.querySelector('#ch2 .note');
    const p = document.querySelector('#ch2 .lede');
    if (!note || !p) return null;
    const n = note.getBoundingClientRect();
    const t = p.getBoundingClientRect();
    return { noteLeft: n.left, textRight: t.right, noteWidth: n.width, float: getComputedStyle(note).float };
  });
  check('margin notes float into the rail above 1180px',
    !!rail && rail.float === 'right' && rail.noteLeft >= rail.textRight - 2,
    rail ? `noteLeft=${rail.noteLeft.toFixed(0)} textRight=${rail.textRight.toFixed(0)} w=${rail.noteWidth.toFixed(0)}` : 'no note');
  check('desktop render raises no page errors', wideErrors.length === 0, wideErrors.join(' | '));
  await wp.screenshot({ path: resolve(SHOTS, '08-ch2-desktop-day-1440.png') });

  await wp.goto(BASE + '/index.html#ch12', { waitUntil: 'load' });
  await wp.waitForTimeout(400);
  await wp.screenshot({ path: resolve(SHOTS, '09-ch12-desktop-day-1440.png'), fullPage: false });
  await wide.close();

  /* -------------------------------------------------------------
     15. Trap 4: no SVG in a hidden chapter references a marker
         defined in a different chapter.
     ------------------------------------------------------------- */
  const markers = await browser.newContext({ viewport: { width: 900, height: 700 } });
  const mp = await markers.newPage();
  await mp.goto(BASE + '/index.html', { waitUntil: 'load' });
  const markerReport = await mp.evaluate(() => {
    const bad = [];
    document.querySelectorAll('svg').forEach((svg) => {
      const owner = svg.closest('article.ch');
      const defined = new Set(
        Array.from(svg.querySelectorAll('defs marker')).map((m) => m.id),
      );
      svg.querySelectorAll('[marker-end],[marker-start],[marker-mid]').forEach((el) => {
        ['marker-end', 'marker-start', 'marker-mid'].forEach((attr) => {
          const v = el.getAttribute(attr);
          if (!v) return;
          const id = (v.match(/url\(#([^)]+)\)/) || [])[1];
          if (!id) return;
          if (!defined.has(id)) bad.push(`${owner ? owner.id : '?'} -> #${id}`);
        });
      });
      // Also check CSS-declared markers on the group elements.
      svg.querySelectorAll('g[marker-end]').forEach((g) => {
        const id = (String(g.getAttribute('marker-end')).match(/url\(#([^)]+)\)/) || [])[1];
        if (id && !defined.has(id)) bad.push(`${owner ? owner.id : '?'} -> #${id}`);
      });
    });
    return Array.from(new Set(bad));
  });
  check('every figure defines the markers it uses', markerReport.length === 0,
    markerReport.slice(0, 4).join(' | '));
  await markers.close();

  /* -------------------------------------------------------------
     16. Capacitor: the book renders but must NOT register a worker.
         Android uses androidScheme https, so location.protocol is
         https: there and the only reliable signal is the injected
         Capacitor global. Both signals are tested.
     ------------------------------------------------------------- */
  for (const shim of [
    { name: 'isNativePlatform()', init: 'window.Capacitor = { isNativePlatform: () => true };' },
    { name: 'isNative flag', init: 'window.Capacitor = { isNative: true };' },
  ]) {
    const capCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      serviceWorkers: 'allow',
    });
    await capCtx.addInitScript(shim.init);
    const cp = await capCtx.newPage();
    const capErrors = [];
    cp.on('pageerror', (e) => capErrors.push(e.message));
    await cp.goto(BASE + '/index.html', { waitUntil: 'load' });
    await cp.waitForTimeout(1200);
    const capState = await cp.evaluate(async () => ({
      articles: document.querySelectorAll('main > article.ch').length,
      regs: (await navigator.serviceWorker.getRegistrations()).length,
    }));
    check(`Capacitor (${shim.name}): book renders`, capState.articles === 25,
      `articles=${capState.articles}`);
    check(`Capacitor (${shim.name}): no service worker registered`, capState.regs === 0,
      `registrations=${capState.regs}`);
    check(`Capacitor (${shim.name}): no page errors`, capErrors.length === 0,
      capErrors.slice(0, 2).join(' | '));
    await capCtx.close();
  }

  /* -------------------------------------------------------------
     16. file:// still renders the book (minus the worker).
     ------------------------------------------------------------- */
  const fileCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const fp = await fileCtx.newPage();
  const fileErrors = [];
  fp.on('pageerror', (e) => fileErrors.push(e.message));
  await fp.goto('file://' + resolve(ROOT, 'www/index.html'), { waitUntil: 'load' });
  await fp.waitForTimeout(600);
  const fileState = await fp.evaluate(() => ({
    articles: document.querySelectorAll('main > article.ch').length,
    on: (document.querySelector('main > article.ch.is-on') || {}).id,
    sw: 'serviceWorker' in navigator
      ? navigator.serviceWorker.controller !== null
      : false,
  }));
  check('opens from file:// with 25 articles', fileState.articles === 25, `on=${fileState.on}`);
  check('no service worker registered on file://', fileState.sw === false);
  check('file:// raises no page errors', fileErrors.length === 0, fileErrors.slice(0, 2).join(' | '));
  await fileCtx.close();
} finally {
  await browser.close();
  server.kill();
}

console.log('\n' + '-'.repeat(64));
console.log(`${results.length - failures} passed, ${failures} failed`);
console.log(`screenshots in ${SHOTS}`);
if (failures) process.exit(1);
