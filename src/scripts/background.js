/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as storage from "../modules/storage.mjs";
import * as utils from "../modules/utils.mjs";
import * as toolbar from "../modules/toolbar.mjs";
import * as compose from "../modules/compose.mjs";
import * as menus from "../modules/menus.mjs";
import * as escripts from "../modules/escripts.mjs";
import * as vfs from "../vendor/vfs-client/vfs-client.mjs";

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

browser.notifications.onClicked.addListener(notificationId => {
  switch (notificationId) {
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

// Initialise the VFS toolkit before any template/script read. The default
// internal storage reads/writes a combined JSON file on OPFS through the
// VFS toolkit, and storage.migrate() runs a one-time migration that needs it.
await vfs.init({
  enableExternalProviders: true,
  configStorageKey: "vfs-toolkit-config-data"
});

// Over the years, the storage concept has changed. migrate() runs all startup
// migrations, including INTERNAL → OPFS for templates + scripts.
await storage.migrate();

// Fix invalid options:
// - reset the value of shortcutModifier to "alt", if it has not a valid value - see issue #177
const shortcutModifier = await storage.getPref("shortcutModifier");
if (!["alt", "control", "meta"].includes(shortcutModifier)) {
  await storage.setPref("shortcutModifier", "alt");
}

let bundles = await storage.getActiveStorageEntries();

// Add menu entry to tools menu.
browser.menus.create({
  contexts: ["tools_menu"],
  onclick: () => utils.openSettingsDialog(),
  title: browser.i18n.getMessage("quicktext.label"),
})

// Add listeners to open template manager.
browser.composeAction.onClicked.addListener(tab => { utils.openSettingsDialog() });
browser.browserAction.onClicked.addListener(tab => { utils.openSettingsDialog() });

await compose.init();
await toolbar.init();
await escripts.init();

// Update the date/time menus before showing them.
messenger.menus.onShown.addListener(async (info) => {
  if (info.menuIds.includes("insertVariable")) {
    await menus.updateDateTimeWebExtMenus("insertVariable.dateTime");
    messenger.menus.refresh();
  }
});

// Check if templates or scripts are invalid (runs once per enabled
// storage).
for (const bundle of bundles) {
  await utils.checkBadNameEntries(bundle.templates, bundle.scripts);
  await utils.checkDuplicatedEntries(bundle.templates, bundle.scripts);
  await utils.checkForIncompatibleScripts(bundle.scripts);
  await utils.checkForDeprecatedAttachmentUsage(bundle.templates);
}
