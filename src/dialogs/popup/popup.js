// Build DOM nodes instead of injecting an HTML string: `label`/`values` are
// untrusted (they come from the template and the message being composed), so
// they are set as text/values that are never parsed as markup.
function createEl(tag, props = {}, children = []) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (k === "text") el.textContent = v;
        else el.setAttribute(k, v);
    }
    for (const child of children) el.append(child);
    return el;
}

// Build the dialog into <body>: a title, the given control, and OK/Cancel
// buttons. Returns the two buttons so the caller can wire them.
function buildDialog(label, control) {
    const title = createEl("div", { id: "quicktext-popup-title", text: label });
    const ok = createEl("button", { id: "quicktext-popup-ok", class: "quicktext-popup-btn", text: "OK" });
    const cancel = createEl("button", { id: "quicktext-popup-cancel", class: "quicktext-popup-btn", text: "Cancel" });
    const buttons = createEl("div", { id: "quicktext-popup-buttons" }, [ok, cancel]);
    document.body.append(createEl("div", { id: "quicktext-popup" }, [title, control, buttons]));
    return { ok, cancel };
}

// Show the INPUT dialog and return a promise for the user's value. Cancel or
// Escape resolve with `undefined`; quicktextParser's process_input maps that to
// "" (or null with { nullOnAbort: true }).
function openInputDialog(type, label, values) {
    const { promise, resolve } = Promise.withResolvers();

    if (type == "prompt") {
        const input = createEl("input", { type: "text", id: "quicktext-popup-prompt" });
        input.value = values ?? "";
        const { ok, cancel } = buildDialog(label, createEl("div", { id: "quicktext-popup-prompt-wrapper" }, [input]));
        ok.addEventListener("click", () => resolve(input.value));
        cancel.addEventListener("click", () => resolve());
        document.addEventListener("keydown", e => {
            if (e.code == "Escape") resolve();
            else if (e.code == "Enter" || e.code == "NumpadEnter") resolve(input.value);
        });
        input.focus();
    } else if (type == "select") {
        const select = createEl("select", { size: "5", id: "quicktext-popup-select" });
        values.forEach((v, i) => {
            const opt = createEl("option", { value: v, text: v });
            if (i == 0) opt.selected = true;
            select.append(opt);
        });
        const { ok, cancel } = buildDialog(label, select);
        ok.addEventListener("click", () => resolve(select.value));
        cancel.addEventListener("click", () => resolve());
        select.addEventListener("dblclick", () => resolve(select.value));
        document.addEventListener("keydown", e => {
            if (e.code == "Escape") resolve();
            else if (e.code == "Enter" || e.code == "NumpadEnter") resolve(select.value);
        });
        select.focus();
    } else {
        console.error(`Unsupported input dialog type: ${type}`);
        return Promise.resolve("");
    }

    return promise;
}

// The window frame (title bar / decorations) is applied asynchronously by the
// OS: `inner === outer` means it is not on yet; the browser fires a `resize`
// when it lands and the inner viewport drops below the outer size. Resolve at
// once if the frame is already on, otherwise on that resize, with a fallback
// timeout for a frameless window or a WM that never fires resize.
function waitForFrameSettled() {
    return new Promise(resolve => {
        if (window.innerHeight < window.outerHeight) { resolve(); return; }
        const finish = () => { clearTimeout(t); window.removeEventListener("resize", onResize); resolve(); };
        // Only settle on the resize that actually applied the frame (inner drops
        // below outer); ignore any spurious earlier resize. The timeout is the
        // frameless / no-resize-event fallback, so skipping events is risk-free.
        const onResize = () => { if (window.innerHeight < window.outerHeight) finish(); };
        window.addEventListener("resize", onResize);
        const t = setTimeout(finish, 1000);
    });
}

// Size the window so its inner area exactly fits the rendered dialog - shrinking
// or growing as needed. `window.resizeTo` is blocked here (the window was not
// created by window.open), but the popup is a privileged extension page, so it
// calls the windows API on itself directly - no messaging to the background.
// `windows.update` height sets the OUTER size, so the frame overhead (known once
// the frame has settled) is added to make the inner area equal the content. A
// long option list scrolls internally (the select's CSS max-height), so the
// window height needs no arbitrary cap.
async function fitWindowToContent() {
    await waitForFrameSettled();
    const frameH = window.outerHeight - window.innerHeight;
    // frameH 0 after settling means either a truly frameless window (content will
    // fit) or a WM that hides its decorations from the API (content may not).
    // Allow scrolling so the buttons stay reachable in the latter; no-op in the
    // former. A normal decorated window (frameH > 0) fits exactly, so no scrollbar.
    if (frameH === 0) document.body.style.overflow = "auto";
    const content = Math.ceil(document.getElementById("quicktext-popup").getBoundingClientRect().height);
    if (window.innerHeight === content) return;
    const win = await browser.windows.getCurrent();
    await browser.windows.update(win.id, { height: content + frameH });
}

let config = await browser.runtime.sendMessage({ action: "config" });

let rvPromise;
if (config.selectLabel) {
    rvPromise = openInputDialog("select", config.selectLabel, config.selectValues);
} else if (config.promptLabel) {
    rvPromise = openInputDialog("prompt", config.promptLabel, config.promptValue);
}

if (rvPromise) {
    // Fire-and-forget: sizing must not block the dialog, and it may reject
    // harmlessly if the window is closed before it finishes.
    fitWindowToContent().catch(() => {});
    let rv = await rvPromise;
    await browser.runtime.sendMessage({ action: "close", rv });
}
window.close();
