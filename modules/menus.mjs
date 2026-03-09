/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as quicktext from "/modules/quicktext.mjs";
import * as storage from "/modules/storage.mjs";
import * as utils from "/modules/utils.mjs";
import { getStaticVariablesMenuStructure, getStaticOtherMenuStructure } from "/modules/menuStructure.mjs";

let composeContextEntries = [];

export async function buildComposeBodyMenu() {
    await processMenuData(await getComposeBodyMenuData());

    // Update the menus before showing them.
    messenger.menus.onShown.addListener(async () => {
        await updateDateTimeMenus();
        messenger.menus.refresh();
    });

    new storage.StorageListener(
        {
            watchedPrefs: ["templates", "popup", "menuCollapse"],
            listener: async (_changes) => {
                // Throw away the menu.
                for (let entry of composeContextEntries.reverse()) {
                    await messenger.menus.remove(entry);
                }
                composeContextEntries = [];

                const popup = await storage.getPref("popup");
                if (popup) {
                    await processMenuData(await getComposeBodyMenuData());
                }
            }
        }
    )
}

async function processMenuData(menuData, parentId) {
    for (let entry of menuData) {
        let createData = {}

        createData.id = parentId ? `${parentId}.${entry.id}` : entry.id;
        if (entry.type == "separator") {
            createData.type = entry.type;
        } else {
            createData.title = entry.title ? entry.title : messenger.i18n.getMessage(`quicktext.${entry.id}.label`);
        }

        if (entry.contexts) createData.contexts = entry.contexts;
        if (entry.visible) createData.visible = entry.visible;
        if (entry.onclick) createData.onclick = entry.onclick;
        if (parentId) createData.parentId = parentId;

        const created = Promise.withResolvers()
        const id = messenger.menus.create(createData, () => {
            let receivedError = browser.runtime.lastError;
            if (receivedError) {
                console.error(receivedError);
            }
            created.resolve();
        });
        await created.promise;
        if (id != createData.id) {
            console.error(`Menu with requested id <${createData.id}> was created as <${id}>`)
        }
        if (composeContextEntries.includes(id)) {
            console.error(`Menu with id <${id}} exists already!`)
        } else {
            composeContextEntries.push(id);
        }

        if (entry.id && entry.children) {
            await processMenuData(entry.children, createData.id);
        }
    }
}

function structureToMenuData(nodes, now) {
    return nodes.flatMap(node => {
        if (node.type === "separator") return [{ type: "separator" }];

        const entry = { id: node.id };
        if (node.localeKey) entry.title = messenger.i18n.getMessage(node.localeKey);
        if (node.type === "dateTime") entry.title = getDateTimeMenuTitle(node.format, now);

        if (node.value?.includes("<path>")) {
            // Open a file picker before inserting the variable.
            let filter, titleKey;
            if (node.value.startsWith("IMAGE=")) {
                filter = "images";
                titleKey = "quicktext.insertImage.label";
            } else if (node.value.startsWith("ATTACHMENT=")) {
                filter = "any";
                titleKey = "quicktext.attachmentFile.label";
            } else {
                filter = "any";
                titleKey = "quicktext.insertFile.label";
            }
            const title = messenger.i18n.getMessage(titleKey);
            entry.onclick = async (_info, tab) => {
                const path = await browser.FileSystemAccess.pickFile(title, filter);
                if (path) quicktext.insertVariable({ tabId: tab.id, variable: node.value.replace("<path>", path) });
            };
        } else if (node.value?.includes("<url>")) {
            // Prompt for a URL — run in the compose tab context where native dialogs are allowed.
            const promptLabel = messenger.i18n.getMessage("quicktext.prompt.addUrl.label");
            entry.onclick = async (_info, tab) => {
                const results = await messenger.tabs.executeScript(tab.id, {
                    code: `window.prompt(${JSON.stringify(promptLabel)}, "https://")`,
                });
                const url = results?.[0];
                if (url) quicktext.insertVariable({ tabId: tab.id, variable: node.value.replace("<url>", url) });
            };
        } else if (node.value) {
            entry.onclick = (_info, tab) => quicktext.insertVariable({ tabId: tab.id, variable: node.value });
        }

        if (node.children) entry.children = structureToMenuData(node.children, now);
        return [entry];
    });
}


async function getComposeBodyMenuData() {
    let menuData = [];
    let contexts = ["compose_body", "compose_action_menu"];
    let templates = await storage.getTemplates();
    for (let i = 0; i < templates.groups.length; i++) {
        let children = [];
        for (let j = 0; j < templates.texts[i].length; j++) {
            children.push({
                id: `group-${i}-text-${j}`,
                title: templates.texts[i][j].name,
                onclick: (_info, tab) => quicktext.insertTemplate(tab.id, i, j)
            });

        }
        // Ignore this group, if it has now children.
        if (children.length == 0) {
            continue;
        }

        // If this group has only a single child, and menuCollapse is true, print
        // only that.
        if (await storage.getPref("menuCollapse") && children.length == 1) {
            menuData.push({
                contexts,
                ...children[0]
            });
            continue;
        }

        menuData.push({
            contexts,
            id: `group-${i}`,
            title: templates.groups[i].name,
            children
        });
    }

    if (templates.groups.length > 0) {
        menuData.push({
            contexts,
            id: `group-separator`,
            type: "separator"
        });
    }

    let now = Date.now();
    menuData.push(
        {
            contexts,
            id: "variables",
            children: structureToMenuData(getStaticVariablesMenuStructure(), now)
        },
        {
            contexts,
            id: "other",
            children: getStaticOtherMenuStructure().map(node => ({
                id: node.id,
                onclick: (_info, tab) => quicktext.insertContentFromFile(tab.id, node.mimeType)
            }))
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

function getDateTimeMenuTitle(field, timeStamp) {
    const fieldType = field.split("-")[0];
    return messenger.i18n.getMessage(`quicktext.${fieldType}.label`, utils.getDateTimeFormat(field, timeStamp));
}

async function updateDateTimeMenus() {
    let fields = ["date-short", "date-long", "date-monthname", "time-noseconds", "time-seconds"];
    let menus = ["variables.dateTime."];
    let now = Date.now();

    for (let menu of menus) {
        for (let field of fields) {
            const title = getDateTimeMenuTitle(field, now);
            await messenger.menus.update(`${menu}${field}`, { title })
        }
    }
}