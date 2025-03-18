import { QuicktextGroup } from "/modules/quicktextGroup.mjs";
import { QuicktextScript } from "/modules/quicktextScript.mjs";
import { QuicktextTemplate } from "/modules/quicktextTemplate.mjs";

/**
 * 
 * @param {string} aData xml file content
 * @param {integer} aType 0 = normal, 1 = default import
 * @returns {obj} imports
 */
export async function parseImport(aData, aType) {
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