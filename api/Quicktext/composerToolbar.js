var quicktext = {
  notifytools: {},
  windowId: null,
  extension: null,

  dateTimeFormat(format, timeStamp) {
    let options = {};
    options["date-short"] = { dateStyle: "short" };
    options["date-long"] = { dateStyle: "long" };
    options["date-monthname"] = { month: "long" };
    options["time-noseconds"] = { timeStyle: "short" };
    options["time-seconds"] = { timeStyle: "long" };
    return new Services.intl.DateTimeFormat(undefined, options[format.toLowerCase()]).format(timeStamp)
  },

  async load() {
    Services.scriptloader.loadSubScript("chrome://quicktext/content/notifyTools/notifyTools.js", quicktext, "UTF-8");

    const { ExtensionParent } = ChromeUtils.importESModule(
      "resource://gre/modules/ExtensionParent.sys.mjs"
    );
    this.extension = ExtensionParent.GlobalManager.getExtension(
      "{8845E3B3-E8FB-40E2-95E9-EC40294818C4}"
    );
    await this.update();
    document.getElementById("quicktext-variables-popup").addEventListener(
      "popupshowing",
      () => this.updateTimeMenus(),
      true
    );
  },
  unload() {
  },
  async updateTimeMenus() {
    // Set the date/time in the variable menu.
    var timeStamp = new Date();
    let fields = ["date-short", "date-long", "date-monthname", "time-noseconds", "time-seconds"];
    for (let i = 0; i < fields.length; i++) {
      let field = fields[i];
      let fieldtype = field.split("-")[0];
      if (document.getElementById(field)) {
        document.getElementById(field).setAttribute(
          "label",
          this.extension.localeData.localizeMessage(fieldtype, [this.dateTimeFormat(field, timeStamp)])
        );
      }
    }
  },
  async update() {
    this.updateTimeMenus();

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
      const templates = await this.notifyTools.notifyBackground({ command: "getTemplates" });
      const collapseGroup = await this.notifyTools.notifyBackground({ command: "getPref", pref: "menuCollapse" });

      var groupLength = templates.group.length;
      for (var i = 0; i < groupLength; i++) {
        var textLength = templates.texts[i].length;
        if (textLength) {
          // Add first level element, this will be either a menu or a button (if
          // only one text in this group).
          var toolbarbuttonGroup;
          let t = document.createXULElement("button");

          // Add a tabindex of -1 (not reachable via sequential keyboard navigation).
          // see: https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/tabindex
          t.setAttribute("tabindex", "-1");

          if (textLength == 1 && collapseGroup) {
            toolbarbuttonGroup = toolbar.appendChild(t);
            toolbarbuttonGroup.setAttribute("label", templates.texts[i][0].mName);
            toolbarbuttonGroup.setAttribute("i", i);
            toolbarbuttonGroup.setAttribute("j", 0);
            toolbarbuttonGroup.setAttribute("class", "customEventListenerForDynamicMenu");
          }
          else {
            t.setAttribute("type", "menu");
            toolbarbuttonGroup = toolbar.appendChild(t);
            toolbarbuttonGroup.setAttribute("label", templates.group[i].mName);
            var menupopup = toolbarbuttonGroup.appendChild(document.createXULElement("menupopup"));

            // Add second level elements: all found texts of this group.
            for (var j = 0; j < textLength; j++) {
              var text = templates.texts[i][j];

              var toolbarbutton = document.createXULElement("menuitem");
              toolbarbutton.setAttribute("label", text.mName);
              toolbarbutton.setAttribute("i", i);
              toolbarbutton.setAttribute("j", j);
              toolbarbutton.setAttribute("class", "customEventListenerForDynamicMenu");

              var shortcut = text.mShortcut;
              if (shortcut > 0) {
                if (shortcut == 10) shortcut = 0;
                toolbarbutton.setAttribute("acceltext", "Alt+" + shortcut);
              }

              menupopup.appendChild(toolbarbutton);
            }
          }
          toolbarbuttonGroup = null;

          // Update the keyshortcuts.
          for (var j = 0; j < textLength; j++) {
            var text = templates.texts[i][j];
            var shortcut = text.mShortcut;
            if (shortcut != "" && typeof this.mShortcuts[shortcut] == "undefined")
              this.mShortcuts[shortcut] = [i, j];

            var keyword = text.mKeyword;
            if (keyword != "" && typeof this.mKeywords[keyword.toLowerCase()] == "undefined")
              this.mKeywords[keyword.toLowerCase()] = [i, j];
          }
        }
      }
    }

    // Add event listeners.
    let items = document.getElementsByClassName("customEventListenerForDynamicMenu");
    for (let i = 0; i < items.length; i++) {
      items[i].addEventListener("command", function () {
        quicktext.insertTemplate(this.getAttribute("i"), this.getAttribute("j"));
        //quicktext.insertTemplate(this.getAttribute("i"), this.getAttribute("j"), true, true);
      }, true);
    }

    this.visibleToolbar();
  },
  // This may not needed, since the toolbar will be an extra add-on and the toolbar
  // will only be shown, when the extra add-on is installed? The "toolbar" pref has
  // no config UI at he moment.
  async visibleToolbar() {
    const toolbar = await this.notifyTools.notifyBackground({ command: "getPref", pref: "toolbar" });
    if (toolbar) {
      document.getElementById("quicktext-toolbar").removeAttribute("collapsed");
    } else {
      document.getElementById("quicktext-toolbar").setAttribute("collapsed", true);
    }
  },
  insertVariable(aVar) {
    this.notifyTools.notifyBackground({
      command: "insertVariable",
      aVar,
      windowId: this.windowId
    });
  },
  insertTemplate(group, text) {
    this.notifyTools.notifyBackground({
      command: "insertTemplate",
      group,
      text,
      windowId: this.windowId
    });
  },
  insertContentFromFile(aType) {
    console.log("not implemented : insertContentFromFile");
  }
}
