/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

export async function openSettingsDialog() {
  const { settingsWindowId = null } = await browser.storage.session.get({ settingsWindowId: null });
  if (settingsWindowId !== null) {
    try {
      await browser.windows.update(settingsWindowId, { focused: true });
      return;
    } catch {
      await browser.storage.session.remove("settingsWindowId");
    }
  }
  const win = await browser.windows.create({
    url: "/dialogs/manager/manager.html",
    type: "popup",
    allowScriptsToClose: true,
    width: 800,
    height: 650,
  });
  await browser.storage.session.set({ settingsWindowId: win.id });
  browser.windows.onRemoved.addListener(function onRemoved(windowId) {
    if (windowId === win.id) {
      browser.storage.session.remove("settingsWindowId");
      browser.windows.onRemoved.removeListener(onRemoved);
    }
  });
}


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

export function replaceText(tag, value, text, { collapseLineBreaks }) {
    const escapedTag = escapeRegExp(tag);

    if (value != "") {
        return text.replace(new RegExp(escapedTag, 'g'), value);
    }

    // If value is "", we collapse a leading spaces and optionally linebreaks. Do not use global mode
    // here, but force this function to be called on each tag (even if used multiple times), so the
    // fallback regexp can cleanup a line until it is matching the single tag regexp and correctly
    // removes the entire line.
    if (collapseLineBreaks) {
        // Match lines with a single empty tag and optional whitespaces.
        const singleTagRegExp = new RegExp(`(^|\\r?\\n)( )*${escapedTag}( )*(\\r?\\n|$)`, 'm');
        const collapsed = text.replace(singleTagRegExp, (match, leadingLB, leadingWSP, trailingWSP, trailingLB, offset, fullText) => {
            // leadingLB and trailingLB are either "" or a line break. If we're matching two
            // line breaks (one before, one after), preserve one.
            return leadingLB && trailingLB ? leadingLB : "";
        });
        if (collapsed !== text) {
            return collapsed;
        }
    }

    // Match empty tags anywhere with optional single space before the tag.
    return text.replace(new RegExp(`( )?${escapedTag}`, ''), value);
}

export function escapeRegExp(aStr) {
    return aStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
        let id = null;
        const { promise, resolve } = Promise.withResolvers();

        const listener = delta => {
            if (id == delta.id && delta.state?.current === 'complete') {
                browser.downloads.onChanged.removeListener(listener);
                resolve();
            }
        }

        browser.downloads.onChanged.addListener(listener);
        id = await browser.downloads.download({
            url,
            filename,
            saveAs: true,
        });

        await promise;
    } catch (error) {
        console.error("Error downloading the file:", error);
    }

    URL.revokeObjectURL(url);
}

