import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  ShaderMaterial,
  Vector3,
} from "three";

import { city } from "../../../content";
import { litCount } from "../../dom/cityMath";
import type { SceneFactory } from "../types";
import {
  COLORSPACE_FRAGMENT,
  PALETTE,
  createSky,
  createStars,
  disposeTree,
  fitCamera,
  horizonUv,
  mix,
  random,
  smooth,
} from "./common";

const PITCH_X = 0.46;
const PITCH_Y = 0.62;
const MARGIN = 0.16;
const WINDOW_W = 0.26;
const WINDOW_H = 0.34;
const CELL = 2.4;
const START_CAMERA = new Vector3(-3, 19, 34);
const END_CAMERA = new Vector3(2.5, 9.5, 13);
const LAST_WINDOW = new Vector3(4.6, 3.6, -5);

interface Tower {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
}

interface Slot {
  position: Vector3;
  normal: Vector3;
  distance: number;
}

/** Window columns that fit across a face, matching the tower shader's grid. */
const columns = (size: number) => Math.max(0, Math.floor((size - 2 * MARGIN) / PITCH_X));
const floors = (height: number) => Math.max(0, Math.floor((height - 0.8) / PITCH_Y));

function buildTowers(count: number, rand: () => number): Tower[] {
  const towers: Tower[] = [];
  for (let gz = 0; towers.length < count && gz < 48; gz++) {
    for (let gx = -17; gx <= 17 && towers.length < count; gx++) {
      if (rand() < 0.2) continue;
      const z = 4 - gz * CELL - rand() * 0.5;
      const x = gx * CELL + (rand() - 0.5) * 0.5 + (gz % 2) * CELL * 0.5;
      const centre = Math.exp(-((x / 16) ** 2)) * Math.exp(-(((z + 40) / 40) ** 2));
      const tall = rand() < 0.05 ? 1.9 : 1;
      const h = (1.1 + rand() * 2.6 + centre * 7.5 * rand()) * tall;
      towers.push({ x, z, w: 1.1 + rand() * 0.9, d: 1.1 + rand() * 0.9, h });
    }
  }
  return towers;
}

/** Every window slot on the faces the camera sees (front and the side facing the street's centre line). */
function windowSlots(towers: Tower[]): Slot[] {
  const slots: Slot[] = [];
  const front = new Vector3(0, 0, 1);
  towers.forEach((tower) => {
    const rows = floors(tower.h);
    const faces: Array<{ normal: Vector3; size: number; origin: (u: number, v: number) => Vector3 }> = [
      {
        normal: front,
        size: tower.w,
        origin: (u, v) => new Vector3(tower.x - tower.w / 2 + u, v, tower.z + tower.d / 2 + 0.015),
      },
    ];
    const side = tower.x > END_CAMERA.x ? -1 : 1;
    faces.push({
      normal: new Vector3(side, 0, 0),
      size: tower.d,
      origin: (u, v) => new Vector3(tower.x + (side * tower.w) / 2 + side * 0.015, v, tower.z + tower.d / 2 - u),
    });
    faces.forEach((face) => {
      const cols = columns(face.size);
      const offset = (face.size - cols * PITCH_X) / 2;
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const position = face.origin(offset + (c + 0.5) * PITCH_X, 0.6 + (r + 0.5) * PITCH_Y);
          slots.push({ position, normal: face.normal, distance: position.distanceTo(END_CAMERA) });
        }
      }
    });
  });
  return slots;
}

/**
 * The city switches off: a night skyline of instanced towers with 4,096 lit windows. The number still
 * lit is `litCount(window)`, the same function and progress the DOM counter uses; windows go dark from
 * the far edge toward the camera until one window is left. Only scroll moves it.
 */
