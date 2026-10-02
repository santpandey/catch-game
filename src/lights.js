import * as THREE from "three";
import { imageUVToBackdrop } from "./stadium.js";

// Roof floodlight clusters in the stadium photo (pixel coords in the
// cropped 2816x1100 image, converted to u/v below)
const CLUSTERS = [
  { x: 240, y: 135 },
  { x: 710, y: 242 },
  { x: 1882, y: 330 },
  { x: 2112, y: 322 },
];
const IMAGE_W = 2816;
const IMAGE_H = 1100;

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
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Fake volumetric beam: open cone, additive, fades along its length and
// at silhouette edges (view-dir . normal) so it reads as a light shaft
function createBeam(apex, target) {
  const dir = new THREE.Vector3().subVectors(target, apex);
  const length = dir.length();
  dir.normalize();

  const geometry = new THREE.ConeGeometry(4.5, length, 24, 1, true);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uOpacity: { value: 0.06 },
    },
    vertexShader: `
      varying float vY;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vY = uv.y;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalMatrix * normal;
        vView = -mvPosition.xyz;
        gl_Position = mvPosition;
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      varying float vY;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float edge = abs(dot(normalize(vNormal), normalize(vView)));
        // Bright near the apex (vY ~1), fading out towards the target
        float along =
          smoothstep(0.0, 0.45, vY) * (1.0 - smoothstep(0.85, 1.0, vY));
        gl_FragColor = vec4(vec3(1.0, 0.97, 0.85), uOpacity * edge * along);
      }
    `,
  });
  material.toneMapped = false;

  const beam = new THREE.Mesh(geometry, material);
  // Cone apex sits at +length/2 in local space; aim it at the target
  beam.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, -1, 0),
    dir,
  );
  beam.position.copy(apex).addScaledVector(dir, length / 2);
  return beam;
}

// Dust motes drifting inside the beam cones. Positions are the base
// particle positions; all motion happens in the vertex shader.
function createDustMotes(origins, target) {
  const COUNT = 150;
  const positions = new Float32Array(COUNT * 3);
  const seeds = new Float32Array(COUNT);
  const p = new THREE.Vector3();
  for (let i = 0; i < COUNT; i++) {
    const apex = origins[i % origins.length];
    const t = 0.15 + Math.random() * 0.7; // along the cone axis
    p.lerpVectors(apex, target, t);
    const spread = 4.5 * t * 0.7;
    p.x += (Math.random() - 0.5) * spread;
    p.y += (Math.random() - 0.5) * spread * 0.6;
    p.z += (Math.random() - 0.5) * spread;
    positions.set([p.x, p.y, p.z], i * 3);
    seeds[i] = Math.random() * 100;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  const material = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      attribute float aSeed;
      uniform float uTime;
      varying float vAlpha;
      void main() {
        vec3 pos = position + vec3(
          sin(uTime * 0.3 + aSeed) * 0.4,
          sin(uTime * 0.2 + aSeed * 1.7) * 0.25,
          cos(uTime * 0.25 + aSeed * 0.9) * 0.4
        );
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        vAlpha = 0.5 + 0.5 * sin(uTime * 0.8 + aSeed * 3.0);
        gl_PointSize = 26.0 / -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float alpha = smoothstep(0.5, 0.0, d) * vAlpha * 0.18;
        gl_FragColor = vec4(vec3(1.0, 0.97, 0.85), alpha);
      }
    `,
  });
  material.toneMapped = false;
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

export function setupFloodlights(scene) {
  const glowTexture = createGlowTexture();
  const pitchTarget = new THREE.Vector3(0, -1, -8);
  const beamOrigins = [];

  CLUSTERS.forEach(({ x, y }) => {
    const point = imageUVToBackdrop(x / IMAGE_W, y / IMAGE_H);

    // Pull glows/beams slightly inside the cylinder so they don't z-fight
    const origin = point.clone().multiplyScalar(0.98);
    origin.y = point.y;
    beamOrigins.push(origin);

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        opacity: 0.85,
      }),
    );
    glow.material.toneMapped = false;
    glow.scale.set(7, 4, 1);
    glow.position.copy(origin);
    scene.add(glow);

    scene.add(createBeam(origin, pitchTarget));
  });

  const dust = createDustMotes(beamOrigins, pitchTarget);
  scene.add(dust);

  return {
    update(elapsedSeconds) {
      dust.material.uniforms.uTime.value = elapsedSeconds;
    },
  };
}