export async function pickFileFromDisc(aTypes) {
    let picker = Promise.withResolvers();

    // Hidden input to open file dialog.
    const inputElement = document.createElement("input");
    inputElement.setAttribute("type", "file");
    inputElement.addEventListener("change", () => { picker.resolve(inputElement.files) }, false);
    inputElement.addEventListener("cancel", () => { picker.resolve([]) }, false);

    let acceptedFileTypes = []
    for (let aType of aTypes) {
        switch (aType) {
            case 0: // TXT files
            case "text/plain":
                acceptedFileTypes.push("text/plain");
                break;
            case 1: // HTML files
            case "text/html":
                acceptedFileTypes.push("text/html");
                break;
            case 2: // arbitrary files
                break;
            case 3: // legacy Quicktext XML files
                acceptedFileTypes.push(".xml");
                break;
            case 4: // image files
                acceptedFileTypes.push("images/*");
                break;
            case 5: // JSON
                acceptedFileTypes.push(".json");
                break;
            default: // attachments
                break;
        }
    }

    inputElement.setAttribute("accept", acceptedFileTypes.join(", "));
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

export async function fetchFileAsFile(url, name) {
    // Bypass the HTTP cache: tag-driven URL reads should always
    // see the live resource, never a stale copy from a previous
    // template insert.
    const response = await fetch(url, { cache: "no-store" });

    if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();
    const filename = name ?? getLeafName(url);
    const contentType = blob.type || getTypeFromExtension(filename)

    return new File([blob], filename, { type: contentType });
}

export async function fetchFileAsText(url) {
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

export async function fetchFileAsDataUrl(url) {
    // Bypass the HTTP cache: tag-driven URL reads should always
    // see the live resource, never a stale copy from a previous
    // template insert.
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

export async function openPopup(tabId, config) {
    let status = "none";
    let popup = Promise.withResolvers();
    let popupId;
    let parentId = await browser.tabs.get(tabId).then(tab => tab.windowId);

    // Provisional size for the popup window. popup.js measures the rendered
    // content after the window frame settles and resizes the window so the inner
    // area fits exactly (shrinking or growing), so this only needs to be small
    // enough not to flash oversized before that adjustment.
    const size = { width: 400, height: 150 };

    // Best-effort centering over the parent compose window. Some Wayland
    // setups ignore the requested position, which is fine - the small size is
    // the actual fix.
    const centeredOverParent = async () => {
        try {
            const { left, top, width, height } = await browser.windows.get(parentId);
            return {
                left: Math.round(left + (width - size.width) / 2),
                top: Math.round(top + (height - size.height) / 2),
            };
        } catch {
            return {};
        }
    };

    const onRemovedListener = windowId => {
        if (windowId == popupId) {
            status = "closed";
            popup.resolve();
        }
    };
    // When the parent window gains focus, refocus the popup to keep
    // it modal-like.
    const onFocusChangedListener = async windowId => {
        if (status != "active") {
            return;
        }
        if (windowId == parentId) {
            try {
                // Return focus to the popup. This keeps it in front and, by
                // taking focus back from the compose window, prevents typing into
                // the message while the input dialog is open (sending is
                // separately blocked via onBeforeSend). Do not resize.
                await browser.windows.update(popupId, { focused: true });
            } catch (e) {
                // The popup might have been closed in the meantime.
                console.warn("Could not refocus popup, it might be closing.", e.message);
            }
        }
    };
    const onMessageListener = (info, sender, sendResponse) => {
        // Validate windowId for all actions, allow first config request to set popupId to resolve race condition
        if (sender.tab.windowId != popupId) {
            if (info?.action === "config" && !popupId) {
                popupId = sender.tab.windowId;
            } else {
                return false;
            }
        }

        switch (info?.action) {
            case "config":
                status = "active";
                return Promise.resolve(config);
            case "close":
                popup.resolve(info.rv);
                status = "closed";
                return Promise.resolve();
        }
        return false;
    }

    browser.runtime.onMessage.addListener(onMessageListener);
    browser.windows.onRemoved.addListener(onRemovedListener);
    browser.windows.onFocusChanged.addListener(onFocusChangedListener);

    popupId = await browser.windows.create({
        url: "/dialogs/popup/popup.html",
        type: "popup",
        allowScriptsToClose: true,
        ...size,
        ...await centeredOverParent(),
    }).then(window => window.id);

    await messenger.tabs.sendMessage(tabId, {
        setInputPopupOpen: true,
        open: true,
    });

    let rv = await popup.promise;

    browser.runtime.onMessage.removeListener(onMessageListener);
    browser.windows.onRemoved.removeListener(onRemovedListener);
    browser.windows.onFocusChanged.removeListener(onFocusChangedListener);

    await messenger.tabs.sendMessage(tabId, {
        setInputPopupOpen: true,
        open: false,
    });

    return rv;
}

export async function checkBadNameEntries(templates, scripts) {
    const badSubstrings = ["|", "[[", "]]"];
    let badEntries = 0;

    if (templates?.groups) {
        badEntries += templates.groups.filter(e => badSubstrings.some(sub => e.name.includes(sub))).length;
    }
    if (templates?.texts) {
        badEntries += templates.texts.flat().filter(e => badSubstrings.some(sub => e.name.includes(sub))).length;
    }
    if (scripts) {
        badEntries += scripts.filter(e => badSubstrings.some(sub => e.name.includes(sub))).length
    }
    if (badEntries > 0) {
        browser.notifications.create("qt-bad-entries", {
            type: "basic",
            title: "Quicktext v6",
            message: `Some of your template, group or script names include one or more forbidden chars ("|", "[[" or "]]"). These entries will not work.`,
        });
    }
}

const createNotification = async message => {
    await browser.notifications.create(
        "qt-duplicated-entries", {
        type: "basic",
        title: "Quicktext v6",
        message
    });
    console.warn(`[Quicktext v6] ${message}`)
}

export async function checkDuplicatedEntries(templates, scripts) {
    const findDuplicates = array => {
        const seen = new Set();
        const duplicates = new Set();
        for (const item of array) {
            if (seen.has(item)) {
                duplicates.add(item);
            } else {
                seen.add(item);
            }
        }
        return [...duplicates];
    }


    const scriptNames = Array.isArray(scripts)
        ? scripts.map(e => e.name.trim())
        : []
    const duplicatedScriptNames = findDuplicates(scriptNames);
    if (duplicatedScriptNames.length) {
        await createNotification(
            `Invalid script data, multiple scripts with the same name: ${duplicatedScriptNames.join(", ")}`
        );
    }

    const groupNames = Array.isArray(templates?.groups)
        ? templates.groups.map(e => e.name.trim())
        : []
    const duplicatedGroupNames = findDuplicates(groupNames);
    if (duplicatedGroupNames.length) {
        await createNotification(
            `Invalid template data, multiple groups with the same name: ${duplicatedGroupNames.join(", ")}`
        );
    }

    if (Array.isArray(templates?.texts)) {
        if (templates.texts.length != groupNames.length) {
            await createNotification(
                `Invalid template data, number of groups does not match number of template groups.`
            );
        }
        for (let i = 0; i < templates.texts.length; i++) {
            const textNames = templates.texts[i].map(e => e.name.trim());
            const duplicatedNames = findDuplicates(textNames);
            if (duplicatedNames.length) {
                await createNotification(
                    `Invalid template data, multiple templates in group "${groupNames[i]}" with the same name: ${duplicatedNames.join(", ")}`
                )
            }
        }
    }
}

// Unified deprecation detection. Scans all bundles for:
// - Templates: deprecated FILE-typed tags (explicit, implicit, underscore).
// - Scripts: deprecated v5 API keywords + deprecated FILE tag calls via
//   this.quicktext.getTag/processTag.
// All script scanning runs on comment-stripped code.
// Results are stored in browser.storage.local and returned.
export async function detectDeprecatedUsages(bundles) {
    const results = { templates: [], scripts: [] };

    // -- Helpers --

    function stripComments(code) {
        return code.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    }

    // Find ]] respecting nested [[ ]] pairs, same logic as the parser.
    function findClosingBrackets(str) {
        let bracketCount = 0;
        for (let i = 0; i < str.length; i++) {
            if (str[i] === "[") bracketCount++;
            if (str[i] === "]") {
                bracketCount--;
                if (bracketCount === -1 && str[i + 1] === "]") return i;
            }
        }
        return -1;
    }

    // Find deprecated FILE-typed tags in a string. Catches:
    //   [[FILE=...]], [[IMAGE=FILE|...]], [[ATTACHMENT=FILE|...]],
    //   [[IMAGE_FILE|...]], [[ATTACHMENT_FILE|...]],
    //   [[IMAGE=/path]] / [[ATTACHMENT=/path]] (implicit FILE mode).
    const tagOpener = /\[\[(file|image|attachment)([=_])/gi;
    function findFileTagsIn(str) {
        const found = [];
        let m;
        while ((m = tagOpener.exec(str)) !== null) {
            const tagName = m[1].toLowerCase();
            const sep = m[2];
            const rest = str.slice(m.index + m[0].length);
            const close = findClosingBrackets(rest);
            if (close === -1) continue;
            const fullTag = str.slice(m.index, m.index + m[0].length + close + 2);
            const inner = rest.slice(0, close);
            const parts = inner.split("|");

            let path = null;
            let isFileMode = false;

            if (tagName === "file") {
                // [[FILE=<path>]] or [[FILE=<path>|flags]]
                path = parts[0].trim();
                isFileMode = true;
            } else if (sep === "_") {
                // [[IMAGE_FILE|<path>]] / [[ATTACHMENT_FILE|<path>]]
                const suffix = parts[0].split("=")[0].trim().toLowerCase();
                if (suffix === "file") {
                    path = parts[1]?.trim() ?? null;
                    isFileMode = true;
                }
            } else {
                // sep === "=": [[IMAGE=...|...]] / [[ATTACHMENT=...|...]]
                const mode = parts[0].trim().toLowerCase();
                if (mode === "file") {
                    // Explicit: [[IMAGE=FILE|<path>]]
                    path = parts[1]?.trim() ?? null;
                    isFileMode = true;
                } else if (!["url", "vfs"].includes(mode)) {
                    // Implicit FILE: [[IMAGE=<path>]] where <path> isn't a mode keyword
                    path = parts[0].trim();
                    isFileMode = true;
                }
            }

            if (!isFileMode) continue;
            const migration = (path && !path.includes("[[")) ? "auto" : "manual";
            found.push({ tag: fullTag, path, migration });
        }
        tagOpener.lastIndex = 0;
        return found;
    }

    // -- Template scan --

    for (const bundle of bundles) {
        const groups = bundle.templates?.groups ?? [];
        const texts = bundle.templates?.texts ?? [];
        for (let gi = 0; gi < groups.length; gi++) {
            for (let ti = 0; ti < (texts[gi]?.length ?? 0); ti++) {
                const tmpl = texts[gi][ti];
                const tags = [
                    ...findFileTagsIn(tmpl.text || ""),
                    ...findFileTagsIn(tmpl.subject || ""),
                ];
                if (tags.length === 0) continue;
                results.templates.push({
                    storageUuid: bundle.storageUuid,
                    storageName: bundle.storageName,
                    group: groups[gi].name,
                    template: tmpl.name,
                    tags,
                });
                for (const t of tags) {
                    console.warn(
                        `[Quicktext] Deprecated FILE tag (${t.migration}) in `
                        + `"${bundle.storageName}" › "${groups[gi].name}" › "${tmpl.name}": ${t.tag}`
                    );
                }
            }
        }
    }

    // -- Script scan --

    const deprecatedApiKeywords = ["this.mWindow", "this.mVariables", "this.mQuicktext"];
    // Match getTag("file", ...) / processTag("file", ...) - the FILE tag itself.
    // Captures: [1]=function name, [2]=quote style around "file",
    // then optionally a second string arg (the path).
    const fileTagCallRe = /(getTag|processTag)\s*\(\s*(["'])file\2\s*(?:,\s*(["'])([^"']*)\3)?/gi;
    // Match getTag("image"/"attachment", "file", ...) - explicit FILE mode.
    const fileModCallRe = /(getTag|processTag)\s*\(\s*(["'])(image|attachment)\2\s*,\s*(["'])file\4\s*(?:,\s*(["'])([^"']*)\5)?/gi;

    function extractCallPath(pathGroup) {
        const path = pathGroup ?? null;
        const migration = (path && !path.includes("[[")) ? "auto" : "manual";
        return { path, migration };
    }

    for (const bundle of bundles) {
        for (const script of (bundle.scripts ?? [])) {
            const code = stripComments(script.script || "");
            const issues = [];
            const details = [];

            for (const kw of deprecatedApiKeywords) {
                if (code.includes(kw)) {
                    if (!issues.includes("deprecated-api")) issues.push("deprecated-api");
                    details.push({ type: "deprecated-api", keyword: kw, migration: "manual" });
                }
            }

            let rm;
            while ((rm = fileTagCallRe.exec(code)) !== null) {
                if (!issues.includes("deprecated-tag")) issues.push("deprecated-tag");
                const { path, migration } = extractCallPath(rm[4]);
                details.push({ type: "deprecated-tag", call: rm[0], path, migration });
            }
            fileTagCallRe.lastIndex = 0;
            while ((rm = fileModCallRe.exec(code)) !== null) {
                if (!issues.includes("deprecated-tag")) issues.push("deprecated-tag");
                const { path, migration } = extractCallPath(rm[6]);
                details.push({ type: "deprecated-tag", call: rm[0], path, migration });
            }
            fileModCallRe.lastIndex = 0;

            const fileTags = findFileTagsIn(code);
            for (const ft of fileTags) {
                if (!issues.includes("deprecated-tag")) issues.push("deprecated-tag");
                details.push({ type: "deprecated-tag", call: ft.tag, path: ft.path, migration: ft.migration });
            }

            if (issues.length === 0) continue;
            results.scripts.push({
                storageUuid: bundle.storageUuid,
                storageName: bundle.storageName,
                script: script.name,
                issues,
                details,
            });
            for (const d of details) {
                const label = d.type === "deprecated-api" ? d.keyword : d.call;
                console.warn(
                    `[Quicktext] Deprecated usage (${d.migration}) in script `
                    + `"${bundle.storageName}" › "${script.name}": ${label}`
                );
            }
        }
    }

    await browser.storage.local.set({ deprecatedUsages: results });

    return results;
}

// Execute auto-migration for a single storage entry. Copies local files into
// VFS folders alongside the config JSON, rewrites tags in template bodies/
// subjects and script bodies. Returns the count of migrated items.
//
// `entry`  - a storageLocations entry (needs `path`, `storageRef`).
// `bundle` - the in-memory bundle for this storage (templates + scripts).
// `findings` - { templates: [...], scripts: [...] } filtered to this storage
//              and only auto-migratable items.
// `vfs`    - the vfs-client module (passed in to avoid circular imports).
export async function runAutoMigration(entry, bundle, findings, vfs, onProgress) {
    const configDir = getConfigDir(entry.path);
    const storageRef = entry.storageRef ?? null;

    // Collect all source paths and their target folders.
    const copyPlan = new Map();

    function planCopy(sourcePath, tagOrCall) {
        if (copyPlan.has(sourcePath)) return copyPlan.get(sourcePath);
        const folder = getFolderForTag(tagOrCall);
        const leaf = getLeafName(sourcePath);
        const target = getVfsTargetPath(configDir, tagOrCall, sourcePath);
        copyPlan.set(sourcePath, { folder, leaf, target, sourcePath });
        return copyPlan.get(sourcePath);
    }

    // First pass: plan all copies and detect leaf-name collisions per folder.
    for (const tmplFinding of (findings.templates ?? [])) {
        for (const t of tmplFinding.tags) {
            if (t.migration !== "auto" || !t.path) continue;
            planCopy(t.path, t.tag);
        }
    }
    for (const scriptFinding of (findings.scripts ?? [])) {
        for (const d of scriptFinding.details) {
            if (d.migration !== "auto" || !d.path) continue;
            planCopy(d.path, d.call);
        }
    }

    // Resolve leaf-name collisions using path-hierarchy disambiguation.
    const byFolder = new Map();
    for (const plan of copyPlan.values()) {
        if (!byFolder.has(plan.folder)) byFolder.set(plan.folder, []);
        byFolder.get(plan.folder).push(plan);
    }
    for (const [folder, plans] of byFolder) {
        const leafGroups = new Map();
        for (const p of plans) {
            if (!leafGroups.has(p.leaf)) leafGroups.set(p.leaf, []);
            leafGroups.get(p.leaf).push(p);
        }
        for (const [, group] of leafGroups) {
            if (group.length <= 1) continue;
            const paths = group.map(p => p.sourcePath.split("/").filter(Boolean));
            const prefixLen = _commonPrefixLength(paths);
            for (const p of group) {
                const segments = p.sourcePath.split("/").filter(Boolean);
                const diffParts = segments.slice(prefixLen, -1);
                const disambiguated = diffParts.length > 0
                    ? diffParts.join("_") + "_" + p.leaf
                    : p.leaf;
                p.target = `${configDir}/${folder}/${disambiguated}`;
            }
        }
    }

    // Ensure target paths don't collide with files already in VFS
    // (from a previous migration attempt or user uploads).
    for (const plan of copyPlan.values()) {
        plan.target = await _findUniquePath(plan.target, storageRef, vfs);
    }

    // Copy files to VFS. Only successfully copied files are added to
    // `copied`; tags referencing failed copies are left unchanged.
    const copied = new Set();
    const failed = new Set();
    const toCopy = [...copyPlan.values()].filter(p => !copied.has(p.target));
    const totalFiles = toCopy.length;
    let fileIdx = 0;
    for (const plan of toCopy) {
        if (copied.has(plan.target)) continue;
        fileIdx++;
        if (onProgress) onProgress({ phase: "copy", file: getLeafName(plan.sourcePath), current: fileIdx, total: totalFiles });
        try {
            const bytes = await browser.FileSystemAccess.readBinaryFile(plan.sourcePath);
            if (!bytes || bytes.length === 0) {
                throw new Error("File is empty or unreadable");
            }
            const type = getTypeFromExtension(plan.sourcePath);
            const blob = new Blob([bytes], { type });
            await vfs.writeFile(
                { path: plan.target, storageRef },
                blob,
                { overwrite: false }
            );
            const verifyFile = await vfs.readFile({ path: plan.target, storageRef });
            const verifyBytes = new Uint8Array(await verifyFile.arrayBuffer());
            if (verifyBytes.length !== bytes.length) {
                throw new Error(`Verification failed: wrote ${bytes.length} bytes, read back ${verifyBytes.length}`);
            }
            copied.add(plan.target);
        } catch (ex) {
            console.error(`[Migration] Failed to copy ${plan.sourcePath} → ${plan.target}:`, ex);
            failed.add(plan.sourcePath);
        }
    }

    if (onProgress) onProgress({ phase: "rewrite" });

    // Rewrite tags in template bodies and subjects.
    let migratedCount = 0;
    const templates = bundle.templates;
    for (const tmplFinding of (findings.templates ?? [])) {
        const gi = templates.groups.findIndex(g => g.name === tmplFinding.group);
        if (gi === -1) continue;
        const ti = templates.texts[gi]?.findIndex(t => t.name === tmplFinding.template);
        if (ti == null || ti === -1) continue;
        const tmpl = templates.texts[gi][ti];
        for (const t of tmplFinding.tags) {
            if (t.migration !== "auto" || !t.path) continue;
            if (failed.has(t.path)) continue;
            const plan = copyPlan.get(t.path);
            if (!plan) continue;
            const vfsRelPath = plan.target;
            const newTag = rewriteTagPreview(t.tag, vfsRelPath);
            tmpl.text = (tmpl.text || "").replaceAll(t.tag, newTag);
            tmpl.subject = (tmpl.subject || "").replaceAll(t.tag, newTag);
            migratedCount++;
        }
    }

    // Rewrite tags in script bodies.
    for (const scriptFinding of (findings.scripts ?? [])) {
        const si = bundle.scripts.findIndex(s => s.name === scriptFinding.script);
        if (si === -1) continue;
        const script = bundle.scripts[si];
        for (const d of scriptFinding.details) {
            if (d.migration !== "auto" || !d.path) continue;
            if (failed.has(d.path)) continue;
            const plan = copyPlan.get(d.path);
            if (!plan) continue;
            const vfsRelPath = plan.target;
            const newCall = rewriteScriptCallPreview(d.call, d.path, vfsRelPath);
            script.script = script.script.replace(d.call, newCall);
            migratedCount++;
        }
    }

    return { migrated: migratedCount, failed: failed.size };
}

async function _findUniquePath(targetPath, storageRef, vfs) {
    const dir = targetPath.replace(/\/[^/]*$/, "") || "/";
    let entries;
    try {
        entries = await vfs.list({ path: dir, storageRef });
    } catch {
        return targetPath;
    }
    const existingNames = new Set(entries.map(e => e.name));
    const dot = targetPath.lastIndexOf(".");
    const base = dot !== -1 ? targetPath.slice(0, dot) : targetPath;
    const ext = dot !== -1 ? targetPath.slice(dot) : "";
    let candidate = targetPath;
    let n = 2;
    while (existingNames.has(getLeafName(candidate))) {
        candidate = `${base}_${n}${ext}`;
        n++;
    }
    return candidate;
}

function _commonPrefixLength(arrays) {
    if (arrays.length === 0) return 0;
    let len = 0;
    while (arrays.every(a => len < a.length && a[len] === arrays[0][len])) len++;
    return len;
}

export function rewriteTagPreview(tag, vfsPath) {
    const lc = tag.toLowerCase();
    if (lc.startsWith("[[file=")) {
        return `[[VFSFILE=${vfsPath}${tag.includes("|") ? tag.slice(tag.indexOf("|")) : "]]"}`;
    }
    if (lc.match(/^\[\[(image|attachment)=file\|/)) {
        return tag.replace(/=file\|/i, `=VFS|`).replace(
            /\|[^|\]]+/,
            `|${vfsPath}`
        );
    }
    if (lc.match(/^\[\[(image|attachment)_file\|/)) {
        return tag.replace(/_(file)\|/i, `=VFS|`).replace(
            /\|[^|\]]+/,
            `|${vfsPath}`
        );
    }
    // Implicit FILE mode: [[IMAGE=/path]] → [[IMAGE=VFS|/vfsPath]]
    if (lc.match(/^\[\[(image|attachment)=/)) {
        const tagName = tag.match(/^\[\[(\w+)=/)[1];
        const rest = tag.slice(tag.indexOf("=") + 1, -2);
        const parts = rest.split("|");
        parts[0] = `VFS|${vfsPath}`;
        return `[[${tagName}=${parts.join("|")}]]`;
    }
    return tag;
}

// Extract the parent directory from a config file path.
export function getConfigDir(configPath) {
    return (configPath || "").replace(/\/[^/]*$/, "") || "";
}

// Compute the full VFS target path for a migrated file.
export function getVfsTargetPath(configDir, tagOrCall, sourcePath) {
    const folder = getFolderForTag(tagOrCall);
    const leaf = sourcePath ? getLeafName(sourcePath) : "?";
    return `${configDir}/${folder}/${leaf}`;
}

// Determine the VFS destination folder for a FILE-typed tag or script call.
export function getFolderForTag(tagOrCall) {
    const lc = (tagOrCall || "").toLowerCase();
    if (lc.match(/^\[\[file=/) || lc.match(/(["'])file\1/)) return "files";
    if (lc.match(/^\[\[image/) || lc.match(/(["'])image\1/)) return "images";
    return "attachments";
}

// Preview the rewritten form of a deprecated script getTag/processTag call.
export function rewriteScriptCallPreview(call, path, vfsPath) {
    return call
        .replace(/["']file["']/i, `"vfsfile"`)
        .replace(new RegExp(escapeRegExp(path)), vfsPath);
}

