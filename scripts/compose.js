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

class QuicktextPopover {
    selectPicker = Promise.withResolvers();
    // Events blocked only in backdrop, but allowed in popover.
    #backdropBlockedEvents = [
        "click",
        "keydown",
    ];
    // Events blocked in backdrop and popover.
    #alwaysBlockedEvents = [
        "keyup",
        "keypress",
        "mousedown",
        "mouseup",
        "select",
        "dblclick",
        "contextmenu",
    ]
    get popoverStyles() {
        return document.getElementById("quicktext-popover-style");
    }
    get popover() {
        return document.getElementById("quicktext-popover");
    }
    show() {
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
        for (let event of this.#backdropBlockedEvents) {
            window.addEventListener(event, this, true);
        }
        for (let event of this.#alwaysBlockedEvents) {
            window.addEventListener(event, this, true);
        }
        // Clicking inside the popover will change the selection and the insertion
        // point. Save current selection.
        const selection = window.getSelection();
        this.savedRanges = [];
        for (let i = 0; i < selection.rangeCount; ++i) {
            this.savedRanges.push(selection.getRangeAt(i));
        }

        this.popover.showPopover();

        // Set global flag.
        popoverShown = true;
    }
    result() {
        return this.selectPicker.promise;
    }
    hide() {
        this.popover.hidePopover();
        this.popover.remove()
        this.popoverStyles.remove();

        for (let event of this.#alwaysBlockedEvents) {
            window.removeEventListener(event, this, true);
        }
        for (let event of this.#backdropBlockedEvents) {
            window.removeEventListener(event, this, true);
        }
        // Restore selection.
        const selection = window.getSelection();
        selection.removeAllRanges();
        for (const range of this.savedRanges.filter(({ startContainer: { nodeName } }) => nodeName === "TR")) {
            selection.addRange(range);
        }
        for (const range of this.savedRanges.filter(({ startContainer: { nodeName } }) => nodeName !== "TR")) {
            selection.addRange(range);
        }

        // Set global flag.
        popoverShown = false;
    }
    popoverKeydownEventHandler(e) {
        console.warn("Not Implemented: popoverKeydownEventHandler()");
    }
    handleEvent(e) {
        if (this.#backdropBlockedEvents.includes(e.type)) {
            // The editor steals focus and key events, so we have to manually catch
            // key events and beam them into the popover. The original target for these
            // events is always the top most html element.
            if (e.type == "keydown") {
                this.popoverKeydownEventHandler(e);
            }
            // Do not block events if targeted inside the popover.
            if (e.target.closest("#quicktext-popover")) {
                return;
            }
        }

        e.stopPropagation();
        e.preventDefault();
        e.stopImmediatePropagation();
        return false;
    }
}

async function openQuicktextPopover(type, label, values) {
    let popover;
    if (type == "prompt") {
        popover = new class extends QuicktextPopover {
            show() {
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
                    () => this.selectPicker.resolve()
                );
                document.getElementById("quicktext-popover-ok").addEventListener(
                    "click",
                    () => this.selectPicker.resolve(this.value)
                );

                this.prompt.focus();
                this.startFakeCaret();
                super.show();
            }
            hide() {
                this.stopFakeCaret()
                super.hide();
            }
            get prompt() {
                return document.getElementById("quicktext-popover-prompt");
            }
            get value() {
                if (this.caretShown) {
                    return this.prompt.value.slice(0, -1);
                }
                return this.prompt.value;
            }
            set value(v) {
                this.stopFakeCaret();
                this.prompt.value = v;
                this.startFakeCaret();
            }
            stopFakeCaret() {
                if (this.caretShown) {
                    this.prompt.value = this.prompt.value.slice(0, -1);
                }
                this.caretShown = false;
                window.clearInterval(this.caretIntervalId);
            }
            startFakeCaret() {
                this.caretShown = false;
                this.caretIntervalId = window.setInterval(() => this.toggleFakeCaret(), 500);
            }
            popoverKeydownEventHandler(e) {
                switch (e.code) {
                    case "Backspace":
                        this.value = this.value.slice(0, -1);
                        break;
                    case "Escape":
                        this.selectPicker.resolve();
                        break;
                    case "Enter":
                    case "NumpadEnter":
                        this.selectPicker.resolve(this.value);
                        break;
                    default:
                        if (e.key.length == "1") {
                            this.value = `${this.value}${e.key}`;
                        }
                }
            }
            toggleFakeCaret() {
                const prompt = this.prompt;
                if (this.caretShown) {
                    prompt.value = prompt.value.slice(0, -1);
                } else {
                    prompt.value = `${prompt.value}|`;
                }
                this.caretShown = !this.caretShown;
            }
        }
    } else if (type == "select") {
        popover = new class extends QuicktextPopover {
            show() {
                document.body.insertAdjacentHTML("beforeend", `
                    <dialog id="quicktext-popover" popover="manual">
                        <div id="quicktext-popover-title">${label}</div>
                        <select size="5" id="quicktext-popover-select">
                        ${values.map((v, i) => `<option value="${v}" ${i == 0 ? "selected" : ""}>${v}</option>`)}
                        </select>
                        <div id="quicktext-popover-buttons">
                            <button id="quicktext-popover-ok" class="quicktext-popover-btn">OK</button>
                            <button id="quicktext-popover-cancel" class="quicktext-popover-btn">Cancel</button>
                        </div>
                    </dialog>`);
                document.getElementById("quicktext-popover-cancel").addEventListener(
                    "click",
                    () => this.selectPicker.resolve()
                );
                document.getElementById("quicktext-popover-ok").addEventListener(
                    "click",
                    () => this.selectPicker.resolve(this.select.value)
                );

                this.select.focus();
                super.show();
            }
            get select() {
                return document.getElementById("quicktext-popover-select");
            }
            popoverKeydownEventHandler(e) {
                const select = this.select;
                switch (e.code) {
                    case "Escape":
                        this.selectPicker.resolve();
                        break;
                    case "Enter":
                    case "NumpadEnter":
                        this.selectPicker.resolve(select.value);
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
        }
    } else {
        console.error(`Unsupported popover type: ${type}`);
        return "";
    }

    popover.show();
    const rv = await popover.result();
    popover.hide();

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
