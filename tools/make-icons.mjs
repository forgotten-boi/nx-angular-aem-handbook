/**
 * Generates the PWA icon set from an inline SVG, rendered through the
 * Chromium that Playwright already provides. No placeholders, no binary
 * assets checked in that nobody can regenerate.
 *
 *   node tools/make-icons.mjs
 *
 * Design: two-ink on a teal field. A dependency fan with the touched node
 * in ochre and its transitive dependents in paper, which is the picture
 * chapter 2 spends a whole widget making.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../www/icons');

const INK = {
  teal: '#1C4E5C',
  tealDeep: '#143B46',
  ochre: '#CFA845',
  paper: '#E9EAE3',
  rule: '#7FB9C9',
};

/**
 * @param {number} inset  fraction of the canvas kept clear on every side.
 *                        0 for a full-bleed square, 0.10 for maskable
 *                        (art inside the middle 80%).
 * @param {boolean} rounded  draw a rounded plate instead of full bleed.
 */
function svg(inset, rounded) {
  // Art coordinate space is 0..100; map it into the safe box.
  const size = 100 - inset * 200;
  const off = inset * 100;
  const m = (x) => (off + (x / 100) * size).toFixed(3);

  const node = (x, y, r, fill, extra = '') =>
    `<circle cx="${m(x)}" cy="${m(y)}" r="${((r / 100) * size).toFixed(3)}" fill="${fill}" ${extra}/>`;

  const edge = (x1, y1, x2, y2, op) =>
    `<line x1="${m(x1)}" y1="${m(y1)}" x2="${m(x2)}" y2="${m(y2)}" ` +
    `stroke="${INK.rule}" stroke-opacity="${op}" stroke-width="${((2.6 / 100) * size).toFixed(3)}" stroke-linecap="round"/>`;

  const plate =
    rounded === 'none'
      ? ''
      : rounded === 'circle'
        ? `<circle cx="50" cy="50" r="50" fill="${INK.teal}"/>`
        : rounded
          ? `<rect x="3" y="3" width="94" height="94" rx="21" fill="${INK.teal}"/>
             <rect x="3" y="3" width="94" height="94" rx="21" fill="none"
                   stroke="${INK.tealDeep}" stroke-width="1.6"/>`
          : `<rect x="0" y="0" width="100" height="100" fill="${INK.teal}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  ${plate}

  <!-- edges first, so nodes sit on top -->
  ${edge(50, 20, 29, 50, 0.85)}
  ${edge(50, 20, 71, 50, 0.85)}
  ${edge(29, 50, 16, 79, 0.5)}
  ${edge(29, 50, 42, 79, 0.5)}
  ${edge(71, 50, 58, 79, 0.5)}
  ${edge(71, 50, 84, 79, 0.5)}

  <!-- the touched node -->
  ${node(50, 20, 10.5, INK.ochre)}

  <!-- direct dependents -->
  ${node(29, 50, 8, INK.paper)}
  ${node(71, 50, 8, INK.paper)}

  <!-- transitive dependents -->
  ${node(16, 79, 6.4, INK.paper, 'fill-opacity="0.82"')}
  ${node(42, 79, 6.4, INK.paper, 'fill-opacity="0.82"')}
  ${node(58, 79, 6.4, INK.paper, 'fill-opacity="0.82"')}
  ${node(84, 79, 6.4, INK.paper, 'fill-opacity="0.82"')}
</svg>`;
}

const TARGETS = [
  { file: 'icon-192.png', size: 192, inset: 0.07, rounded: true },
  { file: 'icon-512.png', size: 512, inset: 0.07, rounded: true },
  // Maskable: every pixel outside the middle 80% may be cropped away by
  // the launcher, so all art has to live inside it and the field bleeds.
  { file: 'icon-maskable-512.png', size: 512, inset: 0.10, rounded: false },
];

await mkdir(OUT, { recursive: true });

