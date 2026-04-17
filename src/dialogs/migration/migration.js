/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as storage from "/modules/storage.mjs";
import * as utils from "/modules/utils.mjs";
import * as vfs from "/vendor/vfs-client/vfs-client.mjs";
import { localizeDocument } from "/vendor/i18n.mjs";

const MANAGER_URL = browser.runtime.getURL("/dialogs/manager/manager.html");
const i18n = (key, subs) => browser.i18n.getMessage(key, subs) || key;

function showAlert(message) {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "popover-overlay";
    const box = document.createElement("div");
    box.className = "popover-box";
    const msg = document.createElement("p");
    msg.textContent = message;
    box.appendChild(msg);
    const btn = document.createElement("button");
    btn.textContent = i18n("migration.btn.ok");
    btn.className = "popover-btn";
    btn.addEventListener("click", () => { overlay.remove(); resolve(); });
    box.appendChild(btn);
    overlay.appendChild(box);
    overlay.addEventListener("click", e => { if (e.target === overlay) { overlay.remove(); resolve(); } });
    document.body.appendChild(overlay);
    btn.focus();
  });
}

async function isManagerOpen() {
  const windows = await browser.windows.getAll({ populate: true });
  for (const w of windows) {
    for (const tab of w.tabs ?? []) {
      if (tab.url === MANAGER_URL) return true;
    }
  }
  return false;
}

function renderItem(container, location, lines) {
  const div = document.createElement("div");
  div.className = "migration-item";
  const loc = document.createElement("div");
  loc.className = "item-location";
  loc.textContent = location;
  div.appendChild(loc);
  for (const line of lines) {
    const el = document.createElement("div");
    el.className = line.className;
    el.textContent = line.text;
    div.appendChild(el);
  }
  container.appendChild(div);
}

const targetFolder = utils.getFolderForTag;

function _sourceLabel(entry) {
  if (entry?.type === "managed") return i18n("migration.source.enterprisePolicy");
  if (entry?.type === "import") return i18n("migration.source.imported");
  return null;
}

function classifyFindings(results, entries, bundles) {
  const auto = { templates: [], scripts: [] };
  const incompatibleScripts = [];
  const deprecatedFs = { templates: [], scripts: [] };

  const sourceMap = new Map();
  for (const e of entries) sourceMap.set(e.uuid, _sourceLabel(e));
  for (const b of bundles) {
    if (sourceMap.has(b.storageUuid)) continue;
    if (b.type === "import" || b.isImport) sourceMap.set(b.storageUuid, i18n("migration.source.imported"));
    else if (b.type === "managed") sourceMap.set(b.storageUuid, i18n("migration.source.enterprisePolicy"));
  }

  for (const t of results.templates ?? []) {
    const source = sourceMap.get(t.storageUuid) ?? null;
    const autoTags = source ? [] : t.tags.filter(tag => tag.migration === "auto");
    const manualTags = source ? t.tags : t.tags.filter(tag => tag.migration === "manual");
    if (autoTags.length) auto.templates.push({ ...t, tags: autoTags });
    if (manualTags.length) deprecatedFs.templates.push({ ...t, tags: manualTags, source });
  }

  for (const s of results.scripts ?? []) {
    const source = sourceMap.get(s.storageUuid) ?? null;
    const apiDetails = s.details.filter(d => d.type === "deprecated-api");
    const tagAutoDetails = source ? [] : s.details.filter(d => d.type === "deprecated-tag" && d.migration === "auto");
    const tagManualDetails = source
      ? s.details.filter(d => d.type === "deprecated-tag")
      : s.details.filter(d => d.type === "deprecated-tag" && d.migration === "manual");
    if (tagAutoDetails.length) auto.scripts.push({ ...s, details: tagAutoDetails });
    if (tagManualDetails.length) deprecatedFs.scripts.push({ ...s, details: tagManualDetails, source });
    if (apiDetails.length) incompatibleScripts.push({ ...s, details: apiDetails, source });
  }

  return { auto, incompatibleScripts, deprecatedFs };
}

function previewVfsPath(tag) {
  const folder = targetFolder(tag.tag);
  const leaf = tag.path ? utils.getLeafName(tag.path) : "?";
  return `${folder}/${leaf}`;
}

