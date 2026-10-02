import * as THREE from "three";
import stadiumImage from "../assets/stadium.webp";

// Colours sampled from assets/stadium.png so 3D and photo blend seamlessly
const SKY_HORIZON = new THREE.Color(0x20395c); // sky near the roof line
const SKY_ZENITH = new THREE.Color(0x070f1e); // darker navy zenith
const GRASS_BASE = "#8ba54c"; // outfield grass just below the boards

// Backdrop cylinder: arc length / height must roughly equal the cropped
// image aspect (2816x1100). A horizontal stretch of <=1.15 is acceptable
// and lowers the whole bowl so the roof/floodlights stay in frame.
const BACKDROP_RADIUS = 40;
const BACKDROP_THETA_LENGTH = Math.PI * 1.1;
const BACKDROP_THETA_START = Math.PI - BACKDROP_THETA_LENGTH / 2;
const IMAGE_ASPECT = 2816 / 1100;
const MAX_STRETCH = 1.15;
const BACKDROP_HEIGHT =
  (BACKDROP_RADIUS * BACKDROP_THETA_LENGTH) / (IMAGE_ASPECT * MAX_STRETCH);
const BACKDROP_Y = -1 + BACKDROP_HEIGHT / 2; // bottom edge sits on the ground

// Crowd tiers as v-ranges in the image (1 = top). Excludes roof, the
// fascia band (v ~0.19-0.26), the red tier band (v ~0.41-0.48) and the
// boundary boards (v < 0.05).
const CROWD_BANDS = [
  [0.3, 0.5],
  [0.6, 0.73],
  [0.81, 0.95],
];
// White sightscreen spans this u-range — never treat it as crowd
const SIGHTSCREEN_U = [0.41, 0.58];
// Boundary boards occupy the bottom ~5% of the image
const BOARDS_V_TOP = 0.95;

// Maps a point in image space (u: 0-1 left-to-right, v: 0-1 top-to-bottom)
// to a 3D point on the backdrop cylinder, accounting for the horizontal
// flip (repeat.x = -1) and the cylinder transform
export function imageUVToBackdrop(u, v) {
  const theta = BACKDROP_THETA_START + (1 - u) * BACKDROP_THETA_LENGTH;
  return new THREE.Vector3(
    BACKDROP_RADIUS * Math.sin(theta),
    BACKDROP_Y + (0.5 - v) * BACKDROP_HEIGHT,
    BACKDROP_RADIUS * Math.cos(theta),
  );
}

// --- Sky dome: gradient + faint twinkling stars ---
function createSkyDome() {
  const geometry = new THREE.SphereGeometry(400, 32, 16);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uHorizon: { value: SKY_HORIZON },
      uZenith: { value: SKY_ZENITH },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uHorizon;
      uniform vec3 uZenith;
      varying vec3 vDir;
      float hash(vec3 p) {
        return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
      }
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 sky = mix(uHorizon, uZenith, pow(h, 0.6));
        // Stars on a coarse cell grid, fading near the horizon
        vec3 cell = floor(vDir * 80.0);
        float star = step(0.997, hash(cell));
        float twinkle = 0.6 + 0.4 * sin(uTime * 2.0 + hash(cell) * 40.0);
        sky += star * twinkle * smoothstep(0.15, 0.6, h) * 0.5;
        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  });
  const dome = new THREE.Mesh(geometry, material);
  dome.renderOrder = -1; // behind everything
  return dome;
}

