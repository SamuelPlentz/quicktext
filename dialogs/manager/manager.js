/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as quicktext from "/modules/quicktext.mjs";
import * as storage from "/modules/storage.mjs";
import * as utils from "/modules/utils.mjs";
import { localizeDocument } from "/vendor/i18n.mjs";
const { computePosition, flip, shift } = FloatingUIDOM;

const i18n = (key, subs) => browser.i18n.getMessage(key, subs) || key;
const deepClone = obj => JSON.parse(JSON.stringify(obj));
const applyManaged = (el, isManaged) => {
  el.disabled = isManaged;
  el.title = isManaged ? i18n("controlled-via-managed-storage") : "";
};

function makeUnique(name, arr) {
  const sanitized = name
    .replaceAll("|", "/")
    .replaceAll("[[", "{[")
    .replaceAll("]]", "]}");
  let unique = sanitized;
  let suffix = 1;
  while (arr.includes(unique)) unique = `${sanitized} #${++suffix}`;
  return unique;
}

// ---------- State ----------

const state = {
  groups: [],         // working copy
  texts: [],          // working copy, parallel to groups
  scripts: [],        // working copy
  prefs: {},
  managedPrefs: new Set(),
  collapseState: [],  // true = expanded
  defaultImportEntries: [],
  storageEntries: [],
  activeStorageIdx: 0,
  selectedGroupIdx: -1,
  selectedTextIdx: -1,   // -1 = group row is selected
  selectedScriptIdx: -1,
  changed: false,
};

// ---------- Load / Save ----------

async function loadAll() {
  const [templates, scripts] = await Promise.all([
    storage.getTemplates(),
    storage.getScripts(),
  ]);

  state.groups = deepClone(templates?.groups || []);
  state.texts = deepClone(templates?.texts || []);
  state.scripts = deepClone(scripts || []);

  const prefNames = [
    "popup", "menuCollapse", "shortcutModifier", "shortcutTypeAdv",
    "keywordKey", "defaultImport", "storageLocations", "activeStorageLocationIdx", "counter",
  ];
  for (const pref of prefNames) {
    const { value, isManaged } = await storage.getPrefWithManagedInfo(pref);
    state.prefs[pref] = value;
    if (isManaged) state.managedPrefs.add(pref);
  }

  state.defaultImportEntries = JSON.parse(state.prefs.defaultImport || "[]");
  state.storageEntries = JSON.parse(state.prefs.storageLocations || '[{"source":"INTERNAL","data":"local"}]');
  state.activeStorageIdx = state.prefs.activeStorageLocationIdx ?? 0;

  const collapseStr = await storage.getPref("collapseState");
  if (collapseStr) {
    state.collapseState = collapseStr.split(";").map(s => s === "1");
  }
  while (state.collapseState.length < state.groups.length) {
    state.collapseState.push(true);
  }
}

async function saveAll() {
  await storage.setPref("popup", state.prefs.popup);
  await storage.setPref("menuCollapse", state.prefs.menuCollapse);
  await storage.setPref("shortcutModifier", state.prefs.shortcutModifier);
  await storage.setPref("shortcutTypeAdv", state.prefs.shortcutTypeAdv);
  await storage.setPref("keywordKey", state.prefs.keywordKey);
  await storage.setPref("defaultImport", JSON.stringify(state.defaultImportEntries));
  await storage.setPref("storageLocations", JSON.stringify(state.storageEntries));
  await storage.setPref("collapseState", state.collapseState.map(v => v ? "1" : "").join(";"));

  const templates = { groups: state.groups, texts: state.texts };
  await storage.setTemplates(templates);
  await storage.setScripts(state.scripts);
  await utils.checkBadNameEntries(templates, state.scripts);
  await utils.checkDuplicatedEntries(templates, state.scripts);

  markSaved();
}

function markChanged() {
  state.changed = true;
  document.getElementById("btn-save").disabled = false;
}

function markSaved() {
  state.changed = false;
  document.getElementById("btn-save").disabled = true;
}

// ---------- Tab management ----------

let _activeTab = "";

function switchTab(tabName) {
  _activeTab = tabName;
  for (const btn of document.querySelectorAll(".tab-btn")) {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  }
  for (const panel of document.querySelectorAll(".tab-panel")) {
    panel.hidden = panel.id !== `panel-${tabName}`;
  }
  updateScriptHelpButton();
}

function updateScriptHelpButton() {
  const onScriptsTab = _activeTab === "scripts";
  const hasIncompatible = onScriptsTab && state.selectedScriptIdx !== -1 &&
    isIncompatibleScript(state.scripts[state.selectedScriptIdx]);
  document.getElementById("btn-script-help").hidden = !hasIncompatible;
}

// ---------- General tab ----------

function updateCounterLegend() {
  document.getElementById("lbl-counter").textContent =
    `${i18n("quicktext.counter.label")}: ${state.prefs.counter}`;
}

