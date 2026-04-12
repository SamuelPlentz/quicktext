/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as quicktext from "./quicktext.mjs";
import * as vfs from "/vendor/vfs-client/vfs-client.mjs";

// Human-readable name for the built-in OPFS storage, shown in the VFS file
// picker and the Storage list. Keep in sync across all picker call sites.
export const OPFS_STORAGE_NAME = "Quicktext Storage";

// Default storage configuration: a single JSON file holding both `templates`
// and `scripts` side-by-side, in the legacy file-source shape that
// parseConfigFileData() already understands. `storageRef: null` selects the
// built-in OPFS provider; for external providers it carries the VFS storageRef
// `{providerId, storageId}`. The `uuid` is assigned at first-write via
// `_makeDefaultConfig()` so fresh installs get a freshly-generated id.
function _makeDefaultConfig() {
  return {
    uuid: crypto.randomUUID(),
    name: "Default",
    type: "vfs",
    storageRef: null,
    path: "/quicktext.json",
    readOnly: false,
    enabled: true,
  };
}

// Default name for a managed-storage entry when the enterprise
// policy doesn't provide one. Resolved via i18n at call time so
// locale switches still take effect on the next migration pass.
function _defaultManagedName() {
  return browser.i18n.getMessage("quicktext.storage.managed.label") || "Managed";
}

// Build a fresh managed-storage entry for `storageLocations`. The
// `type: "managed"` field is the sole identifier: `readConfigFile`
// routes reads to `browser.storage.managed` when it sees this type,
// and the manager dialog uses the same check to gate write-only
// affordances (import, content edits). The entry is injected into
// `storageLocations` on startup by `_migrateStorageLocationsShape()`
// if a policy is present and the user doesn't already have one. The
// policy may ship a custom `name` and `icon` URL via the new
// `managed-quicktext-storage` wrapper (see `_readManagedCombined`);
// both are optional and fall back to sensible defaults.
function _makeManagedEntry({ name = null, icon = null } = {}) {
  return {
    uuid: crypto.randomUUID(),
    name: name || _defaultManagedName(),
    type: "managed",
    icon: icon || null,
    storageRef: null,
    path: null,
    readOnly: true,
    enabled: true,
  };
}

// Thin async check: is there currently any Quicktext data in the
// enterprise policy? Used by the manager to flip a runtime "has
// managed storage" flag so managed entries can be hidden when no
// policy is active (and re-appear when the admin pushes one).
export async function hasManagedPolicy() {
  return (await _readManagedCombined()) !== null;
}

// Read the managed policy's templates/scripts. Returns `null` when
// the API is unavailable or the policy has no Quicktext entries.
// Runs `_stripProtectedInPlace` on the way out so any leftover
// `protected: true` markers in an old policy are dropped.
//
// Two policy shapes are supported:
//
//   1. New (preferred) - a single `managed-quicktext-storage` key
//      whose value is an object with `name`, `icon`, `templates`,
//      `scripts` sub-fields. Admins use this to ship a custom
//      display name and icon alongside the content.
//
//   2. Legacy - two top-level keys `templates` and `scripts`. No
//      display-name or icon customization. Only consulted when the
//      new key is absent.
//
// Return shape is always `{name, icon, templates, scripts}` so
// callers can treat both paths uniformly; `name`/`icon` are `null`
// when the policy doesn't provide them.
async function _readManagedCombined() {
  try {
    const { "managed-quicktext-storage": wrapped = null } = await browser.storage.managed.get({
      "managed-quicktext-storage": null,
    });
    if (wrapped && typeof wrapped === "object") {
      const templates = wrapped.templates ?? null;
      const scripts = wrapped.scripts ?? null;
      if (templates == null && scripts == null) return null;
      const combined = {
        name: typeof wrapped.name === "string" ? wrapped.name : null,
        icon: typeof wrapped.icon === "string" ? wrapped.icon : null,
        templates,
        scripts,
      };
      _stripProtectedInPlace(combined);
      return combined;
    }

    // Legacy fallback: two top-level keys.
    const { templates = null, scripts = null } = await browser.storage.managed.get({
      templates: null,
      scripts: null,
    });
    if (templates == null && scripts == null) return null;
    const combined = { name: null, icon: null, templates, scripts };
    _stripProtectedInPlace(combined);
    return combined;
  } catch {
    return null;
  }
}

