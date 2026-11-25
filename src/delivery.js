// Delivery planner: pure math, no three/cannon/DOM imports — node can
// import this directly to measure delivery quality.
// Mirrors the game's integration exactly: semi-implicit Euler at 60 Hz,
// swing force applied every step while z > swingStartZ (reverse flips its
// sign once z >= reverseFlipZ), zero linear damping.

export const HANDS_Z = 4.2;
export const PHYSICS_DT = 1 / 60;
export const BALL_MASS = 0.156;
export const GRAVITY = -9.82;
export const MAX_SWING_FORCE = 4;
const THROWER_Z = -6;
const START_Y = 1.5;
const REVERSE_FLIP_Z = 1.5;
// Fraction of the original -6 → 4.2 leg at which reverse swing flips —
// reused proportionally for shorter legs (bat deflections) so the flip
// stays the same relative distance into the flight
const REVERSE_FLIP_FRAC = (REVERSE_FLIP_Z - THROWER_Z) / (HANDS_Z - THROWER_Z);

const lerp = (a, b, t) => a + (b - a) * t;

// Pace ramp: discrete milestones make speed-ups a felt "level up" event
// instead of an invisible drift. Pace scales ball speed multiplicatively
// on the base (+15%, +30%, +45%, +55%), so T = BASE_T / PACE_MULT[level].
export const PACE_MILESTONES = [6, 12, 18, 24];
export const PACE_MULT = [1, 1.15, 1.3, 1.45, 1.55];
const BASE_T = 1.4;

// Pace level for a catch count (0-4)
export function paceForCatches(catches) {
  let l = 0;
  for (const m of PACE_MILESTONES) if (catches >= m) l++;
  return l;
}

// Simulates the flight; returns {x, y} at the first step where
// z >= HANDS_Z
function simulate(vx, vy, vz, forceX, swingStartZ, flipZ, start) {
  let x = start.x;
  let y = start.y;
  let z = start.z;
  while (z < HANDS_Z) {
    let f = 0;
    if (z > swingStartZ) {
      f = forceX;
      if (flipZ !== null && z >= flipZ) f = -f;
    }
    vx += (f / BALL_MASS) * PHYSICS_DT;
    vy += GRAVITY * PHYSICS_DT;
    x += vx * PHYSICS_DT;
    y += vy * PHYSICS_DT;
    z += vz * PHYSICS_DT;
  }
  return { x, y };
}

// Exact-rule crossing for callers/tests
export function simulateCrossing(plan) {
  return simulate(
    plan.velocity.x,
    plan.velocity.y,
    plan.velocity.z,
    plan.swingForceX,
    plan.swingStartZ,
    plan.swingType === "reverse" ? plan.reverseFlipZ : null,
    plan.start,
  );
}

// Target zone inside the visible window: horizontally central and low on
// screen so the hands stay near the bottom of the frame; widens a little
// with difficulty.
export function catchZone(win, difficulty = 0) {
  const d = Math.min(1, Math.max(0, difficulty));
  const midX = (win.xMin + win.xMax) / 2;
  const halfW = (win.xMax - win.xMin) * lerp(0.25, 0.35, d);
  return {
    xMin: midX - halfW,
    xMax: midX + halfW,
    yMin: win.yMin,
    yMax: win.yMin + (win.yMax - win.yMin) * lerp(0.3, 0.4, d),
  };
}

