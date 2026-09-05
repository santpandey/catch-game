// Image Conversion Script
// Run with: node convert-to-webp.js

import sharp from "sharp";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function convertToWebP() {
  const inputPath = join(__dirname, "assets", "stadium.png");
  const outputPath = join(__dirname, "assets", "stadium.webp");

  try {
    // Check if input file exists
    if (!fs.existsSync(inputPath)) {
      console.error("❌ Error: stadium.png not found in assets folder");
      return;
    }

    console.log("🔄 Converting stadium.png to WebP...");

    const info = await sharp(inputPath)
      .resize({ width: 2048 }) // Backdrop never renders larger than this
      .webp({
        quality: 82, // Good balance between quality and size
        effort: 6, // Higher effort = better compression
      })
      .toFile(outputPath);

    const originalSize = fs.statSync(inputPath).size;
    const newSize = info.size;
    const savings = (((originalSize - newSize) / originalSize) * 100).toFixed(
      1,
    );

    console.log("✅ Conversion complete!");
    console.log(
      `📊 Original size: ${(originalSize / 1024 / 1024).toFixed(2)} MB`,
    );
    console.log(`📊 New size: ${(newSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`💾 Space saved: ${savings}%`);
    console.log(`📁 Output: ${outputPath}`);
  } catch (error) {
    console.error("❌ Error during conversion:", error.message);
  }
}

convertToWebP();