/**
 * Mutate `combined` in place, dropping any group whose `protected`
 * flag is truthy (together with its matching `texts` slot) and any
 * script whose `protected` flag is truthy. Operates on the combined
 * `{templates: {groups, texts}, scripts}` shape used by both
 * `readConfigFile` and `quicktext.parseConfigFileData`.
 *
 * The old `protected: true` marker was retired during the
 * multi-storage refactor. This filter quietly strips any remaining
 * protected entries at ingest time so they never reach consumers -
 * the on-disk file cleans itself up naturally on the next save via
 * the read-modify-write in `setBundleForStorage`.
 */
export function _stripProtectedInPlace(combined) {
  if (!combined) return;

  const groups = combined.templates?.groups;
  const texts = combined.templates?.texts;
  if (Array.isArray(groups)) {
    const keep = [];
    for (let i = 0; i < groups.length; i++) {
      if (!groups[i]?.protected) keep.push(i);
    }
    if (keep.length !== groups.length) {
      combined.templates = {
        groups: keep.map(i => groups[i]),
        texts: keep.map(i => texts?.[i] ?? []),
      };
    }
  }

  if (Array.isArray(combined.scripts)) {
    combined.scripts = combined.scripts.filter(s => !s?.protected);
  }
}

/**
 * Read the combined `{templates, scripts}` JSON from a storage config.
 * Generic over the storage backend. Entries with `type: "managed"`
 * dispatch to `browser.storage.managed` instead of the VFS path;
 * protected entries from pre-refactor files are silently filtered
 * out on both paths via `_stripProtectedInPlace`.
 */
async function readConfigFile(config) {
  if (config?.type === "managed") {
    return (await _readManagedCombined()) ?? { templates: null, scripts: null };
  }
  try {
    const file = await vfs.readFile({ path: config.path, storageRef: config.storageRef });
    const text = await file.text();
    const parsed = await quicktext.parseConfigFileData(text);
    const combined = {
      templates: parsed?.templates ?? null,
      scripts: parsed?.scripts ?? null,
    };
    _stripProtectedInPlace(combined);
    return combined;
  } catch (ex) {
    // File not found on first run, or parse failure - empty shape.
    return { templates: null, scripts: null };
  }
}

/**
 * Write the combined `{templates, scripts}` JSON to a storage config.
 * Generic over the storage backend.
 */
async function writeConfigFile(config, combined) {
  const payload = JSON.stringify({
    templates: combined.templates ?? null,
    scripts: combined.scripts ?? null,
  });
  const blob = new Blob([payload], { type: "application/json" });
  await vfs.writeFile({ path: config.path, storageRef: config.storageRef }, blob, { overwrite: true });
}

async function _migrateToConfigFile() {
  // Migration to modern storage locations. 
  //
  // - modern format: storageLocations is a plain array where every entry carries
  //   a persisted `uuid`. Nothing to do.
  //
  // - legacy format: `storageLocations` is either `null` (a fresh install that
  //   never ran), a stringified JSON of `[{source, data}]`, or the parsed form
  //   thereof. Templates and scripts live in `browser.storage.local.templates`
  //   and `browser.storage.local.scripts` as stringified JSON.
  //
  // - XML format: old config files may sit in the user profile for really old
  //   installs. Only migrated if the `storageLocations` key is absent.
  const { storageLocations: raw } = await browser.storage.local.get({ storageLocations: null });

  // Already in the modern format - short-circuit.
  if (Array.isArray(raw) && raw.length > 0 && raw.every(e => e && typeof e.uuid === "string")) {
    return;
  }

  const isFreshInstall = raw == null;

  const { templates: rawT, scripts: rawS } = await browser.storage.local.get({
    templates: null,
    scripts: null,
  });
  let templates = rawT ? (typeof rawT === "string" ? JSON.parse(rawT) : rawT) : null;
  let scripts = rawS ? (typeof rawS === "string" ? JSON.parse(rawS) : rawS) : null;
  let source = templates != null || scripts != null ? "INTERNAL" : null;

  if (isFreshInstall && templates == null) {
    try {
      templates = (await quicktext.readLegacyXmlTemplateFile())?.templates ?? null;
      if (templates != null) source = "XML";
    } catch { /* no XML file */ }
  }
  if (isFreshInstall && scripts == null) {
    try {
      scripts = (await quicktext.readLegacyXmlScriptFile())?.scripts ?? null;
      if (scripts != null) source = source ?? "XML";
    } catch { /* no XML file */ }
  }
  console.log(`Quicktext migration: source=${source ?? "none"}`);

  // Write the config file BEFORE persisting the modern storageLocations, so
  // the persisted storageLocations acts as the commit marker - a crash
  // between the two phases leaves legacy state intact and the next run
  // retries.
  const defaultEntry = _makeDefaultConfig();
  if (templates != null || scripts != null) {
    await writeConfigFile(defaultEntry, { templates, scripts });
  }

  await browser.storage.local.remove(["templates", "scripts", "activeStorageLocationIdx"]);
  await browser.storage.local.set({
    storageLocations: [defaultEntry],
  });
}

