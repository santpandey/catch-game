import * as THREE from "three";
// Try WebP first, fallback to PNG
import stadiumImage from "./assets/stadium.webp";
// Import GLB assets so Vite includes them in the build output
import handsModelUrl from "./assets/hands_model.glb?url";
import handsAnimationsUrl from "./assets/hands_animations.glb?url";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as CANNON from "cannon-es";

// --- Global Variables ---
let scene,
  camera,
  renderer,
  world,
  playerHands,
  ball,
  ballBody,
  scoreElement,
  mixer;
let openActionR, catchActionR, openActionL, catchActionL;
let score = 0;
let isBallInPlay = false;
let isBallCaught = false;
let swingType = "none";
let swingDelayZ = 0;
let initialSwingForce = new CANNON.Vec3(0, 0, 0);
const currentSwingForce = new CANNON.Vec3(0, 0, 0);

// --- Stadium Background Setup ---
function setupStadiumBackground() {
  const textureLoader = new THREE.TextureLoader();

  textureLoader.load(
    stadiumImage,
    (texture) => {
      // Cap anisotropy: 4 is visually identical to max for a backdrop, cheaper
      texture.anisotropy = Math.min(
        4,
        renderer.capabilities.getMaxAnisotropy(),
      );
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.repeat.x = -1;

      const radius = 40;
      const thetaLength = Math.PI * 1.1;
      const stadiumGeometry = new THREE.CylinderGeometry(
        radius,
        radius,
        45,
        64,
        1,
        true,
        Math.PI - thetaLength / 2,
        thetaLength,
      );
      const stadiumMaterial = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.BackSide,
      });

      const stadium = new THREE.Mesh(stadiumGeometry, stadiumMaterial);
      stadium.position.set(0, 9, 0);
      scene.add(stadium);

      console.log("✅ Stadium background loaded successfully");
    },
    undefined,
    (error) => {
      console.error("❌ Error loading stadium texture:", error);
      const fallbackGeometry = new THREE.PlaneGeometry(100, 40);
      const fallbackMaterial = new THREE.MeshBasicMaterial({ color: 0x0a1628 });
      const fallbackStadium = new THREE.Mesh(
        fallbackGeometry,
        fallbackMaterial,
      );
      fallbackStadium.position.set(0, 2, -15);
      scene.add(fallbackStadium);
      console.log("⚠️ Using fallback stadium background");
    },
  );
}

// --- Fake Glow Sprite (replaces UnrealBloomPass) ---
function createGlowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(255,252,230,0.85)");
  gradient.addColorStop(0.4, "rgba(255,248,210,0.25)");
  gradient.addColorStop(1, "rgba(255,248,210,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

// --- Floodlight Towers ---
function createFloodlightTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#101418";
  ctx.fillRect(0, 0, 256, 128);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 8; col++) {
      const x = 18 + col * 31.5;
      const y = 18 + row * 31;
      const gradient = ctx.createRadialGradient(x, y, 1, x, y, 12);
      gradient.addColorStop(0, "#ffffff");
      gradient.addColorStop(0.4, "#fff8d8");
      gradient.addColorStop(1, "rgba(255,248,216,0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return new THREE.CanvasTexture(canvas);
}

function setupFloodlights() {
  const lightTexture = createFloodlightTexture();
  const glowTexture = createGlowTexture();
  const poleMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a2f36,
    roughness: 0.8,
  });

  const positions = [
    { x: -18, z: -12, tilt: 0.35 },
    { x: 18, z: -12, tilt: 0.35 },
  ];

  positions.forEach(({ x, z, tilt }) => {
    const tower = new THREE.Group();

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.22, 20, 8),
      poleMaterial,
    );
    pole.position.y = 10;
    tower.add(pole);

    const headMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a1e24,
      emissive: 0xffffff,
      emissiveMap: lightTexture,
      emissiveIntensity: 3,
      map: lightTexture,
    });
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 1.8, 0.2),
      headMaterial,
    );
    head.position.y = 20.2;
    head.rotation.x = tilt;
    tower.add(head);

    // Additive glow sprite in front of the light panel
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        opacity: 0.9,
      }),
    );
    glow.scale.set(9, 5, 1);
    glow.position.set(0, 20.2, 0.4);
    tower.add(glow);

    tower.position.set(x, 0, z);
    scene.add(tower);
  });
}

