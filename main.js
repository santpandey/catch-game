import * as THREE from "three";
// Import GLB assets so Vite includes them in the build output
import handsLeftUrl from "./assets/hands/xr-hand-left.glb?url";
import handsRightUrl from "./assets/hands/xr-hand-right.glb?url";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createHands } from "./src/hands.js";
import * as CANNON from "cannon-es";
import { setupStadium } from "./src/stadium.js";
import { setupFloodlights } from "./src/lights.js";
import { createEffects } from "./src/effects.js";
import { createUI } from "./src/ui.js";
import { createAudio } from "./src/audio.js";
import {
  planDelivery,
  catchZone,
  paceForCatches,
  HANDS_Z,
  BALL_MASS,
} from "./src/delivery.js";
import {
  THROWER_POS,
  BAT_CONTACT,
  LEG_A_TIME,
  legAPosition,
  createBat,
} from "./src/drill.js";

// --- URL params ---
const urlParams = new URLSearchParams(window.location.search);
const debugMode = urlParams.has("debug");
const shotMode = urlParams.get("shot"); // null | "" | "title"

// --- Global Variables ---
let scene,
  camera,
  renderer,
  world,
  playerHands,
  hands,
  ball,
  ballBody,
  ui,
  audio,
  effects,
  releaseFlash;
let stadium = null;
let floodlights = null;
let drillBat = null;

// Game state
// screen: "title" | "flyin" | "play" | "gameover"
// phase:  "ready" | "flight" | "result" (timers in game-time seconds)
let screen = "title";
let phase = "ready";
let phaseT = 0;
let hiddenPaused = false; // tab hidden
let userPaused = false; // player toggle (P / Esc / pause button)
let paused = false; // either source
let pauseRenderedOnce = false;
let gameElapsed = 0; // unpaused game-time seconds for ambient anims
let score = 0;
let streak = 0;
let multiplier = 1;
let lives = 3;
let catches = 0;
let difficulty = 0;
let paceLevel = 0;
let best = 0;
let hadNewBest = false;
try {
  best = parseInt(localStorage.getItem("slipcatch.best"), 10) || 0;
} catch (e) {}
let delivery = null;
let isBallCaught = false;
const swingForce = new CANNON.Vec3(0, 0, 0);

// Hands window at the z = HANDS_Z plane (recomputed on resize)
const handsWindow = { xMin: -1, xMax: 1, yMin: 0.2, yMax: 1.8 };
const raycaster = new THREE.Raycaster();
const handsPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -HANDS_Z);
const _ndc = new THREE.Vector2();
const _hit = new THREE.Vector3();

// Camera fly-in (title -> slip pose)
const PLAY_POS = new THREE.Vector3(0, 1.5, 5);
const PLAY_QUAT = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(0.11, 0, 0),
);
let flyFrom = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
let flyT = 0;
const FLY_DURATION = 1.8;

// Attract-mode autopilot: hands chase the predicted crossing with lag
const autoTarget = new THREE.Vector3();

// Upright-seam orientation: the ball's visual rotation is procedural, not
// from the physics body. The seam ring plane stays vertical (perpendicular
// to the ground) — yawed to the release direction with a slight tilt
// towards the swing side, like a seam bowler's grip — while backspin
// rotates within the seam plane so the ring reads as gyroscopically stable.
const seamBaseQuat = new THREE.Quaternion();
const seamSpinQuat = new THREE.Quaternion();
const seamBaseEuler = new THREE.Euler();
const SEAM_SPIN_RATE = -30; // rad/s backspin around the seam normal
const SEAM_SWING_TILT = 0.35; // rad yaw tilt towards the swing direction
const X_AXIS = new THREE.Vector3(1, 0, 0);
let seamSpinAngle = 0;

