// Capture store/portal screenshots via Playwright WebKit (headless).
// Usage: npm run capture-store   (needs `npx vite preview --port 4173` running)
// Env: BASE_URL (default http://127.0.0.1:4173)
// Writes into store-assets/: five 1280x800 PNGs + promo-440x280.png + marquee-1400x560.png
// Engine lives in ~/Library/Caches/ms-playwright — never installed as a system browser.
// NOTE: Playwright Firefox was the first choice but macOS sandbox denies
// ~/Library/Application Support/Firefox creation, so WebKit is used instead.

import { webkit } from "playwright";
import { mkdir } from "node:fs/promises";
import { statSync } from "node:fs";
import sharp from "sharp";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:4173";
const OUT = "store-assets";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const evaluate = (expr) => page.evaluate(expr);
async function waitFor(expr, timeout = 15000, poll = 150) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evaluate(expr)) return true;
    await sleep(poll);
  }
  return false;
}

// Screen coords of the predicted crossing point (uses the ?debug handle)
const crossingPoint = `
(() => {
  const d = window.__debug; if (!d || !d.delivery) return null;
  const v = d.ball.position.clone();
  v.set(d.delivery.crossing.x, d.delivery.crossing.y, 4.2);
  v.project(d.camera);
  return {
    x: (v.x * 0.5 + 0.5) * innerWidth,
    y: (0.5 - v.y * 0.5) * innerHeight,
  };
})()`;

await mkdir(OUT, { recursive: true });

// 1. Title / attract
await page.goto(`${BASE_URL}/?shot=title`, { waitUntil: "domcontentloaded" });
await sleep(6000);
await page.screenshot({ path: `${OUT}/screenshot-1-title.png` });
console.log("saved screenshot-1-title.png");

// 2. Flight: ?shot jumps straight into play; ?debug exposes the state handle
await page.goto(`${BASE_URL}/?shot&debug`, { waitUntil: "domcontentloaded" });
await waitFor("window.__debug !== undefined");
await sleep(1500);
await waitFor("window.__debug.state.phase === 'flight'");
await sleep(550);
await page.screenshot({ path: `${OUT}/screenshot-2-flight.png` });
console.log("saved screenshot-2-flight.png");

// 3. Catch: track the crossing point until a catch registers, shoot burst+CAUGHT
let caught = false;
for (let round = 0; round < 6 && !caught; round++) {
  await waitFor("window.__debug.state.phase === 'flight'");
  const s0 = await evaluate("window.__debug.state.score");
  while (await evaluate("window.__debug.state.phase === 'flight'")) {
    const p = await evaluate(crossingPoint);
    if (p) await page.mouse.move(p.x, p.y);
    await sleep(60);
  }
  if ((await evaluate("window.__debug.state.score")) > s0) {
    await sleep(120); // burst + message on screen
    await page.screenshot({ path: `${OUT}/screenshot-3-catch.png` });
    console.log("saved screenshot-3-catch.png");
    caught = true;
  }
}

// 4. HUD with streak >= 3
for (let i = 0; i < 10; i++) {
  if ((await evaluate("window.__debug.state.streak")) >= 3) break;
  await waitFor("window.__debug.state.phase === 'flight'");
  while (await evaluate("window.__debug.state.phase === 'flight'")) {
    const p = await evaluate(crossingPoint);
    if (p) await page.mouse.move(p.x, p.y);
    await sleep(60);
  }
}
await page.screenshot({ path: `${OUT}/screenshot-4-streak.png` });
console.log("saved screenshot-4-streak.png");

// 5. Game over: park the pointer, wait for lives to drain
await page.mouse.move(10, 790);
await waitFor("window.__debug.state.screen === 'gameover'", 120000, 500);
await sleep(400);
await page.screenshot({ path: `${OUT}/screenshot-5-gameover.png` });
console.log("saved screenshot-5-gameover.png");

// 6-7. Promo tiles: capture ?shot=promo at 2x DPR, downscale with sharp
for (const [w, h, name] of [
  [440, 280, "promo-440x280.png"],
  [1400, 560, "marquee-1400x560.png"],
]) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 2,
  });
  const p2 = await ctx.newPage();
  await p2.goto(`${BASE_URL}/?shot=promo`, { waitUntil: "domcontentloaded" });
  await sleep(7000);
  const buf = await p2.screenshot();
  await ctx.close();
  await sharp(buf).resize(w, h).png().toFile(`${OUT}/${name}`);
  console.log("saved", name);
}

// Verify all outputs
for (const f of [
  "screenshot-1-title.png",
  "screenshot-2-flight.png",
  "screenshot-3-catch.png",
  "screenshot-4-streak.png",
  "screenshot-5-gameover.png",
  "promo-440x280.png",
  "marquee-1400x560.png",
]) {
  const m = await sharp(`${OUT}/${f}`).metadata();
  const { size } = statSync(`${OUT}/${f}`);
  console.log(`${f}: ${m.width}x${m.height} ${(size / 1024).toFixed(0)} KB`);
}

await browser.close();
process.exit(0);
