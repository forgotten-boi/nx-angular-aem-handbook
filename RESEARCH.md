# Phase 0 research log

Every version-sensitive claim in `www/index.html` was checked against a primary
source on 2026-09-10. This file records what was checked, how, and what moved.

## Method

`nx.dev` and `experienceleague.adobe.com` are both blocked by this environment's
egress policy, so the facts below were taken from sources that are equally
primary and were reachable:

- the npm registry (`registry.npmjs.org`) and the published package tarballs
  themselves, which is where the version constants actually live
- Adobe's own source repositories on GitHub (`adobe/aem-project-archetype`,
  `adobe/universal-editor-cors`, `AdobeDocs/experience-manager-65.en`)
- web search result summaries of the Adobe Experience League pages, used only
  to corroborate facts that were also confirmed in code

## 1. Nx / Angular compatibility

Read from the published `@nx/angular` tarballs
(`dist/src/utils/versions.js` and `dist/src/utils/backward-compatible-versions.js`):

| `@nx/angular` | scaffolds Angular | supports Angular majors |
|---|---|---|
| 22.7.11 (`previous`) | `~21.2.0` | 21, 20 |
| 23.0.0 – 23.0.2 | `~21.2.0` | 21, 20 |
| 23.1.0 – 23.1.3 | `~22.0.4` | 22, 21, 20 |
| 23.2.0 – 23.2.1 (`latest`) | `~22.1.0` | 22, 21, 20 |

Current as of the check: `nx@23.2.1`, `@angular/core@22.1.6`.

The brief's claim ("Angular 22.1 requires Nx >= 23.2.0") holds, with one nuance
worth stating in the text: Angular **22.0** is supported from Nx **23.1.0**;
**23.2.0** is the first release that scaffolds and tracks Angular **22.1**.
The Nx 22.7.x line never gained Angular 22 support.

## 2. Angular 22 API surface

Read from the `@angular/core@22.1.6`, `@angular/platform-browser@22.1.6` and
`@angular/elements@22.1.6` type declarations:

- `provideZonelessChangeDetection()` is stable and carries `@publicApi 20.2`.
  There is no `provideExperimentalZonelessChangeDetection` any more.
  `provideZoneChangeDetection()` still exists and is not marked deprecated.
- Signal APIs present: `signal`, `computed`, `effect`, `linkedSignal`,
  `resource`, `input`, `model`, `output`, `viewChild`, `contentChild`.
- `createApplication(options?: ApplicationConfig, context?: BootstrapContext): Promise<ApplicationRef>`
- `createCustomElement<P>(component: Type<any>, config: NgElementConfig): NgElementConstructor<P>`
- `create-nx-workspace@23.2.1` really does take a `--zoneless` flag.

## 3. AEM SPA Editor deprecation

From `AdobeDocs/experience-manager-65.en` (this repo's `main` is live; the
AEM as a Cloud Service docs mirror is frozen at 2022 and is NOT a usable source):

- `help/sites-developing/spa-editor-deprecation.md` states deprecation "with
  release 6.5.23 of AEM 6.5".
- `help/release-notes/release-notes.md#spa-editor` states "deprecated for new
  projects starting with release 6.5.25 of AEM 6.5".
- These two Adobe pages disagree. The handbook says so rather than picking one.
- Confirmed verbatim: no further SDK enhancements, P1/P2 and security fixes
  only, existing implementations stay supported, listed SDKs in feature freeze,
  and **"There is no direct migration path from the SPA Editor to the Universal
  Editor."**
- Confirmed: the Universal Editor does not reintroduce the Template Editor,
  Style System or Responsive Grid.

## 4. Universal Editor instrumentation contract

Read out of Adobe's own shipped bundle,
`@adobe/universal-editor-cors@2.3.7` → `dist/universal-editor-embedded.js`:

```
URN_PREFIX      "urn:adobe:aue:"
META_SELECTOR   meta[name^='urn:adobe:aue:']
META_NAMESPACE  meta[name='urn:adobe:aue:config:namespace']
DEFAULT_PREFIX  "data-aue-"
COMPONENT_ITEM_TYPE "component"
attribute suffixes: id, resource, type, prop, parentid, behavior, label, model, filter
events: aue:initialized aue:ui-select aue:ui-preview aue:ui-edit
        aue:content-add aue:content-move aue:content-copy
        aue:content-patch aue:content-remove
url schemes: adobe-ue-edit, adobe-ue-preview
```

**This moved.** The `@adobe/universal-editor-cors` npm package README now says:

> `!!! DEPRECATED !!!` This library shall no longer be used. Universal Editor is
> showing a deprecation warning and will stop support May 31st 2025.

So the npm library is not the integration path. The hosted script is:
`<script src="https://universal-editor-service.adobe.io/cors.js" async></script>`
(the host itself is blocked by this environment's egress policy, so it was
corroborated from Adobe Experience League tutorial pages rather than fetched).

## 5. Cloud Manager front-end pipeline

- Front-end code lives at `/ui.frontend`, and the folder given to the pipeline
  must contain a `package.json`. It does not have to be the archetype's
  `ui.frontend` specifically; any npm project folder works.
- The front-end pipeline builds only that module and pushes the output to the
  built-in CDN, bypassing `/etc.clientlibs` delivery.
- Static assets are then served from a `static-p<program>-e<env>...adobeaemcloud.com`
  hostname under a content hash.
- AEM records that CDN prefix as the `prefixPath` property on
  `com.adobe.cq.wcm.core.components.config.HtmlPageItemsConfig`.

## 6. Other pinned versions checked on the day

| thing | version |
|---|---|
| `nx`, `@nx/angular` | 23.2.1 |
| `@angular/core` | 22.1.6 |
| `aem-clientlib-generator` | 2.0.3 |
| `zod` | 4.6.1 |
| `aws-cdk-lib` | 2.268.0 |
| `constructs` | 10.8.1 |
| `esbuild` | 0.28.2 |
| AWS SDK v3 | 3.1129.0 |
| `nrwl/nx-set-shas` | **v5** (not v4) |
| `actions/checkout` | v7 |
| `actions/setup-node` | v7 |
| `actions/configure-pages` | v6 |
| `actions/upload-pages-artifact` | v5 |
| `actions/deploy-pages` | v5 |

CDK `Runtime` exposes `NODEJS_18_X`, `NODEJS_20_X`, `NODEJS_22_X`, `NODEJS_24_X`.

Dispatcher `filters.any` syntax and `clientlib.config.js` shape were taken from
`adobe/aem-project-archetype` at `develop` (HEAD 2026-08-31), not from memory.

## 7. Affected-graph maths

`tools/verify-affected-closure.mjs` computes the transitive-dependent closure
for the chapter 2 widget two independent ways (BFS over reversed edges, and a
brute-force reachability test per candidate) and asserts they agree. Run it with
`node tools/verify-affected-closure.mjs`.