// --- Ball Leather Texture ---
function createBallTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#b3121a"; // bright cherry red so it pops at night
  ctx.fillRect(0, 0, 128, 128);
  // Leather grain: fine speckles of lighter/darker red
  for (let i = 0; i < 3000; i++) {
    ctx.fillStyle =
      Math.random() > 0.5 ? "rgba(255,140,140,0.05)" : "rgba(40,0,0,0.08)";
    ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  // Groove shading along the texture equator (v = 0.5). The sphere mesh is
  // rotated so this line coincides with the seam ring plane — the leather
  // reads as pressed into a channel either side of the seam, like a real
  // ball. Spin about the seam normal keeps the equator invariant.
  const eq = 64;
  const groove = ctx.createLinearGradient(0, eq - 13, 0, eq + 13);
  groove.addColorStop(0, "rgba(0,0,0,0)");
  groove.addColorStop(0.28, "rgba(60,0,0,0.38)");
  groove.addColorStop(0.5, "rgba(30,0,0,0.5)");
  groove.addColorStop(0.72, "rgba(60,0,0,0.38)");
  groove.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = groove;
  ctx.fillRect(0, eq - 13, 128, 26);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// --- Seam Stitch Texture ---
// Reproduces the real thing: the band is red leather, and the white is only
// the thread. Six rows total — a dense cross-stitched centre cord over the
// leather join, flanked by pairs of simple chain-stitch rows — each stitch a
// discrete slanted strand with red showing through the gaps, hand-stitch
// jitter included. Painted once at startup (zero per-frame cost) and reused
// as both colour map and bump map; texture size and draw calls unchanged.
function createSeamTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");

  // Red leather base — slightly darker than the ball since the seam band
  // sits in the pressed groove, darkening further towards the edges.
  ctx.fillStyle = "#a01017";
  ctx.fillRect(0, 0, 1024, 128);
  const bed = ctx.createLinearGradient(0, 0, 0, 128);
  bed.addColorStop(0, "rgba(25,0,0,0.55)");
  bed.addColorStop(0.3, "rgba(25,0,0,0.15)");
  bed.addColorStop(0.5, "rgba(255,60,60,0.08)");
  bed.addColorStop(0.7, "rgba(25,0,0,0.15)");
  bed.addColorStop(1, "rgba(25,0,0,0.55)");
  ctx.fillStyle = bed;
  ctx.fillRect(0, 0, 1024, 128);
  // leather grain speckle, matching the ball texture
  for (let i = 0; i < 1200; i++) {
    ctx.fillStyle =
      Math.random() > 0.5 ? "rgba(255,140,140,0.05)" : "rgba(40,0,0,0.09)";
    ctx.fillRect(Math.random() * 1024, Math.random() * 128, 2, 2);
  }

  // Deterministic jitter so the texture is stable frame to frame
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  ctx.lineCap = "round";
  // One hand-stitched strand: shadow pass then lit pass, slight taper.
  function stitch(x, y, len, angle, w, bright) {
    const dx = Math.cos(angle) * len * 0.5;
    const dy = Math.sin(angle) * len * 0.5;
    ctx.strokeStyle = "rgba(70,25,10,0.55)";
    ctx.lineWidth = w + 1.4;
    ctx.beginPath();
    ctx.moveTo(x - dx + 1, y - dy + 1.2);
    ctx.lineTo(x + dx + 1, y + dy + 1.2);
    ctx.stroke();
    ctx.strokeStyle = bright;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x - dx, y - dy);
    ctx.lineTo(x + dx, y + dy);
    ctx.stroke();
  }

  // Chain-stitch rows: discrete slanted strands, evenly spaced with jitter.
  // ~80 stitches around the ring, like the real thing. Rows are symmetric
  // about the canvas centre (v=64); the wrap-shift at the end moves them
  // onto the tube crown — the only half of the tube outside the sphere.
  const rows = [
    { v: 64 - 23, n: 80, len: 11, lean: 0.5, w: 4.0 },
    { v: 64 + 23, n: 80, len: 11, lean: 0.5, w: 4.0 },
    { v: 64 - 12, n: 80, len: 11, lean: 0.5, w: 4.2 },
    { v: 64 + 12, n: 80, len: 11, lean: 0.5, w: 4.2 },
  ];
  for (const row of rows) {
    const step = 1024 / row.n;
    for (let i = 0; i < row.n; i++) {
      const x = i * step + step * 0.5 + (rand() - 0.5) * 1.6;
      const y = row.v + (rand() - 0.5) * 1.4;
      const lean = row.lean + (rand() - 0.5) * 0.16;
      stitch(x, y, row.len, Math.PI / 2 - lean, row.w, "rgba(253,248,232,0.98)");
    }
  }

  // Centre cord: two interlocked rows of cross-stitch over the leather join.
  // Strands alternate lean to form the X lattice, tighter and brighter here.
  const cn = 72;
  const cstep = 1024 / cn;
  for (let i = 0; i < cn; i++) {
    const x = i * cstep + cstep * 0.5 + (rand() - 0.5) * 1.2;
    const lean = 0.62 + (rand() - 0.5) * 0.12;
    // one strand of the X
    stitch(x, 58.5, 13, Math.PI / 2 - lean, 4.3, "rgba(255,251,236,0.99)");
    // opposite-lean strand offset half a step so the crosses interlock
    stitch(
      x + cstep * 0.5,
      69.5,
      13,
      Math.PI / 2 + lean,
      4.3,
      "rgba(255,251,236,0.99)",
    );
  }
  // leather join line peeking through the centre cord
  ctx.fillStyle = "rgba(40,0,0,0.35)";
  ctx.fillRect(0, 63, 1024, 2);

  // Torus UVs put the tube crown — the half of the seam actually outside
  // the sphere — at the v wrap boundary (uv.y = 0/1). The artwork is
  // painted centred in the canvas, so wrap-shift it by half the height to
  // centre it on that boundary.
  const off = document.createElement("canvas");
  off.width = 1024;
  off.height = 128;
  off.getContext("2d").drawImage(canvas, 0, 0);
  ctx.clearRect(0, 0, 1024, 128);
  ctx.drawImage(off, 0, 64);
  ctx.drawImage(off, 0, -64);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

