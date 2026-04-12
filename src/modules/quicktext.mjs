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
  let { templateFilePath } = await browser.FileSystemAccess.getQuicktextFilePaths(templateFolder);
  let xmlData = await browser.FileSystemAccess.readTextFile(templateFilePath);
  return parseLegacyXmlData(xmlData);
}

export async function readLegacyXmlScriptFile() {
  let templateFolder = await storage.getPref("templateFolder");
  let { scriptFilePath } = await browser.FileSystemAccess.getQuicktextFilePaths(templateFolder);
  let xmlData = await browser.FileSystemAccess.readTextFile(scriptFilePath);
  return parseLegacyXmlData(xmlData);
}

export async function parseLegacyXmlData(xmlData) {
  const domParser = new DOMParser();
  const dom = domParser.parseFromString(xmlData, "text/xml");

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

// ---- INSERT

async function getQuicktextParser({ tabId }) {
  const bundles = await storage.getActiveStorageEntries();
  return new QuicktextParser(tabId, bundles);
}

export async function insertTemplate(tabId, storageUuid, groupIdx, textIdx) {
  const qParser = await getQuicktextParser({ tabId });
  qParser.setActiveStorage(storageUuid);
  const bundle = qParser.activeBundle;
  const group = bundle.templates.groups[groupIdx];
  const text = bundle.templates.texts[groupIdx][textIdx];
  await qParser.clearNonPersistentData();
  await insertSubject({ qParser, subject: text.subject });
  await insertAttachments({ qParser, attachments: text.attachments });
  await qParser.parseAndInsert(`[[TEXT=${group.name}|${text.name}]]`);
}

export async function insertVariable({ tabId, variable, storageUuid }) {
  const qParser = await getQuicktextParser({ tabId });
  // Tag flyouts in the manager and compose menus always carry a storage
  // uuid when they target scripts from a specific storage; free-standing
  // variable insertions (DATE, INPUT, ...) don't care, so fall back to
  // whatever bundle happens to be first.
  if (storageUuid != null) qParser.setActiveStorage(storageUuid);
  await qParser.clearNonPersistentData();
  await qParser.parseAndInsert(`[[${variable}]]`);
}

async function insertSubject({ qParser, subject }) {
  if (!subject) {
    return;
  }

  let parsedSubject = await qParser.parse(subject);
  if (parsedSubject && !parsedSubject.match(/^\s+$/)) {
    await qParser.setDetail("subject", parsedSubject);
  }
}

async function insertAttachments({ qParser, attachments }) {
  let parsedAttachments = await qParser.parse(attachments);
  for (let attachment of parsedAttachments.split(";")) {
    if (!attachment) {
      continue;
    }
    let bytes = await browser.FileSystemAccess.readBinaryFile(attachment);
    let leafName = utils.getLeafName(attachment);
    let type = utils.getTypeFromExtension(leafName);
    let file = new File([bytes], leafName, { type });
    await qParser.addAttachment(file);
  };
}

export async function insertContentFromFile(aTabId, insertMode) {
  let file = await utils.pickFileFromDisc([insertMode]);
  if (file) {
    return insertFile(aTabId, file, insertMode);
  }
}

export async function insertFile(tabId, file, insertMode) {
  const content = await utils.getTextFileContent(file);
  if (!content) {
    return;
  }

  let qParser = await getQuicktextParser({ tabId });
  // The content of the file gets parsed as well. Nested templates which force
  // text insert mode affect the entire insert operation.
  let parsedContent = await qParser.process_file_content(content, {
    insertMode,
    stripHtmlComments: false,
  });
  await qParser.insertBody(parsedContent, {
    extraSpace: false
  });
}

// This function is called from outside and needs to use data of an existing
// parser
export async function getTag({ tabId, tag, variables }) {
  let qParser = await getQuicktextParser({ tabId })
  return await qParser[`get_${tag.toLowerCase()}`](variables);
}

// This function is called from outside and needs to use data of an existing
// parser
export async function processTag({ tabId, tag, variables }) {
  let qParser = await getQuicktextParser({ tabId })
  return await qParser[`process_${tag.toLowerCase()}`](variables);
}

// ---- TEMPLATE

// This is defined async, so it can be used in an runtime.onMessage listener
// without further logic to return a Promise.
export async function getKeywordsAndShortcuts() {
  let bundles = await storage.getActiveStorageEntries();
  let keywords = {};
  let shortcuts = {};

  for (const bundle of bundles) {
    const templates = bundle.templates;
    for (let i = 0; i < templates.groups.length; i++) {
      for (let j = 0; j < templates.texts[i].length; j++) {
        let text = templates.texts[i][j];
        let shortcut = text.shortcut;
        // Earlier storage/group wins on conflict.
        if (shortcut != "" && typeof shortcuts[shortcut] == "undefined") {
          shortcuts[shortcut] = [bundle.storageUuid, i, j];
        }

        let keyword = text.keyword;
        if (keyword != "" && typeof keywords[keyword] == "undefined")
          keywords[keyword] = [bundle.storageUuid, i, j];
      }
    }
  }
  return { keywords, shortcuts };
}
