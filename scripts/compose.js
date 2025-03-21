/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

const alternatives = {
    "Enter": ["NumpadEnter"]
}

let keywords, keywordKey, shortcutTypeAdv, shortcutModifier, shortcuts;
let advShortcutModifierIsDown = false;
let advShortcutString = "";
let popoverShown = false;
// -----------------------------------------------------------------------------

async function insertHtmlFragment(message) {
    // A normal space causes the selection to ignore the space.
    let space = message.extraSpace ? "&nbsp;" : "";
    document.execCommand('insertHtml', false, `${message.insertHtml}${space}`);
    await handlerCursorTags();
}

async function insertTextFragment(message) {
    let space = message.extraSpace ? " " : "";
    document.execCommand('insertText', false, `${message.insertText}${space}`);
    await handlerCursorTags();
}

function requestInsertTemplate(text) {
    return messenger.runtime.sendMessage({ command: "insertTemplate", group: text[0], text: text[1] });
}

async function getSelection(mode) {
    let selection = window.getSelection();
    if (mode == "TEXT") {
        return selection.toString();
    }
    // https://stackoverflow.com/questions/5083682/get-selected-html-in-browser-via-javascript
    if (selection.rangeCount > 0) {
        // It may be beneficial to include the surrounding node
        // to copy the format
        // let wrapperNode = selection.anchorNode.parentElement.tagName;

        let range = selection.getRangeAt(0);
        let clonedSelection = range.cloneContents();
        //let container = document.createElement(wrapperNode);
        //container.appendChild(clonedSelection);

        let div = document.createElement('div');
        div.appendChild(clonedSelection);
        return div.innerHTML;
    }
    return "";
}

async function handlerCursorTags() {
    const CURSOR = '[[CURSOR]]'
    try {
        let items = window.document.evaluate("//*", document, null, XPathResult.ANY_TYPE, null);
        let foundElements = [];
        let nextItem;
        do {
            if (nextItem && nextItem.childNodes.length > 0) {
                for (let node of nextItem.childNodes) {
                    if (node.nodeType == 3 && node.nodeValue.includes(CURSOR)) {
                        foundElements.push(node);
                    }
                }
            }
            nextItem = items.iterateNext();
        }
        while (nextItem)

        if (foundElements.length == 0) {
            return;
        }

        let selection = window.getSelection();
        for (let foundElement of foundElements) {
            let startPos = -1;
            do {
                if (startPos != -1) {
                    let range = document.createRange();
                    range.setStart(foundElement, startPos);
                    range.setEnd(foundElement, startPos + CURSOR.length);
                    selection.removeAllRanges();
                    selection.addRange(range);
                    selection.deleteFromDocument();
                }
                startPos = foundElement.nodeValue.indexOf(CURSOR);
            } while (startPos != -1)
        }

    } catch (ex) {
        console.debug(ex);
    }
}

class BlockedEventsHandler {
    constructor({ blockedEvents, selectPicker, popoverKeydownEventHandler }) {
        this.selectPicker = selectPicker;
        this.blockedEvents = blockedEvents;
        this.popoverKeydownEventHandler = popoverKeydownEventHandler;
    }
    handleEvent(e) {
        // The editor steals focus and key events, so we have to manually catch
        // key events and beam them into the popover. The original target for these
        // events is always the top most html element.
        if (popoverShown && e.type == "keydown") {
            this.popoverKeydownEventHandler(e);
        }

        // Do not block events targeted inside the popover.
        if (e.target.closest("#quicktext-popover")) {
            return;
        }
        e.stopPropagation();
        e.preventDefault();
        e.stopImmediatePropagation();
        return false;
    }
    startBlocking() {
        for (let event of this.blockedEvents) {
            window.addEventListener(event, this, true);
        }
    }
    stopBlocking() {
        for (let event of this.blockedEvents) {
            window.removeEventListener(event, this, true);
        }
    }
}

