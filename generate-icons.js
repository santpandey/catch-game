// Icon Generation Script: rasterizes a cricket-ball SVG into extension,
// PWA and apple-touch icons.
// Run with: node generate-icons.js

import sharp from "sharp";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ballArt = (ballR, bgRx) => `
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <defs>
    <radialGradient id="ball" cx="40%" cy="35%" r="75%">
      <stop offset="0%" stop-color="#c0392b"/>
      <stop offset="60%" stop-color="#8b1a1a"/>
      <stop offset="100%" stop-color="#5c0e0e"/>
    </radialGradient>
  </defs>
  <rect width="128" height="128" rx="${bgRx}" fill="#0a1628"/>
  <circle cx="64" cy="64" r="${ballR}" fill="url(#ball)"/>
  <path d="M 30 44 Q 64 64 30 84" stroke="#f5f0e6" stroke-width="3" fill="none" stroke-dasharray="6 4"/>
  <path d="M 98 44 Q 64 64 98 84" stroke="#f5f0e6" stroke-width="3" fill="none" stroke-dasharray="6 4"/>
</svg>`;

// Standard icon: rounded-corner navy tile, ball fills most of the frame
const standard = Buffer.from(ballArt(46, 24));
// Maskable icon: full-bleed background (no rounded corners — the platform
// applies its own mask), ball shrunk into the ~80% safe zone
const maskable = Buffer.from(ballArt(38, 0));

const icons = [
  ["icon-16.png", 16, standard],
  ["icon-48.png", 48, standard],
  ["icon-128.png", 128, standard],
  ["apple-touch-icon.png", 180, standard],
  ["icon-192.png", 192, standard],
  ["icon-512.png", 512, standard],
  ["icon-maskable-512.png", 512, maskable],
];

async function generateIcons() {
  const outDir = join(__dirname, "public", "icons");
  fs.mkdirSync(outDir, { recursive: true });

  for (const [name, size, art] of icons) {
    const outPath = join(outDir, name);
    await sharp(art, { density: 384 }).resize(size, size).png().toFile(outPath);
    console.log(`Generated ${outPath}`);
  }

  console.log("All icons generated.");
}

generateIcons().catch((err) => {
  console.error("Icon generation failed:", err.message);
  process.exit(1);
});
