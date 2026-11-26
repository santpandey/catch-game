import * as THREE from "three";

// WebXR generic-hand model (MIT, (c) 2019 Amazon) — assets/hands/.
// Joints arrive FLAT under Armature; we re-parent them into real chains
// with attach() (world transforms preserved, verified) so they can curl.

// ~0.26 m of hand at 0.8 m from camera ≈ 20% of frame height
const HAND_SCALE = 1.3;
// Palm centres sit this far apart around the group origin (model units)
const HAND_SPREAD = 0.08;
// Inward yaw per hand (deg) forming the cupped "W" catching bowl —
// real slip technique: hands are not parallel, thumbs meet in the middle
const CUP_YAW_DEG = 30;
// Target pose: palms face the incoming ball (-Z) tilted ~25 deg up;
// fingers point up, leaning ~25 deg toward the viewer (cupped look)
const FINGER_DIR = new THREE.Vector3(
  0,
  Math.cos((25 * Math.PI) / 180),
  Math.sin((25 * Math.PI) / 180),
);
const PALM_NORMAL = new THREE.Vector3(
  0,
  Math.sin((25 * Math.PI) / 180),
  -Math.cos((25 * Math.PI) / 180),
);

// Curl angles (deg) at [open, caught] per joint-name tail
const CURL_DEG = {
  metacarpal: [0, 18],
  "phalanx-proximal": [10, 70],
  "phalanx-intermediate": [10, 85],
  "phalanx-distal": [0, 50],
  tip: [0, 25],
};
const THUMB_DEG = {
  metacarpal: [0, 15],
  "phalanx-proximal": [0, 30],
  "phalanx-distal": [0, 34],
  tip: [0, 16],
};

const CHAINS = {
  index: ["index-finger-metacarpal", "index-finger-phalanx-proximal", "index-finger-phalanx-intermediate", "index-finger-phalanx-distal", "index-finger-tip"],
  middle: ["middle-finger-metacarpal", "middle-finger-phalanx-proximal", "middle-finger-phalanx-intermediate", "middle-finger-phalanx-distal", "middle-finger-tip"],
  ring: ["ring-finger-metacarpal", "ring-finger-phalanx-proximal", "ring-finger-phalanx-intermediate", "ring-finger-phalanx-distal", "ring-finger-tip"],
  pinky: ["pinky-finger-metacarpal", "pinky-finger-phalanx-proximal", "pinky-finger-phalanx-intermediate", "pinky-finger-phalanx-distal", "pinky-finger-tip"],
  thumb: ["thumb-metacarpal", "thumb-phalanx-proximal", "thumb-phalanx-distal", "thumb-tip"],
};
const _rx = new THREE.Quaternion();
const _axisX = new THREE.Vector3(1, 0, 0);
const _v = new THREE.Vector3();

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

function jointTail(name) {
  // "index-finger-phalanx-proximal" -> "phalanx-proximal"; "thumb-tip" -> "tip"
  return name.startsWith("thumb")
    ? name.slice(6)
    : name.split("-").slice(2).join("-");
}

