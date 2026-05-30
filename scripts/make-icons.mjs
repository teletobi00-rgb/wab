import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pngToIco from "png-to-ico";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const buildDir = path.join(root, "build");
const svgPath = path.join(buildDir, "icon.svg");

await fs.mkdir(buildDir, { recursive: true });
const svg = await fs.readFile(svgPath);

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoPngs = await Promise.all(
  icoSizes.map((size) =>
    sharp(svg, { density: 384 }).resize(size, size).png().toBuffer(),
  ),
);
const ico = await pngToIco(icoPngs);
await fs.writeFile(path.join(buildDir, "icon.ico"), ico);

await sharp(svg, { density: 384 })
  .resize(256, 256)
  .png()
  .toFile(path.join(buildDir, "icon.png"));

await sharp(svg, { density: 384 })
  .resize(32, 32)
  .png()
  .toFile(path.join(buildDir, "tray.png"));

await sharp(svg, { density: 384 })
  .resize(16, 16)
  .png()
  .toFile(path.join(buildDir, "tray@2x.png"));

// Small red dot used as the Windows taskbar overlay for unread messages.
const badgeSvg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="7" fill="#ef4444" stroke="#fff" stroke-width="1.5"/></svg>',
);
await sharp(badgeSvg).resize(16, 16).png().toFile(path.join(buildDir, "badge.png"));

console.log("Icons generated:");
console.log("  build/icon.ico  (Windows installer + app icon)");
console.log("  build/icon.png  (256x256, cross-platform fallback)");
console.log("  build/tray.png  (32x32, system tray)");
console.log("  build/tray@2x.png (16x16)");