// --- Visible window at the hands plane (four corner raycasts) ---
function computeHandsWindow() {
  // matrixWorld isn't valid until the first render — without this the
  // window is computed for an identity camera and the hands park
  // below the frame
  camera.updateMatrixWorld(true);
  let xMin = Infinity,
    xMax = -Infinity,
    yMin = Infinity,
    yMax = -Infinity;
  for (const ny of [-1, 1]) {
    for (const nx of [-1, 1]) {
      raycaster.setFromCamera(_ndc.set(nx, ny), camera);
      if (raycaster.ray.intersectPlane(handsPlane, _hit)) {
        xMin = Math.min(xMin, _hit.x);
        xMax = Math.max(xMax, _hit.x);
        yMin = Math.min(yMin, _hit.y);
        yMax = Math.max(yMax, _hit.y);
      }
    }
  }
  if (xMin !== Infinity) {
    handsWindow.xMin = xMin;
    handsWindow.xMax = xMax;
    handsWindow.yMin = yMin;
    handsWindow.yMax = yMax;
  }
}

// --- Initialization ---
function init() {
  // Scene (background + fog set by setupStadium to match the sky)
  scene = new THREE.Scene();

  // Camera
  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.01,
    1000,
  );
  camera.position.copy(PLAY_POS);
  camera.quaternion.copy(PLAY_QUAT);

  // Renderer
  renderer = new THREE.WebGLRenderer({
    canvas: document.querySelector("#bg"),
    antialias: true,
    powerPreference: "high-performance",
  });
  updateCameraFraming();
  renderer.setSize(window.innerWidth, window.innerHeight);
  // Cap DPR: bloom buffers scale with pixel ratio, full DPR freezes hi-DPI screens
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(0, 10, 5);
  scene.add(directionalLight);

  // Physics World
  world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -9.82, 0),
  });

  // Swing force must be applied on every internal substep, not once per
  // rendered frame
  world.addEventListener("preStep", () => {
    if (
      phase === "flight" &&
      delivery &&
      delivery.leg === "B" &&
      delivery.swingType !== "none" &&
      ballBody.position.z > delivery.swingStartZ
    ) {
      const dir =
        delivery.swingType === "reverse" &&
        ballBody.position.z >= delivery.reverseFlipZ
          ? -1
          : 1;
      swingForce.set(delivery.swingForceX * dir, 0, 0);
      ballBody.applyForce(swingForce);
    }
  });

  // Ground
  const groundBody = new CANNON.Body({
    type: CANNON.Body.STATIC,
    shape: new CANNON.Plane(),
  });
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  groundBody.position.y = -1;
  world.addBody(groundBody);

  // Stadium environment: sky dome, photo backdrop, outfield, pitch, stumps
  stadium = setupStadium(scene, renderer);

  // Roof floodlight glows + fake volumetric beams + dust motes
  floodlights = setupFloodlights(scene);

  // Feel effects: trail, burst, shake
  effects = createEffects(scene, camera);

  // Slip-drill staging: the angled bat the throw deflects off
  drillBat = createBat(scene);

  // Ball
  ball = new THREE.Group();
  // Visual scale 0.75: the 0.1m radius is nearly 3x a real cricket ball.
  // 15% reduction still read oversized in the cup; at 25% the ball nests
  // with the fingers wrapping over it. Physics body unchanged.
  ball.scale.setScalar(0.75);
  const ballGeometry = new THREE.SphereGeometry(0.1, 16, 16);
  const ballMaterial = new THREE.MeshStandardMaterial({
    map: createBallTexture(),
    roughness: 0.35,
    emissive: 0xb3121a, // faint self-glow so the ball reads in the dark
    emissiveIntensity: 0.15,
  });
  const ballSphere = new THREE.Mesh(ballGeometry, ballMaterial);
  // Sphere UV equator lies in the XZ plane by default; rotating the mesh
  // about Z puts it in the YZ plane — the same plane as the seam ring, so
  // the texture's groove shading wraps the ball right at the seam. Rotation
  // about the seam normal (X) leaves that plane invariant during backspin.
  ballSphere.rotation.z = Math.PI / 2;
  ball.add(ballSphere);

  const seamGeometry = new THREE.TorusGeometry(0.1, 0.012, 12, 60);
  // A round tube makes the seam far taller than a real one (12% of the
  // ball radius vs ~4% on leather). Squash the cross-section's radial
  // component — the height, in the ring plane — while leaving the width
  // alone, so the seam reads as the low wide ridge of the real thing.
  // One-time vertex edit at startup; UVs untouched, no runtime cost.
  {
    const squash = 0.42;
    const posAttr = seamGeometry.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      const theta = Math.atan2(y, x);
      const ux = Math.cos(theta);
      const uy = Math.sin(theta);
      const radial = x * ux + y * uy;
      const squashed = 0.1 + (radial - 0.1) * squash;
      posAttr.setX(i, squashed * ux);
      posAttr.setY(i, squashed * uy);
    }
    posAttr.needsUpdate = true;
    seamGeometry.computeVertexNormals();
  }
  const seamTexture = createSeamTexture();
  const seamMaterial = new THREE.MeshStandardMaterial({
    map: seamTexture,
    bumpMap: seamTexture,
    bumpScale: 0.6,
    roughness: 0.75,
    // The ball leather carries an emissive self-glow so it reads at night;
    // without matching treatment the unlit seam went dark against it high
    // in the flight. Reusing the same texture as emissiveMap keeps the
    // threads legible at distance — the cost is one extra texture sample
    // on a 240-triangle mesh, effectively free.
    emissiveMap: seamTexture,
    emissive: 0xffffff,
    emissiveIntensity: 0.32,
  });
  const seam = new THREE.Mesh(seamGeometry, seamMaterial);
  // Torus default lies in XY (normal Z). Rotate so the ring lies in the YZ
  // plane — the vertical plane containing the flight direction — making the
  // seam normal the horizontal X axis. Spinning the ball around X then
  // rotates the seam within its own plane: it never wobbles visually.
  seam.rotation.y = Math.PI / 2;
  ball.add(seam);
  scene.add(ball);

  ballBody = new CANNON.Body({
    mass: BALL_MASS,
    shape: new CANNON.Sphere(0.1),
  });
  // Planner assumes zero damping
  ballBody.linearDamping = 0;
  world.addBody(ballBody);

  // Small additive flash at the release point
  {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,240,210,0.9)");
    g.addColorStop(1, "rgba(255,240,210,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      opacity: 0,
    });
    mat.toneMapped = false;
    releaseFlash = new THREE.Sprite(mat);
    releaseFlash.scale.set(0.5, 0.5, 1);
    releaseFlash.position.set(0, 1.5, -6);
    scene.add(releaseFlash);
  }

  // Player Hands (WebXR generic-hand model, MIT)
  const loader = new GLTFLoader();
  Promise.all([
    loader.loadAsync(handsLeftUrl),
    loader.loadAsync(handsRightUrl),
  ])
    .then(([l, r]) => {
      console.log("Hand models loaded successfully.");
      hands = createHands({ left: l.scene, right: r.scene });
      playerHands = hands.group;
      const zone = deliveryZone();
      playerHands.position.set(
        (zone.xMin + zone.xMax) / 2,
        (zone.yMin + zone.yMax) / 2,
        HANDS_Z,
      );
      scene.add(playerHands);
    })
    .catch((error) => {
      console.error("An error happened while loading the model:", error);
    });

  // UI + audio
  audio = createAudio();
  ui = createUI({ onStart, onRestart, onToggleMute, onTogglePause: togglePause });
  ui.setMuted(audio.isMuted());
  ui.setBest(best);

  // Event Listeners
  window.addEventListener("resize", onWindowResize, false);
  document.addEventListener("mousemove", onMouseMove, false);
  document.addEventListener("touchstart", onTouchMove, { passive: false });
  document.addEventListener("touchmove", onTouchMove, { passive: false });
  document.addEventListener("visibilitychange", onVisibilityChange);
  document.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (e.code === "KeyP" || e.code === "Escape") togglePause();
  });

  computeHandsWindow();

  // Debug hooks (?debug only): state handle + effect keys W/F/M
  if (debugMode) {
    window.__debug = {
      get hands() {
        return playerHands;
      },
      get handsCtl() {
        return hands;
      },
      get ball() {
        return ball;
      },
      get ballBody() {
        return ballBody;
      },
      get delivery() {
        return delivery;
      },
      get state() {
        return { screen, phase, score, lives, streak, catches, difficulty, paceLevel };
      },
      // Test hook: jump to a catch count (recomputes difficulty + pace)
      setCatches(n) {
        catches = Math.max(0, Math.floor(n));
        difficulty = Math.min(1, catches / 30);
        paceLevel = paceForCatches(catches);
        ui.setPace(paceLevel);
      },
      scene,
      camera,
      renderer,
    };
    document.addEventListener("keydown", (e) => {
      if (!stadium) return;
      if (e.code === "KeyW") stadium.triggerWave();
      if (e.code === "KeyF") stadium.triggerFlashBurst();
      if (e.code === "KeyM") stadium.setBoardMessage("CAUGHT!", 1500);
    });
  }

  // Start: promo hides all DOM UI over the attract scene; ?shot jumps
  // straight into play; default shows the title
  if (shotMode === "promo") {
    document.getElementById("ui").style.display = "none";
  } else if (shotMode !== null && shotMode !== "title") {
    startPlay(true);
  } else {
    ui.showTitle(best);
  }
  animate();
}

