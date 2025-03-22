/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as storage from "/modules/storage.mjs";
import * as utils from "/modules/utils.mjs";
import { QuicktextParser } from "/modules/quicktextParser.mjs";

// Helper

export async function readLegacyXmlTemplateFile() {
  let templateFolder = await storage.getPref("templateFolder");
  let { templateFilePath } = await browser.Quicktext.getQuicktextFilePaths(templateFolder);
  return parseLegacyXmlFile(templateFilePath, 0);
}

export async function readXmlScriptFile() {
  let templateFolder = await storage.getPref("templateFolder");
  let { scriptFilePath } = await browser.Quicktext.getQuicktextFilePaths(templateFolder);
  return parseLegacyXmlFile(scriptFilePath, 0);
}

/**
 * 
 * @param {string} filePath
 * @param {integer} forceProtected 0 = normal, 1 = default import
 * @returns {obj} imports
 */
export async function parseLegacyXmlFile(filePath, forceProtected) {
  let aData = await browser.Quicktext.readTextFile(filePath);
  const parser = new DOMParser();
  const dom = parser.parseFromString(aData, "text/xml");

  const version = dom.documentElement.getAttribute("version");

  const foundGroups = [];
  const foundTexts = [];
  const foundScripts = [];

  const imports = {}
  for (let part of ["groups", "scripts", "texts"]) {
    imports[part] = [];
  }

  switch (version) {
    case "2":
      const filetype = getTagValue(dom.documentElement, "filetype");
      switch (filetype) {
        case "scripts":
          {
            const elems = dom.documentElement.getElementsByTagName("script");
            for (let i = 0; i < elems.length; i++) {
              let tmp = {
                name: getTagValue(elems[i], "name"),
                script: getTagValue(elems[i], "body"),
                protected: forceProtected
              };

              foundScripts.push(tmp);
            }
          }
          break;

        case "":
        case "templates":
          {
            const elems = dom.documentElement.getElementsByTagName("menu");
            for (let i = 0; i < elems.length; i++) {
              let tmp = {
                name: getTagValue(elems[i], "title"),
                protected: forceProtected
              };

              foundGroups.push(tmp);
              const subTexts = [];
              const textsNodes = elems[i].getElementsByTagName("texts");
              if (textsNodes.length > 0) {
                const subElems = textsNodes[0].getElementsByTagName("text");
                for (let j = 0; j < subElems.length; j++) {
                  let tmp = {
                    name: getTagValue(subElems[j], "name"),
                    text: getTagValue(subElems[j], "body"),
                    shortcut: subElems[j].getAttribute("shortcut"),
                    type: subElems[j].getAttribute("type") == "0" ? "text/plain" : "text/html",
                    keyword: getTagValue(subElems[j], "keyword"),
                    subject: getTagValue(subElems[j], "subject"),
                    attachments: getTagValue(subElems[j], "attachments"),
                  };

                  subTexts.push(tmp);
                }
              }
              foundTexts.push(subTexts);
            }
          }
          break;
        default:
          // Alert the user that the importer don't understand the filetype
          break;
      }

      break;

    default:
      console.error("invalid data format", aData)
      return;
  }

  if (foundScripts.length > 0) {
    for (let i = 0; i < foundScripts.length; i++) {
      imports.scripts.push(foundScripts[i]);
    }
  }

  if (foundGroups.length > 0 && foundTexts.length > 0) {
    for (let i = 0; i < foundGroups.length; i++) {
      imports.groups.push(foundGroups[i]);
    }
    for (let i = 0; i < foundTexts.length; i++) {
      imports.texts.push(foundTexts[i]);
    }
  }

  return imports;
}

function getTagValue(aElem, aTag) {
  const tagElem = aElem.getElementsByTagName(aTag);
  if (tagElem.length > 0) {
    // can't be used anymore as sometimes there are several CDATA entries - see removeIllegalCharsCDATA
    // return tagElem[0].firstChild.nodeValue;

    let result = '';
    for (const child of tagElem[0].childNodes) {
      result = result + child.nodeValue;
    }
    return result;
  }

  return "";
}

// ---- MERGE