async function openQuicktextPopover(type, label, values) {
    const selectPicker = Promise.withResolvers();
    let popoverKeydownEventHandler;

    if (type == "select") {
        document.body.insertAdjacentHTML("beforeend", `
            <dialog id="quicktext-popover" popover="manual">
                <div id="quicktext-popover-title">${label}</div>
                <select size="5" id="quicktext-popover-select">
                ${values.map((v,i) => `<option value="${v}" ${i==0 ? "selected" : ""}>${v}</option>`)}
                </select>
                <div id="quicktext-popover-buttons">
                    <button id="quicktext-popover-ok" class="quicktext-popover-btn">OK</button>
                    <button id="quicktext-popover-cancel" class="quicktext-popover-btn">Cancel</button>
                </div>
            </dialog>`);
        document.getElementById("quicktext-popover-cancel").addEventListener(
            "click",
            () => selectPicker.resolve()
        );
        document.getElementById("quicktext-popover-ok").addEventListener(
            "click",
            () => selectPicker.resolve(document.getElementById("quicktext-popover-select").value)
        );
        document.getElementById("quicktext-popover-select").focus();

        popoverKeydownEventHandler = (e) => {
            const select = document.getElementById("quicktext-popover-select");
            switch (e.code) {
                case "Escape":
                    selectPicker.resolve();
                    break;
                case "Enter":
                case "NumpadEnter":
                    selectPicker.resolve(select.value);
                    break;
                case "ArrowUp":
                    if (select.selectedIndex > 0) {
                        select.selectedIndex -= 1;
                    }
                    break;
                case "ArrowDown":
                    if (select.selectedIndex < select.options.length - 1) {
                        select.selectedIndex += 1;
                    }
                    break;
            }
        }
    } else if (type == "prompt") {
        document.body.insertAdjacentHTML("beforeend", `
            <dialog id="quicktext-popover" popover="manual">
                <div id="quicktext-popover-title">${label}</div>
                <input type="text" id="quicktext-popover-prompt" value="${values}">
                <div id="quicktext-popover-buttons">
                    <button id="quicktext-popover-ok" class="quicktext-popover-btn">OK</button>
                    <button id="quicktext-popover-cancel" class="quicktext-popover-btn">Cancel</button>
                </div>
            </dialog>`);
        document.getElementById("quicktext-popover-cancel").addEventListener(
            "click",
            () => selectPicker.resolve()
        );
        document.getElementById("quicktext-popover-ok").addEventListener(
            "click",
            () => selectPicker.resolve(document.getElementById("quicktext-popover-prompt").value)
        );
        document.getElementById("quicktext-popover-prompt").focus();

        popoverKeydownEventHandler = (e) => {
            const prompt = document.getElementById("quicktext-popover-prompt");
            switch (e.code) {
                case "Backspace":
                    prompt.value = prompt.value.slice(0, -1);
                    break;
                case "Escape":
                    this.selectPicker.resolve();
                    break;
                case "Enter":
                case "NumpadEnter":
                    this.selectPicker.resolve(prompt.value);
                    break;
                default:
                    if (e.key.length == "1") {
                        prompt.value = `${prompt.value}${e.key}`;
                    }
            }
        }
    } else {
        console.error(`Unsupported popover type: ${type}`);
        return "";
    }

    document.head.insertAdjacentHTML("beforeend", `
        <style id="quicktext-popover-style">
            :popover-open {
                width: 300px;
                height: 200px;
                border-radius: 10px;
                border-width: 3px;
                padding: 0 10px;
                cursor: default;
                caret-color: transparent;
            }

            ::backdrop {
                backdrop-filter: brightness(30%) blur(3px);
            }

            #quicktext-popover-buttons {
                display: flex;
                justify-content: flex-end;
                width: 100%;
            }

            .quicktext-popover-btn {
                margin-top: 10px;
                margin-left: 10px;
            }

            #quicktext-popover-select {
                height: auto;
                width: 100%;
            }

            #quicktext-popover-prompt {
                width: 100%;
                caret-color: initial;
                cursor: initial;
            }

            #quicktext-popover-title {
                margin: 10px 0;
            }
        </style>`);

    const popover = document.getElementById("quicktext-popover");
    const popoverStyles = document.getElementById("quicktext-popover-style");
    const blockedEvents = [
        "click",
        "dblclick",
        "mousedown",
        "mouseup",
        "contextmenu",
        "keyup",
        "keydown",
        "keypress",
        "select"
    ];

    const blockedEventsHandler = new BlockedEventsHandler({
        selectPicker, blockedEvents, popoverKeydownEventHandler
    })
    blockedEventsHandler.startBlocking();

    // Clicking inside the popover will change the selection and the insertion
    // point. Save current selection.
    let selection = window.getSelection();
    const savedRanges = [];
    for (let i = 0; i < selection.rangeCount; ++i) {
        savedRanges.push(selection.getRangeAt(i));
    }

    popover.showPopover();
    popoverShown = true;
    const rv = await selectPicker.promise;
    popover.hidePopover();
    popoverShown = false;
    popover.remove()
    popoverStyles.remove();

    // Restore selection.
    selection = window.getSelection();
    selection.removeAllRanges();
    for (const range of savedRanges.filter(({ startContainer: { nodeName } }) => nodeName === "TR")) {
        selection.addRange(range);
    }
    for (const range of savedRanges.filter(({ startContainer: { nodeName } }) => nodeName !== "TR")) {
        selection.addRange(range);
    }

    blockedEventsHandler.stopBlocking();

    return rv;
}

// -----------------------------------------------------------------------------

function hasMatchingModifier(e, modifier) {
    return (
        e.altKey && modifier == "alt" ||
        e.ctrlKey && modifier == "control" ||
        e.metaKey && modifier == "meta"
    )
}