function renderGeneral() {
  const managed = key => state.managedPrefs.has(key);

  const chkPopup = document.getElementById("chk-popup");
  chkPopup.checked = state.prefs.popup;
  applyManaged(chkPopup, managed("popup"));
  chkPopup.addEventListener("change", () => { state.prefs.popup = chkPopup.checked; markChanged(); });

  const chkCollapse = document.getElementById("chk-collapse");
  chkCollapse.checked = state.prefs.menuCollapse;
  applyManaged(chkCollapse, managed("menuCollapse"));
  chkCollapse.addEventListener("change", () => { state.prefs.menuCollapse = chkCollapse.checked; markChanged(); });

  const selModifier = document.getElementById("sel-modifier");
  selModifier.value = state.prefs.shortcutModifier;
  applyManaged(selModifier, managed("shortcutModifier"));
  selModifier.addEventListener("change", () => {
    state.prefs.shortcutModifier = selModifier.value;
    updateShortcutAdvAvailability();
    markChanged();
  });

  const chkShortcutAdv = document.getElementById("chk-shortcut-adv");
  chkShortcutAdv.checked = state.prefs.shortcutTypeAdv;
  chkShortcutAdv.addEventListener("change", () => { state.prefs.shortcutTypeAdv = chkShortcutAdv.checked; markChanged(); });
  updateShortcutAdvAvailability();

  const selKeyword = document.getElementById("sel-keyword");
  selKeyword.value = state.prefs.keywordKey;
  applyManaged(selKeyword, managed("keywordKey"));
  selKeyword.addEventListener("change", () => { state.prefs.keywordKey = selKeyword.value; markChanged(); });

  renderDefaultImportList();

  document.getElementById("btn-export-templates").addEventListener("click", exportTemplates);
  document.getElementById("btn-import-templates").addEventListener("click", importTemplates);
  document.getElementById("btn-export-scripts").addEventListener("click", exportScripts);
  document.getElementById("btn-import-scripts").addEventListener("click", importScripts);
  document.getElementById("btn-reset-counter").addEventListener("click", () => {
    state.prefs.counter = 0;
    storage.setPref("counter", 0);
    updateCounterLegend();
  });
  document.getElementById("btn-add-file").addEventListener("click", addDefaultImportFile);
  document.getElementById("btn-add-url").addEventListener("click", addDefaultImportUrl);
  document.getElementById("btn-remove-import").addEventListener("click", removeDefaultImport);
}

function updateShortcutAdvAvailability() {
  const ua = navigator.userAgent.toLowerCase();
  const forceOff = ua.includes("mac") ||
    (ua.includes("win") && state.prefs.shortcutModifier === "alt");
  const chk = document.getElementById("chk-shortcut-adv");
  const isManaged = state.managedPrefs.has("shortcutTypeAdv");
  chk.disabled = isManaged || forceOff;
  chk.title = isManaged ? i18n("controlled-via-managed-storage") : "";
}

function renderDefaultImportList() {
  const list = document.getElementById("default-import-list");
  list.innerHTML = "";
  const managed = state.managedPrefs.has("defaultImport");

  for (let i = 0; i < state.defaultImportEntries.length; i++) {
    const entry = state.defaultImportEntries[i];
    const li = document.createElement("li");
    li.dataset.idx = i;
    const icon = entry.source.toLowerCase() === "url" ? "🌎" : "💻";
    li.textContent = `${icon} ${entry.data}`;
    li.addEventListener("click", () => {
      list.querySelectorAll("li").forEach(el => el.classList.remove("selected"));
      li.classList.add("selected");
      document.getElementById("btn-remove-import").disabled = managed;
    });
    list.appendChild(li);
  }
  const managedTooltip = managed ? i18n("controlled-via-managed-storage") : "";
  document.getElementById("btn-add-file").disabled = managed;
  document.getElementById("btn-add-file").title = managedTooltip;
  document.getElementById("btn-add-url").disabled = managed;
  document.getElementById("btn-add-url").title = managedTooltip;
  document.getElementById("btn-remove-import").disabled = true;
  document.getElementById("btn-remove-import").title = managedTooltip;
}

async function addDefaultImportFile() {
  const path = await browser.FileSystemAccess.pickFile(i18n("quicktext.buttons.addFile.label"), "any");
  if (!path) return;
  state.defaultImportEntries.push({ source: "FILE", data: path });
  markChanged();
  renderDefaultImportList();
}

function addDefaultImportUrl() {
  const url = prompt(i18n("quicktext.prompt.addUrl.label"), "https://");
  if (!url) return;
  state.defaultImportEntries.push({ source: "URL", data: url });
  markChanged();
  renderDefaultImportList();
}

function removeDefaultImport() {
  const list = document.getElementById("default-import-list");
  const sel = list.querySelector("li.selected");
  if (!sel) return;
  state.defaultImportEntries.splice(parseInt(sel.dataset.idx), 1);
  markChanged();
  renderDefaultImportList();
}

// ---------- Template tree ----------

let dragSrc = null;