const defaultPrefs = {
  "counter": 0,
  "templateFolder": "",
  "defaultImport": [],
  "menuCollapse": true,
  "toolbar": true,
  "popup": true,
  "keywordKey": "Tab",
  "shortcutModifier": "alt",
  "shortcutTypeAdv": false,
  "collapseState": "",
  "storageLocations": [],
};

const managedPrefs = [
  "defaultImport",
  "menuCollapse",
  "popup",
  "keywordKey",
  "shortcutModifier",
  "shortcutTypeAdv",
];

// Raw reader: returns whatever `browser.storage.managed` has for
// `aName`, or `undefined` if the managed area is missing, if the
// pref isn't on the managed-override allowlist, or if the admin
// hasn't set this key.
async function _getManagedPref(aName) {
  if (!managedPrefs.includes(aName)) {
    return undefined;
  }
  try {
    const override = await browser.storage.managed.get({ [aName]: undefined });
    return override[aName];
  } catch {
    // No managed storage available.
  }
  return undefined;
}

// Raw reader: returns whatever `browser.storage.local` has for
// `aName`, falling back to `defaultPrefs[aName]` or the explicit
// `aFallback` when the key isn't set.
async function _getLocalPref(aName, aFallback = undefined) {
  const defaultPref = Object.hasOwn(defaultPrefs, aName)
    ? defaultPrefs[aName]
    : aFallback;
  const o = await browser.storage.local.get({ [aName]: defaultPref });
  return o[aName];
}

// True if the enterprise policy currently provides a value for
// `aName`. Consumers use this to gate UI affordances (e.g., the
// manager disables inputs and buttons for policy-controlled prefs)
// without duplicating the managed-area lookup themselves.
export async function hasManagedPref(aName) {
  return (await _getManagedPref(aName)) !== undefined;
}

// Any pref-shape upgrades that must apply on every read.
function migratePrefOnTheFly(value, name) {
  switch (name) {
    case "defaultImport":
      return _normalizeDefaultImports(value);
    default:
      return value;
  }
}

// The single read path. Resolves the effective value of a pref:
// managed policy wins when it provides a value, otherwise local
// storage (with fallback). The final value is run through
// `migratePrefOnTheFly`.
export async function getPrefWithManagedInfo(aName, aFallback = undefined) {
  const managedPref = await _getManagedPref(aName);
  if (managedPref !== undefined) {
    return { value: migratePrefOnTheFly(managedPref, aName), isManaged: true };
  }
  const localPref = await _getLocalPref(aName, aFallback);
  return { value: migratePrefOnTheFly(localPref, aName), isManaged: false };
}

// Convenience wrapper for consumers that don't care whether the
// value came from policy or local storage.
export async function getPref(aName, aFallback = undefined) {
  return (await getPrefWithManagedInfo(aName, aFallback)).value;
}

// Write `aValue` into local storage for `aName`, unless the
// enterprise policy currently provides a value for this pref.
export async function setPref(aName, aValue) {
  if ((await _getManagedPref(aName)) !== undefined) return;
  await browser.storage.local.set({ [aName]: aValue });
}
// Clear the value for the `aName` from local storage, unless the
// enterprise policy currently provides a value for this pref.
export async function clearPref(aName) {
  if ((await _getManagedPref(aName)) !== undefined) return;
  await browser.storage.local.remove(aName);
}