// --- Outfield + Pitch ---
function createOutfieldTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");

  const stripeCount = 8;
  const stripeHeight = canvas.height / stripeCount;
  for (let i = 0; i < stripeCount; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#14240a" : "#1a2e0d";
    ctx.fillRect(0, i * stripeHeight, canvas.width, stripeHeight);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 4);
  return texture;
}

function setupGround() {
  const grassGeometry = new THREE.PlaneGeometry(500, 500);
  const grassMaterial = new THREE.MeshStandardMaterial({
    map: createOutfieldTexture(),
    roughness: 1,
  });
  const grass = new THREE.Mesh(grassGeometry, grassMaterial);
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -1;
  scene.add(grass);

  const pitchGeometry = new THREE.PlaneGeometry(2.2, 30);
  const pitchMaterial = new THREE.MeshStandardMaterial({
    color: 0x8a7350,
    roughness: 1,
  });
  const pitch = new THREE.Mesh(pitchGeometry, pitchMaterial);
  pitch.rotation.x = -Math.PI / 2;
  pitch.position.set(0, -0.99, -10);
  scene.add(pitch);
}

// --- Ball Leather Texture ---
function createBallTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#7a0d0d";
  ctx.fillRect(0, 0, 128, 128);
  // Leather grain: fine speckles of lighter/darker red
  for (let i = 0; i < 3000; i++) {
    ctx.fillStyle =
      Math.random() > 0.5 ? "rgba(255,120,120,0.05)" : "rgba(30,0,0,0.08)";
    ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  return new THREE.CanvasTexture(canvas);
}

