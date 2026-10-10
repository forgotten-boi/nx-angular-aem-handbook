# The Monorepo and the Machine

A working handbook on Nx monorepos, Angular, and getting front-end code to
actually live inside Adobe Experience Manager. Plus a bonus part on the AWS
that ends up sitting next to it.

Twenty-one chapters, three appendices, eighty-odd code samples, two
interactive widgets. One HTML file. It installs as a PWA, works offline, and
builds as a Capacitor app for Android and iOS from the same `www/` directory
that GitHub Pages serves.

Written for engineers who have to ship this, not evaluate it.

---

## Contents

**Part I, the workspace.** Why a monorepo and why Nx. The Nx mental model
(with a live affected simulator). Standing up the workspace. Slicing into
libraries. Enforcing the boundaries. Angular inside the workspace. Tests,
lint and the CI pipeline.

**Part II, into AEM.** AEM for front-end engineers. Four ways in, and how to
choose (with a decision-tree chooser). Client libraries. Islands as custom
elements. Headless and the Universal Editor. The SPA Editor you inherited.
Where the workspace lives. Caching, the dispatcher and performance.
Deploying. Multi-brand, multi-locale, multi-team. A field guide to things
that break.

**Part III, bonus: AWS.** Why AWS sits beside AEM. Data, storage and the
services you actually need. Building and shipping it from one workspace.

**Back matter.** A command cheat sheet, a glossary, and a list of primary
sources.

---

## Version facts are checked, not recalled

Everything version-sensitive in the book was verified against a primary
source on **10 September 2026** before it was written, and the chapters say
so in place. `RESEARCH.md` records what was checked, how, and what had moved.

The headlines:

| Claim | Status |
|---|---|
| `nx` and `@nx/angular` | 23.2.1 |
| `@angular/core` | 22.1.6 |
| Angular 22.0 support | starts at Nx **23.1.0** |
| Angular 22.1 support | starts at Nx **23.2.0** |
| `provideZonelessChangeDetection()` | stable, `@publicApi 20.2`; no `Experimental` prefix any more |
| AEM SPA Editor | deprecated; Adobe's 6.5 deprecation page says 6.5.23, the 6.5 release notes say 6.5.25, and both are current. Cloud Service: release 2025.01 |
| SPA Editor migration path | none. Adobe states this directly |
| `@adobe/universal-editor-cors` npm package | **deprecated by Adobe**; use the hosted `cors.js` instead |
| `nrwl/nx-set-shas` | **v5**, not the v4 most tutorials pin |

The Universal Editor contract in chapter 12 (`urn:adobe:aue:` URN prefix, the
`data-aue-` attribute prefix, the nine attribute suffixes, the nine `aue:`
events) was read out of Adobe's own shipped bundle rather than from
documentation. The dispatcher and clientlib samples in chapters 10 and 15
came from `adobe/aem-project-archetype` at `develop`.

---

## Running it

```bash
npm install
npm start            # http://localhost:4173
```

`www/index.html` also opens straight from `file://`. Everything is inline:
CSS, JavaScript, SVG. No build step, no CDN, no network fonts. The only thing
that needs a server is the service worker.

### Verifying it

```bash
npm run verify:graph   # recompute the chapter 2 affected closure two ways
npm run verify         # 46 Playwright checks, writes screenshots/
```

`npm run verify` boots the real server and drives a real Chromium. It checks,
among other things: a clean render at 390x844 with no console errors and no
failed requests, 25 articles and balanced tags, that the title page is not
hidden behind the sticky bar and `window.scrollY` is 0 on a fresh load, that
`#ch14` deep-links at scroll 0, that night mode renders code blocks and
quizzes correctly, that the affected simulator agrees with an independently
computed closure, that the service worker reaches `active`, that night mode
and read-state survive a reload, that the book opens offline with icons
resolving, that no figure references a marker defined in another figure, that
`file://` works without a worker, and that a Capacitor environment renders
the book but registers no worker.

---

## Layout