// ---- Default (startup) imports ----------------------------------
//
// Historical shapes of the `defaultImport` pref:
//   1. Semicolon-separated string (pre-v6.4.6)   -> parsed + URL-filtered.
//   2. `[{source: "URL"|"FILE", data}, ...]` (v6.4.6+) -> FILE dropped,
//      URL mapped to `{url: data, name: _deriveName(data)}`.
//   3. `[{name, url}, ...]` (modern) -> pass-through.
//
// Callers read and write via the normal `getPref("defaultImport")` /
// `setPref("defaultImport", list)` path. `migratePrefOnTheFly` runs
// the raw value through `_normalizeDefaultImports` on every read, so
// both the local and managed paths always hand consumers the modern
// shape - there is no ambient legacy state.

function _deriveName(url) {
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").filter(Boolean);
    return segments.length ? segments[segments.length - 1] : u.hostname;
  } catch {
    return url;
  }
}

function _normalizeDefaultImports(raw) {
  if (raw == null) return [];
  // Legacy stringified value - either a JSON blob or a pre-v6.4.6
  // semicolon-separated string of paths.
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return raw
        .split(";")
        .map(s => s.trim())
        .filter(s => /^https?:\/\//.test(s))
        .map(url => ({ name: _deriveName(url), url, icon: null }));
    }
  }
  if (!Array.isArray(raw)) return [];
  const result = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    // Modern shape. The `icon` field is optional - admins can
    // push a per-entry icon URL via the managed default-import
    // pref, alongside `name` and `url`; the manager falls back to
    // a generic globe glyph when it's absent.
    if (typeof entry.url === "string" && entry.url) {
      result.push({
        name: typeof entry.name === "string" && entry.name
          ? entry.name
          : _deriveName(entry.url),
        url: entry.url,
        icon: typeof entry.icon === "string" && entry.icon ? entry.icon : null,
      });
      continue;
    }
    // v6.4.6+ `{source, data}` shape.
    if (entry.source === "URL" && typeof entry.data === "string" && entry.data) {
      result.push({
        name: _deriveName(entry.data),
        url: entry.data,
        icon: null,
      });
      continue;
    }
    // FILE entries and anything unrecognized are dropped.
  }
  return result;
}

/**
 * Return the full list of storage entries from the persisted
 * `storageLocations` pref, in their saved order. Each entry carries
 * a `type` field (`"vfs"` for VFS-backed storages, `"managed"` for
 * the enterprise-policy-backed one). The managed entry is a normal
 * persisted entry just like any other - it's injected into
 * `storageLocations` at startup by `_migrateStorageLocationsShape()`
 * when a policy is first seen, and remains after that even if the
 * policy later disappears so any user rename/reorder sticks.
 *
 * Callers clone as needed; a fresh top-level array is returned on
 * each call (the entries themselves are the persisted objects).
 */
export async function getAllStorageEntries() {
  return await getPref("storageLocations");
}

/**
 * Read templates and scripts from every enabled storage location in
 * the persisted order. One bundle per enabled entry; empty shells
 * are returned for storages with no data yet so the shape is always
 * consistent for consumers.
 *
 * @returns {Promise<Array<{
 *   storageUuid: string,
 *   storageName: string,
 *   readOnly: boolean,
 *   templates: { groups: Array, texts: Array },
 *   scripts: Array,
 * }>>}
 */
export async function getActiveStorageEntries() {
  const allEntries = await getAllStorageEntries();
  const bundles = [];
  for (const entry of allEntries) {
    if (entry.enabled === false) continue;
    bundles.push(await readBundleForEntry(entry));
  }
  return bundles;
}

/**
 * Read one bundle from a given storage-location entry. Exported so the
 * manager dialog can lazy-load a bundle when the user enables or adds a
 * storage in the advanced tab, without round-tripping through
 * `storageLocations` prefs.
 *
 * @param {object} entry - A storageLocations entry carrying at least
 *   `{uuid, name, readOnly, storageRef, path}`.
 */
