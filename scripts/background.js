/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as quicktext from "../modules/quicktext.mjs";
import * as storage from "../modules/storage.mjs";
import * as menus from "../modules/menus.mjs";
import * as utils from "../modules/utils.mjs";
import { getStaticVariablesMenuStructure, getStaticOtherMenuStructure } from "../modules/menuStructure.mjs";


browser.runtime.onInstalled.addListener(details => {
  let manifest = browser.runtime.getManifest();
  if (!manifest.browser_specific_settings.gecko.update_url) {
    return
  };

  if (details.reason == "update") {
    browser.notifications.create("qt-update", {
      type: "basic",
      title: "Quicktext v6",
      message: `Quicktext GitHub Edition was updated to v${manifest.version}. Click for details.`,
    });
  }
});

browser.runtime.onMessageExternal.addListener(({ register_script_addon, available_scripts }, { id }) => {
  if (register_script_addon && available_scripts && available_scripts.length > 0) {
    return utils.registerExternalScriptAddon(id, register_script_addon, available_scripts);
  }
  return false;
});

browser.notifications.onClicked.addListener(notificationId => {
  switch (notificationId) {
    case "qt-deprecate-default-file-import":
      browser.tabs.create({
        url: `https://github.com/jobisoft/quicktext/wiki/Centrally-manage-configurations-and-templates`,
      });
      break;
    case "qt-update":
      browser.tabs.create({
        url: `https://github.com/jobisoft/quicktext/releases/tag/v${browser.runtime.getManifest().version}`,
      });
      break;
    case "qt-bad-entries":
      utils.openSettingsDialog();
      break;
    case "qt-incompatible-scripts":
      browser.tabs.create({
        url: `https://github.com/jobisoft/quicktext/issues/451`,
      });
      break;
  }
})

// Over the years, the storage concept has changed.
await storage.migrate();

// Fix invalid options:
// - reset the value of shortcutModifier to "alt", if it has not a valid value - see issue #177
const shortcutModifier = await storage.getPref("shortcutModifier");
if (!["alt", "control", "meta"].includes(shortcutModifier)) {
  await storage.setPref("shortcutModifier", "alt");
}

// Legacy: The XML files will be kept for backup, but are read only if they have
//         not already been migrated to local storage. Uninstalling Quicktext (which
//         clears the storage) and installing it again, will re-import the XML files.
//         For the future, users have to be reminded to backup their templates.
let templates = await storage.getTemplates();
if (!templates) {
  try {
    templates = await quicktext.readLegacyXmlTemplateFile().then(e => e.templates);
    console.log("Migrating XML template file to JSON stored in local storage.");
    await storage.setTemplates(templates);
  } catch { }
}
if (!templates) {
  templates = { groups: [], texts: [] };
  await storage.setTemplates(templates);
}

let scripts = await storage.getScripts();
if (!scripts) {
  try {
    scripts = await quicktext.readXmlScriptFile().then(e => e.scripts);
    console.log("Migrating XML script file to JSON stored in local storage.")
    await storage.setScripts(scripts);
  } catch { }
}
if (!scripts) {
  scripts = [];
  await storage.setScripts(scripts);
}

// Remove managed templates.
let cleanedTemplates = await utils.removeProtectedTemplates(templates);
if (templates != cleanedTemplates) {
  templates = cleanedTemplates;
  await storage.setTemplates(templates);
}

// Remove managed scripts.
let cleanedScripts = await utils.removeProtectedScripts(scripts);
if (scripts != cleanedScripts) {
  scripts = cleanedScripts;
  await storage.setScripts(scripts);
}

// Startup import.
let defaultImports = JSON.parse(await storage.getPref("defaultImport"));;
if (Array.isArray(defaultImports) && defaultImports.length > 0) {
  for (let defaultImportEntry of defaultImports) {
    let data;
    switch (defaultImportEntry.source.toLowerCase()) {
      case "file":
        try {
          // Import XML or JSON config data from the local file system.
          data = await browser.FileSystemAccess.readTextFile(defaultImportEntry.data);
        } catch (ex) {
          console.error("Failed to read file", ex);
        }
        break;
      case "url":
        try {
          // Import XML or JSON config data from remote server.
          data = await utils.fetchFileAsText(defaultImportEntry.data);
        } catch (ex) {
          console.error("Failed to read url", ex);
        }
        break;
    }
    if (data) {
      try {
        const imports = await quicktext.parseConfigFileData(data);
        if (imports.templates) {
          quicktext.mergeTemplates(templates, imports.templates, true);
        }
        if (imports.scripts) {
          quicktext.mergeScripts(scripts, imports.scripts, true);
        }
      } catch (ex) {
        console.error("Failed to parse data", ex);
      }
    }
  }
  await storage.setTemplates(templates);
  await storage.setScripts(scripts);
}

