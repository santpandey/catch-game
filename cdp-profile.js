// CDP profiler: opens the game in Chrome, collects console/network/perf data.
// Usage: node cdp-profile.js [url] [seconds]
const DEBUG_PORT = 9222;
const url = process.argv[2] || "http://localhost:5173/?debug";
const durationSec = parseInt(process.argv[3] || "15", 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWsUrl() {
  // Create a new tab via the HTTP endpoint
  const res = await fetch(
    `http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(url)}`,
    { method: "PUT" },
  );
  const target = await res.json();
  return target.webSocketDebuggerUrl;
}

async function main() {
  const ws = new WebSocket(await getWsUrl());
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const msgId = ++id;
      pending.set(msgId, { resolve, reject });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });

  const consoleLogs = [];
  const network = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg.result);
    } else if (msg.method === "Runtime.consoleAPICalled") {
      const text = msg.params.args
        .map((a) => a.value ?? a.description ?? "")
        .join(" ");
      consoleLogs.push(`[${msg.params.type}] ${text}`);
    } else if (msg.method === "Network.responseReceived") {
      const r = msg.params.response;
      network.push({
        url: r.url.split("/").pop().slice(0, 60),
        status: r.status,
        type: msg.params.type,
        mime: r.mimeType,
      });
    } else if (msg.method === "Network.loadingFinished") {
      const n = network.find((x) => x.reqId === msg.params.requestId);
      if (n) n.encodedSize = msg.params.encodedDataLength;
    } else if (msg.method === "Network.requestWillBeSent") {
      network.push({ reqId: msg.params.requestId, url: msg.params.request.url.split("/").pop().slice(0, 60) });
    } else if (msg.method === "Runtime.exceptionThrown") {
      consoleLogs.push(`[EXCEPTION] ${JSON.stringify(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text)}`);
    }
  };

  await new Promise((r) => (ws.onopen = r));
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Network.enable");
  await send("Performance.enable");

  // Inject long-task + FPS observer once the page is running
  await sleep(4000);
  await send("Runtime.evaluate", {
    expression: `
      window.__longTasks = [];
      window.__fpsSamples = [];
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__longTasks.push({dur: Math.round(e.duration), start: Math.round(e.startTime)});
      }).observe({entryTypes: ['longtask']});
      let last = performance.now(), frames = 0;
      (function loop(){
        const now = performance.now();
        frames++;
        if (now - last >= 1000) { window.__fpsSamples.push(frames); frames = 0; last = now; }
        requestAnimationFrame(loop);
      })();
      'observers installed';
    `,
  });

  console.log(`Sampling for ${durationSec}s...`);
  await sleep(durationSec * 1000);

  const metrics = await send("Performance.getMetrics");
  const fps = await send("Runtime.evaluate", {
    expression: `JSON.stringify({fps: window.__fpsSamples, longTasks: window.__longTasks.slice(0,50), heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576) : null})`,
    returnByValue: true,
  });

  console.log("\n===== CONSOLE =====");
  consoleLogs.forEach((l) => console.log(l));
  console.log("\n===== NETWORK =====");
  network
    .filter((n) => n.status)
    .forEach((n) =>
      console.log(`${n.status} ${n.type || "?"} ${n.encodedSize ? Math.round(n.encodedSize / 1024) + "KB" : "?"} ${n.url}`),
    );
  console.log("\n===== FPS samples (per second) =====");
  const data = JSON.parse(fps.result.value);
  console.log(data.fps.join(", "));
  console.log("\n===== LONG TASKS (>50ms) =====");
  console.log(JSON.stringify(data.longTasks));
  console.log("JS heap used (MB):", data.heap);
  console.log("\n===== METRICS =====");
  for (const m of metrics.metrics) {
    if (["TaskDuration", "ScriptDuration", "LayoutDuration", "JSHeapUsedSize", "Documents", "Frames", "JSEventListeners", "Nodes"].includes(m.name)) {
      console.log(`${m.name}: ${Math.round(m.value * 100) / 100}`);
    }
  }

  ws.close();
  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