// --- Event Handlers ---
// Portrait gets a wider horizontal FOV so the hands window stays usable
function updateCameraFraming() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.fov =
    camera.aspect < 1
      ? Math.min(
          100,
          Math.max(75, 2 * Math.atan(Math.tan(Math.PI / 180 * 35) / camera.aspect) * 180 / Math.PI),
        )
      : 75;
  camera.updateProjectionMatrix();
}

function onWindowResize() {
  updateCameraFraming();
  renderer.setSize(window.innerWidth, window.innerHeight);
  computeHandsWindow();
}

// Raycast the pointer onto the hands plane; palm centre sits under cursor
function moveHands(clientX, clientY) {
  _ndc.set(
    (clientX / window.innerWidth) * 2 - 1,
    -(clientY / window.innerHeight) * 2 + 1,
  );
  raycaster.setFromCamera(_ndc, camera);
  if (!raycaster.ray.intersectPlane(handsPlane, _hit)) return;
  if (playerHands) {
    playerHands.position.set(
      THREE.MathUtils.clamp(_hit.x, handsWindow.xMin, handsWindow.xMax),
      THREE.MathUtils.clamp(_hit.y, handsWindow.yMin, handsWindow.yMax),
      HANDS_Z,
    );
  }
}

function onMouseMove(event) {
  if (paused) return;
  moveHands(event.clientX, event.clientY);
}

