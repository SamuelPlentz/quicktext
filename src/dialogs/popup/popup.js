class QuicktextPopover {
    userInput = Promise.withResolvers();

    get popover() {
        return document.getElementById("quicktext-popover");
    }
    show() {
        this.popover.showPopover();
    }
    result() {
        return this.userInput.promise;
    }
}

// Build DOM nodes instead of injecting an HTML string: `label`/`values` are untrusted
// (they come from the template and the message the user is composing), so they are set as
// text/values that are never parsed as markup - no insertAdjacentHTML, no injection.
function createEl(tag, props = {}, children = []) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (k === "text") el.textContent = v;
        else el.setAttribute(k, v);
    }
    for (const child of children) el.append(child);
    return el;
}

// The shared popover shell: a <dialog> with a title, the given control, and OK/Cancel buttons,
// appended to <body>. Returns the dialog (its children carry the same ids the show() methods read).
function buildPopoverDialog(label, control) {
    const title = createEl("div", { id: "quicktext-popover-title", text: label });
    const ok = createEl("button", { id: "quicktext-popover-ok", class: "quicktext-popover-btn", text: "OK" });
    const cancel = createEl("button", { id: "quicktext-popover-cancel", class: "quicktext-popover-btn", text: "Cancel" });
    const buttons = createEl("div", { id: "quicktext-popover-buttons" }, [ok, cancel]);
    const dialog = createEl("dialog", { id: "quicktext-popover", popover: "manual" }, [title, control, buttons]);
    document.body.append(dialog);
    return dialog;
}

async function openQuicktextPopover(type, label, values) {
    let popover;
    if (type == "prompt") {
        popover = new class extends QuicktextPopover {
            show() {
                const input = createEl("input", { type: "text", id: "quicktext-popover-prompt" });
                input.value = values ?? "";
                const wrapper = createEl("div", { id: "quicktext-popover-prompt-wrapper" }, [input]);
                buildPopoverDialog(label, wrapper);
                document.getElementById("quicktext-popover-cancel").addEventListener(
                    "click",
                    () => this.userInput.resolve()
                );
                document.getElementById("quicktext-popover-ok").addEventListener(
                    "click",
                    () => this.userInput.resolve(this.value)
                );

                document.addEventListener("keydown", e => this.keydownEventHandler(e))
                this.prompt.focus();
                super.show();
            }
            get prompt() {
                return document.getElementById("quicktext-popover-prompt");
            }
            get value() {
                return this.prompt.value;
            }
            set value(v) {
                this.prompt.value = v;
            }
            keydownEventHandler(e) {
                switch (e.code) {
                    case "Escape":
                        this.userInput.resolve();
                        break;
                    case "Enter":
                    case "NumpadEnter":
                        this.userInput.resolve(this.value);
                        break;
                }
            }
        }
    } else if (type == "select") {
        popover = new class extends QuicktextPopover {
            show() {
                const select = createEl("select", { size: "5", id: "quicktext-popover-select" });
                values.forEach((v, i) => {
                    const opt = createEl("option", { value: v, text: v });
                    if (i == 0) opt.selected = true;
                    select.append(opt);
                });
                buildPopoverDialog(label, select);
                document.getElementById("quicktext-popover-cancel").addEventListener(
                    "click",
                    () => this.userInput.resolve()
                );
                document.getElementById("quicktext-popover-ok").addEventListener(
                    "click",
                    () => this.userInput.resolve(this.select.value)
                );

                document.addEventListener("keydown", e => this.keydownEventHandler(e))
                this.select.addEventListener("dblclick", e => this.dblclickEventHandler(e))

                this.select.focus();
                super.show();
            }
            get select() {
                return document.getElementById("quicktext-popover-select");
            }
            keydownEventHandler(e) {
                switch (e.code) {
                    case "Escape":
                        this.userInput.resolve();
                        break;
                    case "Enter":
                    case "NumpadEnter":
                        this.userInput.resolve(this.select.value);
                        break;
                }
            }
            dblclickEventHandler(e) {
                this.userInput.resolve(this.select.value);
            }
        }
    } else {
        console.error(`Unsupported popover type: ${type}`);
        return "";
    }
    popover.show();
    return popover.result();
}

let config = await browser.runtime.sendMessage({ action: "config" });
if (config.selectLabel) {
    let rv = await openQuicktextPopover("select", config.selectLabel, config.selectValues);
    await browser.runtime.sendMessage({ action: "close", rv });

} else if (config.promptLabel) {
    let rv = await openQuicktextPopover("prompt", config.promptLabel, config.promptValue);
    await browser.runtime.sendMessage({ action: "close", rv });
}
window.close();