// --- Curved photo backdrop with living crowd ---
// onBeforeCompile adds crowd shimmer (per-cell brightness flicker) and a
// Mexican wave (uWaveU sweeps the arc, shifting the sample up slightly)
function setupBackdrop(scene, renderer, crowdUniforms) {
  new THREE.TextureLoader().load(
    stadiumImage,
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      // Cap anisotropy: 4 is visually identical to max for a backdrop, cheaper
      texture.anisotropy = Math.min(
        4,
        renderer.capabilities.getMaxAnisotropy(),
      );
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.repeat.x = -1;

      const geometry = new THREE.CylinderGeometry(
        BACKDROP_RADIUS,
        BACKDROP_RADIUS,
        BACKDROP_HEIGHT,
        64,
        1,
        true,
        BACKDROP_THETA_START,
        BACKDROP_THETA_LENGTH,
      );
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.BackSide,
        toneMapped: false, // show the photo as-is
      });
      material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, crowdUniforms);
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            `#include <common>
            uniform float uTime;
            uniform float uWaveU;
            uniform float uWaveWidth;
            float crowdHash(float c) {
              return fract(sin(c * 12.9898) * 43758.5453);
            }`,
          )
          .replace(
            "#include <map_fragment>",
            `{
            vec2 uv2 = vMapUv;
            // repeat.x = -1 makes vMapUv.x negative; fract() restores image u
            float tu = fract(uv2.x);
            // Crowd mask: seating tiers minus the sightscreen
            float crowd = 0.0;
            ${CROWD_BANDS.map(
              ([v0, v1]) =>
                `crowd = max(crowd, step(${v0.toFixed(3)}, uv2.y) * step(uv2.y, ${v1.toFixed(3)}));`,
            ).join("\n            ")}
            crowd *= 1.0 - step(${SIGHTSCREEN_U[0]}, tu) * step(tu, ${SIGHTSCREEN_U[1]});
            // Shimmer: ~500x120 cells, +-5% brightness ticking at ~1.5 Hz,
            // plus sub-texel jitter
            float cell = floor(tu * 500.0) + floor(uv2.y * 120.0) * 733.0;
            float tick = floor(uTime * 1.5);
            float sh = crowdHash(cell + tick * 78.233);
            float bright = 1.0 + (sh - 0.5) * 0.10;
            uv2.x += (sh - 0.5) * (0.5 / 2816.0);
            // Mexican wave: uplift + brightening inside the wave window
            float dw = abs(tu - uWaveU);
            dw = min(dw, 1.0 - dw);
            float wave = smoothstep(uWaveWidth, 0.0, dw) * crowd
              * step(-0.5, uWaveU);
            uv2.y += wave * (4.0 / 1100.0);
            bright += wave * 0.08;
            vec4 sampledDiffuseColor = texture2D(map, uv2);
            sampledDiffuseColor.rgb *= mix(1.0, bright, crowd);
            diffuseColor *= sampledDiffuseColor;
            }`,
          );
      };
      const backdrop = new THREE.Mesh(geometry, material);
      backdrop.position.y = BACKDROP_Y;
      scene.add(backdrop);
      console.log("✅ Stadium background loaded successfully");
    },
    undefined,
    (error) => {
      console.error("❌ Error loading stadium texture:", error);
      const fallback = new THREE.Mesh(
        new THREE.PlaneGeometry(100, 40),
        new THREE.MeshBasicMaterial({ color: SKY_HORIZON }),
      );
      fallback.position.set(0, 2, -15);
      scene.add(fallback);
      console.log("⚠️ Using fallback stadium background");
    },
  );
}

