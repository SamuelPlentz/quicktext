import * as utils from "/modules/utils.mjs";
import { localizeDocument } from "/vendor/i18n.mjs";
import * as vfs from "/vendor/vfs-toolkit/vfs-client/vfs-client.mjs";

async function logEntries(entries) {
  console.log(entries);
  if (!entries || entries.length == 0) {
    console.log("[VFS] No file selected.");
    return;
  }
  for (let entry of entries) {
    console.log("[VFS] Selected path:", entry.path);
    if (entry.kind == "file") {
      const file = await vfs.readFile(entry);
      const text = await file.text();
      console.log("[VFS] File contents:", text);
    }
  }
}

const EXAMPLE_PROVIDER_ID = 'vfs-example-provider@example.com';
const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>My DOM File</title>
    </head>
    <body>
      <h1>Hello from File()</h1>
    </body>
    </html>
    `;
// Create file with filename
const savefile = new File(
  [htmlContent], // file content
  "my-page.html", // filename
  { type: "text/html" } // MIME type
);

document.addEventListener("DOMContentLoaded", () => {
  localizeDocument();
  document.getElementById("open-settings").addEventListener("click", () =>
    utils.openSettingsDialog()
  );
  document.getElementById("show-openFile-picker").addEventListener("click", async () => {
    const entries = await vfs.showOpenFilePicker({
      multiple: true,
      id: "Quicktext",
      opfsStorageName: "Quicktext",
      excludeAcceptAllOption: false,
      types: [
        {
          description: "Images",
          accept: { "image/*": [".png", ".jpg"] }
        }
      ]
    });
    await logEntries(entries);
  });

  document.getElementById("show-saveFile-picker").addEventListener("click", async () => {
    const result = await vfs.showSaveFilePicker({
      providerId: EXAMPLE_PROVIDER_ID,
      opfsStorageName: "Quicktext",
      suggestedName: "John.pdf"
    });
    console.log({ result });
    if (result) {
      await vfs.writeFile(result, savefile);
      const entry = await vfs.readFile(result);
      await logEntries([entry]);
    }
  });

  document.getElementById("show-directory-picker").addEventListener("click", async () => {
    const entry = await vfs.showDirectoryPicker({
      multiple: true,
      id: "Quicktext",
      opfsStorageName: "Quicktext",
      types: [
        {
          description: "Images",
          accept: { "image/*": [".png", ".jpg"] }
        }
      ]
    });
    await logEntries([entry]);
  });

  const unsubscribe = vfs.onStorageChanged(entries => {
    console.log(entries);
    for (const { path, providerId } of entries) {
      console.log('storage changed:', path, 'on provider:', providerId);
    }
  });

});