function renderAutoItems(container, templates, scripts) {
  container.innerHTML = "";
  for (const t of templates) {
    const lines = t.tags.flatMap(tag => {
      const vfsPath = previewVfsPath(tag);
      return [
        { className: "item-tag", text: tag.tag },
        { className: "item-target", text: `→ ${utils.rewriteTagPreview(tag.tag, vfsPath)}` },
      ];
    });
    renderItem(container,
      `${t.storageName} › ${t.group} › ${t.template} (template)`,
      [{ className: "item-reason", text: i18n("migration.reason.deprecatedFilesystem") }, ...lines]);
  }
  for (const s of scripts) {
    const lines = [];
    for (const d of s.details) {
      if (d.type === "deprecated-api") {
        lines.push({ className: "item-tag", text: d.keyword });
      } else {
        lines.push({ className: "item-tag", text: d.call });
        if (d.path) {
          const folder = targetFolder(d.call);
          const vfsPath = `${folder}/${utils.getLeafName(d.path)}`;
          lines.push({ className: "item-target", text: `→ ${utils.rewriteScriptCallPreview(d.call, d.path, vfsPath)}` });
        }
      }
    }
    const reason = s.issues.includes("deprecated-api")
      ? i18n("migration.reason.deprecatedApi") : i18n("migration.reason.deprecatedFilesystem");
    renderItem(container,
      `${s.storageName} › ${s.script} (script)`,
      [{ className: "item-reason", text: reason }, ...lines]);
  }
}

function _renderReadonlyNote(elementId, sources) {
  const importedLabel = i18n("migration.source.imported");
  const managedLabel = i18n("migration.source.enterprisePolicy");
  const hasImported = sources.some(s => s === importedLabel);
  const hasManaged = sources.some(s => s === managedLabel);
  const el = document.getElementById(elementId);
  if (!hasImported && !hasManaged) { el.hidden = true; return; }
  if (hasImported && hasManaged) {
    el.textContent = i18n("migration.readonlyNote.both");
  } else if (hasImported) {
    el.textContent = i18n("migration.readonlyNote.imported");
  } else {
    el.textContent = i18n("migration.readonlyNote.managed");
  }
  el.hidden = false;
}

function showSection(id, hasItems) {
  document.getElementById(id).hidden = !hasItems;
}

// Build a paragraph where $1 in the message is replaced by a link.
function _buildLinkedParagraph(elementId, messageKey, linkTextKey, href) {
  const el = document.getElementById(elementId);
  el.innerHTML = "";
  const linkText = i18n(linkTextKey);
  const msg = i18n(messageKey, [linkText]);
  const parts = msg.split(linkText);
  el.appendChild(document.createTextNode(parts[0]));
  el.appendChild(_makeLink(href, linkText));
  if (parts[1]) el.appendChild(document.createTextNode(parts[1]));
}

function _buildDroppedDescription() {
  const el = document.getElementById("dropped-description");
  el.innerHTML = "";
  const linkTexts = [
    i18n("migration.dropped.linkVfs"),
    i18n("migration.dropped.linkWebdav"),
    i18n("migration.dropped.linkHomefolder"),
  ];
  const links = [
    "https://addons.thunderbird.net/search/?q=VFS",
    "https://addons.thunderbird.net/en-US/thunderbird/addon/vfs-provider-webdav/",
    "https://addons.thunderbird.net/en-US/thunderbird/addon/vfs-home-folder-access/",
  ];
  const msg = i18n("migration.dropped.description", linkTexts);
  let remaining = msg;
  for (let idx = 0; idx < linkTexts.length; idx++) {
    const pos = remaining.indexOf(linkTexts[idx]);
    if (pos === -1) continue;
    el.appendChild(document.createTextNode(remaining.slice(0, pos)));
    el.appendChild(_makeLink(links[idx], linkTexts[idx]));
    remaining = remaining.slice(pos + linkTexts[idx].length);
  }
  if (remaining) el.appendChild(document.createTextNode(remaining));
}

function _makeLink(href, text) {
  const a = document.createElement("a");
  a.href = href;
  a.textContent = text;
  a.addEventListener("click", e => { e.preventDefault(); browser.windows.openDefaultBrowser(href); });
  return a;
}

