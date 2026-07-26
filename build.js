const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const https = require("https");
const crypto = require("crypto");

// Git's blob object hash for a file's bytes: sha1("blob <len>\0" + content).
// The GitHub tree API reports this per file, so comparing it against the local
// copy tells us whether the bytes are identical without re-downloading.
function gitBlobSha(buf) {
  const header = Buffer.from(`blob ${buf.length}\0`, "utf8");
  return crypto.createHash("sha1").update(Buffer.concat([header, buf])).digest("hex");
}

// Deep-merge `overlay` onto a clone of `base`: nested plain objects merge
// recursively, everything else (scalars, arrays) is replaced by the overlay.
// `base` is never mutated, and its key order is preserved (overlay-only keys
// are appended), which keeps a merged manifest's diff clean.
function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function deepMerge(base, overlay) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(overlay)) {
    out[k] = isPlainObject(out[k]) && isPlainObject(v) ? deepMerge(out[k], v) : v;
  }
  return out;
}

// Recursively list files under `root` as POSIX-style relative paths (empty if
// `root` is absent). Used to spot local files no longer present upstream.
function listFilesRec(root, base = root, out = []) {
  if (!fs.existsSync(base)) return out;
  for (const name of fs.readdirSync(base)) {
    const full = path.join(base, name);
    if (fs.statSync(full).isDirectory()) listFilesRec(root, full, out);
    else out.push(path.relative(root, full).split(path.sep).join("/"));
  }
  return out;
}

// CRC-32 lookup table
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[i] = c;
}
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (const byte of buf) crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Zip files/folders into destFile.
 * @param {string|string[]} sources - Paths to zip
 * @param {string} destFile - Output zip file
 * @param {string[]} [exclude=[]] - Optional array of folder/file paths to exclude (relative paths)
 * @param {Object<string,Buffer>} [overrides={}] - Map of POSIX rel-path to Buffer whose bytes
 *   replace the on-disk file when zipping (e.g. a per-variant manifest.json), leaving the working
 *   tree untouched.
 */