export function mergeTemplates(templates, imports, forceProtected = false) {
  if (imports.groups && imports.texts && imports.texts.length > 0 && imports.groups.length == imports.texts.length) {
    // If a group exists already, import into the existing group.
    templates.groups.forEach((group, existingGroupIdx) => {
      let groupImportIdx = imports.groups.findIndex(i => i.name == group.name);
      if (groupImportIdx != -1) {
        console.log(`Found existing group ${group.name} in imported groups.`)
        templates.groups[existingGroupIdx] = imports.groups[groupImportIdx];
        templates.groups[existingGroupIdx].protected = forceProtected;
        imports.groups.splice(groupImportIdx, 1);

        // Handle texts of this group:
        // merge imports.texts[groupImportIdx] into templates.texts[existingGroupIdx]
        templates.texts[existingGroupIdx].forEach((text, existingTextIndex) => {
          let textImportIdx = imports.texts[groupImportIdx].findIndex(i => i.name == text.name);
          if (textImportIdx != -1) {
            console.log(`Replacing text ${text.name} with imported version.`)
            templates.texts[existingGroupIdx][existingTextIndex] = imports.texts[groupImportIdx][textImportIdx];
            imports.texts[groupImportIdx].splice(textImportIdx, 1);
          }
        });
        // Add remaining texts to this group.
        templates.texts[existingGroupIdx].push(...imports.texts[groupImportIdx]);
        imports.texts.splice(groupImportIdx, 1);
      }
    });

    // Add remaining new templates.
    templates.texts.push(...imports.texts);
    templates.groups.push(...imports.groups.map(g => ({...g, protected: forceProtected})));
  }
}

export function mergeScripts(scripts, imports, forceProtected = false) {
  if (imports.scripts && imports.scripts.length > 0) {
    // Overwrite local existing versions.
    scripts.forEach((script, existingScriptIdx) => {
      let importScriptIdx = imports.scripts.findIndex(i => i.name == script.name);
      if (importScriptIdx != -1) {
        console.log(`Replacing script ${script.name} with imported version.`)
        scripts[existingScriptIdx] = imports.scripts[importScriptIdx];
        scripts[existingScriptIdx].protected = forceProtected;
        imports.scripts.splice(importScriptIdx, 1);
      }
    });
    // Add the remaining new scripts.
    scripts.push(...imports.scripts.map(g => ({...g, protected: forceProtected})));
  }
}

// ---- INSERT

export async function parseVariable(aTabId, aVar) {
  let gTemplates = await storage.getTemplates();

  let quicktextParser = new QuicktextParser(aTabId, gTemplates);
  return quicktextParser.parse("[[" + aVar + "]]");
}

export async function insertVariable(aTabId, aVar, aForceAsText) {
  let gTemplates = await storage.getTemplates();

  // If aForceAsText is not set, but after parsing it is set, we should rerun
  // with aForceAsText set from the beginning. 
  let quicktextParser = new QuicktextParser(aTabId, gTemplates, aForceAsText);
  let parsed = await quicktextParser.parse("[[" + aVar + "]]");
  if (parsed) {
    await quicktextParser.insertBody(parsed, { extraSpace: true });
  }
}

export async function insertContentFromFile(aTabId, aType) {
  let file = utils.getFileFromDisc(aType);
  if (file) {
    return insertFile(aTabId, file, aType);
  }
}

export async function insertFile(aTabId, file, aType) {
  const content = await utils.getTextFileContent(file);
  if (!content) {
    return;
  }

  let gTemplates = await storage.getTemplates();
  let quicktextParser = new QuicktextParser(aTabId, gTemplates, aType == 0);
  await quicktextParser.insertBody(content, { extraSpace: false });
}

// ---- TEMPLATE

// This is defined async, so it can be used in an runtime.onMessage listener
// without further logic to return a Promise.
export async function getKeywordsAndShortcuts() {
  let gTemplates = await storage.getTemplates();
  let keywords = {};
  let shortcuts = {};

  for (let i = 0; i < gTemplates.groups.length; i++) {
    for (let j = 0; j < gTemplates.texts[i].length; j++) {
      let text = gTemplates.texts[i][j];
      let shortcut = text.shortcut;
      if (shortcut != "" && typeof shortcuts[shortcut] == "undefined") {
        shortcuts[shortcut] = [i, j];
      }

      let keyword = text.keyword;
      if (keyword != "" && typeof keywords[keyword.toLowerCase()] == "undefined")
        keywords[keyword.toLowerCase()] = [i, j];
    }
  }
  return { keywords, shortcuts };
}