function renderIntro({ hasScripts }) {
  const el = document.getElementById("intro");
  el.innerHTML = "";

  const p1 = document.createElement("p");
  p1.textContent = i18n("migration.intro.p1");
  el.appendChild(p1);

  const p2 = document.createElement("p");
  const itemType = hasScripts
    ? i18n("migration.intro.itemType.templateAndScript")
    : i18n("migration.intro.itemType.template");
  p2.textContent = i18n("migration.intro.p2", [itemType]);
  el.appendChild(p2);

  const p3El = document.createElement("p");
  p3El.id = "intro-p3";
  el.appendChild(p3El);
  _buildLinkedParagraph("intro-p3",
    "migration.intro.p3",
    "migration.intro.p3.linkText",
    "https://addons.thunderbird.net/search/?q=VFS");

  const quote = document.getElementById("author-quote");
  quote.textContent = i18n("migration.intro.quote");
  const attr = document.createElement("span");
  attr.className = "attribution";
  attr.textContent = i18n("migration.intro.quoteAttribution");
  quote.appendChild(attr);
  quote.hidden = false;
}

async function render() {
  const { deprecatedUsages: results } = await browser.storage.local.get({
    deprecatedUsages: null,
  });
  if (!results) return null;

  const entries = await storage.getAllStorageEntries();
  const bundles = await storage.getActiveStorageEntries();
  const { auto, incompatibleScripts, deprecatedFs } = classifyFindings(results, entries, bundles);

  const autoCount = auto.templates.length + auto.scripts.length;
  const incompatibleCount = incompatibleScripts.length;
  const fsCount = deprecatedFs.templates.length + deprecatedFs.scripts.length;
  const manualCount = incompatibleCount + fsCount;

  const hasScripts = (auto.scripts.length + incompatibleScripts.length
    + deprecatedFs.scripts.length) > 0;
  renderIntro({ hasScripts });

  // Auto section
  showSection("auto-header", autoCount > 0);
  showSection("auto-intro", autoCount > 0);
  showSection("auto-section", autoCount > 0);
  showSection("auto-actions", autoCount > 0);
  if (autoCount > 0) {
    renderAutoItems(document.getElementById("auto-list"), auto.templates, auto.scripts);
    const btn = document.getElementById("btn-migrate");
    btn.textContent = i18n("migration.btn.startMigrationCount", [autoCount]);
    btn.disabled = false;
  }

  // Manual sections
  showSection("manual-header", manualCount > 0);
  showSection("manual-intro", manualCount > 0);

  // Incompatible scripts
  showSection("manual-incompatible", incompatibleCount > 0);
  if (incompatibleCount > 0) {
    _buildLinkedParagraph("incompatible-description",
      "migration.incompatible.description",
      "migration.incompatible.linkText",
      "https://github.com/jobisoft/quicktext/wiki/WebExtension-script-support");
    const list = document.getElementById("manual-incompatible-list");
    list.innerHTML = "";
    for (const s of incompatibleScripts) {
      const typeLabel = s.source ? `${s.source} script` : "script";
      const lines = s.details.map(d => ({ className: "item-tag", text: d.keyword }));
      renderItem(list, `${s.storageName} › ${s.script} (${typeLabel})`,
        [{ className: "item-reason", text: i18n("migration.reason.deprecatedApi") }, ...lines]);
    }
    _renderReadonlyNote("manual-incompatible-readonly-note", incompatibleScripts.map(s => s.source));
  }

  // Deprecated filesystem access
  showSection("manual-filesystem", fsCount > 0);
  if (fsCount > 0) {
    _buildLinkedParagraph("filesystem-description",
      "migration.filesystem.description",
      "migration.filesystem.linkText",
      "https://github.com/jobisoft/quicktext/wiki/Storage-locations#adding-files-to-a-storage-location");
    const list = document.getElementById("manual-filesystem-list");
    list.innerHTML = "";
    for (const t of deprecatedFs.templates) {
      const typeLabel = t.source ? `${t.source} template` : "template";
      const lines = t.tags.flatMap(tag => {
        const result = [{ className: "item-tag", text: tag.tag }];
        const folder = targetFolder(tag.tag);
        result.push({ className: "item-target", text: `→ ${utils.rewriteTagPreview(tag.tag, folder + "/?")}` });
        return result;
      });
      renderItem(list, `${t.storageName} › ${t.group} › ${t.template} (${typeLabel})`,
        [{ className: "item-reason", text: i18n("migration.reason.deprecatedFilesystem") }, ...lines]);
    }
    for (const s of deprecatedFs.scripts) {
      const typeLabel = s.source ? `${s.source} script` : "script";
      const lines = s.details.map(d => ({ className: "item-tag", text: d.keyword || d.call }));
      renderItem(list, `${s.storageName} › ${s.script} (${typeLabel})`,
        [{ className: "item-reason", text: i18n("migration.reason.deprecatedFilesystem") }, ...lines]);
    }
    const allSources = [
      ...deprecatedFs.templates.map(t => t.source),
      ...deprecatedFs.scripts.map(s => s.source),
    ];
    _renderReadonlyNote("manual-filesystem-readonly-note", allSources);
  }

  // Dropped FILE-based configuration sources
  const { droppedFileEntries } = await browser.storage.local.get({
    droppedFileEntries: null,
  });
  const droppedCount = droppedFileEntries?.length ?? 0;
  showSection("dropped-header", droppedCount > 0);
  showSection("dropped-intro", droppedCount > 0);
  showSection("dropped-section", droppedCount > 0);
  showSection("dropped-actions", droppedCount > 0);
  if (droppedCount > 0) {
    _buildDroppedDescription();
    const list = document.getElementById("dropped-list");
    list.innerHTML = "";
    for (const entry of droppedFileEntries) {
      const label = entry.type === "import"
        ? i18n("migration.label.fileImport") : i18n("migration.label.fileStorage");
      const desc = entry.type === "import"
        ? i18n("migration.desc.fileImport") : i18n("migration.desc.fileStorage");
      renderItem(list, `${label}: ${entry.path}`,
        [{ className: "item-reason", text: desc }]);
    }
  }

  return { auto, hasOtherSections: autoCount > 0 || manualCount > 0 };
}