// Warm, readable skin on a night background (option A look)
function skinMaterial(m) {
  m.color.set(0xc68863);
  m.roughness = 0.6;
  m.metalness = 0;
  m.emissive.set(0x3a1e10);
  m.emissiveIntensity = 0.35;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = { value: new THREE.Color(0xffd2a0) };
    shader.uniforms.uRimStrength = { value: 0.35 };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
  totalEmissiveRadiance += uRimColor * pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0) * uRimStrength;`,
      )
      .replace(
        "void main() {",
        "uniform vec3 uRimColor;\nuniform float uRimStrength;\nvoid main() {",
      );
  };
}

// Re-parent the flat joints into chains, add open/caught poses per bone,
// and return the pose/axis info needed to place the hand.
function rigHand(gltfScene, bones, side, scanJoints) {
  const armature = gltfScene.getObjectByName("Armature");
  gltfScene.updateMatrixWorld(true);

  const before = new Map();
  armature.traverse((n) => before.set(n, n.matrixWorld.clone()));
  for (const chain of Object.values(CHAINS)) {
    for (let i = 1; i < chain.length; i++) {
      const parent = gltfScene.getObjectByName(chain[i - 1]);
      const child = gltfScene.getObjectByName(chain[i]);
      if (parent && child) parent.attach(child);
    }
  }
  gltfScene.updateMatrixWorld(true);
  let maxDiff = 0;
  for (const [n, m] of before) {
    const a = m.elements;
    const b = n.matrixWorld.elements;
    for (let i = 0; i < 16; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(a[i] - b[i]));
    }
  }

  // The hand's own axes, measured from bone positions (armature space)
  const pos = (name) =>
    gltfScene.getObjectByName(name).getWorldPosition(new THREE.Vector3());
  const F = pos(CHAINS.middle[4]).sub(pos(CHAINS.middle[0])).normalize();
  const IP = pos(CHAINS.pinky[0]).sub(pos(CHAINS.index[0])).normalize();
  const N = new THREE.Vector3().crossVectors(F, IP).normalize(); // palm side
  // Chirality fix: left and right hands are mirror images, so F×IP yields the
  // palm-side normal for one hand but the back-of-hand normal for the other.
  // Without this the left hand's palm faced the viewer instead of the ball.
  if (side === "left") N.negate();

  // Proper rotation mapping model axes to the target world pose:
  // align finger dir first, then swing the palm normal into place
  const q1 = new THREE.Quaternion().setFromUnitVectors(F, FINGER_DIR);
  const N2 = N.clone().applyQuaternion(q1);
  const q2 = new THREE.Quaternion().setFromUnitVectors(N2, PALM_NORMAL);
  const R = q2.clone().multiply(q1);

  // Curl sign probe: does a local +X rotation on the index distal joint
  // move the fingertip toward the palm side (+N)?
  const indexTip = gltfScene.getObjectByName("index-finger-phalanx-distal");
  const tipNode = gltfScene.getObjectByName("index-finger-tip");
  const t0 = tipNode.getWorldPosition(new THREE.Vector3());
  const saved = indexTip.quaternion.clone();
  indexTip.quaternion.multiply(_rx.setFromAxisAngle(_axisX, Math.PI / 4));
  gltfScene.updateMatrixWorld(true);
  const t1 = tipNode.getWorldPosition(new THREE.Vector3());
  indexTip.quaternion.copy(saved);
  gltfScene.updateMatrixWorld(true);
  const sign = t1.sub(t0).dot(N) > 0 ? 1 : -1;

  // Thumb adduction baked into the base pose: real catching technique holds
  // the thumbs lying across toward each other — visible in the middle of
  // the "W" — not splayed in the hand plane where they hide edge-on behind
  // the palm. Axis directions derived from measured tip-displacement
  // Jacobians: +Y sweeps the left thumb toward the camera, mirrored for
  // right; +X draws both tips inward across the palm.
  // Thumb pose for the catching "W": local rotation quaternions computed
  // by direction-targeting in-browser — the exact rotation aligning each
  // thumb metacarpal's bone direction with the desired world direction
  // (inward-dominant, moderately up, slight forward) so the pair crosses
  // in the centre gap, tips pointing up-inward, right over left.
  const _tm = gltfScene.getObjectByName("thumb-metacarpal");
  const _thumbQuat =
    side === "right"
      ? new THREE.Quaternion(-0.46191, -0.16373, -0.2846, 0.82391)
      : new THREE.Quaternion(-0.4634, 0.26891, 0.27275, 0.79908);
  _tm.quaternion.copy(_thumbQuat);


  for (const [fname, chain] of Object.entries(CHAINS)) {
    const table = chain[0].startsWith("thumb") ? THUMB_DEG : CURL_DEG;
    const key = side + ":" + fname;
    scanJoints[key] = [];
    for (const name of chain) {
      const bone = gltfScene.getObjectByName(name);
      if (!bone) continue;
      // Only the moving, visible segments drive contact scanning — but every
      // joint must still be posed below. Metacarpals and proximal phalanges
      // sit statically deep in the cup where the ball nests — including them
      // in the scan freezes the finger before its tip can close.
      if (/-(tip|distal|intermediate)$/.test(name) || name.endsWith("thumb-tip")) {
        scanJoints[key].push(bone);
      }
      const [openDeg, catchDeg] = table[jointTail(name)] || [0, 0];
      if (openDeg === 0 && catchDeg === 0) continue;
      const open = bone.quaternion.clone();
      _rx.setFromAxisAngle(_axisX, (openDeg * sign * Math.PI) / 180);
      const openQ = open.clone().multiply(_rx);
      _rx.setFromAxisAngle(_axisX, (catchDeg * sign * Math.PI) / 180);
      const caught = open.clone().multiply(_rx);
      bones.push({ bone, open: openQ, caught, finger: key });
    }
  }

  return { wrist: gltfScene.getObjectByName("wrist"), R, maxDiff, N, F };
}

export function createHands({ left, right }) {
  const group = new THREE.Group();
  const model = new THREE.Group();
  model.scale.setScalar(HAND_SCALE);
  group.add(model);

  const bones = [];
  const scanJoints = {};
  const wrists = [];
  let gateDiff = 0;

  for (const [side, gltfScene] of [
    ["right", right],
    ["left", left],
  ]) {
    const rig = rigHand(gltfScene, bones, side, scanJoints);
    gateDiff = Math.max(gateDiff, rig.maxDiff);
    wrists.push(rig.wrist);

    const pivot = new THREE.Group();
    pivot.quaternion.copy(rig.R);
    const yawSign = side === "right" ? 1 : -1;
    pivot.quaternion.premultiply(
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        (yawSign * CUP_YAW_DEG * Math.PI) / 180,
      ),
    );
    pivot.add(gltfScene);
    model.add(pivot);
    model.updateMatrixWorld(true);

    // Centre the palm midpoint at +-HAND_SPREAD/2, 0, 0 (model space) so the
    // combined midpoint of both hands is exactly the group origin
    const palmMid = ["index", "middle", "ring", "pinky"]
      .map((f) => gltfScene.getObjectByName(`${f}-finger-metacarpal`))
      .map((b) => b.getWorldPosition(new THREE.Vector3()))
      .reduce((a, p) => a.add(p), new THREE.Vector3())
      .multiplyScalar(0.25);
    const inModel = model.worldToLocal(palmMid.clone());
    inModel.x -= side === "right" ? HAND_SPREAD / 2 : -HAND_SPREAD / 2;
    pivot.position.sub(inModel);
    if (side === "right") pivot.position.z += 0.02;
  }
  console.log("hands: re-parent gate maxDiff =", gateDiff.toExponential(3));

  // --- Wrist caps: close the hollow tube end with a rounded skin dome ---
  model.updateMatrixWorld(true);
  for (const wrist of wrists) {
    // Direction out of the wrist (forearm side) in world space
    const dirWorld = new THREE.Vector3(0, -0.94, 0.34).normalize();
    const wristPos = wrist.getWorldPosition(new THREE.Vector3());
    const dirLocal = wrist
      .worldToLocal(wristPos.clone().add(dirWorld))
      .normalize();
    const capMat = new THREE.MeshStandardMaterial();
    skinMaterial(capMat);
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.024, 16, 12),
      capMat,
    );
    cap.scale.set(1, 0.5, 0.75);
    cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dirLocal);
    cap.position.copy(dirLocal).multiplyScalar(0.015);
    wrist.add(cap);
  }

  for (const root of [left, right]) {
    root.traverse((c) => {
      if (c.isSkinnedMesh && c.material) skinMaterial(c.material);
    });
  }

  // --- Curl + give animation state ---
  let curl = 0;
  let curlTarget = 0;
  let curlSpeed = 6;
  let catchT = -1;
  let dropT = -1;
  const give = { y: 0, z: 0, rotX: 0 };
  const basePos = new THREE.Vector3();

  // Per-finger contact limits: at the catch instant we scan curl values with
  // forward kinematics and cap each finger where any of its joints would meet
  // the ball, so fingers close onto the surface instead of passing through
  // it. The clearance equals the finger mesh thickness so the skin rests
  // exactly on the ball — no visible gap, no clipping.
  const curlLimits = {};
  for (const key of Object.keys(scanJoints)) curlLimits[key] = 1;

  const CONTACT_CLEARANCE = 0.1; // ball radius + finger skin thickness
  const ANCHOR_PALM = 0.08; // ball centre offset along the palm normal
  const ANCHOR_UP = 0.025; // vertical lift out of the cup floor
  const ANCHOR_FWD = 0.01; // forward offset toward the camera
  const SCAN_STEP = 0.025;
  // The ball anchors rigidly in the cup, so the contact geometry is identical
  // for every catch — scanning once is enough. The first scan almost always
  // happens during attract mode, before real gameplay begins.
  let limitsComputed = false;
  function computeContactLimits() {
    if (limitsComputed) return;
    limitsComputed = true;
    // Where the ball will sit once settled in the cup (give motion decayed)
    _v.set(
      group.position.x + PALM_NORMAL.x * ANCHOR_PALM,
      group.position.y + PALM_NORMAL.y * ANCHOR_PALM + ANCHOR_UP,
      group.position.z + PALM_NORMAL.z * ANCHOR_PALM + ANCHOR_FWD,
    );
    const firstContact = {};
    const resting = {};
    // A finger's joints depend only on its own chain, so posing every chain
    // at the same curl value yields correct per-finger positions in one pass.
    for (let c = 0.1; c <= 1.001; c += SCAN_STEP) {
      for (const b of bones) {
        b.bone.quaternion.slerpQuaternions(b.open, b.caught, c);
      }
      model.updateMatrixWorld(true);
      for (const [key, joints] of Object.entries(scanJoints)) {
        if (firstContact[key] !== undefined) continue;
        for (let ji = 0; ji < joints.length; ji++) {
          if (resting[key + ji]) continue;
          const e = joints[ji].matrixWorld.elements;
          const dx = e[12] - _v.x;
          const dy = e[13] - _v.y;
          const dz = e[14] - _v.z;
          if (Math.sqrt(dx * dx + dy * dy + dz * dz) < CONTACT_CLEARANCE) {
            if (c < 0.15) {
              // Already touching when the hand is open: resting contact, not
              // curl-induced — the finger should still close onto the ball.
              resting[key + ji] = true;
              continue;
            }
            firstContact[key] = c;
            break;
          }
        }
      }
    }
    for (const key of Object.keys(scanJoints)) {
      // Back off half a scan step: the skin presses lightly against the
      // surface — visible contact with no air gap, no silhouette clipping.
      curlLimits[key] =
        firstContact[key] === undefined
          ? 1
          : Math.max(0.1, firstContact[key] - SCAN_STEP / 2);
    }
  }
  const reducedMotion =
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;

  function update(dt, ballPos, ballInFlight) {
    if (ballInFlight && ballPos) {
      const d = _v.copy(ballPos).distanceTo(group.position);
      if (d < 0.8) {
        curlTarget = -0.12;
        curlSpeed = 8;
      }
    }
    if (catchT >= 0) {
      catchT += dt;
      // Snap shut fast, hold while the ball is shown in the cup (the result
      // phase hides it at ~1s), then open back up well before the next ball.
      if (catchT < 0.08) {
        curlTarget = 0.9;
        curlSpeed = 20;
      } else if (catchT < 1.0) {
        curlTarget = 0.8;
        curlSpeed = 8;
      } else {
        curlTarget = 0;
        curlSpeed = 4;
      }
      if (catchT > 1.6) catchT = -1;
    }
    if (dropT >= 0) {
      dropT += dt;
      curlTarget = dropT < 0.07 ? 0.4 : 0;
      curlSpeed = dropT < 0.07 ? 18 : 6;
      if (dropT > 0.45) dropT = -1;
    }
    curl += (curlTarget - curl) * Math.min(1, curlSpeed * dt);
    for (const b of bones) {
      b.bone.quaternion.slerpQuaternions(
        b.open,
        b.caught,
        Math.min(curl, curlLimits[b.finger] ?? 1),
      );
    }

    let gy = 0;
    if (catchT >= 0) {
      const peak = easeOutCubic(clamp01(catchT / 0.1));
      const rec = 1 - easeInOut(clamp01((catchT - 0.1) / 0.4));
      const k = peak * rec;
      give.z = 0.07 * k;
      give.y = -0.03 * k;
      give.rotX = 0.15 * k;
      if (!reducedMotion && catchT > 0.5) {
        gy = 0.04 * Math.sin(((catchT - 0.5) / 0.5) * Math.PI);
      }
    } else {
      give.z = give.y = give.rotX = 0;
    }
    model.position.set(
      basePos.x,
      basePos.y + give.y + gy,
      basePos.z + give.z,
    );
    model.rotation.x = give.rotX;
  }

  function reset() {
    curl = 0;
    curlTarget = 0;
    catchT = -1;
    dropT = -1;
    give.y = give.z = give.rotX = 0;
  }

  return {
    group,
    update,
    reset,
    debugState() {
      return { curl, curlTarget, catchT, limits: { ...curlLimits } };
    },
    catch() {
      catchT = 0;
      dropT = -1;
      computeContactLimits();
    },
    drop() {
      dropT = 0;
      catchT = -1;
    },
    ballAnchor(target) {
      // Ball rests in the cup but high enough that ~1/4 of it shows above
      // the finger line: palm plane + a bit of forward and up
      return target.set(
        group.position.x + PALM_NORMAL.x * ANCHOR_PALM,
        group.position.y + PALM_NORMAL.y * ANCHOR_PALM + give.y + ANCHOR_UP,
        group.position.z + PALM_NORMAL.z * ANCHOR_PALM + give.z + ANCHOR_FWD,
      );
    },
  };
}
