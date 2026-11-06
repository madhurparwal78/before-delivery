import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  Texture,
  Vector3,
  type Material,
  type Object3D,
  type PerspectiveCamera,
} from "three";

import { clamp01 } from "../../stage";

export const PALETTE = {
  night: new Color("#0d0a1e"),
  night2: new Color("#16122f"),
  violet: new Color("#2c2458"),
  dusk3: new Color("#c5b3dc"),
  dusk4: new Color("#4b3d78"),
  dusk5: new Color("#3a2f66"),
  dusk6: new Color("#231c44"),
  dusk7: new Color("#120e26"),
  ember: new Color("#f4a259"),
  emberStrong: new Color("#ffb978"),
  moon: new Color("#f3efe7"),
  moonSoft: new Color("#c9c2db"),
  black: new Color("#050410"),
};


/** 0 → 1 as value goes from `from` to `to` (either direction), clamped. */
export const range = (value: number, from: number, to: number) => clamp01((value - from) / (to - from));

export const smooth = (t: number) => t * t * (3 - 2 * t);

export const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Frame-rate independent approach factor; 0 when time is frozen (reduced motion). */
export const damp = (rate: number, delta: number) => 1 - Math.exp(-rate * delta);

/** Moves `current` toward `target` by the factor `k`, landing exactly once it is within `epsilon`. */
export const approach = (current: number, target: number, k: number, epsilon = 1e-3) =>
  Math.abs(target - current) <= epsilon ? target : current + (target - current) * k;

/** Deterministic pseudo-random numbers, so every load draws the same world. */
export function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fitCamera(camera: PerspectiveCamera, width: number, height: number) {
  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();
}

/** Half extents of the camera's view at `distance` in front of it. */
export function viewExtents(camera: PerspectiveCamera, distance: number) {
  const halfHeight = Math.tan(((camera.fov * Math.PI) / 180) * 0.5) * distance;
  return { halfWidth: halfHeight * camera.aspect, halfHeight };
}

const lookDirection = new Vector3();

/** Where the true horizon (a level line at infinity) sits on screen, 0 bottom → 1 top, for the sky gradient. */
export function horizonUv(camera: PerspectiveCamera) {
  camera.getWorldDirection(lookDirection);
  const pitch = Math.asin(Math.max(-1, Math.min(1, lookDirection.y)));
  const ndc = -Math.tan(pitch) / Math.tan(((camera.fov * Math.PI) / 180) * 0.5);
  return clamp01(0.5 + 0.5 * ndc);
}

/** GLSL shared by the scenes: hash, value noise and fbm in 2D. */
export const NOISE_GLSL = /* glsl */ `
float shHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float shNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = shHash(i);
  float b = shHash(i + vec2(1.0, 0.0));
  float c = shHash(i + vec2(0.0, 1.0));
  float d = shHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float shFbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += amp * shNoise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    amp *= 0.5;
  }
  return sum;
}
`;