// Startup import via managed storage.
try {
  let { templates: managedTemplates } = await browser.storage.managed.get({ templates: null });
  if (managedTemplates) {
    quicktext.mergeTemplates(templates, managedTemplates, true);
  }
  let { scripts: managedScripts } = await browser.storage.managed.get({ scripts: null });
  if (managedScripts) {
    quicktext.mergeScripts(scripts, managedScripts, true);
  }
  await storage.setTemplates(templates);
  await storage.setScripts(scripts);
} catch {
  // No managed storage.
}

// Listener for the quicktext-legacy add-on (proxied toolbar commands).
messenger.runtime.onMessageExternal.addListener((info, sender) => {
  if (sender.id !== "quicktext-legacy@jobisoft.de") return;
  switch (info.command) {
    case "getTemplates":
      return storage.getTemplates();
    case "getPref":
      return storage.getPref(info.pref);
    case "getVariablesMenuStructure":
      return buildVariablesMenuStructure();
    case "getOtherMenuStructure":
      return buildOtherMenuStructure();
    case "getDateTimeFormat":
      return utils.getDateTimeFormat(info.data.format, info.data.timeStamp);
    case "insertVariable":
      return messenger.tabs
        .query({ windowId: info.windowId, type: "messageCompose" })
        .then(tabs => quicktext.insertVariable({ tabId: tabs[0].id, variable: info.aVar }));
    case "insertTemplate":
      return messenger.tabs
        .query({ windowId: info.windowId, type: "messageCompose" })
        .then(tabs => quicktext.insertTemplate(tabs[0].id, info.group, info.text));
    case "insertFile":
      return messenger.tabs
        .query({ windowId: info.windowId, type: "messageCompose" })
        .then(tabs => quicktext.insertFile(tabs[0].id, info.file, info.aType));
  }
});

// Listener for the compose script.
messenger.runtime.onMessage.addListener((info, sender, sendResponse) => {
  // All these functions return Promises.
  switch (info.command) {
    // Sent by scripts/compose.js
    case "getKeywordsAndShortcuts":
      return quicktext.getKeywordsAndShortcuts();
    // Sent by scripts/compose.js
    case "insertTemplate":
      return quicktext.insertTemplate(sender.tab.id, info.group, info.text);
    // Sent by modules/quicktextParser.mjs (running in compose window context)
    case "composeAPI":
      return browser.compose[info.func](sender.tab.id, ...info.params);
    // Sent by modules/quicktextParser.mjs (running in compose window context)
    case "messagesAPI":
      return browser.messages[info.func](...info.params);
    // Sent by modules/quicktextParser.mjs (running in compose window context)
    case "identitiesAPI":
      return browser.identities[info.func](...info.params);
    // Sent by modules/quicktextParser.mjs (running in compose window context)
    case "processTag":
      return quicktext.processTag({ tabId: info.tabId, tag: info.tag, variables: info.variables });
    // Sent by modules/quicktextParser.mjs (running in compose window context)
    case "getTag":
      return quicktext.getTag({ tabId: info.tabId, tag: info.tag, variables: info.variables });
    default:
      return false;
  }
});

// Add entry to tools menu.
browser.menus.create({
  contexts: ["tools_menu"],
  onclick: () => utils.openSettingsDialog(),
  title: browser.i18n.getMessage("quicktext.label"),
})

// Add Quicktext composeBody context menu.
await menus.buildComposeBodyMenu();

// Add listeners to open template manager.
browser.composeAction.onClicked.addListener(tab => { utils.openSettingsDialog() });
browser.browserAction.onClicked.addListener(tab => { utils.openSettingsDialog() });

// TODO: Move this into a module.
async function prepareComposeTab(tab) {
  if (tab.type != "messageCompose") {
    return;
  }

  // BUG: Thunderbird should wait with executeScript until tab is ready.
  //      Getting the compose details works around this.
  await messenger.compose.getComposeDetails(tab.id);
  await messenger.tabs.executeScript(tab.id, {
    file: "/scripts/compose.js"
  });
}

