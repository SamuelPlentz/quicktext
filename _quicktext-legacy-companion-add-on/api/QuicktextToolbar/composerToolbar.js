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

  async dateTimeFormat(format, timeStamp) {
    return this.notify({ command: "getDateTimeFormat", data: { format, timeStamp } });
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
    document.getElementById("quicktext-variables-popup").addEventListener(
      "popupshowing",
      async (event) => {
        // Only rebuild when the root variables popup opens, not when a submenu opens.
        if (event.target.id !== "quicktext-variables-popup") return;
        const popup = document.getElementById("quicktext-variables-popup");
        const menuStructure = await this.notify({ command: "getVariablesMenuStructure" });
        this.buildVariablesMenu(popup, menuStructure);
      },
      true
    );
  },
  unload() {
  },
  buildVariablesMenu(container, items) {
    while (container.firstChild) container.removeChild(container.firstChild);
    for (const item of items) {
      switch (item.type) {
        case "group": {
          const menu = document.createXULElement("menu");
          menu.setAttribute("label", item.label);
          const popup = menu.appendChild(document.createXULElement("menupopup"));
          this.buildVariablesMenu(popup, item.children);
          container.appendChild(menu);
          break;
        }
        case "item": {
          const mi = document.createXULElement("menuitem");
          mi.setAttribute("label", item.label);
          if (item.value?.includes("<path>")) {
            const filter = item.value.startsWith("IMAGE=") ? "images" : "any";
            mi.addEventListener("command", async () => {
              const path = await this.pickFilePath(filter);
              if (path) this.insertVariable(item.value.replace("<path>", path));
            });
          } else if (item.value?.includes("<url>")) {
            mi.addEventListener("command", () => {
              const url = window.prompt(this.extension.localeData.localizeMessage("quicktext.prompt.addUrl.label"), "https://");
              if (url) this.insertVariable(item.value.replace("<url>", url));
            });
          } else {
            mi.addEventListener("command", () => this.insertVariable(item.value));
          }
          container.appendChild(mi);
          break;
        }
        case "separator":
          container.appendChild(document.createXULElement("menuseparator"));
          break;
      }
    }
  },
  buildOtherMenu(container, items) {
    while (container.firstChild) container.removeChild(container.firstChild);
    for (const item of items) {
      const mi = document.createXULElement("menuitem");
      mi.setAttribute("label", item.label);
      mi.addEventListener("command", () => this.insertContentFromFile(item.mimeType));
      container.appendChild(mi);
    }
  },
  async update() {
    const variablesPopup = document.getElementById("quicktext-variables-popup");
    if (variablesPopup) {
      const menuStructure = await this.notify({ command: "getVariablesMenuStructure" });
      this.buildVariablesMenu(variablesPopup, menuStructure);
    }
    const otherPopup = document.getElementById("quicktext-other-popup");
    if (otherPopup) {
      const otherStructure = await this.notify({ command: "getOtherMenuStructure" });
      if (otherStructure) this.buildOtherMenu(otherPopup, otherStructure);
    }

    // Empty all shortcuts and keywords ?????
    this.mShortcuts = {};
    this.mKeywords = {};

    // Update the toolbar
    var toolbar = document.getElementById("quicktext-templates-toolbar");
    if (toolbar != null) {

      // Clear template toolbar.
      var length = toolbar.children.length;
      for (var i = length - 1; i >= 0; i--) {
        toolbar.removeChild(toolbar.children[i]);
      }

      // Rebuild template groups (the leftmost entries)
      const templates = await this.notify({ command: "getTemplates" });
      const collapseGroup = await this.notify({ command: "getPref", pref: "menuCollapse" });
      const shortcutModifier = await this.notify({ command: "getPref", pref: "shortcutModifier" });

      var groupLength = templates.groups.length;
      for (var i = 0; i < groupLength; i++) {
        var textLength = templates.texts[i].length;
        if (textLength) {
          var toolbarbuttonGroup;
          let t = document.createXULElement("button");

          t.setAttribute("tabindex", "-1");

          if (textLength == 1 && collapseGroup) {
            toolbarbuttonGroup = toolbar.appendChild(t);
            toolbarbuttonGroup.setAttribute("label", templates.texts[i][0].name);
            toolbarbuttonGroup.setAttribute("i", i);
            toolbarbuttonGroup.setAttribute("j", 0);
            toolbarbuttonGroup.setAttribute("class", "customEventListenerForDynamicMenu");
          }
          else {
            t.setAttribute("type", "menu");
            toolbarbuttonGroup = toolbar.appendChild(t);
            toolbarbuttonGroup.setAttribute("label", templates.groups[i].name);
            var menupopup = toolbarbuttonGroup.appendChild(document.createXULElement("menupopup"));

            for (var j = 0; j < textLength; j++) {
              var text = templates.texts[i][j];

              var toolbarbutton = document.createXULElement("menuitem");
              toolbarbutton.setAttribute("label", text.name);
              toolbarbutton.setAttribute("i", i);
              toolbarbutton.setAttribute("j", j);
              toolbarbutton.setAttribute("class", "customEventListenerForDynamicMenu");

              var shortcut = text.shortcut;
              if (shortcut != "") {
                if (shortcut == 10) shortcut = 0;
                toolbarbutton.setAttribute("acceltext", `${this.getPrettyKeyName(shortcutModifier)} + ${shortcut}`);
              }

              menupopup.appendChild(toolbarbutton);
            }
          }
          toolbarbuttonGroup = null;

          for (var j = 0; j < textLength; j++) {
            var text = templates.texts[i][j];
            var shortcut = text.shortcut;
            if (shortcut != "" && typeof this.mShortcuts[shortcut] == "undefined")
              this.mShortcuts[shortcut] = [i, j];

            var keyword = text.keyword;
            if (keyword != "" && typeof this.mKeywords[keyword] == "undefined")
              this.mKeywords[keyword] = [i, j];
          }
        }
      }
    }

    // Add event listeners.
    let items = document.getElementsByClassName("customEventListenerForDynamicMenu");
    for (let i = 0; i < items.length; i++) {
      items[i].addEventListener("command", function () {
        quicktextToolbar.insertTemplate(this.getAttribute("i"), this.getAttribute("j"));
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
  async insertVariable(aVar) {
    this.focusMessageBody();
    await this.notify({
      command: "insertVariable",
      aVar,
      windowId: this.windowId
    });
  },
  async insertTemplate(group, text) {
    this.focusMessageBody();
    await this.notify({
      command: "insertTemplate",
      group,
      text,
      windowId: this.windowId
    });
  },
  async insertContentFromFile(aType) {
    const file = await this.pickFile(aType, /* open */ 0, "");
    this.focusMessageBody();
    if (file) {
      await this.notify({
        command: "insertFile",
        aType,
        file,
        windowId: this.windowId
      });
    }
  },
  async pickFilePath(filter) {
    let filePicker = Components.classes["@mozilla.org/filepicker;1"].createInstance(Components.interfaces.nsIFilePicker);
    filePicker.init(window.browsingContext, "", filePicker.modeOpen);
    if (filter === "images") {
      filePicker.appendFilters(filePicker.filterImages);
    } else {
      filePicker.appendFilters(filePicker.filterAll);
    }
    let rv = await new Promise(resolve => filePicker.open(resolve));
    if (rv == filePicker.returnOK) return filePicker.file.path;
    return null;
  },
  async pickFile(aType, aMode, aTitle) {
    let filePicker = Components.classes["@mozilla.org/filepicker;1"].createInstance(Components.interfaces.nsIFilePicker);
    switch (aMode) {
      case 1: // save
        filePicker.init(window.browsingContext, aTitle, filePicker.modeSave);
        break;
      default: // open
        filePicker.init(window.browsingContext, aTitle, filePicker.modeOpen);
        break;
    }

    switch (aType) {
      case 0: // insert TXT file
        filePicker.appendFilters(filePicker.filterText);
        filePicker.defaultExtension = "txt";
        break;
      case 1: // insert HTML file
        filePicker.appendFilters(filePicker.filterHTML);
        filePicker.defaultExtension = "html";
        break;
    }

    filePicker.appendFilters(filePicker.filterAll);

    let rv = await new Promise(function (resolve) {
      filePicker.open(result => {
        resolve(result);
      });
    });

    if (rv == filePicker.returnOK || rv == filePicker.returnReplace) {
      const file = await File.createFromNsIFile(filePicker.file);
      return file;
    } else {
      return null;
    }
  }
}