// --- Initialization ---
function init() {
  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a1628); // Dark night sky
  scene.fog = new THREE.Fog(0x0a1628, 60, 220);

  // Camera
  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.01,
    1000,
  );
  camera.position.set(0, 1.5, 5);

  // Renderer
  renderer = new THREE.WebGLRenderer({
    canvas: document.querySelector("#bg"),
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  // Cap DPR: bloom buffers scale with pixel ratio, full DPR freezes hi-DPI screens
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

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

  // Ground
  const groundBody = new CANNON.Body({
    type: CANNON.Body.STATIC,
    shape: new CANNON.Plane(),
  });
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  groundBody.position.y = -1;
  world.addBody(groundBody);

  // Ground: striped outfield + pitch strip
  setupGround();

  // Stadium Background - curved backdrop wrapping the arena
  setupStadiumBackground();

  // Floodlight towers
  setupFloodlights();

  // Ball
  ball = new THREE.Group();
  const ballGeometry = new THREE.SphereGeometry(0.1, 16, 16);
  const ballMaterial = new THREE.MeshStandardMaterial({
    map: createBallTexture(),
    roughness: 0.35,
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
    mass: 0.156,
    shape: new CANNON.Sphere(0.1),
  });
  world.addBody(ballBody);

  // Player Hands
  const loader = new GLTFLoader();
  loader.load(
    handsModelUrl,
    (gltf) => {
      console.log("Base model loaded successfully.");
      playerHands = gltf.scene;
      playerHands.scale.set(0.28, 0.28, 0.28);
      playerHands.position.z = 4.2;
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

  // Score Element
  scoreElement = document.getElementById("score");

  // Event Listeners
  window.addEventListener("resize", onWindowResize, false);
  document.addEventListener("mousemove", onMouseMove, false);
  document.addEventListener("touchstart", onTouchMove, { passive: false });
  document.addEventListener("touchmove", onTouchMove, { passive: false });

  // Start
  startNewRound();
  animate();
}

// --- Event Handlers ---
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function moveHands(clientX, clientY) {
  const mouseX = (clientX / window.innerWidth) * 2 - 1;
  const mouseY = -(clientY / window.innerHeight) * 2 + 1;
  if (playerHands) {
    const playAreaWidth = 4;
    const playAreaHeight = 2;
    playerHands.position.x = mouseX * (playAreaWidth / 2);
    playerHands.position.y = mouseY * (playAreaHeight / 2) + 1;
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

// --- Game Logic ---
function startNewRound() {
  isBallInPlay = true;
  isBallCaught = false;

  // Reset hands to open pose for the new round
  if (mixer) {
    catchActionR.stop();
    catchActionL.stop();
    openActionR.reset().play();
    openActionL.reset().play();
  }

  resetBall();
}

function resetBall() {
  const THROWER_Z = -6;
  ballBody.position.set(0, 1.5, THROWER_Z); // Raise origin height
  ballBody.velocity.set(0, 0, 0);
  ballBody.angularVelocity.set(0, 0, 0);
  ballBody.wakeUp();

  const random = Math.random();
  if (random < 0.2) {
    swingType = "none";
  } else if (random < 0.7) {
    swingType = "normal";
  } else {
    swingType = "reverse";
  }

  const swingDelayMinZ = THROWER_Z + (camera.position.z - THROWER_Z) * 0.5;
  const swingDelayMaxZ = THROWER_Z + (camera.position.z - THROWER_Z) * 0.7;
  swingDelayZ =
    Math.random() * (swingDelayMaxZ - swingDelayMinZ) + swingDelayMinZ;

  const swingMagnitude = 2;
  const swingDirection = Math.random() < 0.5 ? 1 : -1;
  initialSwingForce.set(
    swingType === "none" ? 0 : swingMagnitude * swingDirection,
    0,
    0,
  );

  const targetX = (Math.random() - 0.5) * 0.8;
  const targetY = 1.3 + Math.random() * 0.4;
  const targetZ = 4;
  const targetPoint = new CANNON.Vec3(targetX, targetY, targetZ);
  const startPoint = ballBody.position;
  const gravity = world.gravity.y;

  let timeOfFlight = 1.37;
  if (swingType === "reverse") {
    timeOfFlight /= 0.9;
  }

  const dx = targetPoint.x - startPoint.x;
  const dy = targetPoint.y - startPoint.y;
  const dz = targetPoint.z - startPoint.z;

  const vx = dx / timeOfFlight;
  const vz = dz / timeOfFlight;
  const vy = (dy - 0.5 * gravity * timeOfFlight * timeOfFlight) / timeOfFlight;

  ballBody.velocity.set(vx, vy, vz);

  // Visible spin so the seam rotation reads on the textured ball
  ballBody.angularVelocity.set(-6, (Math.random() - 0.5) * 4, 0);
  ball.position.copy(ballBody.position);
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

  world.step(1 / 60, deltaTime, 3);

  if (isBallInPlay && ballBody.position.z > swingDelayZ) {
    if (swingType === "normal") {
      currentSwingForce.copy(initialSwingForce);
    } else if (swingType === "reverse") {
      // scale() allocates a new Vec3; keep a precomputed inverse instead
      if (ballBody.position.z < 1.5) {
        currentSwingForce.copy(initialSwingForce);
      } else {
        currentSwingForce.copy(initialSwingForce).scale(-1, currentSwingForce);
      }
    } else {
      currentSwingForce.set(0, 0, 0);
    }
    ballBody.applyForce(currentSwingForce);
  }

  // Only update ball position when necessary to reduce operations
  if (!isBallCaught) {
    ball.position.copy(ballBody.position);
    ball.quaternion.copy(ballBody.quaternion);
  } else if (isBallCaught && playerHands) {
    // Keep ball attached to hands when caught
    ball.position.copy(playerHands.position);
    ball.position.z -= 0.2;
    ball.position.y -= 0.15;
  }

  if (isBallInPlay && playerHands) {
    const distance = playerHands.position.distanceTo(ball.position);
    if (distance < 0.35) {
      score++;
      scoreElement.innerText = `Score: ${score}`;
      isBallInPlay = false;
      isBallCaught = true;

      // Freeze ball physics
      ballBody.sleep();
      ballBody.velocity.set(0, 0, 0);
      ballBody.angularVelocity.set(0, 0, 0);

      if (catchActionR && openActionR && catchActionL && openActionL) {
        openActionR.stop();
        openActionL.stop();
        catchActionR.reset().play();
        catchActionL.reset().play();
      }
      setTimeout(startNewRound, 1000);
    } else {
      // Only check out-of-bounds when the ball wasn't just caught,
      // otherwise both branches fire and two restarts get scheduled
      const playAreaWidth = 4;
      if (
        ball.position.z > 5 ||
        ball.position.y < -0.9 ||
        Math.abs(ball.position.x) > playAreaWidth / 2 + 0.5
      ) {
        isBallInPlay = false;
        setTimeout(startNewRound, 1000);
      }
    }
  }

  // Update the animation mixer on every frame
  if (mixer) {
    mixer.update(deltaTime);
  }

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
  enabled: new URLSearchParams(window.location.search).has("debug"),

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