```
www/                      the only thing deployed
  index.html              the whole book, 334 kB, no dependencies
  sw.js                   precache, cache-first, background refresh
  manifest.webmanifest    standalone, both theme colours
  icons/                  192, 512, and a separate maskable 512
capacitor.config.json     webDir points at www
android/  ios/            Capacitor native projects (tracked: editable source)
tools/
  serve.mjs               the dev server behind `npm start`
  make-icons.mjs          regenerates the icon set from an inline SVG
  verify.mjs              the Playwright suite
  verify-affected-closure.mjs   the chapter 2 graph maths, two ways
  bump-cache.mjs          bumps the service worker CACHE constant
.github/workflows/pages.yml     verify, then deploy ./www to Pages
RESEARCH.md               what was checked, how, and what moved
```

### The service worker cache constant

`www/sw.js` is cache-first and the book has no content hash in its filename,
so **`CACHE` must be bumped whenever `www/index.html` changes** or installed
copies will never see the update. `npm run cap:sync` does it automatically
via `tools/bump-cache.mjs`. If you edit the book by hand, bump it by hand, or
run `node tools/bump-cache.mjs`.

---

## The mobile app

```bash
npm run cap:sync            # bump the cache constant, then npx cap sync
npm run cap:open:android    # needs Android Studio and a JDK
npm run cap:open:ios        # needs macOS and Xcode
```

`appId` is `io.github.forgottenboi.monorepomachine`. Both native projects are
tracked in git on purpose: Capacitor treats them as editable source, and
`npx cap add` does not reproduce manifest edits, icons or splash screens.
Only generated build output and all signing material are ignored.

### What is actually left before a store would take it

Honestly: a fair amount. Both platforms are added and sync cleanly, but
neither is submittable as it stands.

Done already: `npm run icons` generates the real launcher icons for both
platforms from the same SVG as the PWA set. Android gets `ic_launcher`,
`ic_launcher_round` and an adaptive-icon `ic_launcher_foreground` at all five
densities, with the art inside the 72-of-108dp safe zone so no launcher mask
clips it, plus the teal `ic_launcher_background` colour. iOS gets the 1024
`AppIcon-512@2x.png`, opaque and unrounded as Apple requires.

**Android.** Needs Android Studio and a JDK 21 to build at all; nothing here
has been compiled, only generated. Still needs a splash screen that is not
Capacitor's default, a signing keystore held outside the repo, `versionCode`
and `versionName` management, a privacy policy URL, and a Play Console
listing with screenshots at the required sizes. Google's data-safety form has
to be filled in even though the app collects nothing.

**iOS.** Cannot be built on this machine at all: it needs macOS with Xcode.
It also needs a paid Apple Developer account, a launch screen, and
`limitsNavigationsToAppBoundDomains` kept honest.

**Apple guideline 4.2, which is the real problem.** Apple has historically
rejected apps that are a wrapped website with no native capability. As it
stands this app is exactly that: a WebView showing the same `www/` directory
Pages serves. To make a listing defensible it needs native capability that a
browser tab cannot give, and it needs to be genuinely useful rather than
decorative. The credible candidates, in rough order of effort against value:

- **Offline-first downloads as a first-class feature**, with a visible
  download state and storage management, using `@capacitor/filesystem`
  rather than relying on the service worker cache.
- **Reading position and progress synced across devices**, via
  `@capacitor/preferences` plus an account, instead of per-device
  `localStorage`.
- **Native share** (`@capacitor/share`) for a chapter or a code sample, and
  **share-target** handling so a link opens the right chapter.
- **Local notifications** (`@capacitor/local-notifications`) for a reading
  reminder, which is a thin justification on its own but helps.
- **Haptics and native navigation gestures** so chapter paging feels like an
  app rather than a page.
- **System appearance integration**: follow the OS theme live rather than
  only at boot, and set the status-bar style from `@capacitor/status-bar`.

Doing one of those well is worth more at review than doing all six badly. The
offline-downloads route is the strongest, because it is the one thing a
reader genuinely cannot get from the website.

Google Play is considerably more tolerant of wrapped web content, so Android
is realistically shippable once the icons, signing and listing work is done.

---

## Deploying

`.github/workflows/pages.yml` runs the full verification suite, then uploads
`./www` and deploys it with `actions/deploy-pages`. Nothing else ships.

To enable it: **Settings → Pages → Build and deployment → Source: GitHub
Actions**, then push to `main`.

---

## Licence

MIT. See `LICENSE`.

The book's text is written to be read, argued with, and corrected. If a
version fact here has moved, Appendix C lists the primary source so you can
check it yourself rather than taking this on trust.
