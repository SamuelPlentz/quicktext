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

async function openQuicktextPopover(type, label, values) {
    let popover;
    if (type == "prompt") {
        popover = new class extends QuicktextPopover {
            show() {
                document.body.insertAdjacentHTML("beforeend", `
                    <dialog id="quicktext-popover" popover="manual">
                        <div id="quicktext-popover-title">${label}</div>
                        <div id="quicktext-popover-prompt-wrapper">
                            <input type="text" id="quicktext-popover-prompt" value="${values}">
                        </div>
                        <div id="quicktext-popover-buttons">
                            <button id="quicktext-popover-ok" class="quicktext-popover-btn">OK</button>
                            <button id="quicktext-popover-cancel" class="quicktext-popover-btn">Cancel</button>
                        </div>
                    </dialog>`);
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