function renderTree() {
  const container = document.getElementById("template-tree");
  const scrollTop = container.scrollTop;
  container.innerHTML = "";

  for (let gi = 0; gi < state.groups.length; gi++) {
    const group = state.groups[gi];
    const expanded = state.collapseState[gi] !== false;

    const groupEl = document.createElement("div");
    groupEl.className = "tree-group";
    groupEl.dataset.gi = gi;

    const header = document.createElement("div");
    header.className = "tree-group-header";
    if (state.selectedGroupIdx === gi && state.selectedTextIdx === -1) {
      header.classList.add("selected");
    }
    header.draggable = !group.protected;

    const toggle = document.createElement("span");
    toggle.className = "tree-toggle";
    toggle.textContent = expanded ? "▼" : "▶";
    toggle.addEventListener("click", e => {
      e.stopPropagation();
      state.collapseState[gi] = !state.collapseState[gi];
      renderTree();
    });

    const nameSpan = document.createElement("span");
    nameSpan.className = "tree-name";
    nameSpan.textContent = group.name + (group.protected ? " 🔒" : "");

    header.appendChild(toggle);
    header.appendChild(nameSpan);
    header.addEventListener("click", () => selectItem(gi, -1));
    if (!group.protected) setupGroupDrag(header, gi);

    groupEl.appendChild(header);

    if (expanded) {
      const children = document.createElement("div");
      children.className = "tree-children";
      for (let ti = 0; ti < (state.texts[gi] || []).length; ti++) {
        const tmpl = state.texts[gi][ti];
        const tmplEl = document.createElement("div");
        tmplEl.className = "tree-template";
        tmplEl.dataset.gi = gi;
        tmplEl.dataset.ti = ti;
        if (state.selectedGroupIdx === gi && state.selectedTextIdx === ti) {
          tmplEl.classList.add("selected");
        }
        tmplEl.draggable = !group.protected;

        const nameEl = document.createElement("span");
        nameEl.className = "tree-name";
        nameEl.textContent = tmpl.name;

        const shortcutEl = document.createElement("span");
        shortcutEl.className = "tree-shortcut";
        shortcutEl.textContent = tmpl.shortcut || "";

        tmplEl.appendChild(nameEl);
        tmplEl.appendChild(shortcutEl);
        tmplEl.addEventListener("click", () => selectItem(gi, ti));
        if (!group.protected) setupTemplateDrag(tmplEl, gi, ti);

        children.appendChild(tmplEl);
      }
      groupEl.appendChild(children);
    }

    container.appendChild(groupEl);
  }

  container.scrollTop = scrollTop;
  updateTemplateButtons();
}

function selectItem(gi, ti) {
  commitTemplateEdits();
  state.selectedGroupIdx = gi;
  state.selectedTextIdx = ti;
  renderTree();
  renderTemplateDetail();
}

function commitTemplateEdits() {
  const gi = state.selectedGroupIdx;
  const ti = state.selectedTextIdx;
  if (gi === -1 || ti === -1) return;
  const tmpl = state.texts[gi]?.[ti];
  if (!tmpl) return;
  tmpl.text = document.getElementById("text-body").value;
  tmpl.type = document.getElementById("sel-type").value;
  tmpl.keyword = document.getElementById("text-keyword").value.replace(/\s/g, "");
  tmpl.subject = document.getElementById("text-subject").value;
  tmpl.attachments = document.getElementById("text-attachments").value;
  const advMode = state.prefs.shortcutTypeAdv && !isShortcutAdvForced();
  tmpl.shortcut = advMode
    ? document.getElementById("text-shortcut-adv").value.replace(/\D/g, "")
    : document.getElementById("sel-shortcut").value;
}

function renderTemplateDetail() {
  const gi = state.selectedGroupIdx;
  const ti = state.selectedTextIdx;

  if (gi === -1) {
    document.getElementById("detail-caption").textContent = i18n("group");
    setTemplateFieldsVisible(false);
    setTemplateFieldsEnabled(false);
    document.getElementById("text-title").value = "";
    return;
  }

  const isGroup = ti === -1;
  const prot = !!state.groups[gi]?.protected;

  document.getElementById("detail-caption").textContent = i18n(isGroup ? "group" : "template");
  setTemplateFieldsVisible(!isGroup);
  setTemplateFieldsEnabled(!prot);

  if (isGroup) {
    document.getElementById("text-title").value = state.groups[gi].name;
  } else {
    const tmpl = state.texts[gi][ti];
    document.getElementById("text-title").value = tmpl.name;
    document.getElementById("text-body").value = tmpl.text || "";
    document.getElementById("text-keyword").value = tmpl.keyword || "";
    document.getElementById("text-subject").value = tmpl.subject || "";
    document.getElementById("text-attachments").value = tmpl.attachments || "";
    document.getElementById("deprecated-attachment").hidden = !tmpl.attachments;
    document.getElementById("sel-type").value = tmpl.type || "text/plain";
    renderShortcutUI(tmpl.shortcut || "");
  }
}

function setTemplateFieldsVisible(show) {
  for (const el of document.querySelectorAll(".template-only")) {
    el.hidden = !show;
  }
}

function setTemplateFieldsEnabled(enabled) {
  for (const id of ["text-title", "text-body", "sel-type", "sel-shortcut",
    "text-shortcut-adv", "text-keyword", "text-subject", "text-attachments", "btn-variables"]) {
    const el = document.getElementById(id);
    if (el) el.disabled = !enabled;
  }
}

function isShortcutAdvForced() {
  const ua = navigator.userAgent.toLowerCase();
  return ua.includes("mac") || (ua.includes("win") && state.prefs.shortcutModifier === "alt");
}

function renderShortcutUI(shortcut) {
  const advMode = state.prefs.shortcutTypeAdv && !isShortcutAdvForced();
  document.getElementById("sel-shortcut").hidden = advMode;
  document.getElementById("text-shortcut-adv").hidden = !advMode;

  const modKey = { alt: i18n("quicktext.altKey.label"), control: i18n("quicktext.controlKey.label"), meta: i18n("quicktext.metaKey.label") }[state.prefs.shortcutModifier] || "";
  document.getElementById("label-modifier").textContent = `${modKey}+`;

  if (advMode) {
    document.getElementById("text-shortcut-adv").value = shortcut;
  } else {
    const sel = document.getElementById("sel-shortcut");
    if (shortcut === "0") sel.selectedIndex = 10;
    else if (shortcut && !isNaN(parseInt(shortcut))) sel.selectedIndex = parseInt(shortcut);
    else sel.selectedIndex = 0;
    disableUsedShortcuts(shortcut);
  }
}

