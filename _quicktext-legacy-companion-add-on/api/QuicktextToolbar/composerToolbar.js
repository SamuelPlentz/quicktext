var quicktextToolbar = {
  windowId: null,
  extension: null,

  notify(info) {
    return new Promise(resolve => {
      Services.obs.notifyObservers(
        { data: info, resolve },
        "QuicktextToolbarCommand"
      );
    });
  },

  getPrettyKeyName(key) {
    return this.extension.localeData.localizeMessage(`quicktext.${key}Key.label`)
  },

  async load() {
    const { ExtensionParent } = ChromeUtils.importESModule(
      "resource://gre/modules/ExtensionParent.sys.mjs"
    );
    this.extension = ExtensionParent.GlobalManager.getExtension(
      "{8845E3B3-E8FB-40E2-95E9-EC40294818C4}"
    );
    await this.update();
  },
  unload() {
  },
  buildTemplatesMenu(toolbar, nodes, shortcutModifier, menuCollapse) {
    for (const node of nodes) {
      let t = document.createXULElement("button");
      t.setAttribute("tabindex", "-1");
      if (node.children.length == 1 && menuCollapse) {
        toolbar.appendChild(t);
        t.setAttribute("label", node.children[0].title);
        t.setAttribute("storageUuid", node.children[0].storageUuid);
        t.setAttribute("i", node.children[0].groupIndex);
        t.setAttribute("j", node.children[0].textIndex);
        t.setAttribute("class", "customEventListenerForDynamicMenu");
        if (node.shortcut != "" && typeof this.mShortcuts[node.shortcut] == "undefined")
          this.mShortcuts[node.shortcut] = [node.storageUuid, node.groupIndex, node.textIndex];
        if (node.keyword != "" && typeof this.mKeywords[node.keyword] == "undefined")
          this.mKeywords[node.keyword] = [node.storageUuid, node.groupIndex, node.textIndex];
      } else {
        t.setAttribute("type", "menu");
        toolbar.appendChild(t);
        t.setAttribute("label", node.title);
        const menupopup = t.appendChild(document.createXULElement("menupopup"));
        for (const child of node.children) {
          const mi = document.createXULElement("menuitem");
          mi.setAttribute("label", child.title);
          mi.setAttribute("storageUuid", child.storageUuid);
          mi.setAttribute("i", child.groupIndex);
          mi.setAttribute("j", child.textIndex);
          mi.setAttribute("class", "customEventListenerForDynamicMenu");
          if (child.shortcut != "") {
            let shortcut = child.shortcut;
            if (shortcut == 10) shortcut = 0;
            mi.setAttribute("acceltext", `${this.getPrettyKeyName(shortcutModifier)} + ${shortcut}`);
          }
          if (child.shortcut != "" && typeof this.mShortcuts[child.shortcut] == "undefined")
            this.mShortcuts[child.shortcut] = [child.storageUuid, child.groupIndex, child.textIndex];
          if (child.keyword != "" && typeof this.mKeywords[child.keyword] == "undefined")
            this.mKeywords[child.keyword] = [child.storageUuid, child.groupIndex, child.textIndex];
          menupopup.appendChild(mi);
        }
      }
    }
  },
  async update() {
    const data = await this.notify({ command: "getToolbarData" });

    this.mShortcuts = {};
    this.mKeywords = {};

    const toolbar = document.getElementById("quicktext-templates-toolbar");
    if (toolbar) {
      while (toolbar.firstChild) toolbar.removeChild(toolbar.firstChild);

      // Detect multi-storage: top-level children that are groups (have
      // their own children) rather than text items.
      const isMulti = data.templates.some(
        n => n.children?.some(c => c.children)
      );

      if (isMulti && data.templates.length > 1) {
        for (const storageNode of data.templates) {
          const section = document.createXULElement("vbox");
          section.setAttribute("class", "quicktext-storage-section");
          if (storageNode.disabled) section.setAttribute("disabled", "true");
          const label = document.createXULElement("label");
          label.setAttribute("value", storageNode.title);
          label.setAttribute("class", "quicktext-storage-label");
          if (storageNode.disabled) label.setAttribute("disabled", "true");
          section.appendChild(label);
          if (!storageNode.disabled) {
            const buttons = document.createXULElement("hbox");
            buttons.setAttribute("class", "quicktext-storage-buttons");
            this.buildTemplatesMenu(
              buttons, storageNode.children,
              data.shortcutModifier, data.menuCollapse
            );
            section.appendChild(buttons);
          }
          toolbar.appendChild(section);
        }
      } else {
        // Single storage (or multi-storage shape with only one entry):
        // no labels or borders needed. Disabled items (unavailable
        // storage) are rendered as a disabled button.
        const nodes = isMulti ? data.templates[0].children : data.templates;
        for (const node of nodes) {
          if (node.disabled) {
            const section = document.createXULElement("vbox");
            section.setAttribute("class", "quicktext-storage-section");
            section.setAttribute("disabled", "true");
            const label = document.createXULElement("label");
            label.setAttribute("value", node.title);
            label.setAttribute("class", "quicktext-storage-label");
            label.setAttribute("disabled", "true");
            label.style.fontStyle = "italic";
            section.appendChild(label);
            toolbar.appendChild(section);
          } else {
            this.buildTemplatesMenu(
              toolbar, [node],
              data.shortcutModifier, data.menuCollapse
            );
          }
        }
      }
    }

    // Add event listeners.
    let items = document.getElementsByClassName("customEventListenerForDynamicMenu");
    for (let i = 0; i < items.length; i++) {
      items[i].addEventListener("command", function () {
        quicktextToolbar.insertTemplate(
          this.getAttribute("storageUuid"),
          this.getAttribute("i"),
          this.getAttribute("j")
        );
      }, true);
    }

    this.visibleToolbar();
  },
  async visibleToolbar() {
    const toolbar = await this.notify({ command: "getPref", pref: "toolbar" });
    if (toolbar) {
      document.getElementById("quicktext-toolbar").removeAttribute("collapsed");
    } else {
      document.getElementById("quicktext-toolbar").setAttribute("collapsed", true);
    }
  },
  focusMessageBody() {
    let editor = GetCurrentEditorElement();
    if (editor) {
      editor.focus();
    }
  },
  async insertTemplate(storageUuid, group, text) {
    this.focusMessageBody();
    await this.notify({
      command: "insertTemplate",
      storageUuid,
      group,
      text,
      windowId: this.windowId
    });
  },
}