// start: launch point of the flight being planned. Defaults to the
// classic center thrower; the slip-drill deflection passes the bat
// contact point instead — everything downstream (swing geometry, solver)
// is expressed relative to it.
export function planDelivery({ difficulty = 0, pace = 0, window, rng = Math.random, start }) {
  const d = Math.min(1, Math.max(0, difficulty));
  const sx = start?.x ?? 0;
  const sy = start?.y ?? START_Y;
  const sz = start?.z ?? THROWER_Z;
  const span = HANDS_Z - sz;

  // Crossing point (where the ball reaches z = HANDS_Z) inside the window
  const cx = lerp(window.xMin, window.xMax, rng());
  const cy = lerp(window.yMin, window.yMax, rng());

  // Flight time set by pace level. Base time scales with leg length so a
  // bat deflection keeps the same ball speed as a full throw — edged
  // balls carry pace off the bat, and a slower deflection would float.
  let T = (BASE_T * span) / (HANDS_Z - THROWER_Z) / PACE_MULT[Math.min(pace, PACE_MULT.length - 1)];

  // Swing mix: 15% none / 50% normal / 35% reverse
  const roll = rng();
  const swingType = roll < 0.15 ? "none" : roll < 0.65 ? "normal" : "reverse";
  if (swingType === "reverse") T /= 0.9;

  // Swing start: 40-70% down the leg normally — late enough to read as a
  // jag, not a long lazy curve. For reverse, start well before the flip
  // so pre/post-flip legs don't cancel and the solver doesn't need absurd
  // forces. Flip sits at the same proportional depth as the full leg.
  const swingStartZ =
    swingType === "reverse"
      ? sz + span * lerp(0.34, 0.44, rng())
      : sz + span * lerp(0.4, 0.7, rng());
  const flipZ = swingType === "reverse" ? sz + span * REVERSE_FLIP_FRAC : null;

  // Visible lateral displacement: [0.4,0.9] m at d=0 to [0.55,1.4] at d=1 —
  // back towards the wilder early-game feel. Capped by what the swing
  // window can physically deliver: disp = a t² / 2 where a = F/m, so a
  // late start on a fast ball can't move the ball far and must not draw a
  // target the solver would need to clamp (clamping flattens the arc).
  const vzApprox = span / T;
  const tSwing = (HANDS_Z - swingStartZ) / vzApprox;
  const dispCap = (MAX_SWING_FORCE * tSwing * tSwing) / (2 * BALL_MASS) * 0.9;
  const dMin = Math.min(lerp(0.4, 0.55, d), dispCap);
  const dMax = Math.min(lerp(0.9, 1.4, d), dispCap);
  let swingDisp =
    swingType === "none"
      ? 0
      : lerp(dMin, dMax, rng()) * (rng() < 0.5 ? -1 : 1);

  // Aim point = where the ball crosses without swing; keep it sane
  let aim = cx - swingDisp;
  if (Math.abs(aim) > 2) {
    aim = Math.sign(aim) * 2;
    swingDisp = cx - aim;
  }

  // The sim breaks on the first step where z >= HANDS_Z — n steps where
  // n*dt >= T — so solve vy for semi-implicit Euler exactly:
  // y = vy*dt*n + g*dt^2*n(n+1)/2
  let vz = span / T;
  // Count steps with the same float accumulation as simulate() — a
  // closed-form ceil() can be off by one and land the ball ~10 cm low
  let nSteps = 0;
  for (let z = sz; z < HANDS_Z; z += vz * PHYSICS_DT) nSteps++;
  const vy =
    (cy -
      sy -
      (GRAVITY * PHYSICS_DT * PHYSICS_DT * nSteps * (nSteps + 1)) / 2) /
    (nSteps * PHYSICS_DT);
  // Horizontal velocity carries the ball from sx to the aim point in T
  let vx = (aim - sx) / T;

  // Solve swing force against the simulation (x is linear in F AND in vx,
  // so one linear solve each suffices; a correction pass mops up float error)
  const sim = (vvx, vvy, vvz, f) =>
    simulate(vvx, vvy, vvz, f, swingStartZ, flipZ, { x: sx, y: sy, z: sz });
  let swingForceX = 0;
  if (swingType !== "none" && Math.abs(swingDisp) > 1e-4) {
    const x0 = sim(vx, vy, vz, 0).x;
    const k = sim(vx, vy, vz, 1).x - x0;
    swingForceX = Math.abs(k) > 1e-6 ? (cx - x0) / k : 0;
    if (Math.abs(sim(vx, vy, vz, swingForceX).x - cx) > 0.02) {
      swingForceX += (cx - sim(vx, vy, vz, swingForceX).x) / k;
    }
    // Clamp to a physically sane force, then re-solve vx so the crossing
    // still lands on cx
    if (Math.abs(swingForceX) > MAX_SWING_FORCE) {
      swingForceX = Math.sign(swingForceX) * MAX_SWING_FORCE;
      const xv0 = sim(vx, vy, vz, swingForceX).x;
      const kv = sim(vx + 1, vy, vz, swingForceX).x - xv0;
      vx += (cx - xv0) / kv;
      const check = sim(vx, vy, vz, swingForceX).x;
      if (Math.abs(check - cx) > 0.02) {
        vx += (cx - check) / kv;
      }
    }
  }

  return {
    start: { x: sx, y: sy, z: sz },
    velocity: { x: vx, y: vy, z: vz },
    swingType,
    swingForceX,
    swingStartZ,
    reverseFlipZ: flipZ ?? REVERSE_FLIP_Z,
    crossing: { x: cx, y: cy },
    flightTime: T,
    pace,
    swingDisp,
  };
}