function disableUsedShortcuts(currentShortcut) {
  const sel = document.getElementById("sel-shortcut");
  for (const opt of sel.options) opt.disabled = false;
  for (let g = 0; g < state.groups.length; g++) {
    for (const tmpl of (state.texts[g] || [])) {
      const s = tmpl.shortcut;
      if (!s || s === currentShortcut) continue;
      const idx = s === "0" ? 10 : parseInt(s);
      if (sel.options[idx]) sel.options[idx].disabled = true;
    }
  }
}

function updateTemplateButtons() {
  const gi = state.selectedGroupIdx;
  const prot = gi !== -1 && state.groups[gi]?.protected;
  document.getElementById("btn-add-template").disabled = gi === -1 || prot;
  document.getElementById("btn-remove-template").disabled = gi === -1 || prot;
}

function addGroup() {
  commitTemplateEdits();
  const name = makeUnique(i18n("newGroup"), state.groups.map(g => g.name));
  state.groups.push({ name, protected: false });
  state.texts.push([]);
  state.collapseState.push(true);
  state.selectedGroupIdx = state.groups.length - 1;
  state.selectedTextIdx = -1;
  markChanged();
  renderTree();
  renderTemplateDetail();
  updateVariablesMenu();
  const el = document.getElementById("text-title");
  el.focus();
  el.select();
}

function addTemplate() {
  commitTemplateEdits();
  let gi = state.selectedGroupIdx;
  if (gi === -1) { if (!state.groups.length) return; gi = 0; }
  const name = makeUnique(i18n("newTemplate"), (state.texts[gi] || []).map(t => t.name));
  if (!state.texts[gi]) state.texts[gi] = [];
  state.texts[gi].push({ name, text: "", shortcut: "", type: "text/plain", keyword: "", subject: "", attachments: "" });
  state.collapseState[gi] = true;
  state.selectedGroupIdx = gi;
  state.selectedTextIdx = state.texts[gi].length - 1;
  markChanged();
  renderTree();
  renderTemplateDetail();
  const el = document.getElementById("text-title");
  el.focus();
  el.select();
}

function removeTemplateOrGroup() {
  const gi = state.selectedGroupIdx;
  const ti = state.selectedTextIdx;
  if (gi === -1) return;
  const name = ti === -1 ? state.groups[gi].name : state.texts[gi][ti].name;
  if (!confirm(i18n("remove", [name]))) return;
  if (ti === -1) {
    state.groups.splice(gi, 1);
    state.texts.splice(gi, 1);
    state.collapseState.splice(gi, 1);
    state.selectedGroupIdx = Math.min(gi, state.groups.length - 1);
    if (state.groups.length === 0) state.selectedGroupIdx = -1;
    state.selectedTextIdx = -1;
  } else {
    state.texts[gi].splice(ti, 1);
    state.selectedTextIdx = state.texts[gi].length > 0
      ? Math.min(ti, state.texts[gi].length - 1) : -1;
  }
  markChanged();
  renderTree();
  renderTemplateDetail();
  updateVariablesMenu();
}

// ---------- Template drag-and-drop ----------

function setupGroupDrag(el, gi) {
  el.addEventListener("dragstart", e => {
    dragSrc = { type: "group", gi };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "group");
  });
  el.addEventListener("dragover", e => {
    if (dragSrc?.type !== "group") return;
    e.preventDefault();
    el.classList.add("drag-over");
  });
  el.addEventListener("dragleave", () => el.classList.remove("drag-over"));
  el.addEventListener("drop", e => {
    e.preventDefault();
    el.classList.remove("drag-over");
    if (dragSrc?.type !== "group" || dragSrc.gi === gi) { dragSrc = null; return; }
    commitTemplateEdits();
    const src = dragSrc.gi;
    const [grp] = state.groups.splice(src, 1);
    const [txts] = state.texts.splice(src, 1);
    const [col] = state.collapseState.splice(src, 1);
    const dest = src < gi ? gi - 1 : gi;
    state.groups.splice(dest, 0, grp);
    state.texts.splice(dest, 0, txts);
    state.collapseState.splice(dest, 0, col);
    state.selectedGroupIdx = dest;
    state.selectedTextIdx = -1;
    dragSrc = null;
    markChanged();
    renderTree();
    renderTemplateDetail();
  });
}

function setupTemplateDrag(el, gi, ti) {
  el.addEventListener("dragstart", e => {
    dragSrc = { type: "template", gi, ti };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "template");
  });
  el.addEventListener("dragover", e => {
    if (dragSrc?.type !== "template") return;
    e.preventDefault();
    el.classList.add("drag-over");
  });
  el.addEventListener("dragleave", () => el.classList.remove("drag-over"));
  el.addEventListener("drop", e => {
    e.preventDefault();
    el.classList.remove("drag-over");
    if (dragSrc?.type !== "template" || (dragSrc.gi === gi && dragSrc.ti === ti)) { dragSrc = null; return; }
    commitTemplateEdits();
    const [tmpl] = state.texts[dragSrc.gi].splice(dragSrc.ti, 1);
    if (!state.texts[gi]) state.texts[gi] = [];
    const dest = dragSrc.gi === gi && dragSrc.ti < ti ? ti - 1 : ti;
    state.texts[gi].splice(dest, 0, tmpl);
    state.selectedGroupIdx = gi;
    state.selectedTextIdx = dest;
    dragSrc = null;
    markChanged();
    renderTree();
    renderTemplateDetail();
  });
}