// --- Camera flashes: bright additive pinpricks in the stands ---
function createFlashPoints() {
  const COUNT = 60;
  const positions = new Float32Array(COUNT * 3);
  const phases = new Float32Array(COUNT);
  const rates = new Float32Array(COUNT);
  const p = new THREE.Vector3();
  for (let i = 0; i < COUNT; i++) {
    // Random spot inside a random crowd band, skipping the sightscreen
    const band = CROWD_BANDS[(Math.random() * CROWD_BANDS.length) | 0];
    let u = Math.random();
    if (u > SIGHTSCREEN_U[0] && u < SIGHTSCREEN_U[1]) u = SIGHTSCREEN_U[1];
    const v = 1 - (band[0] + Math.random() * (band[1] - band[0]));
    p.copy(imageUVToBackdrop(u, v)).multiplyScalar(0.99);
    p.y = imageUVToBackdrop(u, v).y;
    positions.set([p.x, p.y, p.z], i * 3);
    phases[i] = Math.random();
    rates[i] = 0.03 + Math.random() * 0.07; // flashes every ~10-30 s
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute("aRate", new THREE.BufferAttribute(rates, 1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uBurst: { value: 0 },
    },
    vertexShader: `
      attribute float aPhase;
      attribute float aRate;
      uniform float uTime;
      uniform float uBurst;
      varying float vFlash;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float rate = aRate * (1.0 + uBurst * 30.0);
        float f = fract(uTime * rate + aPhase);
        // ~2% duty at rest; during a burst the window widens so most
        // points are lit together
        float window = 0.02 * (1.0 + uBurst * 15.0);
        vFlash = smoothstep(window, 0.0, f);
        gl_PointSize = 90.0 * (0.5 + vFlash) / -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying float vFlash;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float alpha = smoothstep(0.5, 0.0, d) * vFlash;
        gl_FragColor = vec4(vec3(1.0, 0.98, 0.92), alpha);
      }
    `,
  });
  material.toneMapped = false;
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

// --- LED advertising ribbon hiding the photo's boundary boards ---
function createBoards() {
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");

  let best = 0;
  let messageUntil = 0;

  const draw = () => {
    ctx.fillStyle = "#07080d";
    ctx.fillRect(0, 0, 2048, 64);
    const showing = performance.now() < messageUntil;
    if (showing) {
      ctx.font = "bold 52px Arial, sans-serif";
      ctx.fillStyle = "#ffd766";
      ctx.textBaseline = "middle";
      ctx.fillText(messageText, 120, 34);
    } else {
      ctx.font = "bold 40px Arial, sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#ffd766";
      ctx.fillText("SLIP CATCH", 60, 34);
      ctx.fillStyle = "#e8e4d8";
      ctx.fillText("BEST: " + best, 460, 34);
      ctx.fillStyle = "#ffd766";
      ctx.fillText("SLIP CATCH", 760, 34);
      ctx.fillStyle = "#e8e4d8";
      ctx.fillText("BEST: " + best, 1160, 34);
      ctx.fillStyle = "#ffd766";
      ctx.fillText("SLIP CATCH", 1460, 34);
      ctx.fillStyle = "#e8e4d8";
      ctx.fillText("BEST: " + best, 1860, 34);
      // Diamond separators
      ctx.fillStyle = "#7a86ff";
      [420, 1120, 1820].forEach((x) => {
        ctx.beginPath();
        ctx.moveTo(x, 12);
        ctx.lineTo(x + 16, 32);
        ctx.lineTo(x, 52);
        ctx.lineTo(x - 16, 32);
        ctx.fill();
      });
    }
    texture.needsUpdate = true;
  };

  let messageText = "";
  draw.message = (text, ms) => {
    messageText = text;
    messageUntil = performance.now() + ms;
    draw();
    setTimeout(draw, ms + 50);
  };
  draw.best = (n) => {
    best = n;
    if (performance.now() >= messageUntil) draw();
  };

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.repeat.x = -2; // mirrored view + two loops around the arc
  draw();

  // Covers the boards' v-range (bottom ~5% of the backdrop) plus a margin
  const height = BACKDROP_HEIGHT * (1 - BOARDS_V_TOP) + 0.6;
  const geometry = new THREE.CylinderGeometry(
    BACKDROP_RADIUS - 0.4,
    BACKDROP_RADIUS - 0.4,
    height,
    64,
    1,
    true,
    BACKDROP_THETA_START,
    BACKDROP_THETA_LENGTH,
  );
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.BackSide,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = -1 + height / 2;
  return { mesh, texture, draw };
}

// --- Outfield: mowing stripes, radial darkening, floodlight pools ---
function createOutfieldTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  const base = new THREE.Color(GRASS_BASE);

  // Texture spans the 500x500 ground plane; ~8px ≈ 4m mowing stripes
  const stripe = 8;
  for (let y = 0; y < canvas.height; y += stripe) {
    const alt = (y / stripe) % 2 === 0;
    const c = base.clone().multiplyScalar(alt ? 1.0 : 0.88);
    ctx.fillStyle = `#${c.getHexString()}`;
    ctx.fillRect(0, y, canvas.width, stripe);
  }

  // Soft brighter pools where the floodlights wash the outfield
  const pools = [
    [0.22, 0.35],
    [0.5, 0.25],
    [0.78, 0.35],
  ];
  pools.forEach(([px, py]) => {
    const grad = ctx.createRadialGradient(
      px * 1024,
      py * 1024,
      0,
      px * 1024,
      py * 1024,
      200,
    );
    grad.addColorStop(0, "rgba(255,250,220,0.10)");
    grad.addColorStop(1, "rgba(255,250,220,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1024, 1024);
  });

  // Subtle radial darkening towards the boundary
  const edge = ctx.createRadialGradient(512, 512, 250, 512, 512, 720);
  edge.addColorStop(0, "rgba(0,0,20,0)");
  edge.addColorStop(1, "rgba(0,0,20,0.35)");
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, 1024, 1024);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// --- Pitch: worn centre + crease lines at the batting (far) end ---
function createPitchTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#9a8a68";
  ctx.fillRect(0, 0, 256, 1024);

  // Worn, lighter centre where the ball has been hammered
  const worn = ctx.createLinearGradient(0, 0, 256, 0);
  worn.addColorStop(0, "rgba(220,205,170,0)");
  worn.addColorStop(0.5, "rgba(220,205,170,0.5)");
  worn.addColorStop(1, "rgba(220,205,170,0)");
  ctx.fillStyle = worn;
  ctx.fillRect(0, 0, 256, 1024);

  // Scuffs
  for (let i = 0; i < 600; i++) {
    ctx.fillStyle =
      Math.random() > 0.5 ? "rgba(120,100,70,0.12)" : "rgba(200,185,150,0.10)";
    ctx.fillRect(Math.random() * 256, Math.random() * 1024, 3, 3);
  }

  // Crease lines at the batting end (v≈0.6 maps to z≈-7 where the
  // stumps stand; v=1 is the far end of the plane)
  ctx.strokeStyle = "rgba(245,245,240,0.9)";
  ctx.lineWidth = 5;
  const creaseY = (1 - 0.6) * 1024;
  // Popping crease
  ctx.beginPath();
  ctx.moveTo(28, creaseY);
  ctx.lineTo(228, creaseY);
  ctx.stroke();
  // Bowling crease + return creases
  ctx.beginPath();
  ctx.moveTo(60, creaseY + 26);
  ctx.lineTo(196, creaseY + 26);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(60, creaseY);
  ctx.lineTo(60, creaseY + 56);
  ctx.moveTo(196, creaseY);
  ctx.lineTo(196, creaseY + 56);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// --- Stumps + bails just behind the ball release point ---
function createStumps() {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: 0xe8e0c8,
    roughness: 0.6,
  });
  const stumpGeometry = new THREE.CylinderGeometry(0.018, 0.018, 0.71, 8);
  [-0.114, 0, 0.114].forEach((x) => {
    const stump = new THREE.Mesh(stumpGeometry, material);
    stump.position.set(x, 0.355, 0);
    group.add(stump);
  });
  const bailGeometry = new THREE.CylinderGeometry(0.008, 0.008, 0.1, 6);
  [-0.057, 0.057].forEach((x) => {
    const bail = new THREE.Mesh(bailGeometry, material);
    bail.rotation.z = Math.PI / 2;
    bail.position.set(x, 0.715, 0);
    group.add(bail);
  });
  group.position.set(0, -1, -7);
  return group;
}

