/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

"use strict";

// Using a closure to not leak anything but the API to the outside world.
(function (exports) {
  // Helper function to inject a legacy XUL string into the DOM of Thunderbird.
  // All injected elements will get the data attribute "data-extension-injected"
  // set to the extension id, for easy removal.
  const injectElements = function (extension, window, xulString, debug = false) {
    function checkElements(stringOfIDs) {
      let arrayOfIDs = stringOfIDs.split(",").map((e) => e.trim());
      for (let id of arrayOfIDs) {
        let element = window.document.getElementById(id);
        if (element) {
          return element;
        }
      }
      return null;
    }

    function localize(entity) {
      let msg = entity.slice("__MSG_".length, -2);
      return extension.localeData.localizeMessage(msg);
    }

    function injectChildren(elements, container) {
      if (debug) console.log(elements);

      for (let i = 0; i < elements.length; i++) {
        if (
          elements[i].hasAttribute("insertafter") &&
          checkElements(elements[i].getAttribute("insertafter"))
        ) {
          let insertAfterElement = checkElements(
            elements[i].getAttribute("insertafter")
          );

          if (debug)
            console.log(
              elements[i].tagName +
              "#" +
              elements[i].id +
              ": insertafter " +
              insertAfterElement.id
            );
          if (
            debug &&
            elements[i].id &&
            window.document.getElementById(elements[i].id)
          ) {
            console.error(
              "The id <" +
              elements[i].id +
              "> of the injected element already exists in the document!"
            );
          }
          elements[i].setAttribute("data-extension-injected", extension.id);
          insertAfterElement.parentNode.insertBefore(
            elements[i],
            insertAfterElement.nextSibling
          );
        } else if (
          elements[i].hasAttribute("insertbefore") &&
          checkElements(elements[i].getAttribute("insertbefore"))
        ) {
          let insertBeforeElement = checkElements(
            elements[i].getAttribute("insertbefore")
          );

          if (debug)
            console.log(
              elements[i].tagName +
              "#" +
              elements[i].id +
              ": insertbefore " +
              insertBeforeElement.id
            );
          if (
            debug &&
            elements[i].id &&
            window.document.getElementById(elements[i].id)
          ) {
            console.error(
              "The id <" +
              elements[i].id +
              "> of the injected element already exists in the document!"
            );
          }
          elements[i].setAttribute("data-extension-injected", extension.id);
          insertBeforeElement.parentNode.insertBefore(
            elements[i],
            insertBeforeElement
          );
        } else if (
          elements[i].id &&
          window.document.getElementById(elements[i].id)
        ) {
          // existing container match, dive into recursively
          if (debug)
            console.log(
              elements[i].tagName +
              "#" +
              elements[i].id +
              " is an existing container, injecting into " +
              elements[i].id
            );
          injectChildren(
            Array.from(elements[i].children),
            window.document.getElementById(elements[i].id)
          );
        } else {
          // append element to the current container
          if (debug)
            console.log(
              elements[i].tagName +
              "#" +
              elements[i].id +
              ": append to " +
              container.id
            );
          elements[i].setAttribute("data-extension-injected", extension.id);
          container.appendChild(elements[i]);
        }
      }
    }

    if (debug) console.log("Injecting into root document:");
    let localizedXulString = xulString.replace(
      /__MSG_(.*?)__/g,
      localize
    );
    injectChildren(
      Array.from(
        window.MozXULElement.parseXULToFragment(localizedXulString, []).children
      ),
      window.document.documentElement
    );
  };

  // Helper function to inject a css file into as "link" element into the DOM of
  // Thunderbird. The injected element will get the data attribute
  // "data-extension-injected" set to the extension id, for easy removal.
  const injectCSS = function (extension, window, cssFile) {
    let element = window.document.createElement("link");
    element.setAttribute("data-extension-injected", extension.id);
    element.setAttribute("rel", "stylesheet");
    element.setAttribute("href", cssFile);
    return window.document.documentElement.appendChild(element);
  };

  let managerWindow = null;
  var Quicktext = class extends ExtensionCommon.ExtensionAPI {
    getAPI(context) {
      return {
        Quicktext: {
          async injectLegacyToolbar(windowId) {
            // Get the native window belonging to the specified windowId.
            let { window } = context.extension.windowManager.get(windowId);
            // Load an additional JavaScript file into the window scope.
            Services.scriptloader.loadSubScript("resource://quicktext/api/Quicktext/composerToolbar.js", window, "UTF-8");
            window.quicktext.windowId = windowId;

            injectCSS(context.extension, window, "resource://quicktext/api/Quicktext/composerToolbar.css");
            injectElements(context.extension, window, `
  <toolbar id="quicktext-toolbar" insertbefore="messageEditor">
    <html:div id="quicktext-templates-toolbar" />
    <spacer flex="1" />
    <hbox>
      <button type="menu" id="quicktext-variables" label="__MSG_quicktext.variables.label__" tabindex="-1">
        <menupopup id="quicktext-variables-popup">
          <menu label="__MSG_quicktext.to.label__">
            <menupopup>
              <menuitem label="__MSG_quicktext.firstname.label__" oncommand="quicktext.insertVariable('TO=firstname');" />
              <menuitem label="__MSG_quicktext.lastname.label__" oncommand="quicktext.insertVariable('TO=lastname');" />
              <menuitem label="__MSG_quicktext.fullname.label__" oncommand="quicktext.insertVariable('TO=fullname');" />
              <menuitem label="__MSG_quicktext.displayname.label__" oncommand="quicktext.insertVariable('TO=displayname');" />
              <menuitem label="__MSG_quicktext.nickname.label__" oncommand="quicktext.insertVariable('TO=nickname');" />
              <menuitem label="__MSG_quicktext.email.label__" oncommand="quicktext.insertVariable('TO=email');" />
              <menuitem label="__MSG_quicktext.workphone.label__" oncommand="quicktext.insertVariable('TO=workphone');" />
              <menuitem label="__MSG_quicktext.faxnumber.label__" oncommand="quicktext.insertVariable('TO=faxnumber');" />
              <menuitem label="__MSG_quicktext.cellularnumber.label__"
                oncommand="quicktext.insertVariable('TO=cellularnumber');" />
              <menuitem label="__MSG_quicktext.jobtitle.label__" oncommand="quicktext.insertVariable('TO=jobtitle');" />
              <menuitem label="__MSG_quicktext.custom1.label__" oncommand="quicktext.insertVariable('TO=custom1');" />
              <menuitem label="__MSG_quicktext.custom2.label__" oncommand="quicktext.insertVariable('TO=custom2');" />
              <menuitem label="__MSG_quicktext.custom3.label__" oncommand="quicktext.insertVariable('TO=custom3');" />
              <menuitem label="__MSG_quicktext.custom4.label__" oncommand="quicktext.insertVariable('TO=custom4');" />
            </menupopup>
          </menu>
          <menu label="__MSG_quicktext.from.label__">
            <menupopup>
              <menuitem label="__MSG_quicktext.firstname.label__" oncommand="quicktext.insertVariable('FROM=firstname');" />
              <menuitem label="__MSG_quicktext.lastname.label__" oncommand="quicktext.insertVariable('FROM=lastname');" />
              <menuitem label="__MSG_quicktext.fullname.label__" oncommand="quicktext.insertVariable('FROM=fullname');" />
              <menuitem label="__MSG_quicktext.displayname.label__" oncommand="quicktext.insertVariable('FROM=displayname');" />
              <menuitem label="__MSG_quicktext.nickname.label__" oncommand="quicktext.insertVariable('FROM=nickname');" />
              <menuitem label="__MSG_quicktext.email.label__" oncommand="quicktext.insertVariable('FROM=email');" />
              <menuitem label="__MSG_quicktext.workphone.label__" oncommand="quicktext.insertVariable('FROM=workphone');" />
              <menuitem label="__MSG_quicktext.faxnumber.label__" oncommand="quicktext.insertVariable('FROM=faxnumber');" />
              <menuitem label="__MSG_quicktext.cellularnumber.label__"
                oncommand="quicktext.insertVariable('FROM=cellularnumber');" />
              <menuitem label="__MSG_quicktext.jobtitle.label__" oncommand="quicktext.insertVariable('FROM=jobtitle');" />
              <menuitem label="__MSG_quicktext.custom1.label__" oncommand="quicktext.insertVariable('FROM=custom1');" />
              <menuitem label="__MSG_quicktext.custom2.label__" oncommand="quicktext.insertVariable('FROM=custom2');" />
              <menuitem label="__MSG_quicktext.custom3.label__" oncommand="quicktext.insertVariable('FROM=custom3');" />
              <menuitem label="__MSG_quicktext.custom4.label__" oncommand="quicktext.insertVariable('FROM=custom4');" />
            </menupopup>
          </menu>
          <menu label="__MSG_quicktext.attachments.label__">
            <menupopup>
              <menuitem label="__MSG_quicktext.filename.label__" oncommand="quicktext.insertVariable('ATT=name');" />
              <menuitem label="__MSG_quicktext.filenameAndSize.label__" oncommand="quicktext.insertVariable('ATT=full');" />
            </menupopup>
          </menu>
          <menu label="__MSG_quicktext.dateTime.label__">
            <menupopup>
              <menuitem id="date-short" oncommand="quicktext.insertVariable('DATE');" />
              <menuitem id="date-long" oncommand="quicktext.insertVariable('DATE=long');" />
              <menuitem id="date-monthname" oncommand="quicktext.insertVariable('DATE=monthname');" />
              <menuitem id="time-noseconds" oncommand="quicktext.insertVariable('TIME');" />
              <menuitem id="time-seconds" oncommand="quicktext.insertVariable('TIME=seconds');" />
            </menupopup>
          </menu>
          <menu label="__MSG_quicktext.other.label__">
            <menupopup>
              <menuitem label="__MSG_quicktext.clipboard.label__" oncommand="quicktext.insertVariable('CLIPBOARD');" />
              <menuitem label="__MSG_quicktext.counter.label__" oncommand="quicktext.insertVariable('COUNTER');" />
              <menuitem label="__MSG_quicktext.subject.label__" oncommand="quicktext.insertVariable('SUBJECT');" />
              <menuitem label="__MSG_quicktext.version.label__" oncommand="quicktext.insertVariable('VERSION');" />
            </menupopup>
          </menu>
        </menupopup>
      </button>
      <button type="menu" id="quicktext-other" label="__MSG_quicktext.other.label__" tabindex="-1">
        <menupopup>
          <menuitem label="__MSG_quicktext.insertTextFromFileAsText.label__" oncommand="quicktext.insertContentFromFile(0);" />
          <menuitem label="__MSG_quicktext.insertTextFromFileAsHTML.label__" oncommand="quicktext.insertContentFromFile(1);" />
        </menupopup>
      </button>
    </hbox>
  </toolbar>`
            );

            await window.quicktext.load();
          },
          async updateLegacyToolbar(windowId) {
            let { window } = context.extension.windowManager.get(windowId);
            if (window.quicktext) {
              window.quicktext.update();
            }
          },
          async getQuicktextFilePaths(templateFolder) {
            let rv = {};

            // get profile directory
            let profileDir = Components.classes["@mozilla.org/file/directory_service;1"]
              .getService(Components.interfaces.nsIProperties)
              .get("ProfD", Components.interfaces.nsIFile);
            // check if an alternative path has been given for the config folder
            if (templateFolder) {
              profileDir = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsIFile);
              profileDir.initWithPath(templateFolder);
            }

            let quicktextDir = profileDir;
            quicktextDir.append("quicktext");
            if (!quicktextDir.exists())
              quicktextDir.create(Components.interfaces.nsIFile.DIRECTORY_TYPE, 0o755);

            if (!quicktextDir.isDirectory()) {
              // Must warn the user that the quicktext dir don't exists and couldn't be created
            } else {
              let templateFile = quicktextDir.clone();
              templateFile.append("templates.xml");

              // Checks if the template-file exists and import that, if it exists.
              if (templateFile.exists()) {
                rv.templateFilePath = templateFile.path;
              }

              // Checks if the script-file exists and import that, if it exists.
              let scriptFile = quicktextDir.clone();
              scriptFile.append("scripts.xml");
              if (scriptFile.exists()) {
                rv.scriptFilePath = scriptFile.path;
              }
            }
            return rv;
          },
          openTemplateManager() {
            let window = Services.wm.getMostRecentWindow("mail:3pane");
            managerWindow = window.openDialog(
              "chrome://quicktext/content/settings.xhtml",
              "quicktextConfig",
              "chrome,resizable,centerscreen"
            );
          },
          async readBinaryFile(aFilePath) {
            return IOUtils.read(aFilePath);
          },
          async readTextFile(aFilePath) {
            return IOUtils.readUTF8(aFilePath);
          },
        },
      };
    }

    onShutdown(isAppShutdown) {
      if (isAppShutdown) {
        return; // the application gets unloaded anyway
      }

      const { extension } = this;
      for (const window of Services.wm.getEnumerator("msgcompose")) {
        if (window) {
          let elements = Array.from(
            window.document.querySelectorAll(
              '[data-extension-injected="' + extension.id + '"]'
            )
          );
          for (let element of elements) {
            element.remove();
          }
          if (window.quicktext) {
            window.quicktext.unload();
            window.quicktext = null;
          }
        }
      }
      
      if (managerWindow) {
        managerWindow.close();
      }
    }
  };
  exports.Quicktext = Quicktext;
})(this);