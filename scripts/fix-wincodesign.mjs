import { spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import https from "node:https";
import path from "node:path";

const VERSION = "2.6.0";
const localAppData = process.env.LOCALAPPDATA;
if (!localAppData) {
  console.error("LOCALAPPDATA env var not set. Are you on Windows?");
  process.exit(1);
}

const cacheBase = path.join(localAppData, "electron-builder", "Cache", "winCodeSign");
const targetDir = path.join(cacheBase, `winCodeSign-${VERSION}`);
const zipPath = path.join(cacheBase, `winCodeSign-${VERSION}.7z`);
const marker = path.join(targetDir, "windows-10", "x64", "signtool.exe");

async function main() {
  if (existsSync(marker)) {
    console.log(`winCodeSign cache already valid: ${targetDir}`);
    return;
  }

  mkdirSync(cacheBase, { recursive: true });

  if (!existsSync(zipPath) || statSync(zipPath).size < 5_000_000) {
    console.log(`Downloading winCodeSign-${VERSION}.7z ...`);
    await download(
      `https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-${VERSION}/winCodeSign-${VERSION}.7z`,
      zipPath,
    );
    console.log(`  Saved to ${zipPath}`);
  } else {
    console.log(`Using cached archive: ${zipPath}`);
  }

  const sevenZip = path.resolve("node_modules", "7zip-bin", "win", "x64", "7za.exe");
  if (!existsSync(sevenZip)) {
    throw new Error(
      `7za.exe not found at ${sevenZip}. Run \`npm install\` first.`,
    );
  }

  console.log(`Extracting (excluding darwin/ — Windows builds don't need macOS tools)...`);
  const result = spawnSync(
    sevenZip,
    ["x", "-y", "-aoa", `-o${targetDir}`, zipPath, "-xr!darwin"],
    { stdio: "inherit" },
  );

  if (!existsSync(marker)) {
    console.error(`\nExtraction failed. Expected file not found: ${marker}`);
    if (result.status !== null) {
      console.error(`7za exit status: ${result.status}`);
    }
    process.exit(1);
  }

  console.log(`\nDone. winCodeSign extracted to: ${targetDir}`);
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    function get(currentUrl) {
      https
        .get(currentUrl, (res) => {
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            get(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} for ${currentUrl}`));
            return;
          }
          const file = createWriteStream(dest);
          res.pipe(file);
          file.on("finish", () => file.close(() => resolve()));
          file.on("error", reject);
        })
        .on("error", reject);
    }
    get(url);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
