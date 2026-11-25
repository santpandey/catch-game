import * as THREE from "three";

// Slip-drill staging: the triangular geometry of the real practice drill.
// A thrower (off-frame left in Phase 1 — no characters yet) throws flat at
// a kneeling batsman's angled bat; the ball deflects off the face toward
// the hands. The bat never physically collides with the ball — leg A is a
// scripted fixed-duration straight flight (pure theater, synchronised by
// construction), and at the contact frame the ball is re-launched with
// real physics planned from the bat position (see main.js + delivery.js).

// Thrower release point — right edge of frame, mid-distance, chest height.
export const THROWER_POS = new THREE.Vector3(3.7, 1.65, -4.0);
// Bat-ball contact point — kneeling height, offset right of centre.
export const BAT_CONTACT = new THREE.Vector3(1.85, 0.62, -0.7);
// Leg A duration (s): fixed so the theatre is deterministic. Flat throw.
export const LEG_A_TIME = 0.85;
// Slight downward arc sag on leg A so the throw reads as a arm ball,
// not a laser — peak drop (m) at mid-flight, parabolic in/out.
const LEG_A_SAG = 0.12;

const _a = new THREE.Vector3();

// Scripted leg A position at t in [0,1]: straight thrower→bat line with a
// shallow gravity sag. Deterministic — no physics, no drift.
export function legAPosition(t, out) {
  out.lerpVectors(THROWER_POS, BAT_CONTACT, t);
  out.y -= LEG_A_SAG * 4 * t * (1 - t);
  return out;
}

// The bat as a floating prop: flat blade angled like the drill ramp plus a
// round handle. The face points up-and-back toward the incoming throw so
// the deflection forward-right toward the hands reads as the mirror
// direction — close enough to the reflection law that the eye never
// questions it.
export function createBat(scene) {
  const group = new THREE.Group();

  const wood = new THREE.MeshStandardMaterial({
    color: 0xe8d0a0,
    roughness: 0.65,
    metalness: 0,
  });
  const woodDark = new THREE.MeshStandardMaterial({
    color: 0x9c7a4e,
    roughness: 0.7,
  });
  const rubber = new THREE.MeshStandardMaterial({
    color: 0x222222,
    roughness: 0.9,
  });

  // Blade: 0.55m tall, 0.108m wide (regulation width), thin flat face
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.108, 0.55, 0.035), wood);
  blade.position.y = 0.275 + 0.28; // sits atop the handle length
  // V-edge: slight spine ridge down the back of the blade
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.02), woodDark);
  spine.position.set(0, blade.position.y, -0.028);
  // Handle: short cylinder above the blade
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.016, 0.014, 0.28, 10),
    rubber,
  );
  handle.position.y = 0.14;
  // Toe guard detail: thin dark strip at the blade bottom
  const toe = new THREE.Mesh(new THREE.BoxGeometry(0.108, 0.03, 0.037), woodDark);
  toe.position.y = blade.position.y - 0.26;

  group.add(blade, spine, handle, toe);
  group.scale.setScalar(1.35);

  // Orient: standing nearly upright, leaning back ~55° so the face is a
  // ramp the incoming throw can "hit", and yawed open toward the
  // camera/hands side — the edge naturally flies toward the cordon.
  group.rotation.order = "YXZ";
  group.rotation.y = -0.55; // open the face toward the camera side
  group.rotation.x = -0.95; // lean the blade back into ramp position

  // Anchor the blade's contact-centre at BAT_CONTACT: the group origin is
  // the handle base; shift so the blade's mid-face sits on the contact point
  const midFaceLocal = new THREE.Vector3(0, blade.position.y, 0.02);
  group.position.copy(BAT_CONTACT).sub(
    midFaceLocal.clone().applyEuler(group.rotation),
  );
  scene.add(group);

  // Contact recoil: small jolt backwards around the bat's own base at the
  // moment of impact, springing back over ~0.35 s. Driven from main loop.
  const baseQuat = group.quaternion.clone();
  const hitQuat = new THREE.Quaternion();
  const joltAxis = new THREE.Vector3(1, 0, 0);
  let recoilT = -1; // <0 idle

  return {
    group,
    // Trigger the contact jolt
    hit() {
      recoilT = 0;
    },
    update(dt) {
      if (recoilT < 0) return;
      recoilT += dt;
      const D = 0.35;
      if (recoilT >= D) {
        recoilT = -1;
        group.quaternion.copy(baseQuat);
        return;
      }
      // Fast kick back (~7°), damped spring return — reads as the ball
      // striking the face without any collision ever existing
      const t = recoilT / D;
      const kick = Math.sin(Math.min(t * 3, 1) * Math.PI) * (1 - t * 0.6);
      hitQuat.setFromAxisAngle(joltAxis, (-kick * 7 * Math.PI) / 180);
      group.quaternion.copy(baseQuat).multiply(hitQuat);
    },
  };
}
