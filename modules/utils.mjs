/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

export function getDateTimeFormat(format, timeStamp) {
    let options = {};
    options["date-short"] = { dateStyle: "short" };
    options["date-long"] = { dateStyle: "full" };
    options["date-monthname"] = { month: "long" };
    options["time-noseconds"] = { timeStyle: "short" };
    options["time-seconds"] = { timeStyle: "medium" };
    return new Intl.DateTimeFormat(messenger.i18n.getUILanguage(), options[format.toLowerCase()]).format(timeStamp)
}

export function trimString(aStr) {
    if (!aStr) return "";
    return aStr.toString().replace(/(^\s+)|(\s+$)/g, '')
}

export async function parseDisplayName(addr) {
    let [rv] = await browser.messengerUtilities.parseMailboxString(addr);
    return {
        name: rv?.name || "",
        email: rv?.email || addr,
    }
}

export function replaceText(tag, value, text) {
    var replaceRegExp;
    if (value != "")
        replaceRegExp = new RegExp(escapeRegExp(tag), 'g');
    else
        replaceRegExp = new RegExp("( )?" + escapeRegExp(tag), 'g');
    return text.replace(replaceRegExp, value);
}

function escapeRegExp(aStr) {
    return aStr.replace(/([\^\$\_\.\\\[\]\(\)\|\+\?])/g, "\\$1");
}

export function removeBadHTML(aStr) {
    // Remove the head-tag
    aStr = aStr.replace(/<head(| [^>]*)>.*<\/head>/gim, '');
    // Remove html and body tags
    aStr = aStr.replace(/<(|\/)(head|body)(| [^>]*)>/gim, '');
    return aStr;
}

export function getTypeFromExtension(filename) {
    let ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
    // Extracted from https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types#Image_types
    switch (ext) {
        case ".apng":
            return "image/apng";
        case ".bmp":
            return "image/bmp";
        case ".gif":
            return "image/gif";
        case ".ico":
        case ".cur":
            return "image/x-icon";
        case ".jpg":
        case ".jpeg":
        case ".jfif":
        case ".pjpeg":
        case ".pjp":
            return "image/jpeg";
        case ".png":
            return "image/png";
        case ".svg":
            return "image/svg+xml";
        case ".tif":
        case ".tiff":
            return "image/tiff";
        case ".webp":
            return "image/webp";
        default:
            return "application/octet-stream";
    }
}

export function uint8ArrayToBase64(bytes) {
    return btoa(
        bytes.reduce((acc, current) => acc + String.fromCharCode(current), "")
    );
}

export function getLeafName(fileName) {
    return fileName.split('\\').pop().split('/').pop();
}

export async function writeFileToDisc(data, filename) {
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    try {
        await browser.downloads.download({
            url,
            filename,
            saveAs: true,
        });
    } catch (error) {
        console.error("Error downloading the file:", error);
    }
    URL.revokeObjectURL(url);
}

export async function getFileFromDisc(aType) {
    let picker = Promise.withResolvers();

    // Hidden input to open file dialog.
    const inputElement = document.createElement("input");
    inputElement.setAttribute("type", "file");
    inputElement.addEventListener("change", () => { picker.resolve(inputElement.files) }, false);
    inputElement.addEventListener("cancel", () => { picker.resolve([]) }, false);

    switch (aType) {
        case 0: // TXT files
            inputElement.setAttribute("accept", "text/plain");
            break;
        case 1: // HTML files
            inputElement.setAttribute("accept", "text/html");
            break;
        case 2: // arbitrary files
            break;
        case 3: // legacy Quicktext XML files
            inputElement.setAttribute("accept", ".xml");
            break;
        case 4: // image files
            inputElement.setAttribute("accept", "images/*");
            break;
        case 5: // JSON
            inputElement.setAttribute("accept", ".json");
            break;
        default: // attachments
            break;
    }

    inputElement.click();
    const [file] = await picker.promise;
    inputElement.remove();

    return file;
}

export async function getTextFileContent(file) {
  const content = await new Promise(resolve => {
    const reader = new FileReader();
    reader.onloadend = function (evt) {
      if (evt.target.readyState == FileReader.DONE) {
        var filedata = evt.target.result;
        resolve(filedata);
      }
    };
    reader.readAsText(file)
  })
  return content;
}

export async function fetchFileFromServer(url) {
    try {
        const response = await fetch(url);
        if (response?.ok) {
            return await response.text();
        }
        throw new Error('Network response was not ok');
    } catch (ex) {
        console.error('There was a problem with the fetch operation:', ex);
    }
}
