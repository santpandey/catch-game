// Synthesized game audio (Web Audio API only, no asset files).

const STORAGE_KEY = "slipcatch.muted";
const MASTER_LEVEL = 0.8;
const AMBIENCE_MAX = 0.14; // ambience at level 1 stays well below effects
const NOISE_SECONDS = 2;

function readMuted() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch (e) {
    return false;
  }
}

function writeMuted(value) {
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch (e) {
    // storage unavailable (privacy mode / extension sandbox): ignore
  }
}

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

// ctx.resume()/suspend() can hang forever on a broken audio device; never block callers.
function settle(promise, ms = 1000) {
  return Promise.race([
    Promise.resolve(promise).catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, ms)),
  ]).then(() => {});
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

export function createAudio() {
  const AC = typeof window !== "undefined" ? (window.AudioContext || window.webkitAudioContext) : null;

  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let ambienceGain = null;
  let unlocked = false;
  let unlockPromise = null;
  let muted = readMuted();
  let ambienceLevel = 0.5;

  function ready() {
    return unlocked && ctx && !muted && ctx.state === "running";
  }

  function build() {
    ctx = new AC();

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.25;
    comp.connect(ctx.destination);

    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_LEVEL;
    master.connect(comp);

    // One shared white-noise buffer reused by every sound.
    const len = Math.floor(ctx.sampleRate * NOISE_SECONDS);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    startAmbience();
  }

  function startAmbience() {
    ambienceGain = ctx.createGain();
    ambienceGain.gain.value = ambienceLevel * AMBIENCE_MAX;
    ambienceGain.connect(master);

    // [filter type, freq, Q, base gain, lfo rate Hz, lfo depth (fraction of base)]
    const layers = [
      ["lowpass", 320, 0.7, 0.9, 0.07, 0.3],
      ["bandpass", 650, 0.8, 0.8, 0.13, 0.4],
      ["bandpass", 1800, 1.2, 0.35, 0.21, 0.5],
    ];
    const t = ctx.currentTime;
    for (const [type, freq, q, base, rate, depth] of layers) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      filter.Q.value = q;

      const gain = ctx.createGain();
      gain.gain.value = base;

      // Slow LFO on gain for a "living" murmur.
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate * rand(0.85, 1.15);
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = base * depth;
      lfo.connect(lfoDepth);
      lfoDepth.connect(gain.gain);

      // Gentle drift of the filter centre as well.
      const fLfo = ctx.createOscillator();
      fLfo.frequency.value = rate * 0.6;
      const fDepth = ctx.createGain();
      fDepth.gain.value = freq * 0.15;
      fLfo.connect(fDepth);
      fDepth.connect(filter.frequency);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(ambienceGain);

      // Different offsets so the layers don't share the same noise.
      src.start(t, rand(0, NOISE_SECONDS));
      lfo.start(t, 0);
      fLfo.start(t);
    }
  }

  // Noise burst source with random offset; disconnects `nodes` when done.
  function noise(t, dur, nodes) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const maxOffset = Math.max(0, NOISE_SECONDS - dur - 0.01);
    src.start(t, rand(0, maxOffset), dur);
    src.onended = () => {
      src.disconnect();
      for (const n of nodes) n.disconnect();
    };
    return src;
  }

  function cleanupOn(node, nodes) {
    node.onended = () => {
      node.disconnect();
      for (const n of nodes) n.disconnect();
    };
  }

  // Attack-then-exponential-decay envelope.
  function env(param, t, attack, peak, decay) {
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  function filter(type, freq, q) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q !== undefined) f.Q.value = q;
    return f;
  }

  function playRelease() {
    if (!ready()) return;
    const t = ctx.currentTime + 0.005;

    // Crisp high-band noise click.
    const hp = filter("highpass", 2500, 0.7);
    const bp = filter("bandpass", 4500, 2);
    const g = ctx.createGain();
    env(g.gain, t, 0.001, 0.55, 0.045);
    const src = noise(t, 0.06, [hp, bp, g]);
    src.connect(hp);
    hp.connect(bp);
    bp.connect(g);
    g.connect(master);

    // Faint woody ping underneath.
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(2300, t);
    osc.frequency.exponentialRampToValueAtTime(1600, t + 0.05);
    const og = ctx.createGain();
    env(og.gain, t, 0.001, 0.12, 0.05);
    osc.connect(og);
    og.connect(master);
    osc.start(t);
    osc.stop(t + 0.06);
    cleanupOn(osc, [og]);
  }

  function playCatch() {
    if (!ready()) return;
    const t = ctx.currentTime + 0.005;

    // Low thump: falling sine.
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.12);
    const og = ctx.createGain();
    env(og.gain, t, 0.003, 0.9, 0.16);
    osc.connect(og);
    og.connect(master);
    osc.start(t);
    osc.stop(t + 0.2);
    cleanupOn(osc, [og]);

    // Leather/skin slap: mid-band noise.
    const bp = filter("bandpass", 1300, 0.9);
    const lp = filter("lowpass", 3500, 0.7);
    const g = ctx.createGain();
    env(g.gain, t, 0.001, 0.6, 0.055);
    const src = noise(t, 0.08, [bp, lp, g]);
    src.connect(bp);
    bp.connect(lp);
    lp.connect(g);
    g.connect(master);

    // Tiny higher crack for the fingers closing.
    const hp = filter("bandpass", 3000, 1.5);
    const g2 = ctx.createGain();
    env(g2.gain, t + 0.008, 0.001, 0.18, 0.025);
    const src2 = noise(t + 0.008, 0.04, [hp, g2]);
    src2.connect(hp);
    hp.connect(g2);
    g2.connect(master);
  }

  function playCheer(intensity) {
    if (!ready()) return;
    const k = clamp01(intensity === undefined ? 0.7 : intensity);
    const t = ctx.currentTime + 0.01;
    const dur = 2 + k;
    const peak = 0.25 + 0.4 * k;

    // Roar: two noise bands with a swelling envelope and rising brightness.
    const roarBus = ctx.createGain();
    roarBus.gain.setValueAtTime(0.0001, t);
    roarBus.gain.linearRampToValueAtTime(peak, t + 0.35);
    roarBus.gain.setValueAtTime(peak, t + dur * 0.4);
    roarBus.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    roarBus.connect(master);

    const bp = filter("bandpass", 700, 0.6);
    bp.frequency.setValueAtTime(650, t);
    bp.frequency.linearRampToValueAtTime(1100 + 300 * k, t + 0.4);
    bp.frequency.linearRampToValueAtTime(800, t + dur);
    const lp = filter("lowpass", 450, 0.7);
    const lpGain = ctx.createGain();
    lpGain.gain.value = 0.7;

    // Applause: claps routed through a few shared band filters.
    const clapBus = ctx.createGain();
    clapBus.gain.value = 0.5 + 0.7 * k;
    clapBus.connect(master);
    const clapFilters = [1100, 1700, 2600].map((f) => {
      const cf = filter("bandpass", f, 1.6);
      cf.connect(clapBus);
      return cf;
    });

    const roar = noise(t, dur + 0.05, [bp, lp, lpGain, roarBus, clapBus, ...clapFilters]);
    // Loop so the 2 s buffer covers longer cheers.
    roar.loop = true;
    roar.connect(bp);
    roar.connect(lp);
    bp.connect(roarBus);
    lp.connect(lpGain);
    lpGain.connect(roarBus);

    const claps = Math.round(40 + 120 * k);
    for (let i = 0; i < claps; i++) {
      // Skewed towards the start so density follows the roar.
      const ct = t + 0.08 + Math.pow(Math.random(), 1.6) * (dur - 0.25);
      const fade = 1 - (ct - t) / dur;
      const cg = ctx.createGain();
      env(cg.gain, ct, 0.001, rand(0.08, 0.22) * (0.4 + 0.6 * fade), rand(0.018, 0.035));
      const cs = noise(ct, 0.045, [cg]);
      cs.connect(cg);
      cg.connect(clapFilters[i % clapFilters.length]);
    }
  }

  function playDrop() {
    if (!ready()) return;
    const t = ctx.currentTime + 0.01;
    const dur = 1.2;

    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.linearRampToValueAtTime(0.4, t + 0.15);
    out.gain.setValueAtTime(0.4, t + 0.45);
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    out.connect(master);

    // "Oo" formants sliding down.
    const f1 = filter("bandpass", 450, 4);
    f1.frequency.setValueAtTime(450, t);
    f1.frequency.exponentialRampToValueAtTime(260, t + dur);
    const f2 = filter("bandpass", 1000, 5);
    f2.frequency.setValueAtTime(1000, t);
    f2.frequency.exponentialRampToValueAtTime(620, t + dur);
    const f2g = ctx.createGain();
    f2g.gain.value = 0.5;
    const voiceIn = ctx.createGain();
    voiceIn.gain.value = 1;
    voiceIn.connect(f1);
    voiceIn.connect(f2);
    f1.connect(out);
    f2.connect(f2g);
    f2g.connect(out);

    // Breathy noise part.
    const nGain = ctx.createGain();
    nGain.gain.value = 1.4;
    const src = noise(t, dur + 0.05, [voiceIn, f1, f2, f2g, out, nGain]);
    src.connect(nGain);
    nGain.connect(voiceIn);

    // A handful of detuned "voices" for a vocal groan.
    for (let i = 0; i < 6; i++) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      const f0 = rand(170, 240);
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(f0 * rand(0.6, 0.72), t + dur);
      const vg = ctx.createGain();
      vg.gain.value = 0.035;
      osc.connect(vg);
      vg.connect(voiceIn);
      osc.start(t + rand(0, 0.08));
      osc.stop(t + dur + 0.05);
      cleanupOn(osc, [vg]);
    }
  }

  function unlock() {
    if (!AC) return Promise.resolve();
    if (unlockPromise) return unlockPromise;
    try {
      if (!ctx) build();
    } catch (e) {
      ctx = null;
      return Promise.resolve();
    }
    unlocked = true;
    if (ctx.state === "running") return Promise.resolve();
    let resuming;
    try {
      resuming = ctx.resume();
    } catch (e) {
      resuming = null;
    }
    unlockPromise = settle(resuming).then(() => {
      unlockPromise = null;
    });
    return unlockPromise;
  }

  function setMuted(isMutedValue) {
    muted = !!isMutedValue;
    writeMuted(muted);
    if (!ctx || !master) return;
    try {
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.setTargetAtTime(muted ? 0 : MASTER_LEVEL, now, 0.05);
      const hidden = typeof document !== "undefined" && document.hidden;
      if (!muted && unlocked && ctx.state === "suspended" && !hidden) {
        settle(ctx.resume());
      }
    } catch (e) {
      // ignore
    }
  }

  function setAmbience(level) {
    ambienceLevel = clamp01(level);
    if (!ctx || !ambienceGain) return;
    try {
      const now = ctx.currentTime;
      ambienceGain.gain.cancelScheduledValues(now);
      ambienceGain.gain.setValueAtTime(ambienceGain.gain.value, now);
      ambienceGain.gain.setTargetAtTime(ambienceLevel * AMBIENCE_MAX, now, 0.15); // ~0.5 s to settle
    } catch (e) {
      // ignore
    }
  }

  function suspend() {
    if (!ctx || ctx.state !== "running") return Promise.resolve();
    try {
      return settle(ctx.suspend());
    } catch (e) {
      return Promise.resolve();
    }
  }

  function resume() {
    if (!ctx || !unlocked || muted || ctx.state !== "suspended") return Promise.resolve();
    try {
      return settle(ctx.resume());
    } catch (e) {
      return Promise.resolve();
    }
  }

  // Never let audio errors break gameplay.
  function safe(fn) {
    return (...args) => {
      try {
        return fn(...args);
      } catch (e) {
        console.warn("[audio]", e);
        return undefined;
      }
    };
  }

  return {
    unlock,
    setMuted,
    isMuted: () => muted,
    setAmbience,
    playRelease: safe(playRelease),
    playCatch: safe(playCatch),
    playCheer: safe(playCheer),
    playDrop: safe(playDrop),
    suspend,
    resume,
  };
}