function zip(sources, destFile, exclude = [], overrides = {}) {
  const files = [];

  // Ensure parent directory exists
  const parentDir = path.dirname(destFile);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  function collect(full, rel) {
    // skip if rel matches any exclude pattern
    if (exclude.some(e => rel === e || rel.startsWith(e + "/"))) return;

    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(full)) {
        collect(path.join(full, name), rel + "/" + name);
      }
    } else {
      files.push({ full, rel });
    }
  }

  if (typeof sources === "string") {
    for (const name of fs.readdirSync(sources)) collect(path.join(sources, name), name);
  } else {
    for (const src of sources) collect(src, src);
  }

  const parts = [];
  const centralDir = [];
  let offset = 0;

  for (const { full, rel } of files) {
    const data = overrides[rel] ?? fs.readFileSync(full);
    const compressed = zlib.deflateRawSync(data);
    const useDeflate = compressed.length < data.length;
    const fileData = useDeflate ? compressed : data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(data);
    const nameBytes = Buffer.from(rel, "utf8");

    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(fileData.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    nameBytes.copy(local, 30);

    const cd = Buffer.alloc(46 + nameBytes.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(fileData.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBytes.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    nameBytes.copy(cd, 46);

    parts.push(local, fileData);
    centralDir.push(cd);
    offset += local.length + fileData.length;
  }

  const cdBuf = Buffer.concat(centralDir);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  fs.writeFileSync(destFile, Buffer.concat([...parts, cdBuf, eocd]));
}

function rm(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "build-script" } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(get(res.headers.location));
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

async function fetchJSON(url) {
  const buf = await get(url);
  return JSON.parse(buf.toString("utf8"));
}

async function main() {
  const { version } = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const manifest = JSON.parse(fs.readFileSync("src/manifest.json", "utf8"));
  manifest.version = version;
  fs.writeFileSync("src/manifest.json", JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Set manifest version to ${version}`);

  console.log("Cleaning output directory ...");
  rm("dist");

  console.log("Fetching latest vfs-client from GitHub ...");
  const repoPath = "modules/vfs-toolkit/vfs-client";
  const commits = await fetchJSON(
    `https://api.github.com/repos/thunderbird/webext-support/commits?path=${repoPath}&per_page=1`
  );
  const sha = commits[0].sha;
  console.log(`  Latest commit: ${sha}`);

  // Use the Git tree API to list all files in the folder at this commit
  const treeUrl = `https://api.github.com/repos/thunderbird/webext-support/git/trees/${sha}?recursive=1`;
  const tree = await fetchJSON(treeUrl);
  const prefix = repoPath + "/";
  const clientFiles = tree.tree.filter(f => f.type === "blob" && f.path.startsWith(prefix));

  console.log(`  Found ${clientFiles.length} files.`);
  const destRoot = "src/vendor/vfs-client";
  const wanted = new Set(clientFiles.map(f => f.path.slice(prefix.length)));

  // Drop local files that are no longer part of the upstream tree (upstream
  // deletions), without disturbing the files that are still current.
  for (const rel of listFilesRec(destRoot)) {
    if (!wanted.has(rel)) {
      console.log(`  Removing stale ${rel} ...`);
      fs.rmSync(path.join(destRoot, rel));
    }
  }

  // Fetch only files whose bytes differ from the local copy: git's blob hash of
  // the local file (file.sha from the tree API) is our identity check, so an
  // unchanged file is left untouched (no network, no rewrite).
  let fetched = 0;
  let unchanged = 0;
  for (const file of clientFiles) {
    const relativePath = file.path.slice(prefix.length);
    const dest = path.join(destRoot, relativePath);
    if (fs.existsSync(dest) && gitBlobSha(fs.readFileSync(dest)) === file.sha) {
      unchanged++;
      continue;
    }
    const rawUrl = `https://github.com/thunderbird/webext-support/raw/${sha}/${file.path}`;
    console.log(`  Fetching ${relativePath} ...`);
    const buf = await get(rawUrl);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    fetched++;
  }
  console.log(`  ${fetched} fetched, ${unchanged} unchanged (kept local copy).`);

  // Update VENDOR.md — replace the vfs-clientkit upstream URL with the new commit hash
  const vendorMdPath = "src/VENDOR.md";
  let vendorMd = fs.readFileSync(vendorMdPath, "utf8");
  const newTreeUrl = `https://github.com/thunderbird/webext-support/tree/${sha}/${repoPath}`;
  vendorMd = vendorMd.replace(
    /^(## vfs-client\n[\s\S]*?- \*\*Upstream\*\* : )https:\/\/github\.com\/thunderbird\/webext-support\/tree\/[0-9a-f]+\/modules\/vfs-toolkit\/vfs-client$/m,
    `$1${newTreeUrl}`
  );
  fs.writeFileSync(vendorMdPath, vendorMd);
  console.log(`  Updated VENDOR.md with commit ${sha}`);

  const xpiVersion = version.replace(/\./g, "_");

  // ATN build: the on-disk manifest as-is (no update_url, plain name).
  const atnName = `quicktext_${xpiVersion}_atn.xpi`;
  console.log(`Creating ATN extension file (dist/${atnName}) ...`);
  zip("src", `dist/${atnName}`);

  // GitHub build (the beta release): same tree, but manifest.json deep-merged
  // with the overlay (adds gecko.update_url for self-hosted auto-update,
  // overrides the name to "Quicktext Beta").
  const overlayPath = "manifest_beta.json";
  if (!fs.existsSync(overlayPath)) {
    throw new Error(`Missing ${overlayPath}, required for the beta XPI.`);
  }
  const overlay = JSON.parse(fs.readFileSync(overlayPath, "utf8"));
  const betaManifest = deepMerge(manifest, overlay);
  const betaManifestBuf = Buffer.from(JSON.stringify(betaManifest, null, 2) + "\n", "utf8");
  const betaName = `quicktext_${xpiVersion}_beta.xpi`;
  console.log(`Creating beta (GitHub) extension file (dist/${betaName}) ...`);
  zip("src", `dist/${betaName}`, [], { "manifest.json": betaManifestBuf });

  console.log("Build finished. Output is in the 'dist' folder.");
  https.globalAgent.destroy();
}

main().catch(e => { console.error(e); process.exit(1); });