// This image pre-installs a Chromium that may not match the version the
// installed Playwright expects. Use it when it is there rather than
// downloading a second copy.
const PINNED = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const launchOpts = existsSync(PINNED) ? { executablePath: PINNED } : {};

const browser = await chromium.launch(launchOpts);
try {
  for (const t of TARGETS) {
    const page = await browser.newPage({
      viewport: { width: t.size, height: t.size },
      deviceScaleFactor: 1,
    });
    const markup = svg(t.inset, t.rounded);
    await page.setContent(
      `<style>html,body{margin:0;padding:0;background:transparent}
       svg{display:block;width:${t.size}px;height:${t.size}px}</style>${markup}`,
      { waitUntil: 'load' },
    );
    await page.screenshot({ path: resolve(OUT, t.file), omitBackground: false });
    await page.close();
    console.log(`wrote icons/${t.file}  ${t.size}x${t.size}`);
  }

  // Keep the source next to the output so it can be regenerated or edited.
  const { writeFile } = await import('node:fs/promises');
  await writeFile(resolve(OUT, 'icon.svg'), svg(0.07, true), 'utf8');
  console.log('wrote icons/icon.svg (source)');

  /* -------------------------------------------------------------------
     Native launcher icons.
     Skipped silently when the Capacitor platforms are not present, so
     this script stays runnable in a checkout without them.
     ------------------------------------------------------------------- */
  const ANDROID_RES = resolve(HERE, '../android/app/src/main/res');
  const IOS_ICONS = resolve(
    HERE,
    '../ios/App/App/Assets.xcassets/AppIcon.appiconset',
  );

  async function shoot(file, px, inset, rounded) {
    const page = await browser.newPage({
      viewport: { width: px, height: px },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<style>html,body{margin:0;padding:0;background:transparent}
       svg{display:block;width:${px}px;height:${px}px}</style>${svg(inset, rounded)}`,
      { waitUntil: 'load' },
    );
    await page.screenshot({ path: file, omitBackground: rounded === 'none' });
    await page.close();
  }

  if (existsSync(ANDROID_RES)) {
    // An adaptive icon's foreground is a 108dp canvas whose visible safe
    // zone is only the middle 72dp. 0.18 inset keeps the art inside it,
    // so nothing is clipped by a circular or squircle launcher mask.
    const DENSITIES = [
      ['mdpi', 48, 108],
      ['hdpi', 72, 162],
      ['xhdpi', 96, 216],
      ['xxhdpi', 144, 324],
      ['xxxhdpi', 192, 432],
    ];
    for (const [density, legacy, foreground] of DENSITIES) {
      const dir = resolve(ANDROID_RES, `mipmap-${density}`);
      await mkdir(dir, { recursive: true });
      await shoot(resolve(dir, 'ic_launcher.png'), legacy, 0.07, true);
      await shoot(resolve(dir, 'ic_launcher_round.png'), legacy, 0.07, 'circle');
      await shoot(resolve(dir, 'ic_launcher_foreground.png'), foreground, 0.18, 'none');
    }
    // The adaptive icon XML references this colour as its background.
    await writeFile(
      resolve(ANDROID_RES, 'values/ic_launcher_background.xml'),
      `<?xml version="1.0" encoding="utf-8"?>\n` +
        `<resources>\n` +
        `    <color name="ic_launcher_background">${INK.teal}</color>\n` +
        `</resources>\n`,
      'utf8',
    );
    console.log(`wrote android launcher icons for ${DENSITIES.length} densities`);
  }

  if (existsSync(IOS_ICONS)) {
    // iOS wants one 1024 square with no transparency and no rounding:
    // the system applies the mask itself.
    await shoot(resolve(IOS_ICONS, 'AppIcon-512@2x.png'), 1024, 0.10, false);
    console.log('wrote ios AppIcon-512@2x.png');
  }
} finally {
  await browser.close();
}
