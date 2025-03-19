/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as quicktext from "../modules/quicktext.mjs";
import * as storage from "../modules/storage.mjs";
import * as menus from "../modules/menus.mjs";

// Legacy: Register global urls.
await browser.LegacyHelper.registerGlobalUrls([
  ["content", "quicktext", "chrome/content/"],
  ["resource", "quicktext", "chrome/"],
]);

// Define default prefs.
let defaultPrefs = {
  "counter": 0,
  "templateFolder": "",
  "defaultImport": "",
  "menuCollapse": true,
  "toolbar": true,
  "popup": false,
  "keywordKey": "Tab",
  "shortcutModifier": "alt",
  "shortcutTypeAdv": false,
  "collapseState": ""
};
await storage.init(defaultPrefs);

// Define prefs, which can be overridden by system admins. Admins have to migrate
// these manually from legacy prefs to managed storage.
const managedPrefs = [
  "defaultImport",
  "templateFolder",
];
for (let managedPref of managedPrefs) {
  try {
    let override = await browser.storage.managed.get({ [managedPref]: null });
    if (override[managedPref] !== null) {
      await storage.setPref(managedPref, override[managedPref]);
    }
  } catch {
    // No managed storage available.
  }
}

// Read current prefs into an options object.
let options = {}
for (let name of Object.keys(defaultPrefs)) {
  options[name] = await storage.getPref(name);
}

// Fix invalid options:
// - reset the value of mShortcutModifier to "alt", if it has not a valid value - see issue #177
if (!["alt", "control", "meta"].includes(options.shortcutModifier)) {
  options.shortcutModifier = "alt";
  await storage.setPref("shortcutModifier", options.shortcutModifier)
}

// Read template and scripts from the profile folder. The XML files will remain
// the source of truth, as long as the XUL settings dialog is still writing them.
// In the future, they will be kept for backup purposes, but will be ignored if
// they exist in the storage already.
let { templateFilePath, scriptFilePath } = await browser.Quicktext.getQuicktextFilePaths(options);
let templateFile = await browser.Quicktext.readTextFile(templateFilePath);
let scriptFile = await browser.Quicktext.readTextFile(scriptFilePath);
const { templates, scripts } = await quicktext.parseXmlData({ templateFile, scriptFile });
// Store templates in local storage.
await storage.setTemplates(templates);

// NotifyTools needed for Experiment code trying to access local storage.
messenger.NotifyTools.onNotifyBackground.addListener(async (info) => {
  switch (info.command) {
    case "setPref":
      return storage.setPref(info.pref, info.value);
    case "getPref":
      return storage.getPref(info.pref);
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
        `TEXT=${t.group[info.group].mName}|${t.texts[info.group][info.text].mName}`
      ));
    default:
      return false;
  }
});

// Legacy: Load templates and settings.
await browser.Quicktext.loadSettings();

// Add entry to tools menu.
browser.menus.create({
  contexts: ["tools_menu"],
  onclick: () => quicktext.openTemplateManager(),
  title: browser.i18n.getMessage("quicktext.label"),
})

// Move this somewhere else.
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


// Legacy: Manipulate all already open compose windows.
let windows = await browser.windows.getAll({ windowTypes: ["messageCompose"] })
for (let window of windows) {
  await browser.Quicktext.manipulateComposeWindow(window.id);
}

// Legacy: Manipulate any new compose window being opened.
browser.windows.onCreated.addListener(async window => {
  if (window.type == "messageCompose") {
    await browser.Quicktext.manipulateComposeWindow(window.id);
  }
});

// Add Quicktext composeBody context menu.
await menus.buildComposeBodyMenu();

// Update the menus before showing them.
messenger.menus.onShown.addListener(async () => {
  await menus.updateDateTimeMenus();
  await menus.updateTemplateMenus();
  messenger.menus.refresh();
});

// Add listeners to open template manager.
browser.composeAction.onClicked.addListener(tab => { quicktext.openTemplateManager() });
browser.browserAction.onClicked.addListener(tab => { quicktext.openTemplateManager() });
