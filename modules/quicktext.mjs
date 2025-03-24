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
  let xmlData = await browser.Quicktext.readTextFile(templateFilePath);
  return parseLegacyXmlData(xmlData);
}

export async function readXmlScriptFile() {
  let templateFolder = await storage.getPref("templateFolder");
  let { scriptFilePath } = await browser.Quicktext.getQuicktextFilePaths(templateFolder);
  let xmlData = await browser.Quicktext.readTextFile(scriptFilePath);
  return parseLegacyXmlData(xmlData);
}

export async function parseLegacyXmlData(xmlData) {
  const parser = new DOMParser();
  const dom = parser.parseFromString(xmlData, "text/xml");

  const version = dom.documentElement.getAttribute("version");

  const foundGroups = [];
  const foundTexts = [];
  const foundScripts = [];

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
                protected: false
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
                protected: false
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
      console.error("invalid data format", xmlData)
      return;
  }

  const imports = {}

  if (foundScripts.length > 0) {
    imports.scripts = [];
    for (let i = 0; i < foundScripts.length; i++) {
      imports.scripts.push(foundScripts[i]);
    }
  }

  if (foundGroups.length > 0 && foundTexts.length > 0) {
    imports.templates = {};
    imports.templates.groups = [];
    for (let i = 0; i < foundGroups.length; i++) {
      imports.templates.groups.push(foundGroups[i]);
    }
    imports.templates.texts = [];
    for (let i = 0; i < foundTexts.length; i++) {
      imports.templates.texts.push(foundTexts[i]);
    }
  }

  return imports;
}

export async function parseConfigFileData(fileData) {
  let errors = [];
  try {
    return JSON.parse(fileData);
  } catch (e) {
    errors.push(e);
  }

  try {
    return await parseLegacyXmlData(fileData);
  } catch (e) {
    errors.push(e);
  }

  console.error("Failed to parse config file, does not seem to be a supported JSON or XML format", errors);
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

export function mergeTemplates(templates, importedTemplates, forceProtected = false) {
  if (importedTemplates.groups && importedTemplates.texts && importedTemplates.texts.length > 0 && importedTemplates.groups.length == importedTemplates.texts.length) {
    // If a group exists already, import into the existing group.
    templates.groups.forEach((group, existingGroupIdx) => {
      let groupImportIdx = importedTemplates.groups.findIndex(i => i.name == group.name);
      if (groupImportIdx != -1) {
        console.log(`Found existing group ${group.name} in imported groups.`)
        templates.groups[existingGroupIdx] = importedTemplates.groups[groupImportIdx];
        templates.groups[existingGroupIdx].protected = forceProtected;
        importedTemplates.groups.splice(groupImportIdx, 1);

        // Handle texts of this group:
        // merge imports.texts[groupImportIdx] into templates.texts[existingGroupIdx]
        templates.texts[existingGroupIdx].forEach((text, existingTextIndex) => {
          let textImportIdx = importedTemplates.texts[groupImportIdx].findIndex(i => i.name == text.name);
          if (textImportIdx != -1) {
            console.log(`Replacing text ${text.name} with imported version.`)
            templates.texts[existingGroupIdx][existingTextIndex] = importedTemplates.texts[groupImportIdx][textImportIdx];
            importedTemplates.texts[groupImportIdx].splice(textImportIdx, 1);
          }
        });
        // Add remaining texts to this group.
        templates.texts[existingGroupIdx].push(...importedTemplates.texts[groupImportIdx]);
        importedTemplates.texts.splice(groupImportIdx, 1);
      }
    });

    // Add remaining new templates.
    templates.texts.push(...importedTemplates.texts);
    templates.groups.push(...importedTemplates.groups.map(g => ({ ...g, protected: forceProtected })));
  }
}

export function mergeScripts(scripts, importedScripts, forceProtected = false) {
  if (importedScripts && importedScripts.length > 0) {
    // Overwrite local existing versions.
    scripts.forEach((script, existingScriptIdx) => {
      let importScriptIdx = importedScripts.findIndex(i => i.name == script.name);
      if (importScriptIdx != -1) {
        console.log(`Replacing script ${script.name} with imported version.`)
        scripts[existingScriptIdx] = importedScripts[importScriptIdx];
        scripts[existingScriptIdx].protected = forceProtected;
        importedScripts.splice(importScriptIdx, 1);
      }
    });
    // Add the remaining new scripts.
    scripts.push(...importedScripts.map(g => ({ ...g, protected: forceProtected })));
  }
}

// ---- INSERT

export async function parseVariable(aTabId, aVar) {
  let gTemplates = await storage.getTemplates();
  let getScripts = await storage.getScripts();

  let quicktextParser = new QuicktextParser(aTabId, gTemplates, getScripts);
  return quicktextParser.parse("[[" + aVar + "]]");
}

export async function insertVariable(aTabId, aVar, aForceAsText) {
  let gTemplates = await storage.getTemplates();
  let getScripts = await storage.getScripts();

  // If aForceAsText is not set, but after parsing it is set, we should rerun
  // with aForceAsText set from the beginning. 
  let quicktextParser = new QuicktextParser(aTabId, gTemplates, getScripts, aForceAsText);
  let parsed = await quicktextParser.parse("[[" + aVar + "]]");
  if (parsed) {
    await quicktextParser.insertBody(parsed, { extraSpace: false });
  }
}

export async function insertContentFromFile(aTabId, aType) {
  let file = utils.pickFileFromDisc(aType);
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
  let getScripts = await storage.getScripts();

  let quicktextParser = new QuicktextParser(aTabId, gTemplates, getScripts, aType == 0);
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