import * as THREE from "three";

// Feel effects: ball trail ribbon, catch burst, camera shake.
// Everything preallocated; update() mutates buffers in place.

const TRAIL_POINTS = 16;

export function createEffects(scene, camera) {
  // --- Ball trail: camera-facing ribbon over the last N positions ---
  const trailPositions = new Float32Array(TRAIL_POINTS * 3);
  const trailVerts = new Float32Array(TRAIL_POINTS * 2 * 3);
  const trailAlpha = new Float32Array(TRAIL_POINTS * 2);
  const trailIndex = new Uint16Array((TRAIL_POINTS - 1) * 6);
  for (let i = 0; i < TRAIL_POINTS - 1; i++) {
    const v = i * 2;
    trailIndex.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], i * 6);
  }
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute(
    "position",
    new THREE.BufferAttribute(trailVerts, 3).setUsage(THREE.DynamicDrawUsage),
  );
  trailGeo.setAttribute(
    "aAlpha",
    new THREE.BufferAttribute(trailAlpha, 1).setUsage(THREE.DynamicDrawUsage),
  );
  trailGeo.setIndex(new THREE.BufferAttribute(trailIndex, 1));
  const trailMat = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexShader: `
      attribute float aAlpha;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      void main() {
        gl_FragColor = vec4(1.0, 0.95, 0.8, vAlpha);
      }
    `,
  });
  trailMat.toneMapped = false;
  const trail = new THREE.Mesh(trailGeo, trailMat);
  trail.frustumCulled = false;
  trail.visible = false;
  scene.add(trail);
  let trailCount = 0;

  // --- Catch burst: preallocated points, all motion in vertex shader ---
  const BURST_COUNT = 80;
  const burstDirs = new Float32Array(BURST_COUNT * 3);
  const burstSeed = new Float32Array(BURST_COUNT);
  const burstPositions = new Float32Array(BURST_COUNT * 3); // dummy, origin via uniform
  for (let i = 0; i < BURST_COUNT; i++) {
    // Mostly-upward cone of sparks + a few slow puffs
    const a = Math.random() * Math.PI * 2;
    const up = Math.random() * 0.9 + 0.1;
    const r = Math.sqrt(1 - up * up);
    const speed = (Math.random() * 0.7 + 0.3) * (i % 6 === 0 ? 0.6 : 2.2);
    burstDirs.set(
      [Math.cos(a) * r * speed, up * speed, Math.sin(a) * r * speed],
      i * 3,
    );
    burstSeed[i] = Math.random();
  }
  const burstGeo = new THREE.BufferGeometry();
  burstGeo.setAttribute("position", new THREE.BufferAttribute(burstPositions, 3));
  burstGeo.setAttribute("aDir", new THREE.BufferAttribute(burstDirs, 3));
  burstGeo.setAttribute("aSeed", new THREE.BufferAttribute(burstSeed, 1));
  const burstUniforms = {
    uStart: { value: -10 },
    uOrigin: { value: new THREE.Vector3() },
    uTime: { value: 0 },
  };
  const burstMat = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    uniforms: burstUniforms,
    vertexShader: `
      attribute vec3 aDir;
      attribute float aSeed;
      uniform float uStart;
      uniform vec3 uOrigin;
      uniform float uTime;
      varying float vFade;
      varying float vSeed;
      void main() {
        float t = uTime - uStart;
        float life = 0.8;
        vFade = clamp(1.0 - t / life, 0.0, 1.0) * step(0.0, t);
        vec3 pos = uOrigin + aDir * t + vec3(0.0, -2.0, 0.0) * t * t;
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        vSeed = aSeed;
        gl_PointSize = (aSeed < 0.15 ? 60.0 : 18.0) * (0.4 + vFade) / -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying float vFade;
      varying float vSeed;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float alpha = smoothstep(0.5, 0.1, d) * vFade;
        // few soft chalk puffs, rest are gold sparks
        vec3 col = vSeed < 0.15 ? vec3(0.85, 0.82, 0.75) : vec3(1.0, 0.83, 0.4);
        gl_FragColor = vec4(col, alpha * (vSeed < 0.15 ? 0.35 : 1.0));
      }
    `,
  });
  burstMat.toneMapped = false;
  const burst = new THREE.Points(burstGeo, burstMat);
  burst.frustumCulled = false;
  scene.add(burst);

  // --- Camera shake: decaying offset, never touches the base pose ---
  let shakeAmp = 0;
  let shakeT = 0;
  const shakeOffset = new THREE.Vector3();
  const _applied = new THREE.Vector3();

  // Scratch vectors for the trail rebuild (no per-frame allocation)
  const _p = new THREE.Vector3();
  const _q = new THREE.Vector3();
  const _side = new THREE.Vector3();
  const _camDir = new THREE.Vector3();

  return {
    update(dt, ballPosition, isBallFlying) {
      burstUniforms.uTime.value += dt;
      if (isBallFlying && ballPosition) {
        trail.visible = true;
        // shift history down, newest at index 0
        trailPositions.copyWithin(3, 0, (TRAIL_POINTS - 1) * 3);
        trailPositions[0] = ballPosition.x;
        trailPositions[1] = ballPosition.y;
        trailPositions[2] = ballPosition.z;
        trailCount = Math.min(trailCount + 1, TRAIL_POINTS);

        camera.getWorldDirection(_camDir);
        for (let i = 0; i < TRAIL_POINTS; i++) {
          const j = Math.min(i, trailCount - 1) * 3;
          _p.set(trailPositions[j], trailPositions[j + 1], trailPositions[j + 2]);
          // side = normalize(cross(camDir, segment direction))
          const k = Math.min(i + 1, trailCount - 1) * 3;
          _q.set(trailPositions[k], trailPositions[k + 1], trailPositions[k + 2]);
          _side.subVectors(_p, _q).cross(_camDir).normalize();
          if (_side.lengthSq() < 0.5) _side.set(1, 0, 0);
          const w = 0.07 * (1 - i / TRAIL_POINTS); // tapering width
          const a = 0.75 * (1 - i / TRAIL_POINTS) * (i < trailCount ? 1 : 0);
          const vi = i * 6;
          trailVerts[vi] = _p.x + _side.x * w;
          trailVerts[vi + 1] = _p.y + _side.y * w;
          trailVerts[vi + 2] = _p.z + _side.z * w;
          trailVerts[vi + 3] = _p.x - _side.x * w;
          trailVerts[vi + 4] = _p.y - _side.y * w;
          trailVerts[vi + 5] = _p.z - _side.z * w;
          trailAlpha[i * 2] = a;
          trailAlpha[i * 2 + 1] = a;
        }
        trailGeo.attributes.position.needsUpdate = true;
        trailGeo.attributes.aAlpha.needsUpdate = true;
      } else {
        trail.visible = false;
        trailCount = 0;
      }

      // Camera shake decay
      if (shakeAmp > 0.001) {
        shakeT += dt;
        const s = shakeAmp * Math.exp(-shakeT * 6);
        shakeOffset.set(
          Math.sin(shakeT * 47) * s,
          Math.cos(shakeT * 39) * s * 0.7,
          0,
        );
      } else {
        shakeOffset.set(0, 0, 0);
      }
    },
    burst(position) {
      burstUniforms.uOrigin.value.copy(position);
      burstUniforms.uStart.value = burstUniforms.uTime.value;
    },
    shake(strength) {
      shakeAmp = Math.max(shakeAmp, strength * 0.08);
      shakeT = 0;
    },
    // Called right before render: applies the shake offset on top of
    // whatever the base pose currently is. The offset is removed at the
    // start of the next call, so pointer raycasts between frames always
    // see the un-shaken base pose.
    applyShake() {
      camera.position.sub(_applied);
      _applied.copy(shakeOffset);
      camera.position.add(shakeOffset);
    },
    reset() {
      trailCount = 0;
      trail.visible = false;
      shakeAmp = 0;
      shakeOffset.set(0, 0, 0);
    },
  };
}
