# Vendored Files

This file lists files that were not created by this project and are maintained upstream elsewhere.

---

## @floating-ui/dom

| | |
|---|---|
| **Files** | `vendor/floating-ui/floating-ui.core.umd.min.js`, `vendor/floating-ui/floating-ui.dom.umd.min.js` |
| **Version** | 1.7.6 (core: same release) |
| **Upstream** | https://github.com/floating-ui/floating-ui |
| **npm** | https://www.npmjs.com/package/@floating-ui/dom |
| **License** | MIT |
| **Notes** | UMD builds from unpkg. The core build sets `globalThis.FloatingUICore`; the dom build reads it and sets `globalThis.FloatingUIDOM`. Both are loaded as plain scripts in `manager.html` before the module script. Neither file is modified. |

---

## i18n.mjs

| | |
|---|---|
| **File** | `modules/i18n.mjs` |
| **Upstream** | https://github.com/thunderbird/webext-support/blob/6bbbf8ac2105d04c1b59083e8bd52e0046448ec7/modules/i18n/i18n.mjs |
| **License** | MIT (derived from [webextensions-lib-l10n](https://github.com/piroor/webextensions-lib-l10n) by YUKI "Piro" Hiroshi) |