// Load compose script into all open compose windows.
let composeTabs = await messenger.tabs.query({ type: "messageCompose" });
for (let composeTab of composeTabs) {
  await prepareComposeTab(composeTab);
}

// Load compose script into any new compose window being opened.
messenger.tabs.onCreated.addListener(prepareComposeTab);

// Remove saved state data after tab closed.
messenger.tabs.onRemoved.addListener(tabId => {
  browser.storage.session.remove(`QuicktextStateData_${tabId}`);
});

// Prevent sending, if a popover is shown.
browser.compose.onBeforeSend.addListener(async (tab, details) => {
  let isPopoverShown = await messenger.tabs.sendMessage(tab.id, {
    isPopoverShown: true,
  });
  return {
    cancel: isPopoverShown
  }
})

// Collect the i18n strings still needed as __MSG_*__ placeholders in the XUL template.
function getLegacyToolbarLabels() {
  return Object.fromEntries([
    "quicktext.variables.label",
    "quicktext.other.label",
  ].map(key => [key, browser.i18n.getMessage(key)]));
}

// Build the full variables menu structure for the legacy toolbar.
// Resolves the abstract structure from menuStructure.mjs into a
// label-resolved tree that the companion add-on builds into XUL elements.
async function buildVariablesMenuStructure() {
  const i18n = (key, subs) => browser.i18n.getMessage(key, subs) || key;

  const now = new Date();
  function resolve(nodes) {
    return nodes.map(node => {
      if (node.type === "separator") return { type: "separator" };
      if (node.type === "dateTime") {
        const fieldType = node.format.split("-")[0];
        const label = i18n(`quicktext.${fieldType}.label`, [utils.getDateTimeFormat(node.format, now)]);
        return { type: "item", label, value: node.value };
      }
      const label = i18n(node.localeKey || `quicktext.${node.id}.label`);
      if (node.type === "group") return { type: "group", label, children: resolve(node.children) };
      return { type: "item", label, value: node.value };
    });
  }

  return resolve(getStaticVariablesMenuStructure());
}

async function buildOtherMenuStructure() {
  const i18n = key => browser.i18n.getMessage(key) || key;
  return getStaticOtherMenuStructure().map(node => ({
    type: "item",
    label: i18n(`quicktext.${node.id}.label`),
    mimeType: node.mimeType,
  }));
}

// Legacy: Inject toolbar into all already open compose windows.
{
  let legacyAddon;
  try { legacyAddon = await browser.management.get("quicktext-legacy@jobisoft.de"); } catch { }
  if (legacyAddon?.enabled) {
    const labels = getLegacyToolbarLabels();
    let windows = await browser.windows.getAll({ windowTypes: ["messageCompose"] })
    for (let window of windows) {
      browser.runtime.sendMessage("quicktext-legacy@jobisoft.de", { command: "injectLegacyToolbar", windowId: window.id, labels });
    }
  }
}

// Legacy: Inject toolbar into any new compose window being opened.
browser.windows.onCreated.addListener(async window => {
  if (window.type == "messageCompose") {
    let legacyAddon;
    try { legacyAddon = await browser.management.get("quicktext-legacy@jobisoft.de"); } catch { }
    if (legacyAddon?.enabled) {
      browser.runtime.sendMessage("quicktext-legacy@jobisoft.de", { command: "injectLegacyToolbar", windowId: window.id, labels: getLegacyToolbarLabels() });
    }
  }
});

// Legacy: Update toolbar if relevant settings changed.
new storage.StorageListener(
  {
    watchedPrefs: ["templates", "menuCollapse", "shortcutModifier"],
    listener: async (changes) => {
      let legacyAddon;
      try { legacyAddon = await browser.management.get("quicktext-legacy@jobisoft.de"); } catch { }
      if (!legacyAddon || legacyAddon.enabled === false) return;
      let windows = await browser.windows.getAll({ windowTypes: ["messageCompose"] })
      windows.forEach(window => browser.runtime.sendMessage("quicktext-legacy@jobisoft.de", { command: "updateLegacyToolbar", windowId: window.id }));
    }
  }
)

// Check if templates or scripts are invalid.
await utils.checkBadNameEntries(templates, scripts);
await utils.checkDuplicatedEntries(templates, scripts);
await utils.checkForIncompatibleScripts(scripts);
await utils.checkForDeprecatedAttachmentUsage(templates);