export function setupStadium(scene, renderer) {
  // Match fog/background to the sky horizon so nothing reads as a hole
  scene.background = SKY_HORIZON.clone();
  scene.fog = new THREE.Fog(SKY_HORIZON.clone(), 60, 220);

  const dome = createSkyDome();
  scene.add(dome);

  // Shared crowd-shader uniforms (backdrop patch + flash points)
  const crowdUniforms = {
    uTime: { value: 0 },
    uWaveU: { value: -1 },
    uWaveWidth: { value: 0.12 },
  };
  setupBackdrop(scene, renderer, crowdUniforms);

  const flashes = createFlashPoints();
  scene.add(flashes);

  const boards = createBoards();
  scene.add(boards.mesh);

  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(500, 500),
    new THREE.MeshStandardMaterial({
      map: createOutfieldTexture(),
      roughness: 1,
    }),
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -1;
  scene.add(grass);

  const pitch = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 30),
    new THREE.MeshStandardMaterial({
      map: createPitchTexture(),
      roughness: 1,
    }),
  );
  pitch.rotation.x = -Math.PI / 2;
  pitch.position.set(0, -0.99, -10);
  scene.add(pitch);

  scene.add(createStumps());

  // Wave + flash state
  const WAVE_DURATION = 6;
  let waveStart = -1;
  let nextAutoWave = 15 + Math.random() * 20;
  let lastT = 0;

  return {
    update(elapsedSeconds) {
      const dt = Math.min(elapsedSeconds - lastT, 0.1);
      lastT = elapsedSeconds;
      dome.material.uniforms.uTime.value = elapsedSeconds;
      crowdUniforms.uTime.value = elapsedSeconds;
      flashes.material.uniforms.uTime.value = elapsedSeconds;

      // Mexican wave sweep; uWaveU < -0.5 disables it in the shader
      if (waveStart >= 0) {
        const t = (elapsedSeconds - waveStart) / WAVE_DURATION;
        crowdUniforms.uWaveU.value = t >= 1 ? -1 : t * 1.2 - 0.1;
        if (t >= 1) {
          waveStart = -1;
          nextAutoWave = elapsedSeconds + 25 + Math.random() * 20;
        }
      } else if (elapsedSeconds >= nextAutoWave) {
        this.triggerWave();
      }

      // Flash burst decay (~1.5 s half-life-ish)
      const u = flashes.material.uniforms.uBurst;
      if (u.value > 0) u.value = Math.max(0, u.value - dt / 1.5);

      // Scrolling LED boards
      boards.texture.offset.x = (elapsedSeconds * 0.05) % 1;
    },
    triggerWave() {
      waveStart = lastT;
    },
    triggerFlashBurst() {
      flashes.material.uniforms.uBurst.value = 1;
    },
    setBoardMessage(text, durationMs) {
      boards.draw.message(text, durationMs);
    },
    setBest(n) {
      boards.draw.best(n);
    },
  };
}