function isMatchingModifier(e, modifier) {
    return (
        e.key == "Alt" && modifier == "alt" ||
        e.key == "Control" && modifier == "control" ||
        e.key == "Meta" && modifier == "meta"
    )
}

function isRealKey(e) {
    return e.key.length == 1;
}

function keywordListener(e) {
    if (e.code == keywordKey || alternatives[keywordKey]?.includes(e.code)) {
        let selection = window.getSelection();
        if (!(selection.rangeCount > 0)) {
            return;
        }

        // This gives us a range object of the currently selected text
        // and as the user usually does not have any text selected when
        // triggering keywords, it is a collapsed range at the current
        // cursor position.
        let initialSelectionRange = selection.getRangeAt(0).cloneRange();

        // Get a temp selection, which we can modify to search for the beginning
        // of the last word.
        let tmpRange = initialSelectionRange.cloneRange();
        tmpRange.collapse(false);
        selection.removeAllRanges();
        selection.addRange(tmpRange);

        // Extend selection to the beginning of the current word.
        selection.modify("extend", "backward", "word");

        // We should only have one word selected, but make sure to only get the
        // last one by chopping up its content.
        let lastWord = selection.toString().split(" ").pop().toLowerCase();
        if (!lastWord) {
            // Restore to the initialSelectionRange and abort.
            selection.removeAllRanges();
            selection.addRange(initialSelectionRange);
            return;
        }

        let lastWordIsKeyword = keywords.hasOwnProperty(lastWord);
        if (!lastWordIsKeyword) {
            // Restore to the initialSelectionRange and abort.
            selection.removeAllRanges();
            selection.addRange(initialSelectionRange);
            return;
        }

        // So this is it. Eat the keypress, remove the keyword from the document
        // and insert the template.
        e.stopPropagation();
        e.preventDefault();

        // The following line will remove the keyword before we replace it. If we
        // do not do that, we see the keyword being selected and then replaced.
        // It does look interesting, but I keep it as it was before.
        selection.deleteFromDocument()
        requestInsertTemplate(keywords[lastWord])
    }
}

function shortcutKeyDown(e) {
    if (!hasMatchingModifier(e, shortcutModifier)) {
        return;
    }

    if (shortcutTypeAdv) {
        advShortcutModifierIsDown = true;
        if (isRealKey(e)) {
            advShortcutString += e.key;
        }
    } else if (isRealKey(e) && shortcuts[e.key] && !e.repeat) {
        requestInsertTemplate(shortcuts[e.key]);
    }

    // Eat all keys while modifier is down.
    e.stopPropagation();
    e.preventDefault();
}

async function shortcutKeyUp(e) {
    if (advShortcutModifierIsDown && shortcutTypeAdv && isMatchingModifier(e, shortcutModifier)) {
        if (advShortcutString != "" && typeof shortcuts[advShortcutString] != "undefined") {
            requestInsertTemplate(shortcuts[advShortcutString]);
        }
        advShortcutModifierIsDown = false;
        advShortcutString = "";
    }
}

async function getLatestPrefs() {
    const storage = await import(browser.runtime.getURL("/modules/storage.mjs"));

    keywordKey = await storage.getPref("keywordKey");
    shortcutTypeAdv = await storage.getPref("shortcutTypeAdv");
    shortcutModifier = await storage.getPref("shortcutModifier");

    let rv = await messenger.runtime.sendMessage({ command: "getKeywordsAndShortcuts" });
    keywords = rv.keywords;
    shortcuts = rv.shortcuts;

}
// -----------------------------------------------------------------------------

async function setup() {
    const storage = await import(browser.runtime.getURL("/modules/storage.mjs"));

    await getLatestPrefs();

    window.addEventListener("keydown", shortcutKeyDown, true);
    window.addEventListener("keyup", shortcutKeyUp, true);
    window.addEventListener("keydown", keywordListener, false);

    new storage.StorageListener(
        {
            watchedPrefs: ["keywordKey", "shortcutTypeAdv", "shortcutModifier"],
            listener: (changes) => {
                getLatestPrefs();
            }
        }
    )
}

messenger.runtime.onMessage.addListener((message, sender) => {
    if (message.insertText) {
        return insertTextFragment(message);
    }
    if (message.insertHtml) {
        return insertHtmlFragment(message);
    }
    if (message.promptLabel) {
        return openQuicktextPopover("prompt", message.promptLabel, message.promptValue);
    }
    if (message.selectLabel) {
        return openQuicktextPopover("select", message.selectLabel, message.selectValues);
    }
    if (message.alertLabel) {
        return Promise.resolve(window.alert(message.alertLabel));
    }
    if (message.getSelection) {
        return getSelection(message.getSelection)
    }
    if (message.isPopoverShown) {
        return Promise.resolve(popoverShown);
    }
    return false;
});

setup();

console.log("Quicktext compose script loaded");
