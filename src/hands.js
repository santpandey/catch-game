import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Finger curl angles added on top of each bone's open pose, as a local-X
// rotation (matches the authored Pose-Catch difference in the Blender script).
const CURL_DEG = {
  Index1: 85,
  Middle1: 85,
  Ring1: 85,
  Pinky1: 85,
  Index2: 90,
  Middle2: 90,
  Ring2: 90,
  Pinky2: 90,
  Thumb1: 20, // authored 3 deg is too subtle to read as a wrap
};

// ~0.26 m of hand at 0.8 m from camera ≈ 20% of frame height
const MODEL_SCALE = 0.22;

const _rx = new THREE.Quaternion();
const _axisX = new THREE.Vector3(1, 0, 0);
const _v = new THREE.Vector3();

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

export function createHands(gltfScene) {
  const group = new THREE.Group();
  const model = gltfScene;
  model.scale.setScalar(MODEL_SCALE);
  group.add(model);

  // --- Bones + poses ---
  // Bone names repeat across both armatures, so they must be found by subtree.
  const bones = [];
  for (const side of ["R", "L"]) {
    const armature =
      model.getObjectByName(`Armature.${side}`) ||
      model.getObjectByName(`Armature${side}`);
    if (!armature) continue;
    armature.traverse((n) => {
      if (!n.isBone) return;
      // THREE dedupes the second armature's names with a _1 suffix
      const deg = CURL_DEG[n.name.replace(/_\d+$/, "")];
      if (deg === undefined) return;
      const open = n.quaternion.clone();
      _rx.setFromAxisAngle(_axisX, (deg * Math.PI) / 180);
      const caught = open.clone().multiply(_rx);
      bones.push({ bone: n, open, caught });
    });
  }

  // --- Skin material: warm, readable, cheap rim ---
  model.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const m = child.material;
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
    // Smooth out the low-poly facets; skin attributes survive the merge
    if (child.geometry && !child.geometry.userData.smoothed) {
      const merged = mergeVertices(child.geometry, 1e-4);
      merged.computeVertexNormals();
      child.geometry = merged;
      child.geometry.userData.smoothed = true;
    }
  });

  // --- Curl + give animation state ---
  let curl = 0;
  let curlTarget = 0;
  let curlSpeed = 6;
  let catchT = -1; // seconds since catch() (-1 = not catching)
  let dropT = -1;
  const give = { x: 0, y: 0, z: 0, rotX: 0 };
  const basePos = new THREE.Vector3();
  const baseRotX = 0;
  const reducedMotion =
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;

  function update(dt, ballPos, ballInFlight) {
    // Pre-contact spread: fingers open slightly past neutral as ball approaches
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
      // slerpQuaternions extrapolates fine for curl slightly outside 0..1
      b.bone.quaternion.slerpQuaternions(b.open, b.caught, curl);
    }

    // "Give" on catch: dip toward camera, recover, celebratory lift
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
      basePos.x + give.x,
      basePos.y + give.y + gy,
      basePos.z + give.z,
    );
    model.rotation.x = baseRotX + give.rotX;
  }

  function reset() {
    curl = 0;
    curlTarget = 0;
    catchT = -1;
    dropT = -1;
    give.x = give.y = give.z = give.rotX = 0;
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
      // Caught-ball position: palm centre + the catch give, in group space
      return target.set(
        group.position.x,
        group.position.y + give.y - 0.02,
        group.position.z + give.z + 0.05,
      );
    },
  };
}
