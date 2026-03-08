import * as utils from "/modules/utils.mjs";
import { localizeDocument } from "/modules/i18n.mjs";

document.addEventListener("DOMContentLoaded", () => {
  localizeDocument();
  document.getElementById("open-settings").addEventListener("click", () =>
    utils.openSettingsDialog()
  );
});
