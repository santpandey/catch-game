// Image Conversion Script
// Run with: node convert-to-webp.js

import sharp from "sharp";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Crop: drop the baked-in grass/pitch below the boundary boards
// (also removes the AI watermark in the bottom-right grass)
const CROP_TOP = 0;
const CROP_HEIGHT = 1100;

// Fascia band carrying real branding ("MELBOURNE CRICKET GROUND",
// "AUS vs IND" etc). The white sightscreen in the middle (x ~1150-1625)
// must stay untouched, so the cover is drawn as two rects.
const BAND_Y = 810;
const BAND_H = 76;
const SIGHT_X0 = 1145;
const SIGHT_X1 = 1630;
const OUT_WIDTH = 2816;

async function convertToWebP() {
  const inputPath = join(__dirname, "assets", "stadium.png");
  const outputPath = join(__dirname, "assets", "stadium.webp");

  try {
    if (!fs.existsSync(inputPath)) {
      console.error("❌ Error: stadium.png not found in assets folder");
      return;
    }

    console.log("🔄 Repainting and converting stadium.png to WebP...");

    // Average colour of the fascia band so the cover matches
    const { data, info } = await sharp(inputPath)
      .extract({ left: 100, top: BAND_Y + 5, width: 900, height: 30 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    let r = 0,
      g = 0,
      b = 0;
    const n = data.length / info.channels;
    for (let i = 0; i < data.length; i += info.channels) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    const bandColor = `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
    console.log(`🎨 Fascia band colour: ${bandColor}`);

    // Generic signage repeated along the band; letters ~55% of band height
    const textSpan = (x0, x1) => {
      let t = "";
      const textY = BAND_Y + BAND_H / 2 + 15;
      for (let x = x0 + 40; x < x1 - 430; x += 620) {
        t += `<text x="${x}" y="${textY}" font-family="Arial, sans-serif" font-size="42" font-weight="bold" fill="#c9a44a" letter-spacing="3">SLIP CATCH PRACTICE</text>`;
        t += `<text x="${x + 545}" y="${textY - 2}" font-family="Arial, sans-serif" font-size="26" fill="#d8d4c8">&#9679;</text>`;
      }
      return t;
    };
    // Vertical gradient + darker edge lines so it reads as a painted fascia
    const svg = `<svg width="${OUT_WIDTH}" height="${CROP_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="fascia" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="white" stop-opacity="0.10"/>
          <stop offset="0.5" stop-color="white" stop-opacity="0"/>
          <stop offset="1" stop-color="black" stop-opacity="0.15"/>
        </linearGradient>
      </defs>
      <rect x="0" y="${BAND_Y}" width="${SIGHT_X0}" height="${BAND_H}" fill="${bandColor}"/>
      <rect x="${SIGHT_X1}" y="${BAND_Y}" width="${OUT_WIDTH - SIGHT_X1}" height="${BAND_H}" fill="${bandColor}"/>
      <rect x="0" y="${BAND_Y}" width="${SIGHT_X0}" height="${BAND_H}" fill="url(#fascia)"/>
      <rect x="${SIGHT_X1}" y="${BAND_Y}" width="${OUT_WIDTH - SIGHT_X1}" height="${BAND_H}" fill="url(#fascia)"/>
      <rect x="0" y="${BAND_Y}" width="${SIGHT_X0}" height="1.5" fill="rgba(0,0,0,0.35)"/>
      <rect x="${SIGHT_X1}" y="${BAND_Y}" width="${OUT_WIDTH - SIGHT_X1}" height="1.5" fill="rgba(0,0,0,0.35)"/>
      <rect x="0" y="${BAND_Y + BAND_H - 1.5}" width="${SIGHT_X0}" height="1.5" fill="rgba(0,0,0,0.35)"/>
      <rect x="${SIGHT_X1}" y="${BAND_Y + BAND_H - 1.5}" width="${OUT_WIDTH - SIGHT_X1}" height="1.5" fill="rgba(0,0,0,0.35)"/>
      ${textSpan(0, SIGHT_X0)}
      ${textSpan(SIGHT_X1, OUT_WIDTH)}
    </svg>`;

    const infoOut = await sharp(inputPath)
      .extract({ left: 0, top: CROP_TOP, width: OUT_WIDTH, height: CROP_HEIGHT })
      .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
      .webp({ quality: 80, effort: 6 })
      .toFile(outputPath);

    const originalSize = fs.statSync(inputPath).size;
    const newSize = infoOut.size;
    const savings = (((originalSize - newSize) / originalSize) * 100).toFixed(1);

    console.log("✅ Conversion complete!");
    console.log(`📊 Original size: ${(originalSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`📊 New size: ${(newSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`📐 Dimensions: ${infoOut.width}x${infoOut.height}`);
    console.log(`💾 Space saved: ${savings}%`);
    console.log(`📁 Output: ${outputPath}`);
  } catch (error) {
    console.error("❌ Error during conversion:", error.message);
  }
}

convertToWebP();