// ---------- Title auto-save ----------

function onTitleInput() {
  const gi = state.selectedGroupIdx;
  const ti = state.selectedTextIdx;
  if (gi === -1) return;
  let value = document.getElementById("text-title").value.trim() || i18n(ti === -1 ? "newGroup" : "newTemplate");

  if (ti === -1) {
    const others = state.groups.map((g, i) => i === gi ? null : g.name).filter(Boolean);
    value = makeUnique(value, others);
    state.groups[gi].name = value;
    const nameEl = document.querySelector(`.tree-group[data-gi="${gi}"] .tree-name`);
    if (nameEl) nameEl.textContent = value + (state.groups[gi].protected ? " 🔒" : "");
  } else {
    const others = (state.texts[gi] || []).map((t, i) => i === ti ? null : t.name).filter(Boolean);
    value = makeUnique(value, others);
    state.texts[gi][ti].name = value;
    const nameEl = document.querySelector(`.tree-template[data-gi="${gi}"][data-ti="${ti}"] .tree-name`);
    if (nameEl) nameEl.textContent = value;
  }
  markChanged();
}

// ---------- Scripts ----------

function renderScriptList() {
  const list = document.getElementById("script-list");
  list.innerHTML = "";
  for (let i = 0; i < state.scripts.length; i++) {
    const script = state.scripts[i];
    const li = document.createElement("li");
    li.dataset.idx = i;
    if (i === state.selectedScriptIdx) li.classList.add("selected");
    const nameSpan = document.createElement("span");
    nameSpan.textContent = script.name;
    li.appendChild(nameSpan);
    if (isIncompatibleScript(script)) {
      const warn = document.createElement("span");
      warn.textContent = " ⚠️";
      li.appendChild(warn);
    }
    li.addEventListener("click", () => selectScript(i));
    list.appendChild(li);
  }
  updateScriptButtons();
}

function isIncompatibleScript(script) {
  return ["this.mWindow", "this.mVariables", "this.mQuicktext"].some(t => script.script?.includes(t));
}

function selectScript(idx) {
  commitScriptEdits();
  state.selectedScriptIdx = idx;
  renderScriptList();
  renderScriptDetail();
}

function commitScriptEdits() {
  const idx = state.selectedScriptIdx;
  if (idx === -1 || !state.scripts[idx]) return;
  state.scripts[idx].script = document.getElementById("script-body").value;
}

function renderScriptDetail() {
  const idx = state.selectedScriptIdx;
  const script = idx !== -1 ? state.scripts[idx] : null;
  document.getElementById("script-title").value = script?.name ?? "";
  document.getElementById("script-title").disabled = !script || !!script.protected;
  document.getElementById("script-body").value = script?.script ?? "";
  document.getElementById("script-body").disabled = !script || !!script.protected;
  const incompatible = script ? isIncompatibleScript(script) : false;
  const warn = document.getElementById("script-warning");
  warn.hidden = !incompatible;
  if (incompatible) warn.textContent = `⚠️ ${i18n("quicktext.scripthelp.label")}`;
  updateScriptHelpButton();
}

function updateScriptButtons() {
  const idx = state.selectedScriptIdx;
  const script = idx !== -1 ? state.scripts[idx] : null;
  document.getElementById("btn-remove-script").disabled = !script || !!script.protected;
}

function onScriptTitleInput() {
  const idx = state.selectedScriptIdx;
  if (idx === -1) return;
  let value = document.getElementById("script-title").value.trim() || i18n("newScript");
  const others = state.scripts.map((s, i) => i === idx ? null : s.name).filter(Boolean);
  value = makeUnique(value, others);
  state.scripts[idx].name = value;
  const li = document.querySelector(`#script-list li[data-idx="${idx}"] span`);
  if (li) li.textContent = value;
  updateVariablesMenu();
  markChanged();
}

function addScript() {
  commitScriptEdits();
  const name = makeUnique(i18n("newScript"), state.scripts.map(s => s.name));
  state.scripts.push({ name, script: "", protected: false });
  state.selectedScriptIdx = state.scripts.length - 1;
  markChanged();
  renderScriptList();
  renderScriptDetail();
  updateVariablesMenu();
  const el = document.getElementById("script-title");
  el.focus();
  el.select();
}

function removeScript() {
  const idx = state.selectedScriptIdx;
  if (idx === -1) return;
  if (!confirm(i18n("remove", [state.scripts[idx].name]))) return;
  state.scripts.splice(idx, 1);
  state.selectedScriptIdx = state.scripts.length > 0 ? Math.max(0, idx - 1) : -1;
  markChanged();
  renderScriptList();
  renderScriptDetail();
  updateVariablesMenu();
}

// ---------- Advanced tab ----------

function renderAdvanced() {
  renderStorageList();
  document.getElementById("btn-add-storage-folder").addEventListener("click", addStorageFolder);
  document.getElementById("btn-remove-storage").addEventListener("click", removeStorage);
  document.getElementById("btn-select-storage").addEventListener("click", selectStorage);
}

