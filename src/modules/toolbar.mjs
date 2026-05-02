import { getTemplatesMenuStructure } from "./menuStructure.mjs";

import * as quicktext from "../modules/quicktext.mjs";
import * as storage from "../modules/storage.mjs";

const COMPANION_ADDON_ID = "quicktext-legacy@jobisoft.de";

// Bundle all data the companion's update() needs into a single response, avoiding
// multiple round-trips. Templates use the existing getTemplatesMenuStructure()
// output (flat in single-storage, nested with storage wrappers in multi-storage).
async function buildToolbarData() {
  return {
    templates: await getTemplatesMenuStructure(),
    shortcutModifier: await storage.getPref("shortcutModifier"),
    menuCollapse: await storage.getPref("menuCollapse"),
  };
}

function getLegacyToolbarLabels() {
  return {};
}

async function injectToolbar(window = null) {
  let legacyAddon;
  try {
    legacyAddon = await browser.management.get(COMPANION_ADDON_ID);
  } catch {
    // Not installed, do nothing.
  }
  if (legacyAddon?.enabled) {
    const labels = getLegacyToolbarLabels();
    let windows = window
      ? [window]
      : await browser.windows.getAll({ windowTypes: ["messageCompose"] });

    for (let window of windows) {
      browser.runtime.sendMessage(COMPANION_ADDON_ID, {
        command: "injectLegacyToolbar",
        windowId: window.id,
        labels
      });
    }
  }
}

export async function init() {
  // Listener for the quicktext-legacy add-on (proxied toolbar commands).
  messenger.runtime.onMessageExternal.addListener((info, sender) => {
    if (sender.id !== COMPANION_ADDON_ID) return false;

    switch (info.command) {
      case "getToolbarData":
        return buildToolbarData();
      case "getPref":
        return storage.getPref(info.pref);
      case "insertTemplate":
        return messenger.tabs
          .query({ windowId: info.windowId, type: "messageCompose" })
          .then(tabs => quicktext.insertTemplate(tabs[0].id, info.storageUuid, info.group, info.text));
    }
    
    return false;
  });

  // Inject toolbar into all already open compose windows.
  await injectToolbar();

  // Inject toolbar into any new compose window being opened.
  browser.windows.onCreated.addListener(window => {
    if (window.type == "messageCompose") {
      injectToolbar(window);
    }
  });

  // Update toolbar if relevant settings changed.
  new storage.StorageListener({
    area: "auto",
    watchedPrefs: ["templates", "managedStorage", "menuCollapse", "shortcutModifier", "storageLocations", "defaultImport", "providerAvailability"],
    listener: async (_events) => {
      let legacyAddon;
      try {
        legacyAddon = await browser.management.get(COMPANION_ADDON_ID);
      } catch {
        // Not installed, do nothing.
      }
      if (!legacyAddon || legacyAddon.enabled === false) return;

      let windows = await browser.windows.getAll({
        windowTypes: ["messageCompose"]
      });
      windows.forEach(window => browser.runtime.sendMessage(
        COMPANION_ADDON_ID, {
        command: "updateLegacyToolbar",
        windowId: window.id
      }
      ));
    }
  })

  // Auto-load the legacy toolbar if the legacy companion add-on is installed or
  // enabled.
  browser.management.onEnabled.addListener(async addon => {
    if (addon.id === COMPANION_ADDON_ID) {
      injectToolbar();
    }
  });
  browser.management.onInstalled.addListener(async addon => {
    if (addon.id === COMPANION_ADDON_ID) {
      injectToolbar();
    }
  });
}