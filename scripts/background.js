/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as quicktext from "../modules/quicktext.mjs";
import * as storage from "../modules/storage.mjs";
import * as menus from "../modules/menus.mjs";
import * as utils from "../modules/utils.mjs";

// Legacy: Register global urls.
await browser.LegacyHelper.registerGlobalUrls([
  ["content", "quicktext", "xul_settings_dialog/"],
  ["resource", "quicktext", "."],
]);

// Define default prefs.
let defaultPrefs = {
  "counter": 0,
  "templateFolder": "",
  "defaultImport": "",
  "menuCollapse": true,
  "toolbar": true,
  "popup": true,
  "keywordKey": "Tab",
  "shortcutModifier": "alt",
  "shortcutTypeAdv": false,
  "collapseState": ""
};
await storage.init(defaultPrefs);

// Fix invalid options:
// - reset the value of shortcutModifier to "alt", if it has not a valid value - see issue #177
const shortcutModifier = await storage.getPref("shortcutModifier");
if (!["alt", "control", "meta"].includes(shortcutModifier)) {
  await storage.setPref("shortcutModifier", "alt");
}

// Define prefs, which can be overridden by system admins. Admins have to migrate
// these manually from legacy prefs to managed storage.
const managedPrefs = [
  "defaultImport",
];
for (let managedPref of managedPrefs) {
  try {
    let override = await browser.storage.managed.get({ [managedPref]: null });
    if (override[managedPref] !== null) {
      await storage.setPref(managedPref, override[managedPref]);
    }
    await storage.setPref(`${managedPref}.managed`, true);
  } catch {
    // No managed storage available.
    await storage.setPref(`${managedPref}.managed`, false);
  }
}

// Legacy: The XML files will be kept for backup, but are read only if they have
//         not already been migrated to local storage. Uninstalling Quicktext (which
//         clears the storage) and installing it again, will re-import the XML files.
//         For the future, users have to be remembered to backup their templates.
let templates = await storage.getTemplates();
if (!templates) {
  console.log("Migrating XML template file to JSON stored in local storage.")
  templates = await quicktext.readLegacyXmlTemplateFile().then(
    e => e.templates
  );
  // After the migration code is removed, this needs to be used for initialization.
  // templates = {};
  await storage.setTemplates(templates);
}

let scripts = await storage.getScripts();
if (!scripts) {
  console.log("Migrating XML script file to JSON stored in local storage.")
  scripts = await quicktext.readXmlScriptFile().then(
    e => e.scripts
  );
  // After the migration code is removed, this needs to be used for initialization.
  // scripts = [];
  await storage.setScripts(scripts);
}

