// Capture scripted gameplay footage for social reels.
// Usage: node capture-reel.mjs <outdir> <seconds> [catchesJump] [errorRate]
//   catchesJump — jump to this catch count first (pace/difficulty), default 0
//   errorRate   — 0 = perfect autopilot, 0.2-ish = occasional natural drops
// Records WebKit video (webm) of portrait gameplay driven by an injected
// autopilot that mirrors the game's attract-mode tracking.
import { webkit } from "playwright";
import { mkdirSync, readFileSync } from "fs";

const [, , outdir = "/tmp/reelcap", secondsArg = "35", jumpArg = "0", errArg = "0"] = process.argv;
const seconds = Number(secondsArg);
const catchesJump = Number(jumpArg);
const errorRate = Number(errArg);
mkdirSync(outdir, { recursive: true });

const b = await webkit.launch();
const ctx = await b.newContext({
  viewport: { width: 1080, height: 1920 },
  deviceScaleFactor: 1,
  recordVideo: { dir: outdir, size: { width: 1080, height: 1920 } },
});
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(String(e)));

const port = process.env.CAPTURE_PORT || "5173";
await p.goto(`http://localhost:${port}/?shot&debug`, { waitUntil: "domcontentloaded" });
await p.waitForFunction("window.__debug !== undefined", { timeout: 15000 });

// Small viewport settle, then optional pace jump
await new Promise((r) => setTimeout(r, 1000));
if (catchesJump > 0) {
  await p.evaluate((n) => window.__debug.setCatches(n), catchesJump);
}

await p.evaluate((errRate) => {
  const d = window.__debug;
  let offsetX = 0;
  let offsetY = 0;
  let lastBallId = null;
  function drive() {
    const st = d.state;
    const del = d.delivery;
    if ((st.phase === "flight" || st.phase === "ready") && del && del.crossing) {
      // New delivery → fresh per-ball aim error (natural imperfection)
      const id = del.crossing.x + ":" + del.crossing.y + ":" + st.score + ":" + st.phase;
      if (st.phase === "flight" && id !== lastBallId) {
        lastBallId = id;
        offsetX = (Math.random() - 0.5) * 2 * errRate;
        offsetY = (Math.random() - 0.5) * 2 * errRate;
      }
      const tx = del.crossing.x + offsetX;
      const ty = del.crossing.y + offsetY;
      // Same lerp feel as attract autopilot (deltaTime*4 at 60fps ≈ 0.066)
      d.hands.position.x += (tx - d.hands.position.x) * 0.075;
      d.hands.position.y += (ty - d.hands.position.y) * 0.075;
    } else {
      // Between deliveries: drift back to a neutral ready position
      d.hands.position.x += (0 - d.hands.position.x) * 0.04;
      d.hands.position.y += (-0.1 - d.hands.position.y) * 0.04;
    }
    requestAnimationFrame(drive);
  }
  drive();
}, errorRate);


// --- Timed text overlays, injected as DOM ---
const overlayJson = process.argv[6] || "null";
const overlays = overlayJson === "null" ? null : JSON.parse(readFileSync(overlayJson, "utf8"));
if (overlays) {
  await p.evaluate((specs) => {
    const root = document.createElement("div");
    root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:9999;font-family:'Avenir Next','Helvetica Neue',sans-serif;";
    document.body.appendChild(root);
    const t0 = performance.now();
    const els = specs.map((s) => {
      const el = document.createElement("div");
      const posCss = s.pos === "center"
        ? "top:38%;left:0;right:0;transform:translateY(-50%);"
        : s.pos === "lower"
        ? "top:64%;left:0;right:0;"
        : "top:12%;left:0;right:0;";
      el.style.cssText = posCss + "position:absolute;text-align:center;opacity:0;transition:opacity .35s;padding:0 40px;";
      const main = document.createElement("div");
      main.textContent = s.text;
      main.style.cssText = "font-weight:800;font-size:" + (s.size || 64) + "px;letter-spacing:.01em;color:#fff;text-shadow:0 3px 18px rgba(0,0,0,.85),0 0 4px rgba(0,0,0,.9);text-transform:uppercase;line-height:1.15;";
      el.appendChild(main);
      if (s.sub) {
        const sub = document.createElement("div");
        sub.textContent = s.sub;
        sub.style.cssText = "margin-top:14px;font-weight:700;font-size:" + (s.subsize || 40) + "px;color:#ffd34d;text-shadow:0 2px 12px rgba(0,0,0,.9);text-transform:uppercase;letter-spacing:.02em;";
        el.appendChild(sub);
      }
      root.appendChild(el);
      return { el, s };
    });
    function tick() {
      const t = (performance.now() - t0) / 1000;
      for (const { el, s } of els) {
        el.style.opacity = t >= s.start && t <= s.end ? "1" : "0";
      }
      requestAnimationFrame(tick);
    }
    tick();
  }, overlays);
}

// Log game events so we can correlate score/pace with video time
const t0 = Date.now();
const events = [];
const poll = setInterval(async () => {
  try {
    const s = await p.evaluate(() => {
      const st = window.__debug.state;
      return { score: st.score, lives: st.lives, phase: st.phase, pace: st.paceLevel, streak: st.streak };
    });
    const t = ((Date.now() - t0) / 1000).toFixed(1);
    const last = events[events.length - 1];
    if (!last || last.score !== s.score || last.lives !== s.lives || last.pace !== s.pace) {
      events.push({ t, ...s });
    }
  } catch {}
}, 250);

await new Promise((r) => setTimeout(r, seconds * 1000));
clearInterval(poll);
console.log("events:", JSON.stringify(events));
console.log("pageerrors:", errs.length);
await ctx.close();
await b.close();
