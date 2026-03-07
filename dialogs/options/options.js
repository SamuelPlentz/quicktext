import * as utils from "/modules/utils.mjs";

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("intro").textContent =
    browser.i18n.getMessage("quicktext.options.intro");
  document.getElementById("open-settings").textContent =
    browser.i18n.getMessage("quicktext.options.openManager");
  document.getElementById("open-settings").addEventListener("click", () =>
    utils.openSettingsDialog()
  );
});
