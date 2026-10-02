// Delivery planner: pure math, no three/cannon/DOM imports — node can
// import this directly to measure delivery quality.
// Mirrors the game's integration exactly: semi-implicit Euler at 60 Hz,
// swing force applied every step while z > swingStartZ (reverse flips its
// sign once z >= reverseFlipZ), zero linear damping.

export const HANDS_Z = 4.2;
export const PHYSICS_DT = 1 / 60;
export const BALL_MASS = 0.156;
export const GRAVITY = -9.82;
export const MAX_SWING_FORCE = 2.5;
const THROWER_Z = -6;
const START_Y = 1.5;
const REVERSE_FLIP_Z = 1.5;

const lerp = (a, b, t) => a + (b - a) * t;

// Simulates the flight; returns {x, y} at the first step where
// z >= HANDS_Z
function simulate(vx, vy, vz, forceX, swingStartZ, flipZ) {
  let x = 0;
  let y = START_Y;
  let z = THROWER_Z;
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
  );
}

export function planDelivery({ difficulty = 0, window, rng = Math.random }) {
  const d = Math.min(1, Math.max(0, difficulty));

  // Crossing point (where the ball reaches z = HANDS_Z) inside the window
  const cx = lerp(window.xMin, window.xMax, rng());
  const cy = lerp(window.yMin, window.yMax, rng());

  // Flight time: 1.37 s at difficulty 0 down to ~0.85 s at 1
  let T = lerp(1.37, 0.85, d);

  // Swing mix: 20% none / 50% normal / 30% reverse
  const roll = rng();
  const swingType = roll < 0.2 ? "none" : roll < 0.7 ? "normal" : "reverse";
  if (swingType === "reverse") T /= 0.9;

  // Swing start: 50-70% down the leg normally. For reverse, start well
  // before the flip (z = 1.5) so pre/post-flip legs don't cancel and the
  // solver doesn't need absurd forces.
  const swingStartZ =
    swingType === "reverse"
      ? lerp(-1.5, -0.5, rng())
      : THROWER_Z + (5 - THROWER_Z) * lerp(0.5, 0.7, rng());
  const flipZ = swingType === "reverse" ? REVERSE_FLIP_Z : null;

  // Visible lateral displacement: [0.25,0.6] m at d=0 to [0.4,0.9] at d=1
  const dMin = lerp(0.25, 0.4, d);
  const dMax = lerp(0.6, 0.9, d);
  let swingDisp =
    swingType === "none" ? 0 : lerp(dMin, dMax, rng()) * (rng() < 0.5 ? -1 : 1);

  // Aim point = where the ball crosses without swing; keep it sane
  let aim = cx - swingDisp;
  if (Math.abs(aim) > 2) {
    aim = Math.sign(aim) * 2;
    swingDisp = cx - aim;
  }

  // The sim breaks on the first step where z >= HANDS_Z — n steps where
  // n*dt >= T — so solve vy for semi-implicit Euler exactly:
  // y = vy*dt*n + g*dt^2*n(n+1)/2
  let vz = (HANDS_Z - THROWER_Z) / T;
  const nSteps = Math.ceil((HANDS_Z - THROWER_Z) / (vz * PHYSICS_DT));
  const vy =
    (cy -
      START_Y -
      (GRAVITY * PHYSICS_DT * PHYSICS_DT * nSteps * (nSteps + 1)) / 2) /
    (nSteps * PHYSICS_DT);
  let vx = aim / T;

  // Solve swing force against the simulation (x is linear in F AND in vx,
  // so one linear solve each suffices; a correction pass mops up float error)
  let swingForceX = 0;
  if (swingType !== "none" && Math.abs(swingDisp) > 1e-4) {
    const x0 = simulate(vx, vy, vz, 0, swingStartZ, flipZ).x;
    const k = simulate(vx, vy, vz, 1, swingStartZ, flipZ).x - x0;
    swingForceX = Math.abs(k) > 1e-6 ? (cx - x0) / k : 0;
    if (Math.abs(simulate(vx, vy, vz, swingForceX, swingStartZ, flipZ).x - cx) >
      0.02) {
      swingForceX +=
        (cx - simulate(vx, vy, vz, swingForceX, swingStartZ, flipZ).x) / k;
    }
    // Clamp to a physically sane force, then re-solve vx so the crossing
    // still lands on cx
    if (Math.abs(swingForceX) > MAX_SWING_FORCE) {
      swingForceX = Math.sign(swingForceX) * MAX_SWING_FORCE;
      const xv0 = simulate(vx, vy, vz, swingForceX, swingStartZ, flipZ).x;
      const kv =
        simulate(vx + 1, vy, vz, swingForceX, swingStartZ, flipZ).x - xv0;
      vx += (cx - xv0) / kv;
      const check = simulate(vx, vy, vz, swingForceX, swingStartZ, flipZ).x;
      if (Math.abs(check - cx) > 0.02) {
        vx += (cx - check) / kv;
      }
    }
  }

  return {
    start: { x: 0, y: START_Y, z: THROWER_Z },
    velocity: { x: vx, y: vy, z: vz },
    swingType,
    swingForceX,
    swingStartZ,
    reverseFlipZ: REVERSE_FLIP_Z,
    crossing: { x: cx, y: cy },
    flightTime: T,
    swingDisp,
  };
}
