/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

export async function getPref(aName, aFallback = null) {
  const defaultPref = await browser.storage.local
    .get({ [`${aName}.default`]: aFallback })
    .then(o => o[`${aName}.default`]);

  return browser.storage.local
    .get({ [`${aName}.value`]: defaultPref })
    .then(o => o[`${aName}.value`]);
}

export async function setPref(aName, aValue) {
  await browser.storage.local.set({ [`${aName}.value`]: aValue });
}

export async function clearPref(aName) {
  await browser.storage.local.remove(`${aName}.value`);
}

export async function setTemplates(templates) {
  await browser.storage.local.set({ templates });
}

export async function getTemplates() {
  return browser.storage.local.get({ templates: {} }).then(e => e.templates);
}

export async function init(defaults = null) {
  // Migrate options from sync to local storage, as sync storage can only hold
  // 100 KB which will not be enough for templates.
  const { userPrefs: syncUserPrefs } = await browser.storage.sync.get({ userPrefs: null });
  if (syncUserPrefs) {
    await browser.storage.local.set({ userPrefs: syncUserPrefs });
    await browser.storage.sync.set({ userPrefs: null });
  }

  // Migrate from userPrefs/defaultPrefs objects to *.value and *.default
  const { userPrefs } = await browser.storage.local.get({ userPrefs: null });
  if (userPrefs) {
    for (let [key, value] of Object.entries(userPrefs)) {
      await browser.storage.local.set({ [`${key}.value`]: value });
    }
    await browser.storage.local.remove("userPrefs");
  }
  const { defaultPrefs } = await browser.storage.local.get({ defaultPrefs: null });
  if (defaultPrefs) {
    await browser.storage.local.remove("defaultPrefs");
  }

  // If defaults are given, push them into storage.local
  if (defaults) {
    for (let [key, value] of Object.entries(defaults)) {
      await browser.storage.local.set({ [`${key}.default`]: value });
    }
  }
}