function renderStorageList() {
  const list = document.getElementById("storage-list");
  list.innerHTML = "";
  const ICONS = { url: "🌎", file: "💻", internal: "📦" };
  for (let i = 0; i < state.storageEntries.length; i++) {
    const entry = state.storageEntries[i];
    const li = document.createElement("li");
    li.dataset.idx = i;
    if (i === state.activeStorageIdx) li.classList.add("active");
    const icon = ICONS[entry.source.toLowerCase()] ?? "⚠️";
    const label = entry.source.toLowerCase() === "internal"
      ? i18n(`quicktext.storage.internal.${entry.data.toLowerCase()}.label`)
      : entry.data;
    li.textContent = `${icon} ${label}`;
    li.addEventListener("click", () => {
      list.querySelectorAll("li").forEach(el => el.classList.remove("selected"));
      li.classList.add("selected");
      updateStorageButtons();
    });
    list.appendChild(li);
  }
  updateStorageButtons();
}

function updateStorageButtons() {
  const managed = state.managedPrefs.has("storageLocations") || state.managedPrefs.has("activeStorageLocationIdx");
  const list = document.getElementById("storage-list");
  const sel = list.querySelector("li.selected");
  const idx = sel ? parseInt(sel.dataset.idx) : -1;
  const managedTooltip = managed ? i18n("controlled-via-managed-storage") : "";
  document.getElementById("btn-add-storage-folder").disabled = managed;
  document.getElementById("btn-add-storage-folder").title = managedTooltip;
  document.getElementById("btn-remove-storage").disabled = managed || idx <= 0 || idx === state.activeStorageIdx;
  document.getElementById("btn-remove-storage").title = managedTooltip;
  document.getElementById("btn-select-storage").disabled = managed || idx < 0 || idx === state.activeStorageIdx;
  document.getElementById("btn-select-storage").title = managedTooltip;
}

async function addStorageFolder() {
  const folder = await browser.FileSystemAccess.pickFolder(i18n("quicktext.buttons.addFolder.label"));
  if (!folder) return;
  state.storageEntries.push({ source: "FILE", data: folder });
  markChanged();
  renderStorageList();
}

function removeStorage() {
  const list = document.getElementById("storage-list");
  const sel = list.querySelector("li.selected");
  if (!sel) return;
  const idx = parseInt(sel.dataset.idx);
  if (idx <= 0) return;
  state.storageEntries.splice(idx, 1);
  if (state.activeStorageIdx > idx) state.activeStorageIdx--;
  else if (state.activeStorageIdx >= state.storageEntries.length) state.activeStorageIdx = 0;
  markChanged();
  renderStorageList();
}

async function selectStorage() {
  const list = document.getElementById("storage-list");
  const sel = list.querySelector("li.selected");
  if (!sel) return;
  const idx = parseInt(sel.dataset.idx);
  await storage.setPref("storageLocations", JSON.stringify(state.storageEntries));
  await storage.setPref("activeStorageLocationIdx", idx);
  browser.runtime.reload();
}

// ---------- Variables nested menu ----------

function buildVariablesMenu() {
  const menu = document.getElementById("variables-menu");
  menu.innerHTML = "";

  const makeItem = (label, val) => {
    const btn = document.createElement("button");
    btn.className = "var-item";
    btn.textContent = label;
    btn.dataset.val = val;
    return btn;
  };

  const makeSeparator = () => {
    const sep = document.createElement("div");
    sep.className = "var-separator";
    return sep;
  };

  const addGrp = (label, pairs, className = "") => {
    const grp = document.createElement("div");
    grp.className = "var-group" + (className ? ` ${className}` : "");

    const lbl = document.createElement("span");
    lbl.className = "var-group-label";
    lbl.textContent = label;
    grp.appendChild(lbl);

    const sub = document.createElement("div");
    sub.className = "var-submenu";
    for (const entry of pairs) {
      sub.appendChild(entry === null ? makeSeparator() : makeItem(entry[0], entry[1]));
    }
    grp.appendChild(sub);
    menu.appendChild(grp);
    return grp;
  };

  const contactFields = name => [
    [i18n("quicktext.firstname.label"), `${name}=firstname`],
    [i18n("quicktext.lastname.label"), `${name}=lastname`],
    [i18n("quicktext.fullname.label"), `${name}=fullname`],
    [i18n("quicktext.displayname.label"), `${name}=displayname`],
    [i18n("quicktext.nickname.label"), `${name}=nickname`],
    [i18n("quicktext.email.label"), `${name}=email`],
    [i18n("quicktext.workphone.label"), `${name}=workphone`],
    [i18n("quicktext.faxnumber.label"), `${name}=faxnumber`],
    [i18n("quicktext.cellularnumber.label"), `${name}=cellularnumber`],
    [i18n("quicktext.jobtitle.label"), `${name}=jobtitle`],
    [i18n("quicktext.custom1.label"), `${name}=custom1`],
    [i18n("quicktext.custom2.label"), `${name}=custom2`],
    [i18n("quicktext.custom3.label"), `${name}=custom3`],
    [i18n("quicktext.custom4.label"), `${name}=custom4`],
  ];

  addGrp(i18n("quicktext.to.label"), contactFields("TO"));
  addGrp(i18n("quicktext.from.label"), contactFields("FROM"));

  addGrp(i18n("quicktext.attachments.label"), [
    [i18n("quicktext.filename.label"), "ATT=name"],
    [i18n("quicktext.filenameAndSize.label"), "ATT=full"],
    null,
    [i18n("attachmentFile"), "ATTACHMENT=FILE|<path>"],
  ]);

  const now = new Date();
  addGrp(i18n("quicktext.dateTime.label"), [
    [i18n("date", [now.toLocaleDateString()]), "DATE"],
    [i18n("date", [now.toLocaleDateString(undefined, { dateStyle: "full" })]), "DATE=long"],
    [now.toLocaleDateString(undefined, { month: "long" }), "DATE=monthname"],
    [i18n("time", [now.toLocaleTimeString(undefined, { timeStyle: "short" })]), "TIME"],
    [i18n("time", [now.toLocaleTimeString(undefined, { timeStyle: "medium" })]), "TIME=seconds"],
  ]);

  addGrp(i18n("quicktext.other.label"), [
    [i18n("quicktext.clipboard.label"), "CLIPBOARD"],
    [i18n("quicktext.counter.label"), "COUNTER"],
    [i18n("quicktext.input.label"), "INPUT=name|type|options"],
    [i18n("quicktext.selection.label"), "SELECTION"],
    [i18n("quicktext.orgatt.label"), "ORGATT=\\n"],
    [i18n("quicktext.orgheader.label"), "ORGHEADER=type|\\n"],
    [i18n("quicktext.subject.label"), "SUBJECT"],
    [i18n("quicktext.url.label"), "URL=url|data"],
    [i18n("quicktext.insertfile.label"), "FILE=<path>"],
    [i18n("quicktext.image.label"), "IMAGE=FILE|<path>"],
    [i18n("quicktext.version.label"), "VERSION"],
    null,
    [i18n("quicktext.header.label"), "HEADER=type|value"],
    [i18n("quicktext.cursor.label"), "CURSOR"],
  ]);

  updateVariablesMenu();
}