export const createCityScene: SceneFactory = (quality) => {
  const scene = new Scene();
  const camera = new PerspectiveCamera(40, 1, 0.1, 400);
  const rand = random(23);

  const sky = createSky(PALETTE.night, PALETTE.dusk5, PALETTE.night, 0.72);
  sky.material.uniforms.uLift.value = 0.5;
  scene.add(sky.mesh);
  const stars = createStars(Math.round(700 * quality.density) + 150, 31, { minY: 0.08 });
  stars.material.uniforms.uPixelRatio.value = quality.pixelRatio * quality.renderScale;
  scene.add(stars.points);

  const ground = new Mesh(
    new PlaneGeometry(1600, 1600).rotateX(-Math.PI / 2),
    new ShaderMaterial({
      uniforms: { uColor: { value: PALETTE.night.clone() }, uFog: { value: PALETTE.dusk6.clone() }, uLit: { value: 1 } },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        varying float vDepth;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          vec4 view = viewMatrix * world;
          vDepth = -view.z;
          gl_Position = projectionMatrix * view;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform vec3 uFog;
        uniform float uLit;
        varying vec3 vWorld;
        varying float vDepth;
        void main() {
          vec2 cell = abs(fract(vWorld.xz / ${CELL.toFixed(1)} + 0.5) - 0.5);
          float street = smoothstep(0.06, 0.0, min(cell.x, cell.y));
          vec3 lamp = vec3(1.0, 0.62, 0.3) * street * 0.1 * uLit * smoothstep(8.0, 26.0, vDepth) * (1.0 - smoothstep(40.0, 110.0, vDepth));
          vec3 color = mix(uColor, uFog, smoothstep(40.0, 190.0, vDepth)) + lamp;
          gl_FragColor = vec4(color, 1.0);
          ${COLORSPACE_FRAGMENT}
        }
      `,
      toneMapped: false,
    }),
  );
  ground.name = "ground";
  scene.add(ground);

  const towers = buildTowers(Math.round(1000 * Math.max(0.55, quality.density)), rand);
  const box = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const towerMaterial = new ShaderMaterial({
    uniforms: {
      uBody: { value: new Color("#0c0a1d") },
      uLight: { value: new Color("#2a2357") },
      uGlass: { value: new Color("#1d1840") },
      uFog: { value: new Color("#2a2050") },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aSize;
      varying vec2 vFace;
      varying vec3 vNormal;
      varying float vDepth;
      varying float vHeight;
      void main() {
        vNormal = normal;
        vec2 size = abs(normal.z) > 0.5 ? aSize.xy : aSize.zy;
        vFace = vec2(uv.x * size.x, position.y * aSize.y);
        vHeight = position.y;
        vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vec4 view = viewMatrix * world;
        vDepth = -view.z;
        gl_Position = projectionMatrix * view;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uBody;
      uniform vec3 uLight;
      uniform vec3 uGlass;
      uniform vec3 uFog;
      varying vec2 vFace;
      varying vec3 vNormal;
      varying float vDepth;
      varying float vHeight;
      void main() {
        float lit = vNormal.y > 0.5 ? 0.55 : abs(vNormal.z) > 0.5 ? 0.35 : 0.18;
        vec3 color = mix(uBody, uLight, lit * (0.4 + 0.6 * vHeight));
        if (vNormal.y < 0.5) {
          vec2 cell = vec2(${PITCH_X}, ${PITCH_Y});
          vec2 local = vec2(vFace.x, vFace.y - 0.6);
          vec2 inCell = mod(local, cell);
          float glass = step(abs(inCell.x - cell.x * 0.5), ${(WINDOW_W / 2).toFixed(3)}) * step(abs(inCell.y - cell.y * 0.5), ${(WINDOW_H / 2).toFixed(3)});
          glass *= step(0.0, local.y);
          color = mix(color, uGlass, glass * 0.55);
        }
        color = mix(color, uFog, smoothstep(30.0, 150.0, vDepth) * 0.9);
        gl_FragColor = vec4(color, 1.0);
        ${COLORSPACE_FRAGMENT}
      }
    `,
    toneMapped: false,
  });
  const towerMesh = new InstancedMesh(box, towerMaterial, towers.length);
  const sizes = new Float32Array(towers.length * 3);
  const matrix = new Matrix4();
  towers.forEach((tower, index) => {
    matrix.compose(new Vector3(tower.x, 0, tower.z), new Quaternion(), new Vector3(tower.w, tower.h, tower.d));
    towerMesh.setMatrixAt(index, matrix);
    sizes.set([tower.w, tower.h, tower.d], index * 3);
  });
  box.setAttribute("aSize", new InstancedBufferAttribute(sizes, 3));
  towerMesh.frustumCulled = false;
  towerMesh.name = "towers";
  scene.add(towerMesh);

  // Lit windows: a random subset of the slots, ranked so the far ones switch off first.
  const slots = windowSlots(towers);
  const count = Math.min(slots.length, city.windows);
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  const chosen = slots.slice(0, count);
  const maxDistance = Math.max(...chosen.map((slot) => slot.distance));
  const order = chosen
    .map((slot, index) => ({ index, key: (1 - slot.distance / maxDistance) * 0.82 + rand() * 0.18 }))
    .sort((a, b) => a.key - b.key);
  const ranks = new Float32Array(count);
  order.forEach((entry, rank) => (ranks[entry.index] = rank));
  // The last window: a near one, right of centre, high enough to stay in view at the end.
  const last = chosen.reduce(
    (best, slot, index) => {
      const score = slot.position.distanceTo(LAST_WINDOW) + (slot.normal.z > 0.5 ? 0 : 3);
      return score < best.score ? { index, score } : best;
    },
    { index: 0, score: Infinity },
  );
  const lastRank = ranks[last.index];
  ranks.forEach((rank, index) => {
    if (rank > lastRank) ranks[index] = rank - 1;
  });
  ranks[last.index] = count - 1;

  const cityGlow = new Color("#5a3d6e");
  // Warm lamplight in every window; the last one left burns ember.
  const palette = [new Color("#ffd9a8"), new Color("#f4a259"), new Color("#ffc27a"), new Color("#ffb978")];
  // One static mesh for every lit window (instancing is slow per instance on software renderers).
  const corners = [
    [-1, -1, 0, 0],
    [1, -1, 1, 0],
    [1, 1, 1, 1],
    [-1, 1, 0, 1],
  ];
  const positions = new Float32Array(count * 12);
  const uvs = new Float32Array(count * 8);
  const rankAttr = new Float32Array(count * 4);
  const tintAttr = new Float32Array(count * 12);
  const indices = new Uint32Array(count * 6);
  const up = new Vector3(0, 1, 0);
  const right = new Vector3();
  const halfW = (WINDOW_W * 1.35) / 2;
  const halfH = (WINDOW_H * 1.3) / 2;
  chosen.forEach((slot, index) => {
    right.crossVectors(up, slot.normal).normalize();
    const tint = index === last.index ? PALETTE.ember : palette[Math.floor(rand() * palette.length)];
    corners.forEach(([sx, sy, u, v], corner) => {
      const vertex = index * 4 + corner;
      positions[vertex * 3] = slot.position.x + right.x * sx * halfW;
      positions[vertex * 3 + 1] = slot.position.y + sy * halfH;
      positions[vertex * 3 + 2] = slot.position.z + right.z * sx * halfW;
      uvs[vertex * 2] = u;
      uvs[vertex * 2 + 1] = v;
      rankAttr[vertex] = ranks[index];
      tintAttr.set([tint.r, tint.g, tint.b], vertex * 3);
    });
    indices.set([0, 1, 2, 0, 2, 3].map((n) => index * 4 + n), index * 6);
  });
  const windowGeometry = new BufferGeometry();
  windowGeometry.setAttribute("position", new BufferAttribute(positions, 3));
  windowGeometry.setAttribute("uv", new BufferAttribute(uvs, 2));
  windowGeometry.setAttribute("aRank", new BufferAttribute(rankAttr, 1));
  windowGeometry.setAttribute("aTint", new BufferAttribute(tintAttr, 3));
  windowGeometry.setIndex(new BufferAttribute(indices, 1));
  const windowMaterial = new ShaderMaterial({
    uniforms: { uLitCount: { value: count }, uCount: { value: count } },
    vertexShader: /* glsl */ `
      attribute float aRank;
      attribute vec3 aTint;
      uniform float uLitCount;
      uniform float uCount;
      varying vec2 vUv;
      varying vec3 vTint;
      varying float vOn;
      void main() {
        vUv = uv;
        vTint = aTint;
        vOn = step(uCount - uLitCount, aRank) * (0.86 + 0.14 * fract(aRank * 0.618));
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vTint;
      varying float vOn;
      void main() {
        if (vOn <= 0.001) discard;
        vec2 p = abs(vUv - 0.5) * 2.0;
        float core = step(p.x, 0.74) * step(p.y, 0.77);
        float glow = (1.0 - max(p.x, p.y)) * 0.9;
        float alpha = (core + glow) * vOn;
        gl_FragColor = vec4(vTint * alpha, alpha);
        ${COLORSPACE_FRAGMENT}
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  });
  const windowMesh = new Mesh(windowGeometry, windowMaterial);
  windowMesh.frustumCulled = false;
  windowMesh.name = "windows";
  scene.add(windowMesh);

  const windowUniforms = windowMaterial.uniforms;
  const groundUniforms = (ground.material as ShaderMaterial).uniforms;

  return {
    id: "city",
    scene,
    camera,
    update({ progress, window }) {
      const lit = Math.min(count, litCount(window));
      const share = lit / city.windows;
      windowUniforms.uLitCount.value = lit;
      groundUniforms.uLit.value = mix(0.25, 1, share);
      sky.material.uniforms.uGlow.value = mix(0.25, 1.3, share);
      sky.material.uniforms.uHorizon.value.copy(PALETTE.dusk6).lerp(cityGlow, share * 0.8);
      stars.material.uniforms.uOpacity.value = mix(0.9, 0.12, share);
      const haze = 1 + 0.35 * sky.material.uniforms.uGlow.value;
      groundUniforms.uFog.value.copy(sky.material.uniforms.uHorizon.value).multiplyScalar(haze);
      towerMaterial.uniforms.uFog.value.copy(sky.material.uniforms.uHorizon.value).multiplyScalar(haze * 0.85);

      const t = smooth(progress);
      camera.position.lerpVectors(START_CAMERA, END_CAMERA, t);
      camera.lookAt(mix(0, LAST_WINDOW.x * 0.7, t), mix(1, 2.4, t), mix(-40, -24, t));
      camera.updateMatrixWorld();
      sky.material.uniforms.uHorizonY.value = horizonUv(camera);
      return false;
    },
    resize(width, height) {
      fitCamera(camera, width, height);
      camera.fov = width < 768 ? 60 : 40;
      camera.updateProjectionMatrix();
    },
    dispose() {
      disposeTree(scene);
    },
  };
};