function onTouchMove(event) {
  const t = event.target;
  // Taps on the UI overlays (title, pause, game over, buttons) must reach them
  // as clicks; preventDefault on touchstart would suppress the click on phones
  if (t && t.closest && t.closest("#ui")) return;
  if (paused) return;
  event.preventDefault();
  const touch = event.touches[0];
  if (touch) {
    moveHands(touch.clientX, touch.clientY);
  }
}

// --- Pause ---
function togglePause(next) {
  if (screen !== "play") return;
  const want = next === undefined ? !userPaused : !!next;
  if (want === userPaused) return;
  userPaused = want;
  paused = hiddenPaused || userPaused;
  if (userPaused) {
    ui.showPause();
    audio.suspend();
  } else {
    ui.hidePause();
    if (!hiddenPaused) {
      audio.resume();
      // Discard the paused gap so physics/timers don't lurch forward
      clock.getDelta();
      lastFrameTime = performance.now();
    }
  }
  ui.setPaused(userPaused);
}

function onVisibilityChange() {
  if (document.hidden) {
    hiddenPaused = true;
    paused = true;
    // Come back to the pause overlay, not a ball already in flight
    if (screen === "play" && !userPaused) {
      userPaused = true;
      ui.showPause();
      ui.setPaused(true);
    }
    audio.suspend();
  } else {
    hiddenPaused = false;
    paused = userPaused;
    if (!userPaused) {
      audio.resume();
      clock.getDelta();
      lastFrameTime = performance.now();
    }
  }
}

// --- Game flow ---
function startPlay(skipFly) {
  audio.unlock(); // resolves within ~1 s even on a hung device
  audio.setAmbience(0.35);
  ui.hideTitle();
  if (skipFly) {
    camera.position.copy(PLAY_POS);
    camera.quaternion.copy(PLAY_QUAT);
    screen = "play";
    phase = "ready";
    phaseT = 0;
    ui.showHud();
    ui.setPauseAvailable(true);
  } else {
    flyFrom.pos.copy(camera.position);
    flyFrom.quat.copy(camera.quaternion);
    flyT = 0;
    // Kill any attract-mode delivery the moment the player commits. It was
    // never their ball — left flying it either freezes mid-air (the phase
    // machine is paused during flyin) or vanishes right as play begins,
    // reading as "the first ball disappears". The first ball the player
    // sees must be their first real delivery.
    ball.visible = false;
    ballBody.sleep();
    isBallCaught = false;
    screen = "flyin";
  }
}

function onStart() {
  startPlay(false);
}

function onRestart() {
  score = 0;
  streak = 0;
  multiplier = 1;
  lives = 3;
  catches = 0;
  difficulty = 0;
  paceLevel = 0;
  hadNewBest = false;
  userPaused = false;
  paused = hiddenPaused;
  ui.hidePause();
  ui.setPauseAvailable(true);
  ui.hideGameOver();
  ui.setScore(0);
  ui.setStreak(0, 1);
  ui.setLives(lives, 3);
  ui.setBest(best);
  ui.setPace(0);
  ui.showHud();
  effects.reset();
  screen = "play";
  phase = "ready";
  phaseT = 0;
}

function onToggleMute() {
  audio.setMuted(!audio.isMuted());
  ui.setMuted(audio.isMuted());
}

