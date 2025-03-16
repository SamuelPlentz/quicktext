(async () => {
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
  await preferences.init(defaultPrefs);

  // Migrate legacy prefs using the LegacyPrefs API.
  const legacyPrefBranch = "extensions.quicktext.";
  const prefNames = Object.keys(defaultPrefs);

  for (let prefName of prefNames) {
    let legacyValue = await messenger.LegacyPrefs.getUserPref(`${legacyPrefBranch}${prefName}`);
    if (legacyValue !== null) {
      console.log(`Migrating legacy preference <${legacyPrefBranch}${prefName}> = <${legacyValue}>.`);

      // Store the migrated value in local storage.
      // Check out the MDN documentation at
      // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage
      // or use preference.js bundled with this API
      preferences.setPref(prefName, legacyValue);

      // Clear the legacy value.
      messenger.LegacyPrefs.clearUserPref(`${legacyPrefBranch}${prefName}`);
    }
  }

  // Allow to set defaultImport from user_prefs
  let defaultImportOverride = await messenger.LegacyPrefs.getUserPref(`${legacyPrefBranch}defaultImportOverride`);
  if (defaultImportOverride !== null) {
    preferences.setPref("defaultImport", defaultImportOverride);
  }

  // Allow to override templateFolder from user_prefs
  let templateFolderOverride = await messenger.LegacyPrefs.getUserPref(`${legacyPrefBranch}templateFolderOverride`);
  if (templateFolderOverride !== null) {
    preferences.setPref("templateFolder", templateFolderOverride);
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

  // Add entry to tools menu
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
})();
