import { Preferences } from "./modules/preferences.mjs";
import { parseImport } from "./modules/quicktext.mjs";

await browser.LegacyHelper.registerGlobalUrls([
  ["content", "quicktext", "chrome/content/"],
  ["resource", "quicktext", "chrome/"],
]);

// Define default prefs.
const preferences = new Preferences();
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
await preferences.init(defaultPrefs);

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
      await preferences.setPref(managedPref, override[managedPref]);
    }
  } catch {
    // No managed storage available.
  }
}

// Read current prefs into an options object.
let options = {}
for (let name of Object.keys(defaultPrefs)) {
  options[name] = preferences.getPref(name);
}

// Read template and scripts from the profile folder. They are kept for backup
// purposes, but are ignored if they exist in the storage already.
let { templateFilePath, scriptFilePath } = await browser.Quicktext.getQuicktextFilePaths(options);
let templateFile = await browser.Quicktext.readTextFile(templateFilePath);
let scriptFile = await browser.Quicktext.readTextFile(scriptFilePath);

const templates = await parseImport(templateFile, 0);
const scripts = await parseImport(scriptFile, 0);
console.log({templates, scripts});

// NotifyTools needed for Experiment code trying to access local storage.
messenger.NotifyTools.onNotifyBackground.addListener(async (info) => {
  switch (info.command) {
    case "setPref":
      return preferences.setPref(info.pref, info.value);
    case "getPref":
      return preferences.getPref(info.pref);
  }
});



// Load templates and settings.
await browser.Quicktext.loadSettings();

// Add entry to tools menu.
browser.menus.create({
  contexts: ["tools_menu"],
  onclick: () => browser.LegacyHelper.openDialog("quicktextConfig", "chrome://quicktext/content/settings.xhtml"),
  title: browser.i18n.getMessage("quicktext.label"),
})

// Manipulate all already open compose windows.
let windows = await browser.windows.getAll({ windowTypes: ["messageCompose"] })
for (let window of windows) {
  await browser.Quicktext.manipulateComposeWindow(window.id);
}

// Manipulate any new compose window being opened.
browser.windows.onCreated.addListener(async window => {
  if (window.type == "messageCompose") {
    await browser.Quicktext.manipulateComposeWindow(window.id);
  }
});

browser.composeAction.onClicked.addListener(tab => { browser.LegacyHelper.openDialog("quicktextConfig", "chrome://quicktext/content/settings.xhtml"); });
browser.browserAction.onClicked.addListener(tab => { browser.LegacyHelper.openDialog("quicktextConfig", "chrome://quicktext/content/settings.xhtml"); });