async function backupConfigFile(entry) {
  const storageRef = entry.storageRef ?? null;
  const origPath = entry.path;

  const now = new Date();
  const ts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "_",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
    String(now.getMilliseconds()).padStart(3, "0"),
  ].join("");
  const dot = origPath.lastIndexOf(".");
  const backupPath = dot !== -1
    ? `${origPath.slice(0, dot)}_backup_${ts}${origPath.slice(dot)}`
    : `${origPath}_backup_${ts}`;

  const origFile = await vfs.readFile({ path: origPath, storageRef });
  const origContent = await origFile.text();
  if (!origContent) {
    throw new Error(`Backup aborted: config file ${origPath} is empty.`);
  }

  await vfs.writeFile({ path: backupPath, storageRef }, origFile, { overwrite: true });

  const verifyFile = await vfs.readFile({ path: backupPath, storageRef });
  const verifyContent = await verifyFile.text();
  if (verifyContent !== origContent) {
    throw new Error(`Backup verification failed for ${origPath}: backup content does not match original.`);
  }

  console.log(`[Migration] Backed up ${origPath} → ${backupPath} (${origContent.length} bytes verified)`);
}

function showProgressPopover() {
  const overlay = document.createElement("div");
  overlay.className = "popover-overlay";
  const box = document.createElement("div");
  box.className = "popover-box progress-box";

  const spinner = document.createElement("div");
  spinner.className = "spinner";
  box.appendChild(spinner);

  const statusLine = document.createElement("p");
  statusLine.className = "progress-status";
  statusLine.textContent = i18n("migration.progress.preparing");
  box.appendChild(statusLine);

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  return {
    update(text) { statusLine.textContent = text; },
    showSuccess(count, warning) {
      return new Promise(resolve => {
        spinner.remove();
        const check = document.createElement("div");
        check.className = "success-check";
        check.textContent = "✓";
        box.insertBefore(check, statusLine);
        statusLine.textContent = i18n("migration.success", [count]);
        if (warning) {
          const warn = document.createElement("p");
          warn.className = "progress-warning";
          warn.textContent = warning;
          box.insertBefore(warn, null);
        }
        const btn = document.createElement("button");
        btn.className = "popover-btn";
        btn.textContent = i18n("migration.btn.close");
        btn.addEventListener("click", () => { overlay.remove(); resolve(); });
        box.appendChild(btn);
        btn.focus();
      });
    },
    showError(message) {
      spinner.remove();
      const icon = document.createElement("div");
      icon.className = "error-icon";
      icon.textContent = "✗";
      box.insertBefore(icon, statusLine);
      statusLine.textContent = message;
      statusLine.style.color = "#c44";
      const btn = document.createElement("button");
      btn.className = "popover-btn";
      btn.textContent = i18n("migration.btn.close");
      btn.addEventListener("click", () => overlay.remove());
      box.appendChild(btn);
      btn.focus();
    },
  };
}

