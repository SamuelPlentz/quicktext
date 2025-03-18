/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

export async function getPref(aName, aFallback = null) {
  // Get defaultPref.
  const { defaultPrefs } = await browser.storage.local.get({ defaultPrefs: {} });
  let defaultPref = defaultPrefs.hasOwnProperty(aName)
    ? defaultPrefs[aName]
    : aFallback;

  // Check if userPref type is defaultPref type and return default if no match.
  const { userPrefs } = await browser.storage.local.get({ userPrefs: {} });
  if (userPrefs.hasOwnProperty(aName)) {
    let userPref = userPrefs[aName];
    if (typeof defaultPref == typeof userPref) {
      return userPref;
    }
    console.log("Type of defaultPref <" + defaultPref + ":" + typeof defaultPref + "> does not match type of userPref <" + userPref + ":" + typeof userPref + ">. Fallback to defaultPref.")
  }

  // Fallback to default value.
  return defaultPref;
}

export async function setPref(aName, aValue) {
  const { userPrefs } = await browser.storage.local.get({ userPrefs: {} });
  userPrefs[aName] = aValue;
  await browser.storage.local.set({ userPrefs });
}

export async function clearPref(aName) {
  const { userPrefs } = await browser.storage.local.get({ userPrefs: {} });
  delete userPrefs[aName];
  await browser.storage.local.set({ userPrefs });
}

export async function init(defaults = null) {
  // Migrate options from sync to local storage, as sync storage can only hold
  // 100 KB which will not be enough for templates.
  const { userPrefs } = await browser.storage.sync.get({ userPrefs: null });
  if (userPrefs) {
    await browser.storage.local.set({ userPrefs });
    await browser.storage.sync.set({ userPrefs: null });
  }

  // If defaults are given, push them into storage.local
  if (defaults) {
    await browser.storage.local.set({ defaultPrefs: defaults });
  }
}