import * as utils from "/modules/utils.mjs";
import { localizeDocument } from "/vendor/i18n.mjs";

document.addEventListener("DOMContentLoaded", async () => {
  localizeDocument();

  const browserInfo = await browser.runtime.getBrowserInfo();
  if (browserInfo.name !== "Thunderbird") {
    document.getElementById("compatibility").style.display = "block";
    return;
  }

  document.getElementById("body").style.display = "block";
  document.getElementById("open-settings").addEventListener("click", () =>
    utils.openSettingsDialog()
  );
});