// Startup import
const defaultImport = await storage.getPref("defaultImport");
if (defaultImport) {
  const defaultImports = defaultImport.split(";").map(e => e.trim()).reverse();
  for (let path of defaultImports) {
    try {
      // Import XML or JSON config data from remote server or local file system.
      // Support for importing from the local file system will be removed for the
      // pure WebExtension version. Use managed storage instead.
      const data = path.match(/^(http|https):\/\//)
        ? await utils.fetchFileFromServer(path)
        : await browser.Quicktext.readTextFile(path);
      const imports = quicktext.parseConfigFileData(data);
      if (imports.templates) {
        quicktext.mergeTemplates(templates, imports.templates, true);
      }
      if (imports.scripts) {
        quicktext.mergeScripts(scripts, imports.scripts, true);
      }
    } catch (e) {
      console.error(e);
    }
  }
  await storage.setTemplates(templates);
  await storage.setScripts(scripts);
}

// NotifyTools needed by Experiment code to access WebExtension code.
messenger.NotifyTools.onNotifyBackground.addListener(async (info) => {
  switch (info.command) {
    case "setPref":
      return storage.setPref(info.pref, info.value);
    case "getPref":
      return storage.getPref(info.pref);

    case "setScripts":
      return storage.setScripts(info.data);
    case "getScripts":
      return storage.getScripts();

    case "setTemplates":
      return storage.setTemplates(info.data);
    case "getTemplates":
      return storage.getTemplates();

    case "openWebPage":
      return browser.windows.openDefaultBrowser(info.url);

    case "parseConfigFile":
      return browser.Quicktext.readTextFile(info.path).then(quicktext.parseConfigFileData);
    case "pickAndParseConfigFile":
      // Currently not used. Instead the settings window keeps using the legacy
      // file picker.
      return utils.pickFileFromDisc([3, 5])
        .then(utils.getTextFileContent)
        .then(quicktext.parseConfigFileData);

    case "exportTemplates":
      return storage.getTemplates().then(templates => templates
        ? utils.writeFileToDisc(JSON.stringify({ templates }, null, 2), "templates.json")
        : null
      );
    case "exportScripts":
      return storage.getScripts().then(scripts => scripts
        ? utils.writeFileToDisc(JSON.stringify({ scripts }, null, 2), "scripts.json")
        : null
      );

    // Experiment toolbar actions from the compose window.
    case "insertFile":
      return messenger.tabs
        .query({ windowId: info.windowId, type: "messageCompose" })
        .then(tabs => quicktext.insertFile(tabs[0].id, info.file, info.aType));
    case "insertVariable":
      return messenger.tabs
        .query({ windowId: info.windowId, type: "messageCompose" })
        .then(tabs => quicktext.insertVariable(tabs[0].id, info.aVar));
    case "insertTemplate":
      return messenger.tabs
        .query({ windowId: info.windowId, type: "messageCompose" })
        .then(async tabs => {
          let t = await storage.getTemplates();
          return quicktext.insertVariable(
            tabs[0].id,
            `TEXT=${t.groups[info.group].name}|${t.texts[info.group][info.text].name}`
          )
        });
  }
});

// Listener for the compose script.
messenger.runtime.onMessage.addListener((info, sender, sendResponse) => {
  // All these functions return Promises.
  switch (info.command) {
    case "getKeywordsAndShortcuts":
      return quicktext.getKeywordsAndShortcuts();
    case "insertTemplate":
      return storage.getTemplates().then(t => quicktext.insertVariable(
        sender.tab.id,
        `TEXT=${t.groups[info.group].name}|${t.texts[info.group][info.text].name}`
      ));
    default:
      return false;
  }
});

// Add entry to tools menu.
browser.menus.create({
  contexts: ["tools_menu"],
  onclick: () => browser.Quicktext.openTemplateManager(),
  title: browser.i18n.getMessage("quicktext.label"),
})

// Add Quicktext composeBody context menu.
await menus.buildComposeBodyMenu();

// Add listeners to open template manager.
browser.composeAction.onClicked.addListener(tab => { browser.Quicktext.openTemplateManager() });
browser.browserAction.onClicked.addListener(tab => { browser.Quicktext.openTemplateManager() });

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

// Prevent sending, if a popover is shown.
browser.compose.onBeforeSend.addListener(async (tab, details) => {
  let isPopoverShown = await messenger.tabs.sendMessage(tab.id, {
    isPopoverShown: true,
  });
  return {
    cancel: isPopoverShown
  }
})

// Legacy: Inject toolbar into all already open compose windows.
let windows = await browser.windows.getAll({ windowTypes: ["messageCompose"] })
for (let window of windows) {
  await browser.QuicktextToolbar.injectLegacyToolbar(window.id);
}

// Legacy: Inject toolbar into any new compose window being opened.
browser.windows.onCreated.addListener(async window => {
  if (window.type == "messageCompose") {
    await browser.QuicktextToolbar.injectLegacyToolbar(window.id);
  }
});

// Legacy: Update toolbar if templates or menuCollapse setting changed.
new storage.StorageListener(
  {
    watchedPrefs: ["templates", "menuCollapse"],
    listener: async (changes) => {
      let windows = await browser.windows.getAll({ windowTypes: ["messageCompose"] })
      windows.forEach(window => browser.QuicktextToolbar.updateLegacyToolbar(window.id));
    }
  }
)