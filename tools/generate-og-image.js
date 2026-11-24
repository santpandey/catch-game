// Generates public/og-image.png (1200x630) — the Open Graph/Twitter card
// image shown when the game link is shared. Stadium photo + wordmark.
// Run with: node tools/generate-og-image.js

import sharp from "sharp";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const W = 1200;
const H = 630;

// Wordmark + tagline drawn as SVG so the composite needs no font files
const overlay = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0a1628" stop-opacity="0.55"/>
      <stop offset="45%" stop-color="#0a1628" stop-opacity="0.1"/>
      <stop offset="100%" stop-color="#0a1628" stop-opacity="0.85"/>
    </linearGradient>
    <radialGradient id="ball" cx="40%" cy="35%" r="75%">
      <stop offset="0%" stop-color="#c0392b"/>
      <stop offset="60%" stop-color="#8b1a1a"/>
      <stop offset="100%" stop-color="#5c0e0e"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#shade)"/>
  <g font-family="Arial Black, Arial, sans-serif" font-weight="900" font-style="italic" text-anchor="middle">
    <text x="600" y="240" font-size="110" fill="#ffffff" letter-spacing="6">SLIP</text>
    <text x="600" y="390" font-size="170" fill="#ffd766" letter-spacing="4">CATCH</text>
  </g>
  <text x="600" y="470" font-family="Arial, sans-serif" font-size="34" font-weight="600"
        fill="#ffffff" text-anchor="middle">Floodlit cricket slip-catch practice — free in your browser</text>
  <g transform="translate(66,522)">
    <circle cx="0" cy="0" r="26" fill="url(#ball)"/>
    <path d="M -18 -12 Q 0 0 -18 12" stroke="#f5f0e6" stroke-width="2.5" fill="none" stroke-dasharray="4 3"/>
    <path d="M 18 -12 Q 0 0 18 12" stroke="#f5f0e6" stroke-width="2.5" fill="none" stroke-dasharray="4 3"/>
  </g>
  <text x="112" y="532" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#c9a44a">catchtheswing.netlify.app</text>
</svg>`);

async function main() {
  const stadium = join(root, "assets", "stadium.webp");
  const out = join(root, "public", "og-image.jpg");
  await sharp(stadium)
    .resize(W, H, { fit: "cover" })
    .composite([{ input: overlay }])
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(out);
  console.log("Generated", out);
}

main().catch((err) => {
  console.error("OG image generation failed:", err.message);
  process.exit(1);
});