async function runMigration(auto) {
  const btn = document.getElementById("btn-migrate");
  btn.disabled = true;

  await browser.storage.session.set({ migrationRunning: true });
  const progress = showProgressPopover();

  try {
    const entries = await storage.getAllStorageEntries();
    const vfsEntries = entries.filter(e => e.type === "vfs" && !e.isReadOnly);
    const bundles = await Promise.all(
      vfsEntries.map(e =>
        storage.readBundleForEntry(e).then(b => ({ entry: e, bundle: b }))
      )
    );

    let totalMigrated = 0;
    let totalFailed = 0;
    for (const { entry, bundle } of bundles) {
      const templateFindings = auto.templates.filter(t => t.storageUuid === entry.uuid);
      const scriptFindings = auto.scripts.filter(s => s.storageUuid === entry.uuid);
      if (templateFindings.length === 0 && scriptFindings.length === 0) continue;

      progress.update(i18n("migration.progress.backingUp", [utils.getLeafName(entry.path)]));
      await backupConfigFile(entry);

      const result = await utils.runAutoMigration(
        entry, bundle,
        { templates: templateFindings, scripts: scriptFindings },
        vfs,
        ({ phase, file, current, total }) => {
          if (phase === "copy") {
            progress.update(i18n("migration.progress.copying", [file, current, total]));
          } else if (phase === "rewrite") {
            progress.update(i18n("migration.progress.rewriting"));
          }
        }
      );
      if (result.migrated > 0) {
        progress.update(i18n("migration.progress.saving"));
        await storage.setBundleForStorage(entry.uuid, {
          templates: bundle.templates,
          scripts: bundle.scripts,
        });
      }
      totalMigrated += result.migrated;
      totalFailed += result.failed;
    }

    progress.update(i18n("migration.progress.updating"));
    const allBundles = await storage.getActiveStorageEntries();
    const freshResults = await utils.detectDeprecatedUsages(allBundles);

    if (totalFailed > 0) {
      progress.showError(
        totalMigrated > 0
          ? i18n("migration.error.partialFailed", [totalMigrated, totalFailed])
          : i18n("migration.error.allFailed", [totalFailed])
      );
    } else {
      await progress.showSuccess(totalMigrated);
    }

    const { droppedFileEntries: droppedAfter } = await browser.storage.local.get({
      droppedFileEntries: null,
    });
    const hasRemaining = (freshResults.templates?.length > 0)
      || (freshResults.scripts?.length > 0)
      || (droppedAfter?.length > 0);
    if (!hasRemaining) {
      await browser.storage.session.set({ migrationRunning: false });
      const tab = await browser.tabs.getCurrent();
      if (tab) browser.tabs.remove(tab.id);
      return;
    }
  } catch (ex) {
    console.error("[Migration] Error:", ex);
    progress.showError(ex.message);
  } finally {
    await browser.storage.session.set({ migrationRunning: false });
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  localizeDocument();

  const version = browser.runtime.getManifest().version;
  const wizardTitle = i18n("migration.pageTitle", [version]);
  document.title = wizardTitle;
  document.getElementById("page-title").textContent = wizardTitle;

  // Intercept all link clicks to open in the default browser.
  document.addEventListener("click", e => {
    const a = e.target.closest("a[href]");
    if (a?.href?.startsWith("http")) {
      e.preventDefault();
      browser.windows.openDefaultBrowser(a.href);
    }
  });

  let state = await render();

  document.getElementById("btn-open-manager").addEventListener("click", () => {
    utils.openSettingsDialog();
  });

  document.getElementById("btn-wiki-storage").addEventListener("click", () => {
    browser.windows.openDefaultBrowser("https://github.com/jobisoft/quicktext/wiki/Storage-locations");
  });

  document.getElementById("btn-wiki-journey").addEventListener("click", () => {
    browser.windows.openDefaultBrowser("https://github.com/jobisoft/quicktext/wiki/Quicktext's-journey-from-a-legacy-Add%E2%80%90on-to-a-modern-WebExtension");
  });

  document.getElementById("btn-migrate").addEventListener("click", async () => {
    if (!state?.auto) return;
    if (await isManagerOpen()) {
      await showAlert(i18n("migration.alert.managerOpen"));
      return;
    }
    await runMigration(state.auto);
    state = await render();
  });

  document.getElementById("btn-dropped-ok").addEventListener("click", async () => {
    await browser.storage.local.remove("droppedFileEntries");
    if (!state?.hasOtherSections) {
      const tab = await browser.tabs.getCurrent();
      if (tab) browser.tabs.remove(tab.id);
      return;
    }
    state = await render();
  });
});
