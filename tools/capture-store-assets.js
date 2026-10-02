// Capture Chrome Web Store assets via WebDriver BiDi (Firefox headless).
// Usage: node tools/capture-store-assets.js
// Env: BIDI_URL (default ws://127.0.0.1:9230/session), BASE_URL (default http://127.0.0.1:4173)
// Writes into store-assets/: five 1280x800 PNGs + promo-440x280.png + marquee-1400x560.png

import { mkdir } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import sharp from "sharp";

const BIDI_URL = process.env.BIDI_URL || "ws://127.0.0.1:9230/session";
const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:4173";
const OUT = "store-assets";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Minimal BiDi client ---
const ws = new WebSocket(BIDI_URL);
let msgId = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.reject(new Error(`${m.error}: ${m.message}`)) : p.resolve(m.result);
  }
};
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

await send("session.new", {
  capabilities: { alwaysMatch: { acceptInsecureCerts: true } },
});
const tree = await send("browsingContext.getTree", {});
const ctx = tree.contexts[0].context;

async function setViewport(w, h, dpr = 1) {
  await send("browsingContext.setViewport", {
    context: ctx,
    viewport: { width: w, height: h },
    devicePixelRatio: dpr,
  });
}
async function navigate(url) {
  await send("browsingContext.navigate", {
    context: ctx,
    url,
    wait: "interactive",
  });
}
async function evaluate(expr, awaitPromise = false) {
  const r = await send("script.evaluate", {
    expression: expr,
    target: { context: ctx },
    awaitPromise,
    resultOwnership: "none",
  });
  if (r.type === "exception") throw new Error(r.exceptionDetails?.text || "eval error");
  return r.result?.value;
}
async function shot(file) {
  const r = await send("browsingContext.captureScreenshot", {
    context: ctx,
    origin: "viewport",
  });
  writeFileSync(file, Buffer.from(r.data, "base64"));
  console.log("saved", file);
}
async function waitFor(expr, timeout = 15000, poll = 150) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evaluate(expr)) return true;
    await sleep(poll);
  }
  return false;
}
// Pointer at the predicted crossing (uses ?debug handle)
const moveToCrossing = `
(() => {
  const d = window.__debug; if (!d || !d.delivery) return "nodelivery";
  const c = d.camera;
  const v = d.ball.position.clone();
  v.set(d.delivery.crossing.x, d.delivery.crossing.y, 4.2);
  v.project(c);
  const x = (v.x * 0.5 + 0.5) * innerWidth;
  const y = (0.5 - v.y * 0.5) * innerHeight;
  document.dispatchEvent(new PointerEvent("pointermove", { clientX: x, clientY: y }));
  document.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y }));
  return "ok";
})()`;

await mkdir(OUT, { recursive: true });

// 1. Title / attract
await setViewport(1280, 800);
await navigate(`${BASE_URL}/?shot=title`);
await sleep(6000);
await shot(`${OUT}/screenshot-1-title.png`);

// 2-4. Play shots: ?shot jumps straight in. Need ?debug for pointer control —
// combine flags by navigating to ?shot&debug.
await navigate(`${BASE_URL}/?shot&debug`);
await waitFor("window.__debug !== undefined", 15000);
await sleep(1500);

// Wait for a fresh flight, then screenshot mid-flight with trail
await waitFor("window.__debug.state.phase === 'flight'");
await sleep(550);
await shot(`${OUT}/screenshot-2-flight.png`);

// Drive the pointer to crossings until a catch registers, then shoot burst+CAUGHT
let caught = false;
for (let round = 0; round < 6 && !caught; round++) {
  await waitFor("window.__debug.state.phase === 'flight'");
  const s0 = await evaluate("window.__debug.state.score");
  while (await evaluate("window.__debug.state.phase === 'flight'")) {
    await evaluate(moveToCrossing);
    await sleep(60);
  }
  const s1 = await evaluate("window.__debug.state.score");
  if (s1 > s0) {
    await sleep(120); // burst + message on screen
    await shot(`${OUT}/screenshot-3-catch.png`);
    caught = true;
  }
}

// 4. HUD with streak >= 3: keep catching until streak >= 3
for (let i = 0; i < 10; i++) {
  const st = await evaluate("window.__debug.state.streak");
  if (st >= 3) break;
  await waitFor("window.__debug.state.phase === 'flight'");
  while (await evaluate("window.__debug.state.phase === 'flight'")) {
    await evaluate(moveToCrossing);
    await sleep(60);
  }
}
await shot(`${OUT}/screenshot-4-streak.png`);

// 5. Game over: park the pointer, wait for lives to drain
await evaluate("document.dispatchEvent(new PointerEvent('pointermove',{clientX:10,clientY:790}))");
await waitFor("window.__debug.state.screen === 'gameover'", 120000, 500);
await sleep(400);
await shot(`${OUT}/screenshot-5-gameover.png`);

// 6-7. Promo tiles: capture ?shot=promo at 2x, downscale with sharp
for (const [w, h, name] of [
  [440, 280, "promo-440x280.png"],
  [1400, 560, "marquee-1400x560.png"],
]) {
  await setViewport(w * 2, h * 2, 1);
  await navigate(`${BASE_URL}/?shot=promo`);
  await waitFor("document.readyState === 'complete'");
  await sleep(7000);
  const r = await send("browsingContext.captureScreenshot", {
    context: ctx,
    origin: "viewport",
  });
  const buf = Buffer.from(r.data, "base64");
  await sharp(buf).resize(w, h).png().toFile(`${OUT}/${name}`);
  console.log("saved", `${OUT}/${name}`);
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
  const { size } = (await import("node:fs")).statSync(`${OUT}/${f}`);
  console.log(`${f}: ${m.width}x${m.height} ${(size / 1024).toFixed(0)} KB`);
}
ws.close();
process.exit(0);