export async function readBundleForEntry(entry) {
  let combined = { templates: null, scripts: null };
  try {
    combined = await readConfigFile(entry);
  } catch (ex) {
    console.log(ex);
  }
  // Normalize templates into a `{groups:[], texts:[]}` shape even when
  // the on-disk file carries a truthy-but-malformed `templates` object
  // (e.g. legacy exports, hand-edited files, or a managed policy that
  // sets only one sub-key). Downstream consumers like
  // `_templateNodesForBundle` index into `groups`/`texts` without
  // further guarding.
  const templates = combined.templates ?? {};
  return {
    storageUuid: entry.uuid,
    storageName: entry.name,
    readOnly: !!entry.readOnly,
    templates: {
      groups: Array.isArray(templates.groups) ? templates.groups : [],
      texts: Array.isArray(templates.texts) ? templates.texts : [],
    },
    scripts: Array.isArray(combined.scripts) ? combined.scripts : [],
  };
}

// Bump counters persisted in browser.storage.local so that
// StorageListener-based observers (compose menu, manager, toolbar) can
// notice template/script writes. The actual content lives in the VFS
// config files, which storage.onChanged does not observe.
async function _bumpChangeCounter(key) {
  const { [key]: cur = 0 } = await browser.storage.local.get({ [key]: 0 });
  await browser.storage.local.set({ [key]: cur + 1 });
}

/**
 * Write templates and scripts into the storage entry whose `uuid`
 * matches. Templates and scripts share a single config file, so a
 * bundle save is a single read-modify-write. Refuses to write into a
 * read-only storage - the manager UI already blocks edits, so hitting
 * this branch indicates a programming error.
 */
export async function setBundleForStorage(storageUuid, { templates, scripts }) {
  const storageLocations = await getPref("storageLocations");
  const entry = storageLocations.find(e => e.uuid === storageUuid);
  if (!entry) throw new Error(`Unknown storage uuid ${storageUuid}`);
  if (entry.readOnly) throw new Error(`Refusing to write read-only storage "${entry.name}"`);
  const combined = await readConfigFile(entry);
  combined.templates = templates;
  combined.scripts = scripts;
  await writeConfigFile(entry, combined);
  await _bumpChangeCounter("templates");
  await _bumpChangeCounter("scripts");
}

export async function migrate() {
  // Migrate options from sync to local storage, as sync storage can only hold
  // 100 KB which will not be enough for templates.
  const { userPrefs: syncUserPrefs } = await browser.storage.sync.get({ userPrefs: undefined });
  if (syncUserPrefs) {
    await browser.storage.local.set({ userPrefs: syncUserPrefs });
    await browser.storage.sync.remove("userPrefs");
  }

  // Migrate from userPrefs/defaultPrefs objects to *.value and *.default.
  const { userPrefs: v1UserPrefs } = await browser.storage.local.get({ userPrefs: undefined });
  if (v1UserPrefs) {
    for (let [key, value] of Object.entries(v1UserPrefs)) {
      await browser.storage.local.set({ [`${key}.value`]: value });
    }
    await browser.storage.local.remove("userPrefs");
  }
  const { defaultPrefs: v1DefaultPrefs } = await browser.storage.local.get({ defaultPrefs: undefined });
  if (v1DefaultPrefs) {
    await browser.storage.local.remove("defaultPrefs");
  }

  // Migrate from *.value and *.default to simple values.
  for (let aName of Object.keys(defaultPrefs)) {
    const aValue = await browser.storage.local
      .get({ [`${aName}.value`]: undefined })
      .then(o => o[`${aName}.value`]);
    if (aValue !== undefined) {
      await browser.storage.local.remove(`${aName}.value`);
      await browser.storage.local.set({ [aName]: aValue });
    }
    await browser.storage.local.remove(`${aName}.default`);
    await browser.storage.local.remove(`${aName}.managed.value`);
  }

  // Migrate INTERNAL storage (browser.storage.local.templates + .scripts) or
  // legacy XML files on disk into the combined /quicktext.json on OPFS, and
  // upgrade storageLocations to the new VFS config shape. Requires vfs.init()
  // to have run.
  await _migrateToConfigFile();

  // Backfill the `type` field on every storageLocations entry and
  // inject a persisted managed entry when a policy is present.
  await _migrateStorageLocationsShape();
}

