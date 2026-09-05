// Icon Generation Script: rasterizes a cricket-ball SVG into extension icons
// Run with: node generate-icons.js

import sharp from "sharp";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const cricketBallSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <defs>
    <radialGradient id="ball" cx="40%" cy="35%" r="75%">
      <stop offset="0%" stop-color="#c0392b"/>
      <stop offset="60%" stop-color="#8b1a1a"/>
      <stop offset="100%" stop-color="#5c0e0e"/>
    </radialGradient>
  </defs>
  <rect width="128" height="128" rx="24" fill="#0a1628"/>
  <circle cx="64" cy="64" r="46" fill="url(#ball)"/>
  <path d="M 30 44 Q 64 64 30 84" stroke="#f5f0e6" stroke-width="3" fill="none" stroke-dasharray="6 4"/>
  <path d="M 98 44 Q 64 64 98 84" stroke="#f5f0e6" stroke-width="3" fill="none" stroke-dasharray="6 4"/>
</svg>`;

const sizes = [16, 48, 128];

async function generateIcons() {
  const outDir = join(__dirname, "public", "icons");
  fs.mkdirSync(outDir, { recursive: true });

  for (const size of sizes) {
    const outPath = join(outDir, `icon-${size}.png`);
    await sharp(Buffer.from(cricketBallSvg))
      .resize(size, size)
      .png()
      .toFile(outPath);
    console.log(`Generated ${outPath}`);
  }

  console.log("All extension icons generated.");
}

generateIcons().catch((err) => {
  console.error("Icon generation failed:", err.message);
  process.exit(1);
});