// --- Round machine (game-time driven, no setTimeout) ---
let readyTarget = 1.0; // randomized 0.7-1.4 s per round
function setPhase(next) {
  phase = next;
  phaseT = 0;
  if (next === "ready") readyTarget = 0.7 + Math.random() * 0.7;
}

// Deliveries land low and central in the visible window (margins keep the
// hands model on screen)
function deliveryZone() {
  return catchZone(
    {
      xMin: handsWindow.xMin + 0.15,
      xMax: handsWindow.xMax - 0.15,
      yMin: handsWindow.yMin + 0.2,
      yMax: handsWindow.yMax - 0.15,
    },
    difficulty,
  );
}

function releaseBall() {
  // Leg B is planned first: the deflection's physics must exist before the
  // theatre begins so the handoff frame is a pure velocity swap. Leg A is
  // scripted — fixed-duration straight thrower→bat flight, no physics.
  delivery = planDelivery({
    difficulty,
    pace: paceLevel,
    window: deliveryZone(),
    start: { x: BAT_CONTACT.x, y: BAT_CONTACT.y, z: BAT_CONTACT.z },
  });
  delivery.leg = "A";
  delivery.legT = 0;
  isBallCaught = false;

  // Park the physics body at the thrower, asleep — leg A drives the mesh
  // directly and the body only wakes at the bat-contact handoff.
  ballBody.position.set(THROWER_POS.x, THROWER_POS.y, THROWER_POS.z);
  ballBody.velocity.set(0, 0, 0);
  ballBody.angularVelocity.set(0, 0, 0);
  ballBody.sleep();
  ball.visible = true;
  ball.position.copy(THROWER_POS);

  // Seam upright along the throw line for the theatre leg; re-oriented at
  // the handoff to the deflection direction.
  const throwDir = Math.atan2(
    BAT_CONTACT.x - THROWER_POS.x,
    BAT_CONTACT.z - THROWER_POS.z,
  );
  seamBaseEuler.set(0, throwDir, 0);
  seamBaseQuat.setFromEuler(seamBaseEuler);
  seamSpinAngle = 0;
  ball.quaternion.copy(seamBaseQuat);

  // Release flash at the thrower's hand
  releaseFlash.position.copy(THROWER_POS);
  releaseFlash.material.opacity = 0.9;

  if (screen === "play") audio.playRelease();

  // Autopilot target for attract mode (slight imperfection)
  autoTarget.set(
    delivery.crossing.x + (Math.random() - 0.5) * 0.25,
    delivery.crossing.y + (Math.random() - 0.5) * 0.25,
    HANDS_Z,
  );

  // Reset hands to open pose for the new round
  if (hands) hands.reset();
}

// Bat-contact handoff: the scripted throw arrives at the face, the ball is
// re-launched with the deflection plan's real physics, and the contact is
// sold with flash + knock + bat recoil. From here on the round is exactly
// the classic catch problem on a shorter, diagonal leg.
function launchLegB() {
  delivery.leg = "B";

  ballBody.position.set(BAT_CONTACT.x, BAT_CONTACT.y, BAT_CONTACT.z);
  ballBody.velocity.set(
    delivery.velocity.x,
    delivery.velocity.y,
    delivery.velocity.z,
  );
  ballBody.angularVelocity.set(0, 0, 0);
  ballBody.wakeUp();

  // Seam upright, yawed to the deflection direction; swinging deliveries
  // tilt the seam a touch towards the swing side.
  const v = delivery.velocity;
  const releaseYaw = Math.atan2(v.x, v.z);
  const tilt =
    delivery.swingType === "none"
      ? 0
      : Math.sign(delivery.swingForceX || 1) * SEAM_SWING_TILT;
  seamBaseEuler.set(0, releaseYaw + tilt, 0);
  seamBaseQuat.setFromEuler(seamBaseEuler);
  seamSpinAngle = 0;

  // Contact theatre — the illusion frame. Flash jumps to the bat face.
  releaseFlash.position.copy(BAT_CONTACT);
  releaseFlash.material.opacity = 0.9;
  drillBat.hit();
  if (screen === "play") audio.playBatContact();
}

function onCatch() {
  isBallCaught = true;
  ballBody.sleep();
  ballBody.velocity.set(0, 0, 0);
  ballBody.angularVelocity.set(0, 0, 0);

  effects.burst(ball.position);
  effects.shake(0.5);

  if (hands) hands.catch();

  if (screen === "play") {
    catches++;
    streak++;
    multiplier = Math.min(1 + Math.floor(streak / 3), 5);
    score += multiplier;
    difficulty = Math.min(1, catches / 30);
    const newPace = paceForCatches(catches);
    const paceUp = newPace > paceLevel;
    if (paceUp) {
      paceLevel = newPace;
      ui.setPace(paceLevel);
    }
    const isScreamer = Math.abs(delivery.swingDisp) > 0.95;
    ui.setScore(score);
    ui.setStreak(streak, multiplier);
    if (score > best) {
      best = score;
      hadNewBest = true;
      ui.setBest(best);
      try {
        localStorage.setItem("slipcatch.best", String(best));
      } catch (e) {}
    }
    stadium.setBest(best);
    // Milestone catches announce the speed-up instead of a plain CAUGHT —
    // the score/streak/burst still confirm the catch visually.
    const msg = paceUp ? "PACE UP!" : isScreamer ? "SCREAMER!" : "CAUGHT!";
    ui.popMessage(msg, paceUp ? "info" : "good");
    audio.playCatch();
    audio.playCheer(Math.min(1, 0.4 + streak * 0.1));
    stadium.triggerWave();
    stadium.triggerFlashBurst();
    stadium.setBoardMessage(msg, 1500);
  }
  setPhase("result");
}

