import * as THREE from "three";

// WebXR generic-hand model (MIT, (c) 2019 Amazon) — assets/hands/.
// Joints arrive FLAT under Armature; we re-parent them into real chains
// with attach() (world transforms preserved, verified) so they can curl.

// ~0.26 m of hand at 0.8 m from camera ≈ 20% of frame height
const HAND_SCALE = 1.6;
// Palm centres sit this far apart around the group origin (model units)
const HAND_SPREAD = 0.08;
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
  metacarpal: [0, 20],
  "phalanx-proximal": [10, 75],
  "phalanx-intermediate": [10, 90],
  "phalanx-distal": [0, 60],
  tip: [0, 30],
};
const THUMB_DEG = {
  metacarpal: [0, 15],
  "phalanx-proximal": [0, 35],
  "phalanx-distal": [0, 40],
  tip: [0, 20],
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
function rigHand(gltfScene, bones) {
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

  for (const chain of Object.values(CHAINS)) {
    const table = chain[0].startsWith("thumb") ? THUMB_DEG : CURL_DEG;
    for (const name of chain) {
      const bone = gltfScene.getObjectByName(name);
      if (!bone) continue;
      const [openDeg, catchDeg] = table[jointTail(name)] || [0, 0];
      if (openDeg === 0 && catchDeg === 0) continue;
      const open = bone.quaternion.clone();
      _rx.setFromAxisAngle(_axisX, (openDeg * sign * Math.PI) / 180);
      const openQ = open.clone().multiply(_rx);
      _rx.setFromAxisAngle(_axisX, (catchDeg * sign * Math.PI) / 180);
      const caught = open.clone().multiply(_rx);
      bones.push({ bone, open: openQ, caught });
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
  let gateDiff = 0;
  const wrists = [];

  for (const [side, gltfScene] of [
    ["right", right],
    ["left", left],
  ]) {
    const rig = rigHand(gltfScene, bones);
    gateDiff = Math.max(gateDiff, rig.maxDiff);
    wrists.push(rig.wrist);

    const pivot = new THREE.Group();
    pivot.quaternion.copy(rig.R);
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
    inModel.x -= side === "right" ? -HAND_SPREAD / 2 : HAND_SPREAD / 2;
    pivot.position.sub(inModel);
  }
  console.log("hands: re-parent gate maxDiff =", gateDiff.toExponential(3));

  // --- Forearm sleeves: children of each wrist, extending away from palm ---
  const sleeveMat = new THREE.MeshStandardMaterial({
    color: 0x1b3f9e,
    roughness: 0.7,
  });
  const bandMat = new THREE.MeshStandardMaterial({
    color: 0x4a6fd4,
    roughness: 0.6,
  });
  model.updateMatrixWorld(true);
  for (const wrist of wrists) {
    // Forearm direction in world = down and slightly toward the viewer
    const dirWorld = new THREE.Vector3(0, -0.94, 0.34).normalize();
    const wristPos = wrist.getWorldPosition(new THREE.Vector3());
    const dirLocal = wrist
      .worldToLocal(wristPos.clone().add(dirWorld))
      .normalize();
    const sleeve = new THREE.Group();
    sleeve.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, -1, 0),
      dirLocal,
    );
    const tube = new THREE.Mesh(
      new THREE.CylinderGeometry(0.036, 0.028, 0.19, 20),
      sleeveMat,
    );
    tube.position.y = -0.095;
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.037, 0.037, 0.02, 20),
      bandMat,
    );
    band.position.y = -0.012;
    sleeve.add(tube, band);
    wrist.add(sleeve);
  }

  // --- Skin on the hand meshes only (sleeves keep their jersey material) ---
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
      // Snap shut fast, settle to a wrap that keeps the ball visible
      curlTarget = catchT < 0.08 ? 1.0 : 0.82;
      curlSpeed = catchT < 0.08 ? 20 : 8;
      if (catchT > 1.0) catchT = -1;
    }
    if (dropT >= 0) {
      dropT += dt;
      curlTarget = dropT < 0.07 ? 0.4 : 0;
      curlSpeed = dropT < 0.07 ? 18 : 6;
      if (dropT > 0.45) dropT = -1;
    }
    curl += (curlTarget - curl) * Math.min(1, curlSpeed * dt);
    for (const b of bones) {
      b.bone.quaternion.slerpQuaternions(b.open, b.caught, curl);
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
    catch() {
      catchT = 0;
      dropT = -1;
    },
    drop() {
      dropT = 0;
      catchT = -1;
    },
    ballAnchor(target) {
      // Ball rests in the cup but high enough that ~1/4 of it shows above
      // the finger line: palm plane + a bit of forward and up
      return target.set(
        group.position.x + PALM_NORMAL.x * 0.1,
        group.position.y + PALM_NORMAL.y * 0.1 + give.y + 0.04,
        group.position.z + PALM_NORMAL.z * 0.1 + give.z + 0.02,
      );
    },
  };
}