function updateVariablesMenu() {
  const menu = document.getElementById("variables-menu");
  if (!menu) return;
  for (const grp of [...menu.querySelectorAll(".var-group.dynamic")]) grp.remove();

  const addGrp = (label, pairs) => {
    const grp = document.createElement("div");
    grp.className = "var-group dynamic";

    const lbl = document.createElement("span");
    lbl.className = "var-group-label";
    lbl.textContent = label;
    grp.appendChild(lbl);

    const sub = document.createElement("div");
    sub.className = "var-submenu";
    for (const [itemLabel, val] of pairs) {
      const btn = document.createElement("button");
      btn.className = "var-item";
      btn.textContent = itemLabel;
      btn.dataset.val = val;
      sub.appendChild(btn);
    }
    grp.appendChild(sub);
    menu.appendChild(grp);
  };

  if (state.groups.some((_, gi) => (state.texts[gi] || []).length > 0)) {
    const pairs = [];
    for (let gi = 0; gi < state.groups.length; gi++) {
      for (const tmpl of (state.texts[gi] || [])) {
        pairs.push([`${state.groups[gi].name} / ${tmpl.name}`, `TEXT=${state.groups[gi].name}|${tmpl.name}`]);
      }
    }
    addGrp(i18n("quicktext.templates.label"), pairs);
  }

  if (state.scripts.length > 0) {
    addGrp(i18n("quicktext.scripts.label"), state.scripts.map(s => [s.name, `SCRIPT=${s.name}`]));
  }
}

function insertVariable(varStr) {
  const subjectEl = document.getElementById("text-subject");
  const bodyEl = document.getElementById("text-body");
  const target = document.activeElement === subjectEl ? subjectEl : bodyEl;
  const start = target.selectionStart;
  const end = target.selectionEnd;
  target.value = target.value.slice(0, start) + `[[${varStr}]]` + target.value.slice(end);
  const pos = start + varStr.length + 4;
  target.setSelectionRange(pos, pos);
  target.focus();
  markChanged();
}

// ---------- Import / Export ----------

async function exportTemplates() {
  const templates = await storage.getTemplates();
  if (templates) await utils.writeFileToDisc(JSON.stringify({ templates }, null, 2), "templates.json");
  window.focus();
}
async function exportScripts() {
  const scripts = await storage.getScripts();
  if (scripts) await utils.writeFileToDisc(JSON.stringify({ scripts }, null, 2), "scripts.json");
  window.focus();
}

async function importTemplates() {
  const file = await pickFile([".json", ".xml"]);
  if (!file) return;
  const content = await readFileText(file);
  const result = await quicktext.parseConfigFileData(content);
  if (!result?.templates) return;
  for (let gi = 0; gi < result.templates.groups.length; gi++) {
    if (result.templates.groups[gi].protected) continue;
    state.groups.push(result.templates.groups[gi]);
    state.texts.push(result.templates.texts?.[gi] || []);
    state.collapseState.push(true);
  }
  markChanged();
  renderTree();
  updateVariablesMenu();
}

async function importScripts() {
  const file = await pickFile([".json", ".xml"]);
  if (!file) return;
  const content = await readFileText(file);
  const result = await quicktext.parseConfigFileData(content);
  if (!result?.scripts) return;
  for (const script of result.scripts) {
    if (!script.protected) state.scripts.push(script);
  }
  markChanged();
  renderScriptList();
  updateVariablesMenu();
}

