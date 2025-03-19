/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as storage from "/modules/storage.mjs";

// These classes are used to create the internal m* properties, with defaults.
// Once the template object (with multiple of these classes) are stored in local
// storage, the class methods are stripped and only the m* properties remain.
// Whenever WebExtension code needs the class methods, the class can be re-created.
// Note: The template class has methods related to headers, which are not fully
//       understood
import { QuicktextGroup } from "/modules/quicktextGroup.mjs";
import { QuicktextScript } from "/modules/quicktextScript.mjs";
import { QuicktextTemplate } from "/modules/quicktextTemplate.mjs";
import { QuicktextParser } from "/modules/quicktextParser.mjs";

// Helper

export function openTemplateManager() {
  return browser.LegacyHelper.openDialog("quicktextConfig", "chrome://quicktext/content/settings.xhtml");
}

export async function parseXmlData({templateFile, scriptFile}) {
  const templates = await parseImport(templateFile, 0);
  const scripts = await parseImport(scriptFile, 0);
  return {templates, scripts};
  
  /*
  const templates = await parseImport(templateFile, 0).then(({group,texts}) => {
    // Map scripts to flat array with groupId
    const rv = {};
    rv.groups = group.map((e,i) => ({...e, id:i}));
    rv.texts = texts.map((e,i) => e.map(t => ({...t, groupId:i}))).flat();
    return rv;
  });
  const { scripts } = await parseImport(scriptFile, 0);
  return {templates, scripts};
  */
}

/**
 * 
 * @param {string} aData xml file content
 * @param {integer} aType 0 = normal, 1 = default import
 * @returns {obj} imports
 */
async function parseImport(aData, aType) {
  const parser = new DOMParser();
  const dom = parser.parseFromString(aData, "text/xml");

  const version = dom.documentElement.getAttribute("version");

  const foundGroups = [];
  const foundTexts = [];
  const foundScripts = [];

  const imports = {}
  for (let part of ["group", "scripts", "texts"]) {
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
              let tmp = new QuicktextScript({
                name: getTagValue(elems[i], "name"),
                script: getTagValue(elems[i], "body"),
                type: aType
              });

              foundScripts.push(tmp);
            }
          }
          break;

        case "":
        case "templates":
          {
            const elems = dom.documentElement.getElementsByTagName("menu");
            for (let i = 0; i < elems.length; i++) {
              let tmp = new QuicktextGroup({
                name: getTagValue(elems[i], "title"),
                type: aType
              });

              foundGroups.push(tmp);
              const subTexts = [];
              const textsNodes = elems[i].getElementsByTagName("texts");
              if (textsNodes.length > 0) {
                const subElems = textsNodes[0].getElementsByTagName("text");
                for (let j = 0; j < subElems.length; j++) {
                  let tmp = new QuicktextTemplate({
                    name: getTagValue(subElems[j], "name"),
                    text: getTagValue(subElems[j], "body"),
                    shortcut: subElems[j].getAttribute("shortcut"),
                    type: subElems[j].getAttribute("type"),
                    keyword: getTagValue(subElems[j], "keyword"),
                    subject: getTagValue(subElems[j], "subject"),
                    attachments: getTagValue(subElems[j], "attachments"),
                  });

                  // There seems to be no use to read dynamically gathered header informations from the last use of a template from the file

                  // var headersTag = subElems[j].getElementsByTagName("headers");
                  // if (headersTag.length > 0)
                  // {
                  //   var headers = headersTag[0].getElementsByTagName("header");
                  //   for (var k = 0; k < headers.length; k++)
                  //     tmp.addHeader(getTagValue(headers[k], "type"), getTagValue(headers[k], "value"));
                  // }

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
      imports.group.push(foundGroups[i]);
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
    await quicktextParser.insertBody(parsed, {extraSpace: true});
  }
}

export async function insertContentFromFile(aTabId, aType) {
  let gTemplates = await storage.getTemplates();
  
  let content = await browser.Quicktext.pickFile(aTabId, aType, 0, browser.i18n.getMessage("insertFile"));
  if (!content) {
    return;
  }
  let quicktextParser = new QuicktextParser(aTabId, gTemplates, aType == 0);
  await quicktextParser.insertBody(content, {extraSpace: false});
}

// ---- TEMPLATE

// This is defined async, so it can be used in an runtime.onMessage listener
// without further logic to return a Promise.
export async function getKeywordsAndShortcuts() {
  let gTemplates = await storage.getTemplates();
  let keywords = {};
  let shortcuts = {};

  for (let i = 0; i < gTemplates.group.length; i++) {
    for (let j = 0; j < gTemplates.texts[i].length; j++) {
      let text = gTemplates.texts[i][j];
      let shortcut = text.mShortcut;
      if (shortcut != "" && typeof shortcuts[shortcut] == "undefined") {
        shortcuts[shortcut] = [i, j];
      }

      let keyword = text.mKeyword;
      if (keyword != "" && typeof keywords[keyword.toLowerCase()] == "undefined")
        keywords[keyword.toLowerCase()] = [i, j];
    }
  }
  return {keywords, shortcuts};
}