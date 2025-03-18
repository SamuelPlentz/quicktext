import { Preferences } from "./modules/preferences.mjs";

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
      preferences.setPref(managedPref, override[managedPref]);
    }
  } catch {
    // No managed storage available.
  }
}

// NotifyTools needed for Experiment code trying to access local storage.
messenger.NotifyTools.onNotifyBackground.addListener(async (info) => {
  switch (info.command) {
    case "setPref":
      preferences.setPref(info.pref, info.value);
      break;
    case "getPref":
      return await preferences.getPref(info.pref);
      break;
  }
});

await browser.LegacyHelper.registerGlobalUrls([
  ["content", "quicktext", "chrome/content/"],
  ["resource", "quicktext", "chrome/"],
]);

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
