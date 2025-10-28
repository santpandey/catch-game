import * as THREE from "three";
import stadiumImage from "./assets/stadium.png";
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
let animationFrameId;

// --- Initialization ---
function init() {
  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb); // Blue sky

  // Camera
  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.01,
    1000
  );
  camera.position.set(0, 1.5, 5);

  // Renderer
  renderer = new THREE.WebGLRenderer({
    canvas: document.querySelector("#bg"),
    antialias: true,
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);

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

  const grassGeometry = new THREE.PlaneGeometry(500, 500);
  const grassMaterial = new THREE.MeshBasicMaterial({
    color: 0x6a782d,
    side: THREE.DoubleSide,
  });
  const grass = new THREE.Mesh(grassGeometry, grassMaterial);
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -1;
  scene.add(grass);

  // Stadium
  const textureLoader = new THREE.TextureLoader();
  const stadiumTexture = textureLoader.load(stadiumImage);
  const stadiumGeometry = new THREE.PlaneGeometry(100, 20);
  const stadiumMaterial = new THREE.MeshBasicMaterial({ map: stadiumTexture });
  const stadium = new THREE.Mesh(stadiumGeometry, stadiumMaterial);
  stadium.position.set(0, 6, -15);
  scene.add(stadium);

  // Ball
  ball = new THREE.Group();
  const ballGeometry = new THREE.SphereGeometry(0.1, 32, 32);
  const ballMaterial = new THREE.MeshBasicMaterial({ color: 0x8b0000 });
  const ballSphere = new THREE.Mesh(ballGeometry, ballMaterial);
  ball.add(ballSphere);

  const seamGeometry = new THREE.TorusGeometry(0.1, 0.01, 16, 100);
  const seamMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
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
    "assets/hands_model.glb",
    (gltf) => {
      console.log("Base model loaded successfully.");
      playerHands = gltf.scene;
      playerHands.scale.set(0.28, 0.28, 0.28);
      playerHands.position.z = 4.2;
      scene.add(playerHands);

      const animLoader = new GLTFLoader();
      animLoader.load(
        "assets/hands_animations.glb",
        (animGltf) => {
          console.log("Animations loaded successfully.");
          mixer = new THREE.AnimationMixer(playerHands);
          const clips = animGltf.animations;

          const openClipR = THREE.AnimationClip.findByName(clips, "Pose-Open.R");
          const catchClipR = THREE.AnimationClip.findByName(clips, "Pose-Catch.R");
          const openClipL = THREE.AnimationClip.findByName(clips, "Pose-Open.L");
          const catchClipL = THREE.AnimationClip.findByName(clips, "Pose-Catch.L");

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
        }
      );
    },
    undefined,
    (error) => {
      console.error("An error happened while loading the model:", error);
    }
  );

  // Score Element
  scoreElement = document.getElementById("score");

  // Event Listeners
  window.addEventListener("resize", onWindowResize, false);
  document.addEventListener("mousemove", onMouseMove, false);

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

function onMouseMove(event) {
  const mouseX = (event.clientX / window.innerWidth) * 2 - 1;
  const mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
  if (playerHands) {
    const playAreaWidth = 4;
    const playAreaHeight = 2;
    playerHands.position.x = mouseX * (playAreaWidth / 2);
    playerHands.position.y = mouseY * (playAreaHeight / 2) + 1;
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
    0
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
}

// --- Animation Loop ---
const clock = new THREE.Clock();
let lastFrameTime = performance.now();
const targetFPS = 60;
const frameInterval = 1000 / targetFPS;

function animate() {
  animationFrameId = requestAnimationFrame(animate);
  
  const currentTime = performance.now();
  const deltaTime = clock.getDelta();
  
  // Limit physics updates to prevent frame drops
  if (currentTime - lastFrameTime >= frameInterval) {
    world.step(1 / 60, deltaTime, 3);
    lastFrameTime = currentTime;
  }

  if (isBallInPlay && ballBody.position.z > swingDelayZ) {
    // Reuse force vector to prevent garbage collection
    if (!window.currentSwingForce) {
      window.currentSwingForce = new CANNON.Vec3(0, 0, 0);
    }
    
    if (swingType === "normal") {
      window.currentSwingForce.copy(initialSwingForce);
    } else if (swingType === "reverse") {
      window.currentSwingForce.copy(
        ballBody.position.z < 1.5
          ? initialSwingForce
          : initialSwingForce.scale(-1)
      );
    } else {
      window.currentSwingForce.set(0, 0, 0);
    }
    ballBody.applyForce(window.currentSwingForce);
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
    }

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

  // Update the animation mixer on every frame
  if (mixer) {
    mixer.update(clock.getDelta());
  }

  renderer.render(scene, camera);
}

// --- Performance Monitoring ---
const fpsMonitor = {
  frames: 0,
  lastTime: performance.now(),
  
  update() {
    this.frames++;
    const currentTime = performance.now();
    if (currentTime >= this.lastTime + 1000) {
      const fps = Math.round((this.frames * 1000) / (currentTime - this.lastTime));
      console.log(`FPS: ${fps}`);
      this.frames = 0;
      this.lastTime = currentTime;
    }
  }
};

// Add FPS monitoring to animation loop
setInterval(() => fpsMonitor.update(), 100);

// --- Start Application ---
init();

// Vite HMR is now handled by the framework's default, faster mechanism.
