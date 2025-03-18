/*
 * This file is provided by the addon-developer-support repository at
 * https://github.com/thundernest/addon-developer-support
 *
 * Version: 1.3
 * - Converted to ES6 module, exporting a class
 * - only run init() once
 * 
 * Version: 1.2
 * - Bugfix: move to a different saving scheme, as storage.local.get() without
 *   providing a value to get them all, may cause an TransactionInactiveError in
 *   IndexedDB.sys.mjs
 *
 * Version: 1.1
 * - Bugfix: use messenger.storage instead of browser.storage
 *
 * Version: 1.0
 *
 * Author: John Bieling (john@thunderbird.net)
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

export class Preferences {

  #userPrefs = {}
  #defaultPrefs = {}
  #initialized = false;

  // Get pref value from local pref obj.
  getPref(aName, aFallback = null) {
    // Get defaultPref.
    let defaultPref = this.#defaultPrefs.hasOwnProperty(aName)
      ? this.#defaultPrefs[aName]
      : aFallback;

    // Check if userPref type is defaultPref type and return default if no match.
    if (this.#userPrefs.hasOwnProperty(aName)) {
      let userPref = this.#userPrefs[aName];
      if (typeof defaultPref == typeof userPref) {
        return userPref;
      }
      console.log("Type of defaultPref <" + defaultPref + ":" + typeof defaultPref + "> does not match type of userPref <" + userPref + ":" + typeof userPref + ">. Fallback to defaultPref.")
    }

    // Fallback to default value.
    return defaultPref;
  }

  // Set pref value by updating local pref obj and updating storage.
  async setPref(aName, aValue) {
    this.#userPrefs[aName] = aValue;
    await messenger.storage.local.set({ userPrefs: this.#userPrefs });
  }

  // Remove a preference (calls to getPref will return default value)
  async clearPref(aName) {
    delete this.#userPrefs[aName];
    await messenger.storage.local.set({ userPrefs: this.#userPrefs });
  }

  // Initialize the local pref obj by loading userPrefs and defaultPrefs from
  // WebExtension storage. If a defaults obj is given, the defaults in storage
  // are updated/set.
  async init(defaults = null) {
    if (this.#initialized) {
      return;
    }

    // Migrate options from sync to local storage, as sync storage can only hold
    // 100 KB which will not be enough for templates.
    const { userPrefs } = await browser.storage.sync.get({ userPrefs: null });
    if (userPrefs) {
      await browser.storage.local.set({ userPrefs });
      await browser.storage.sync.set({ userPrefs: null });
    }

    // Store user prefs into the local userPrefs obj.
    this.#userPrefs = (await messenger.storage.local.get("userPrefs")).userPrefs || {};

    // If defaults are given, push them into storage.local
    if (defaults) {
      await messenger.storage.local.set({ defaultPrefs: defaults });
    }

    this.#defaultPrefs = (await messenger.storage.local.get("defaultPrefs")).defaultPrefs || {};

    // Add storage change listener.
    // Note: This is only needed to react on pref changes which are *not* performed
    //       by preferences.mjs. Consider removing it.
    await messenger.storage.onChanged.addListener((changes, area) => {
      let changedItems = Object.keys(changes);
      for (let item of changedItems) {
        if (area == "local" && item == "userPrefs") {
          this.#userPrefs = changes.userPrefs.newValue;
        }
  
        if (area == "local" && item == "defaultPrefs") {
          this.#defaultPrefs = changes.defaultPrefs.newValue;
        }
      }
    });
  }
}