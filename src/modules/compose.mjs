import * as quicktext from "./quicktext.mjs";
import * as menus from "./menus.mjs";
import * as storage from "/modules/storage.mjs";
import * as utils from "/modules/utils.mjs";

import { getVariablesMenuStructure, getTemplatesMenuStructure } from "/modules/menuStructure.mjs";

let composeMenuEntries = [];

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

// Convert a single group node (with leaf template items) to compose-menu
// entries. Honours the per-group `menuCollapse` rule that promotes a
// single-template group to its lone child.
function _groupNodeToMenuData(node, contexts, menuCollapse) {
  if (node.children.length == 1 && menuCollapse) {
    const child = node.children[0];
    return {
      contexts,
      id: node.id,
      title: child.title,
      onclick: (_info, tab) => quicktext.insertTemplate(tab.id, child.storageUuid, child.groupIndex, child.textIndex),
    };
  }
  return {
    contexts,
    id: node.id,
    title: node.title,
    children: node.children.map(({ id, title, storageUuid, groupIndex, textIndex }) => ({
      id,
      title,
      onclick: (_info, tab) => quicktext.insertTemplate(tab.id, storageUuid, groupIndex, textIndex),
    })),
  };
}

async function getComposeBodyMenuData() {
  let menuData = [];
  let contexts = ["compose_body", "compose_action_menu"];
  const menuCollapse = await storage.getPref("menuCollapse");

  // templateNodes is either:
  //   single-storage: [ {group, children:[{text}]}, ... ]
  //   multi-storage:  [ {storage, iconUrl, children:[{group, children:[{text}]}]}, ... ]
  const templateNodes = await getTemplatesMenuStructure();
  const isMulti = templateNodes.some(n => n.children?.some(c => c.children));
  for (const node of templateNodes) {
    if (isMulti) {
      if (node.disabled) {
        menuData.push({
          contexts,
          id: node.id,
          title: node.title,
          icons: node.iconUrl ? { "16": node.iconUrl } : undefined,
          enabled: false,
        });
      } else {
        menuData.push({
          contexts,
          id: node.id,
          title: node.title,
          icons: node.iconUrl ? { "16": node.iconUrl } : undefined,
          children: node.children.map(groupNode =>
            _groupNodeToMenuData(groupNode, contexts, menuCollapse)
          ),
        });
      }
    } else if (node.disabled) {
      menuData.push({
        contexts,
        id: node.id,
        title: node.title,
        enabled: false,
      });
    } else {
      menuData.push(_groupNodeToMenuData(node, contexts, menuCollapse));
    }
  }

  if (templateNodes.length > 0) {
    menuData.push({ contexts, id: "group-separator", type: "separator" });
  }

  let now = Date.now();
  menuData.push(
    {
      contexts,
      id: "insertVariable",
      children: menus.structureToMenuData(getVariablesMenuStructure({ origin: "compose" }), now)
    },
    {
      contexts,
      id: "separator",
      type: "separator",
    },
    {
      contexts,
      id: "settings",
      title: messenger.i18n.getMessage("quicktext.settings.title"),
      onclick: () => utils.openSettingsDialog()
    },
  );

  return menuData;
}

export async function init() {
  // Listener for the compose script.
  messenger.runtime.onMessage.addListener((info, sender, sendResponse) => {
    // All these functions return Promises.
    switch (info.command) {
      // Sent by scripts/compose.js
      case "getKeywordsAndShortcuts":
        return quicktext.getKeywordsAndShortcuts();
      // Sent by scripts/compose.js
      case "insertTemplate":
        return quicktext.insertTemplate(sender.tab.id, info.storageUuid, info.group, info.text);
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
        return quicktext.processTag({ tabId: info.tabId, tag: info.tag, variables: info.variables, options: info.options });
      // Sent by modules/quicktextParser.mjs (running in compose window context)
      case "getTag":
        return quicktext.getTag({ tabId: info.tabId, tag: info.tag, variables: info.variables, options: info.options });
      default:
        return false;
    }
  });

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

  // Prevent sending while an INPUT popup is still open (the template is not
  // fully rendered yet).
  browser.compose.onBeforeSend.addListener(async (tab, details) => {
    let inputPopupOpen = await messenger.tabs.sendMessage(tab.id, {
      isInputPopupOpen: true,
    });
    return {
      cancel: inputPopupOpen
    }
  })

  // Add Quicktext composeBody context menu.
  await menus.processMenuData(composeMenuEntries, await getComposeBodyMenuData());

  // The "Embed image" entries produce HTML <img> output, which is inert in a
  // plain-text message. Disable the group for plain-text compose tabs; the
  // check runs on every show because the user can toggle compose mode mid-
  // session (Format -> Plain Text / HTML).
  browser.menus.onShown.addListener(async (info, tab) => {
    if (!tab || tab.type !== "messageCompose") return;
    if (!info.contexts.includes("compose_body") &&
        !info.contexts.includes("compose_action_menu")) return;
    try {
      const { isPlainText } = await browser.compose.getComposeDetails(tab.id);
      await browser.menus.update("insertVariable.image", { enabled: !isPlainText });
      await browser.menus.refresh();
    } catch {
      // Menu may have been rebuilt between onShown and update; the next show
      // will reapply. Swallow rather than spam the console.
    }
  });

  // Register a listener for changes in templates and settings, to update the
  // compose context menus.
  new storage.StorageListener({
    area: "auto",
    watchedPrefs: ["templates", "managedStorage", "popup", "menuCollapse", "storageLocations", "defaultImport", "providerAvailability"],
    listener: async (_events) => {
      // Throw away the menu and rebuild it from the current templates.
      // Rebuild unconditionally, matching the initial build above: the earlier
      // `if (popup)` guard left the compose picker torn down but not rebuilt -
      // empty until restart - after any template/script edit when the "show
      // popup" option was off (#634).
      for (let entry of composeMenuEntries.reverse()) {
        await messenger.menus.remove(entry);
      }
      composeMenuEntries = [];
      await menus.processMenuData(composeMenuEntries, await getComposeBodyMenuData());
    }
  })
}
