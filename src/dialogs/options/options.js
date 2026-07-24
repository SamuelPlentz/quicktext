import * as utils from "/modules/utils.mjs";
import * as storage from "/modules/storage.mjs";
import { localizeDocument } from "/vendor/i18n.mjs";

document.addEventListener("DOMContentLoaded", async () => {
  localizeDocument();
  document.getElementById("open-settings").addEventListener("click", () =>
    utils.openSettingsDialog()
  );

  const chkRemoteRequests = document.getElementById("chk-remote-requests");
  const { value, isManaged } = await storage.getPrefWithManagedInfo("allowRemoteRequests");
  chkRemoteRequests.checked = value;
  // Same affordance as the manager: a policy-controlled pref is still shown,
  // but cannot be changed here (setPref would ignore the write anyway).
  chkRemoteRequests.disabled = isManaged;
  chkRemoteRequests.title = isManaged
    ? browser.i18n.getMessage("quicktext.controlledViaManagedStorage.label")
    : "";
  chkRemoteRequests.addEventListener("change", () =>
    storage.setPref("allowRemoteRequests", chkRemoteRequests.checked)
  );
});