function onDrop() {
  ball.visible = false;
  if (hands) hands.drop();
  if (screen === "play") {
    effects.shake(0.25);
    streak = 0;
    multiplier = 1;
    lives--;
    ui.setStreak(0, 1);
    ui.setLives(lives, 3);
    ui.popMessage("DROPPED", "bad");
    audio.playDrop();
    stadium.setBoardMessage("OOOH!", 1200);
    if (lives <= 0) {
      screen = "gameover";
      userPaused = false;
      paused = hiddenPaused;
      ui.hidePause();
      ui.setPauseAvailable(false);
      const isNewBest = hadNewBest;
      if (score > best) best = score;
      try {
        localStorage.setItem("slipcatch.best", String(best));
      } catch (e) {}
      stadium.setBest(best);
      ui.setBest(best);
      ui.showGameOver({ score, best, isNewBest, catches });
      setPhase("result");
      return;
    }
  }
  setPhase("result");
}

// --- Animation Loop ---
const clock = new THREE.Clock();
let lastFrameTime = performance.now();
const targetFPS = 60;
const frameInterval = 1000 / targetFPS;

function animate() {
  requestAnimationFrame(animate);

  const currentTime = performance.now();

  // Cap the whole frame at ~60 FPS: on 120/144Hz displays rAF fires 2x+
  // more often than the game needs, doubling GPU work for zero benefit.
  // Tolerance is 4ms (not 1ms): 60Hz rAF ticks jitter around 16.7ms and a
  // tighter threshold skips ~25% of real frames, reading as ~45 FPS
  if (currentTime - lastFrameTime < frameInterval - 4) {
    return;
  }
  lastFrameTime = currentTime;

  // Single delta read per frame, capped to survive tab-switch gaps
  // (window.__timeScale is a test-only slow-motion knob, default 1)
  const deltaTime =
    Math.min(clock.getDelta(), 0.1) * ((debugMode && window.__timeScale) || 1);
  const elapsed = clock.elapsedTime;

  // Paused: keep the canvas' last frame on screen — render it once, then
  // idle so a paused game costs no GPU.
  if (paused) {
    if (!pauseRenderedOnce) {
      pauseRenderedOnce = true;
      renderer.render(scene, camera);
    }
    return;
  }
  pauseRenderedOnce = false;
  gameElapsed += deltaTime;

  if (!paused) {
    phaseT += deltaTime;

    // --- Screen: attract-mode camera drift on the title ---
    if (screen === "title") {
      const t = elapsed;
      camera.position.set(
        Math.sin(t * 0.08) * 6,
        5.5 + Math.sin(t * 0.05) * 0.8,
        9 + Math.sin(t * 0.06) * 1.5,
      );
      camera.lookAt(0, -0.5, -7);
    } else if (screen === "flyin") {
      // easeInOutCubic flight to the slip pose
      flyT = Math.min(flyT + deltaTime / FLY_DURATION, 1);
      const e =
        flyT < 0.5 ? 4 * flyT * flyT * flyT : 1 - Math.pow(-2 * flyT + 2, 3) / 2;
      camera.position.lerpVectors(flyFrom.pos, PLAY_POS, e);
      camera.quaternion.slerpQuaternions(flyFrom.quat, PLAY_QUAT, e);
      if (flyT >= 1) {
        screen = "play";
        setPhase("ready");
        ui.showHud();
        ui.setPauseAvailable(true);
      }
    }

    // --- Phase machine ---
    // Frozen during the fly-in: a ready timer expiring mid-flight would
    // release a phantom ball into the camera transition.
    if (screen !== "flyin") {
      if (phase === "ready") {
      ball.visible = false;
      ballBody.sleep();
      ballBody.position.set(0, 1.5, -6);
      if (phaseT >= readyTarget) {
        setPhase("flight");
        releaseBall();
      }
    } else if (phase === "flight") {
      // Leg A: scripted theatre flight thrower→bat. The physics body stays
      // asleep; at the fixed arrival frame the ball is re-launched (leg B).
      if (delivery && delivery.leg === "A" && !isBallCaught) {
        delivery.legT += deltaTime;
        const t = Math.min(delivery.legT / LEG_A_TIME, 1);
        legAPosition(t, ball.position);
        seamSpinAngle += SEAM_SPIN_RATE * deltaTime;
        ball.quaternion
          .copy(seamBaseQuat)
          .multiply(seamSpinQuat.setFromAxisAngle(X_AXIS, seamSpinAngle));
        if (delivery.legT >= LEG_A_TIME) {
          launchLegB();
        }
      }

      world.step(1 / 60, deltaTime, 3);

      if (!isBallCaught && delivery && delivery.leg === "B") {
        ball.position.copy(ballBody.position);
        // Backspin around the seam normal — the ring rotates within its own
        // vertical plane, so the seam reads upright the whole way down.
        seamSpinAngle += SEAM_SPIN_RATE * deltaTime;
        ball.quaternion
          .copy(seamBaseQuat)
          .multiply(seamSpinQuat.setFromAxisAngle(X_AXIS, seamSpinAngle));
      } else if (isBallCaught && hands) {
        // Keep ball attached to hands when caught
        hands.ballAnchor(ball.position);
      }

      // Attract autopilot: hands drift to the crossing
      if (screen === "title" && playerHands) {
        playerHands.position.lerp(autoTarget, Math.min(1, deltaTime * 4));
      }

      if (playerHands && !isBallCaught && delivery && delivery.leg === "B") {
        // Planar distance at the hand plane — the z component inflated the
        // old spherical test into catches that visibly missed the hands.
        // Radius matches the visual span of the scaled-down pair.
        const _dx = ball.position.x - playerHands.position.x;
        const _dy = ball.position.y - playerHands.position.y;
        const distance = Math.hypot(_dx, _dy);
        // Tight z-window at the hand plane: without it the one-sided gate
        // (z < HANDS_Z + 0.6) is true for the whole of leg B, so a ball
        // lined up with the hands triggered the catch far before visually
        // arriving — the phantom catch. The ball must actually be AT the
        // plane, and the planar margin is reduced to match the cup.
        const _zIn = ballBody.position.z > HANDS_Z - 0.25 &&
          ballBody.position.z < HANDS_Z + 0.4;
        if (distance < 0.19 && _zIn) {
          onCatch();
        } else if (
          ballBody.position.z > HANDS_Z + 0.7 ||
          ballBody.position.y < -0.9 ||
          Math.abs(ballBody.position.x) > handsWindow.xMax + 1.5
        ) {
          onDrop();
        }
      }
    } else if (phase === "result") {
      if (isBallCaught && hands) {
        hands.ballAnchor(ball.position);
      }
      if (phaseT >= 1.0 && screen !== "gameover") {
        setPhase("ready");
        ball.visible = false;
      }
    }
    }

    // Release flash decay
    if (releaseFlash.material.opacity > 0) {
      releaseFlash.material.opacity = Math.max(
        0,
        releaseFlash.material.opacity - deltaTime * 3,
      );
      const s = 0.5 + (0.9 - releaseFlash.material.opacity) * 1.5;
      releaseFlash.scale.set(s, s, 1);
    }
  }

  // Bat contact-recoil animation
  if (drillBat) drillBat.update(deltaTime);

  // Update the hands (curl timeline, catch give) on every frame
  if (hands) {
    hands.update(
      deltaTime,
      ball.position,
      phase === "flight" && !isBallCaught,
    );
  }

  if (stadium) {
    stadium.update(gameElapsed);
  }
  if (floodlights) {
    floodlights.update(gameElapsed);
  }
  effects.update(
    deltaTime,
    ball.position,
    phase === "flight" && !isBallCaught,
  );
  effects.applyShake();

  renderer.render(scene, camera);
  fpsMonitor.frame();
}

// --- Performance Monitoring ---
// frame() is called once per rendered frame from animate(); update() runs
// on a timer and reports real FPS. The old version counted timer ticks,
// which made a healthy 60 FPS game report "FPS: 10".
const fpsMonitor = {
  frames: 0,
  lastTime: performance.now(),
  enabled: debugMode,

  frame() {
    if (this.enabled) this.frames++;
  },

  update() {
    const currentTime = performance.now();
    if (currentTime >= this.lastTime + 1000) {
      const fps = Math.round(
        (this.frames * 1000) / (currentTime - this.lastTime),
      );
      console.log(`FPS: ${fps}`);
      this.frames = 0;
      this.lastTime = currentTime;
    }
  },
};

// FPS monitoring only when ?debug is in the URL (console spam otherwise)
if (fpsMonitor.enabled) {
  setInterval(() => fpsMonitor.update(), 1000);
}

// --- Start Application ---
init();

// Service worker: offline play + instant repeat loads. Production only —
// in dev the SW would cache stale modules. Registered relative to the page
// so it also works under subpaths (itch.io, portal iframes).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