/** Value noise and fbm on the CPU (same shape as the GLSL), for geometry built once. */
export function createNoise(seed: number) {
  const rand = random(seed);
  const size = 256;
  const table = new Float32Array(size * size);
  for (let i = 0; i < table.length; i++) table[i] = rand();
  const at = (x: number, y: number) => table[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  const noise = (x: number, y: number) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = at(ix, iy);
    const b = at(ix + 1, iy);
    const c = at(ix, iy + 1);
    const d = at(ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy * (1 - ux) + (d - b) * ux * uy;
  };
  const fbm = (x: number, y: number, octaves = 4) => {
    let sum = 0;
    let amp = 0.5;
    let px = x;
    let py = y;
    for (let i = 0; i < octaves; i++) {
      sum += amp * noise(px, py);
      px = px * 2.03 + 17.1;
      py = py * 2.03 + 9.2;
      amp *= 0.5;
    }
    return sum;
  };
  return { noise, fbm };
}

const COLORSPACE = "#include <colorspace_fragment>";

/** A full-screen vertical gradient drawn behind everything: `top`, `horizon` (at `horizonY`, 0 bottom → 1 top) and `bottom`. */
export function createSky(top: Color, horizon: Color, bottom: Color, horizonY = 0.42) {
  const material = new ShaderMaterial({
    uniforms: {
      uTop: { value: top.clone() },
      uHorizon: { value: horizon.clone() },
      uBottom: { value: bottom.clone() },
      uHorizonY: { value: horizonY },
      uGlow: { value: 1 },
      uLift: { value: 0.7 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 1.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uBottom;
      uniform float uHorizonY;
      uniform float uGlow;
      uniform float uLift;
      varying vec2 vUv;
      void main() {
        float y = vUv.y;
        vec3 above = mix(uHorizon, uTop, pow(smoothstep(uHorizonY, 1.0, y), uLift));
        vec3 below = mix(uBottom, uHorizon, smoothstep(0.0, uHorizonY, y));
        vec3 color = y > uHorizonY ? above : below;
        float band = exp(-pow((y - uHorizonY) * 9.0, 2.0)) * 0.35 * uGlow;
        color += uHorizon * band;
        gl_FragColor = vec4(color, 1.0);
        ${COLORSPACE}
      }
    `,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  });
  const mesh = new Mesh(new PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return { mesh, material };
}

/** A still starfield on a sphere around the camera; each star has its own size and brightness, and all fade with `uOpacity`. */
export function createStars(count: number, seed: number, options: { radius?: number; minY?: number; size?: number } = {}) {
  const { radius = 80, minY = -0.05, size = 1.6 } = options;
  const rand = random(seed);
  const positions = new Float32Array(count * 3);
  const extras = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const theta = rand() * Math.PI * 2;
    const y = minY + rand() * (1 - minY);
    const r = Math.sqrt(1 - y * y);
    positions[i * 3] = Math.cos(theta) * r * radius;
    positions[i * 3 + 1] = y * radius;
    positions[i * 3 + 2] = Math.sin(theta) * r * radius;
    extras[i * 2] = 0.35 + rand() * rand() * 1.4;
    extras[i * 2 + 1] = rand() * Math.PI * 2;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("aExtra", new BufferAttribute(extras, 2));
  const material = new ShaderMaterial({
    uniforms: {
      uOpacity: { value: 1 },
      uSize: { value: size },
      uPixelRatio: { value: 1 },
      uColor: { value: PALETTE.moon.clone() },
    },
    vertexShader: /* glsl */ `
      attribute vec2 aExtra;
      uniform float uSize;
      uniform float uPixelRatio;
      varying float vBright;
      void main() {
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * view;
        vBright = 0.45 + 0.55 * fract(aExtra.y * 0.159);
        gl_PointSize = uSize * aExtra.x * uPixelRatio;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      uniform vec3 uColor;
      varying float vBright;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float alpha = smoothstep(0.5, 0.0, d) * vBright * uOpacity;
        gl_FragColor = vec4(uColor * alpha, alpha);
        ${COLORSPACE}
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = -5;
  return { points, material };
}

/** A camera-facing soft disc with a halo, for suns, moons and glows. */
export function createGlowDisc(color: Color, options: { core?: number; halo?: number; additive?: boolean } = {}) {
  const { core = 0.32, halo = 1, additive = true } = options;
  const material = new ShaderMaterial({
    uniforms: {
      uColor: { value: color.clone() },
      uCore: { value: core },
      uHalo: { value: halo },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uCore;
      uniform float uHalo;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float disc = smoothstep(uCore, uCore - 0.02, d);
        float glow = pow(max(0.0, 1.0 - d), 2.6) * uHalo;
        float alpha = clamp(disc + glow, 0.0, 1.0) * uOpacity;
        gl_FragColor = vec4(uColor * (disc + glow * 0.8) * uOpacity, alpha);
        ${COLORSPACE}
      }
    `,
    transparent: true,
    depthWrite: false,
    ...(additive ? { blending: AdditiveBlending } : {}),
    toneMapped: false,
  });
  const mesh = new Mesh(new PlaneGeometry(1, 1), material);
  return { mesh, material };
}

/** Disposes every geometry, material and texture under `root`. */
export function disposeTree(root: Object3D) {
  root.traverse((child) => {
    const node = child as Mesh;
    node.geometry?.dispose();
    const materials: Material[] = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
    materials.forEach((material) => {
      if (material instanceof ShaderMaterial) {
        Object.values(material.uniforms).forEach((uniform) => {
          if (uniform.value instanceof Texture) uniform.value.dispose();
        });
      }
      Object.values(material).forEach((value) => {
        if (value instanceof Texture) value.dispose();
      });
      material.dispose();
    });
  });
}

export const COLORSPACE_FRAGMENT = COLORSPACE;