function pickFile(accept) {
  return new Promise(resolve => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept.join(",");
    input.addEventListener("change", () => resolve(input.files[0] || null));
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = e => { if (e.target.readyState === FileReader.DONE) resolve(e.target.result); };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

// ---------- Save / Close ----------

async function doSave() {
  commitTemplateEdits();
  commitScriptEdits();
  await saveAll();
}

function onClose() {
  commitTemplateEdits();
  commitScriptEdits();
  window.close();
}

window.addEventListener("beforeunload", e => {
  if (!state.changed) return;
  e.preventDefault();
  e.returnValue = "";
});

// ---------- Init ----------

async function init() {
  localizeDocument();
  await loadAll();

  // Tab buttons
  for (const btn of document.querySelectorAll(".tab-btn")) {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  }

  // General tab
  renderGeneral();
  updateCounterLegend();

  new storage.StorageListener({
    watchedPrefs: ["counter"],
    listener: changes => {
      if ("counter" in changes) {
        state.prefs.counter = changes.counter.newValue;
        updateCounterLegend();
      }
    },
  });

  // Template tab buttons
  document.getElementById("btn-add-group").addEventListener("click", addGroup);
  document.getElementById("btn-add-template").addEventListener("click", addTemplate);
  document.getElementById("btn-remove-template").addEventListener("click", removeTemplateOrGroup);

  // Template detail fields
  document.getElementById("text-title").addEventListener("input", onTitleInput);
  document.getElementById("text-body").addEventListener("input", markChanged);
  document.getElementById("sel-type").addEventListener("change", markChanged);
  document.getElementById("sel-shortcut").addEventListener("change", markChanged);
  document.getElementById("text-shortcut-adv").addEventListener("input", markChanged);
  document.getElementById("text-keyword").addEventListener("input", e => {
    e.target.value = e.target.value.replace(/\s/g, "");
    markChanged();
  });
  document.getElementById("text-subject").addEventListener("input", markChanged);
  document.getElementById("text-attachments").addEventListener("input", e => {
    document.getElementById("deprecated-attachment").hidden = !e.target.value;
    markChanged();
  });

  // Variables nested menu
  buildVariablesMenu();

  document.getElementById("btn-variables").addEventListener("click", e => {
    const menu = document.getElementById("variables-menu");
    menu.hidden = !menu.hidden;
    e.stopPropagation();
  });

  document.getElementById("variables-menu").addEventListener("mouseover", e => {
    const grp = e.target.closest(".var-group");
    const lbl = grp?.querySelector(":scope > .var-group-label");
    const sub = grp?.querySelector(":scope > .var-submenu");
    if (!lbl || !sub) return;
    computePosition(lbl, sub, {
      placement: "left-start",
      middleware: [flip(), shift({ padding: 4 })],
    }).then(({ x, y }) => {
      sub.style.left = `${x}px`;
      sub.style.top = `${y}px`;
    });
  });

  document.getElementById("variables-menu").addEventListener("click", async e => {
    const btn = e.target.closest(".var-item");
    if (!btn) return;
    document.getElementById("variables-menu").hidden = true;
    const val = btn.dataset.val;

    if (val.includes("<path>")) {
      let title, filter;
      if (val.startsWith("IMAGE=")) {
        title = i18n("insertImage");
        filter = "images";
      } else if (val.startsWith("ATTACHMENT=")) {
        title = i18n("attachmentFile");
        filter = "any";
      } else if (val.startsWith("FILE=")) {
        title = i18n("insertFile");
        filter = "any";
      } else {
        console.error(`pickFile: unknown variable type for value "${val}"`);
        return;
      }
      const path = await browser.FileSystemAccess.pickFile(title, filter);
      if (path) insertVariable(val.replace("<path>", path));
    } else {
      insertVariable(val);
    }
  });

  document.addEventListener("click", () => {
    document.getElementById("variables-menu").hidden = true;
  });

  // Script tab
  document.getElementById("btn-add-script").addEventListener("click", addScript);
  document.getElementById("btn-remove-script").addEventListener("click", removeScript);
  document.getElementById("btn-community-scripts").addEventListener("click", () =>
    browser.windows.openDefaultBrowser("https://github.com/jobisoft/quicktext/wiki/Community-scripts"));
  document.getElementById("btn-script-docs").addEventListener("click", () =>
    browser.windows.openDefaultBrowser("https://github.com/jobisoft/quicktext/wiki/WebExtension-script-support"));
  document.getElementById("script-title").addEventListener("input", onScriptTitleInput);
  document.getElementById("script-body").addEventListener("input", markChanged);

  // Bottom buttons
  document.getElementById("btn-save").addEventListener("click", doSave);
  document.getElementById("btn-close").addEventListener("click", onClose);
  document.getElementById("btn-help").addEventListener("click", () =>
    browser.windows.openDefaultBrowser("https://github.com/jobisoft/quicktext/wiki/"));
  document.getElementById("btn-script-help").addEventListener("click", () =>
    browser.windows.openDefaultBrowser("https://github.com/jobisoft/quicktext/issues/451"));

  // Keyboard
  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); doSave(); }
    if (e.key === "Escape") onClose();
  });

  // Initial render
  renderTree();
  renderTemplateDetail();
  renderScriptList();
  renderScriptDetail();
  renderAdvanced();

  switchTab("templates");
}

document.addEventListener("DOMContentLoaded", init);