// Post-`_migrateToConfigFile` tidy-up:
//
//   1. Every persisted storageLocations entry gets a `type` field.
//      Pre-refactor entries have none - default them to `"vfs"`.
//   2. If `browser.storage.managed` currently has Quicktext data
//      AND no entry with `type === "managed"` is already persisted,
//      prepend a fresh managed entry so the policy shows up in the
//      storage list like any other storage. Once injected it stays
//      even if the policy later disappears, so user rename/reorder
//      edits are preserved across policy churn.
//   3. The admin-provided `name`/`icon` on an existing managed
//      entry is refreshed from the live policy on every run. Since
//      the user can't rename managed entries, there's no local
//      edit to preserve; the policy is authoritative.
//
// `storageLocations` is user-owned (never policy-controlled), so
// this always persists to local storage. Idempotent - safe to run
// on every startup.
async function _migrateStorageLocationsShape() {
  const storageLocations = await getPref("storageLocations");
  if (!Array.isArray(storageLocations)) return;

  let mutated = false;
  for (const entry of storageLocations) {
    if (entry && typeof entry.type !== "string") {
      entry.type = "vfs";
      mutated = true;
    }
  }

  const managedCombined = await _readManagedCombined();
  const managedEntry = storageLocations.find(e => e?.type === "managed");
  if (!managedEntry && managedCombined) {
    storageLocations.unshift(_makeManagedEntry({
      name: managedCombined.name,
      icon: managedCombined.icon,
    }));
    mutated = true;
  } else if (managedEntry && managedCombined) {
    // Refresh the persisted name/icon so policy updates take effect
    // on the next startup. Falls back to the i18n default when the
    // new policy shape omits a name.
    const desiredName = managedCombined.name || _defaultManagedName();
    const desiredIcon = managedCombined.icon || null;
    if (managedEntry.name !== desiredName) {
      managedEntry.name = desiredName;
      mutated = true;
    }
    if ((managedEntry.icon ?? null) !== desiredIcon) {
      managedEntry.icon = desiredIcon;
      mutated = true;
    }
  }

  if (mutated) {
    await setPref("storageLocations", storageLocations);
  }
}

export class StorageListener {
  #watchedPrefs = [];
  #listener = null;
  #timeoutId;
  #changedWatchedPrefs = {};

  #eventEmitter() {
    this.#listener(this.#changedWatchedPrefs);
    this.#changedWatchedPrefs = {}
  }

  #eventCollapse = async (changes, area) => {
    if (area == "local") {
      for (let [key, value] of Object.entries(changes)) {
        const watchedPref = this.#watchedPrefs.find(p => key == p);

        // Do not monitor managed prefs.
        let managedPref = await _getManagedPref(key);
        if (managedPref !== undefined) {
          continue;
        }

        if (watchedPref && value.oldValue != value.newValue) {
          this.#changedWatchedPrefs[watchedPref] = value;
        }
      }

      if (Object.keys(this.#changedWatchedPrefs).length > 0) {
        window.clearTimeout(this.#timeoutId);
        this.#timeoutId = window.setTimeout(() => this.#eventEmitter(), 500);
      }
    } else if (area == "managed") {
      // Admin pushed a new policy. Normalize any content-affecting
      // change - the legacy `templates`/`scripts` keys and the new
      // `managed-quicktext-storage` wrapper - into synthetic
      // `templates`/`scripts` change events so consumers that watch
      // the content keys (compose menu, toolbar, manager) rebuild
      // without needing to know about the wrapper format.
      // `storageLocations` is user-owned and deliberately not
      // policy-controlled, so it's not forwarded.
      const managedContentKeys = ["templates", "scripts", "managed-quicktext-storage"];
      const touched = managedContentKeys.some(k => k in changes);
      if (touched) {
        for (const watched of ["templates", "scripts"]) {
          if (this.#watchedPrefs.includes(watched)) {
            this.#changedWatchedPrefs[watched] = changes[watched] ?? { managed: true };
          }
        }
      }
      if (Object.keys(this.#changedWatchedPrefs).length > 0) {
        window.clearTimeout(this.#timeoutId);
        this.#timeoutId = window.setTimeout(() => this.#eventEmitter(), 500);
      }
    }
  }

  constructor(options = {}) {
    this.#watchedPrefs = options.watchedPrefs || [];
    this.#listener = options.listener;
    browser.storage.onChanged.addListener(this.#eventCollapse);
  }
}