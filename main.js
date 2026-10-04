import * as THREE from "three";
// Import GLB assets so Vite includes them in the build output
import handsModelUrl from "./assets/hands_model.glb?url";
import handsAnimationsUrl from "./assets/hands_animations.glb?url";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as CANNON from "cannon-es";
import { setupStadium } from "./src/stadium.js";
import { setupFloodlights } from "./src/lights.js";
import { createEffects } from "./src/effects.js";
import { createUI } from "./src/ui.js";
import { createAudio } from "./src/audio.js";
import {
  planDelivery,
  catchZone,
  HANDS_Z,
  BALL_MASS,
} from "./src/delivery.js";

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
  ball,
  ballBody,
  mixer,
  ui,
  audio,
  effects,
  releaseFlash;
let openActionR, catchActionR, openActionL, catchActionL;
let stadium = null;
let floodlights = null;

// Game state
// screen: "title" | "flyin" | "play" | "gameover"
// phase:  "ready" | "flight" | "result" (timers in game-time seconds)
let screen = "title";
let phase = "ready";
let phaseT = 0;
let paused = false;
let score = 0;
let streak = 0;
let multiplier = 1;
let lives = 3;
let catches = 0;
let difficulty = 0;
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
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
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

  // Ball
  ball = new THREE.Group();
  const ballGeometry = new THREE.SphereGeometry(0.1, 16, 16);
  const ballMaterial = new THREE.MeshStandardMaterial({
    map: createBallTexture(),
    roughness: 0.35,
    emissive: 0xb3121a, // faint self-glow so the ball reads in the dark
    emissiveIntensity: 0.15,
  });
  const ballSphere = new THREE.Mesh(ballGeometry, ballMaterial);
  ball.add(ballSphere);

  const seamGeometry = new THREE.TorusGeometry(0.1, 0.012, 12, 60);
  const seamMaterial = new THREE.MeshStandardMaterial({
    color: 0xf5f0e6,
    roughness: 0.6,
  });
  const seam = new THREE.Mesh(seamGeometry, seamMaterial);
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

  // Player Hands
  const loader = new GLTFLoader();
  loader.load(
    handsModelUrl,
    (gltf) => {
      console.log("Base model loaded successfully.");
      playerHands = gltf.scene;
      // ~0.26 m of hand at 0.8 m from camera ≈ 20% of frame height
      playerHands.scale.set(0.22, 0.22, 0.22);
      const zone = deliveryZone();
      playerHands.position.set(
        (zone.xMin + zone.xMax) / 2,
        (zone.yMin + zone.yMax) / 2,
        HANDS_Z,
      );
      playerHands.traverse((child) => {
        if (child.isMesh && child.material) {
          child.material.roughness = 0.55;
          child.material.metalness = 0;
        }
      });

      // Jersey sleeve fallback: only add procedural cuffs if the GLB
      // doesn't already include them (re-export via Blender script)
      const hasSleeves =
        playerHands.getObjectByName("Sleeve.R") ||
        playerHands.getObjectByName("Sleeve.L");
      if (!hasSleeves) {
        const sleeveMaterial = new THREE.MeshStandardMaterial({
          color: 0x041c6b,
          roughness: 0.7,
        });
        ["R", "L"].forEach((side) => {
          const palm = playerHands.getObjectByName(`Palm.${side}`);
          if (palm) {
            const sleeve = new THREE.Mesh(
              new THREE.CylinderGeometry(0.85, 0.95, 0.9, 24),
              sleeveMaterial,
            );
            sleeve.rotation.x = Math.PI / 2;
            sleeve.position.set(0, 0, -1.35);
            palm.add(sleeve);
          }
        });
      }
      scene.add(playerHands);

      const animLoader = new GLTFLoader();
      animLoader.load(
        handsAnimationsUrl,
        (animGltf) => {
          console.log("Animations loaded successfully.");
          mixer = new THREE.AnimationMixer(playerHands);
          const clips = animGltf.animations;

          const openClipR = THREE.AnimationClip.findByName(
            clips,
            "Pose-Open.R",
          );
          const catchClipR = THREE.AnimationClip.findByName(
            clips,
            "Pose-Catch.R",
          );
          const openClipL = THREE.AnimationClip.findByName(
            clips,
            "Pose-Open.L",
          );
          const catchClipL = THREE.AnimationClip.findByName(
            clips,
            "Pose-Catch.L",
          );

          if (openClipR && catchClipR && openClipL && catchClipL) {
            openActionR = mixer.clipAction(openClipR);
            catchActionR = mixer.clipAction(catchClipR);
            openActionL = mixer.clipAction(openClipL);
            catchActionL = mixer.clipAction(catchClipL);

            openActionR.setLoop(THREE.LoopRepeat);
            openActionL.setLoop(THREE.LoopRepeat);

            // Slow down catch animations by 10% (0.9 timeScale = 10% slower)
            catchActionR.timeScale = 0.9;
            catchActionL.timeScale = 0.9;

            openActionR.play();
            openActionL.play();

            catchActionR.setLoop(THREE.LoopOnce);
            catchActionR.clampWhenFinished = true;
            catchActionL.setLoop(THREE.LoopOnce);
            catchActionL.clampWhenFinished = true;

            playerHands.visible = true;
            console.log("Animation actions created and hands are now visible.");
          } else {
            console.error("One or more animation clips are missing!");
          }
        },
        undefined,
        (error) => {
          console.error("ERROR: Failed to load hands_animations.glb:", error);
        },
      );
    },
    undefined,
    (error) => {
      console.error("An error happened while loading the model:", error);
    },
  );

  // UI + audio
  audio = createAudio();
  ui = createUI({ onStart, onRestart, onToggleMute });
  ui.setMuted(audio.isMuted());
  ui.setBest(best);

  // Event Listeners
  window.addEventListener("resize", onWindowResize, false);
  document.addEventListener("mousemove", onMouseMove, false);
  document.addEventListener("touchstart", onTouchMove, { passive: false });
  document.addEventListener("touchmove", onTouchMove, { passive: false });
  document.addEventListener("visibilitychange", onVisibilityChange);

  computeHandsWindow();

  // Debug hooks (?debug only): state handle + effect keys W/F/M
  if (debugMode) {
    window.__debug = {
      get hands() {
        return playerHands;
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
        return { screen, phase, score, lives, streak };
      },
      scene,
      camera,
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
  moveHands(event.clientX, event.clientY);
}

function onTouchMove(event) {
  event.preventDefault();
  const touch = event.touches[0];
  if (touch) {
    moveHands(touch.clientX, touch.clientY);
  }
}

function onVisibilityChange() {
  if (document.hidden) {
    paused = true;
    audio.suspend();
  } else {
    paused = false;
    audio.resume();
    // Discard the paused gap so physics/timers don't lurch forward
    clock.getDelta();
    lastFrameTime = performance.now();
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
  } else {
    flyFrom.pos.copy(camera.position);
    flyFrom.quat.copy(camera.quaternion);
    flyT = 0;
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
  hadNewBest = false;
  ui.hideGameOver();
  ui.setScore(0);
  ui.setStreak(0, 1);
  ui.setLives(lives, 3);
  ui.setBest(best);
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
  delivery = planDelivery({ difficulty, window: deliveryZone() });
  isBallCaught = false;

  ballBody.position.set(
    delivery.start.x,
    delivery.start.y,
    delivery.start.z,
  );
  ballBody.velocity.set(
    delivery.velocity.x,
    delivery.velocity.y,
    delivery.velocity.z,
  );
  ballBody.angularVelocity.set(-6, (Math.random() - 0.5) * 4, 0);
  ballBody.wakeUp();
  ball.visible = true;
  ball.position.copy(ballBody.position);

  // Release flash
  releaseFlash.material.opacity = 0.9;

  if (screen === "play") audio.playRelease();

  // Autopilot target for attract mode (slight imperfection)
  autoTarget.set(
    delivery.crossing.x + (Math.random() - 0.5) * 0.25,
    delivery.crossing.y + (Math.random() - 0.5) * 0.25,
    HANDS_Z,
  );

  // Reset hands to open pose for the new round
  if (mixer) {
    catchActionR.stop();
    catchActionL.stop();
    openActionR.reset().play();
    openActionL.reset().play();
  }
}

function onCatch() {
  isBallCaught = true;
  ballBody.sleep();
  ballBody.velocity.set(0, 0, 0);
  ballBody.angularVelocity.set(0, 0, 0);

  effects.burst(ball.position);
  effects.shake(0.5);

  if (catchActionR && openActionR && catchActionL && openActionL) {
    openActionR.stop();
    openActionL.stop();
    catchActionR.reset().play();
    catchActionL.reset().play();
  }

  if (screen === "play") {
    catches++;
    streak++;
    multiplier = Math.min(1 + Math.floor(streak / 3), 5);
    score += multiplier;
    difficulty = Math.min(1, catches / 30);
    const isScreamer =
      Math.abs(delivery.swingDisp) > 0.6 || delivery.flightTime < 1.0;
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
    ui.popMessage(isScreamer ? "SCREAMER!" : "CAUGHT!", "good");
    audio.playCatch();
    audio.playCheer(Math.min(1, 0.4 + streak * 0.1));
    stadium.triggerWave();
    stadium.triggerFlashBurst();
    stadium.setBoardMessage(isScreamer ? "SCREAMER!" : "CAUGHT!", 1500);
  }
  setPhase("result");
}

function onDrop() {
  ball.visible = false;
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
  const deltaTime = Math.min(clock.getDelta(), 0.1);
  const elapsed = clock.elapsedTime;

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
      }
    }

    // --- Phase machine ---
    if (phase === "ready") {
      ball.visible = false;
      ballBody.sleep();
      ballBody.position.set(0, 1.5, -6);
      if (phaseT >= readyTarget) {
        setPhase("flight");
        releaseBall();
      }
    } else if (phase === "flight") {
      world.step(1 / 60, deltaTime, 3);

      if (!isBallCaught) {
        ball.position.copy(ballBody.position);
        ball.quaternion.copy(ballBody.quaternion);
      } else if (playerHands) {
        // Keep ball attached to hands when caught
        ball.position.copy(playerHands.position);
        ball.position.z += 0.05;
        ball.position.y -= 0.02;
      }

      // Attract autopilot: hands drift to the crossing
      if (screen === "title" && playerHands) {
        playerHands.position.lerp(autoTarget, Math.min(1, deltaTime * 4));
      }

      if (playerHands && !isBallCaught) {
        const distance = playerHands.position.distanceTo(ball.position);
        if (distance < 0.35 && ballBody.position.z < HANDS_Z + 0.6) {
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
      if (isBallCaught && playerHands) {
        ball.position.copy(playerHands.position);
        ball.position.z += 0.05;
        ball.position.y -= 0.02;
      }
      if (phaseT >= 1.0 && screen !== "gameover") {
        setPhase("ready");
        ball.visible = false;
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

  // Update the animation mixer on every frame
  if (mixer) {
    mixer.update(deltaTime);
  }

  if (stadium) {
    stadium.update(elapsed);
  }
  if (floodlights) {
    floodlights.update(elapsed);
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

// Vite HMR is now handled by the framework's default, faster mechanism.
