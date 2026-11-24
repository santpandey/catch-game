// Generates store-assets/itch-cover-630x500.png — the itch.io project page
// cover (minimum 315x250, recommended 630x500). Stadium photo + wordmark,
// same look as the og-image but squarer. Run: node tools/generate-itch-assets.js

import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const W = 630;
const H = 500;

const overlay = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0a1628" stop-opacity="0.55"/>
      <stop offset="40%" stop-color="#0a1628" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="#0a1628" stop-opacity="0.9"/>
    </linearGradient>
    <radialGradient id="ball" cx="40%" cy="35%" r="75%">
      <stop offset="0%" stop-color="#c0392b"/>
      <stop offset="60%" stop-color="#8b1a1a"/>
      <stop offset="100%" stop-color="#5c0e0e"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#shade)"/>
  <g transform="translate(315,110)">
    <circle cx="0" cy="0" r="34" fill="url(#ball)"/>
    <path d="M -23 -16 Q 0 0 -23 16" stroke="#f5f0e6" stroke-width="3" fill="none" stroke-dasharray="5 4"/>
    <path d="M 23 -16 Q 0 0 23 16" stroke="#f5f0e6" stroke-width="3" fill="none" stroke-dasharray="5 4"/>
  </g>
  <g font-family="Arial Black, Arial, sans-serif" font-weight="900" font-style="italic" text-anchor="middle">
    <text x="315" y="235" font-size="72" fill="#ffffff" letter-spacing="4">SLIP</text>
    <text x="315" y="340" font-size="105" fill="#ffd766" letter-spacing="3">CATCH</text>
  </g>
  <text x="315" y="410" font-family="Arial, sans-serif" font-size="24" font-weight="600"
        fill="#ffffff" text-anchor="middle">Floodlit cricket slip-catch practice</text>
  <text x="315" y="445" font-family="Arial, sans-serif" font-size="24" font-weight="600"
        fill="#c9a44a" text-anchor="middle">free in your browser</text>
</svg>`);

async function main() {
  const outDir = join(root, "store-assets");
  await mkdir(outDir, { recursive: true });
  const out = join(outDir, "itch-cover-630x500.png");
  await sharp(join(root, "assets", "stadium.webp"))
    .resize(W, H, { fit: "cover" })
    .composite([{ input: overlay }])
    .png()
    .toFile(out);
  console.log("Generated", out);
}

main().catch((err) => {
  console.error("itch.io asset generation failed:", err.message);
  process.exit(1);
});
