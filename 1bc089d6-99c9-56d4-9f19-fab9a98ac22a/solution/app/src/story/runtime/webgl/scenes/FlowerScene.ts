import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  Scene,
  ShaderMaterial,
  Vector3,
  Vector4,
} from "three";

import type { Stage } from "../../stage";
import type { SceneFactory } from "../types";
import {
  COLORSPACE_FRAGMENT,
  NOISE_GLSL,
  PALETTE,
  createGlowDisc,
  createSky,
  createStars,
  approach,
  damp,
  disposeTree,
  fitCamera,
  horizonUv,
  random,
} from "./common";

const PETALS = 6;
const ROWS = 7;
const PETAL_LENGTH = 0.34;
const PETAL_WIDTH = 0.17;
const MOON_DIR = new Vector3(-0.42, 0.2, -1).normalize();
/** The viewer stands among the flowers and looks down the field, so it fills the lower two thirds. */
const EYE = new Vector3(0, 1.55, 6.5);
const LOOK = new Vector3(0.3, 0.1, -5);
/** Share of the window's progress one flower takes to fold shut. */
const FOLD_SPAN = 0.24;

interface Flower {
  head: Vector3;
  scale: number;
  twist: number;
  delay: number;
}

function plantField(count: number, rand: () => number): Flower[] {
  const flowers: Flower[] = [];
  for (let i = 0; i < count; i++) {
    const depth = Math.pow(rand(), 1.5);
    const z = 4.2 - depth * 30;
    const spread = 2.2 + depth * 16;
    const x = (rand() * 2 - 1) * spread;
    const stem = 0.32 + rand() * 0.4;
    flowers.push({ head: new Vector3(x, stem, z), scale: 0.75 + rand() * 0.55, twist: rand() * Math.PI, delay: 0 });
  }
  const ranked = flowers.map((flower, index) => ({ index, distance: flower.head.distanceTo(EYE) })).sort((a, b) => a.distance - b.distance);
  // The farthest flowers fold first; the nearest finish exactly as the window's progress reaches 1.
  ranked.forEach((entry, rank) => {
    flowers[entry.index].delay = (rank / Math.max(1, ranked.length - 1)) * (0.72 + rand() * 0.04);
  });
  return flowers;
}

/** Every petal of every flower in one geometry; the fold happens in the vertex shader. */
function petalGeometry(flowers: Flower[]) {
  const perPetal = 3 * ROWS;
  const count = flowers.length * PETALS * perPetal;
  const local = new Float32Array(count * 3);
  const head = new Float32Array(count * 4);
  const petal = new Float32Array(count * 3);
  const indices: number[] = [];
  let vertex = 0;
  flowers.forEach((flower, flowerIndex) => {
    for (let p = 0; p < PETALS; p++) {
      const start = vertex;
      for (let r = 0; r < ROWS; r++) {
        const t = r / (ROWS - 1);
        const width = Math.pow(Math.sin(Math.PI * Math.min(0.98, t * 0.92 + 0.06)), 0.75) * PETAL_WIDTH * 0.5;
        for (let c = -1; c <= 1; c++) {
          local.set([c * width, t * PETAL_LENGTH, Math.abs(c) * width * 0.35], vertex * 3);
          head.set([flower.head.x, flower.head.y, flower.head.z, flower.scale], vertex * 4);
          petal.set([(p / PETALS) * Math.PI * 2 + flower.twist, flower.delay, flowerIndex], vertex * 3);
          vertex += 1;
        }
      }
      for (let r = 0; r < ROWS - 1; r++) {
        for (let c = 0; c < 2; c++) {
          const a = start + r * 3 + c;
          indices.push(a, a + 1, a + 3, a + 1, a + 4, a + 3);
        }
      }
    }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(local, 3));
  geometry.setAttribute("aHead", new BufferAttribute(head, 4));
  geometry.setAttribute("aPetal", new BufferAttribute(petal, 3));
  geometry.setIndex(indices);
  return geometry;
}

/**
 * Moonflowers close: a field of pale flowers under the moon. Their petals fold shut across the
 * window's progress, the farthest first. Hovering a flower (or tapping it) closes it early, within a
 * second; once scroll has closed it too, scrolling back above that point opens it again.
 */
export const createFlowerScene: SceneFactory = (quality) => {
  const scene = new Scene();
  const camera = new PerspectiveCamera(46, 1, 0.05, 200);
  camera.position.copy(EYE);
  camera.lookAt(LOOK);
  const rand = random(57);

  const sky = createSky(new Color("#0a0820"), new Color("#3a2f6a"), PALETTE.night, 0.62);
  sky.material.uniforms.uLift.value = 0.55;
  scene.add(sky.mesh);
  const stars = createStars(Math.round(600 * quality.density) + 150, 71, { minY: 0.06 });
  stars.material.uniforms.uPixelRatio.value = quality.pixelRatio * quality.renderScale;
  scene.add(stars.points);
  const moon = createGlowDisc(PALETTE.moon, { core: 0.09, halo: 0.55 });
  moon.mesh.position.copy(MOON_DIR).multiplyScalar(60).add(EYE);
  moon.mesh.scale.setScalar(26);
  moon.mesh.lookAt(EYE);
  scene.add(moon.mesh);

  const ground = new Mesh(
    new PlaneGeometry(300, 300).rotateX(-Math.PI / 2),
    new ShaderMaterial({
      uniforms: { uNear: { value: new Color("#121722") }, uFar: { value: new Color("#2c2558") } },
      vertexShader: /* glsl */ `
        varying float vDepth;
        varying vec2 vXZ;
        void main() {
          vXZ = (modelMatrix * vec4(position, 1.0)).xz;
          vec4 view = viewMatrix * modelMatrix * vec4(position, 1.0);
          vDepth = -view.z;
          gl_Position = projectionMatrix * view;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uNear;
        uniform vec3 uFar;
        varying float vDepth;
        varying vec2 vXZ;
        ${NOISE_GLSL}
        void main() {
          float grain = shNoise(vXZ * 2.5) * 0.5 + shNoise(vXZ * 9.0) * 0.5;
          vec3 near = uNear * (0.7 + 0.6 * grain);
          gl_FragColor = vec4(mix(near, uFar, smoothstep(3.0, 60.0, vDepth)), 1.0);
          ${COLORSPACE_FRAGMENT}
        }
      `,
      toneMapped: false,
    }),
  );
  scene.add(ground);

  const hillPoints = 120;
  const hillPositions = new Float32Array(hillPoints * 2 * 3);
  for (let i = 0; i < hillPoints; i++) {
    const x = -140 + (i / (hillPoints - 1)) * 280;
    const top = 2.2 + Math.sin(i * 0.21) * 1.1 + Math.sin(i * 0.53 + 1.3) * 0.6 + rand() * 0.25;
    hillPositions.set([x, -0.5, -70, x, top, -70], i * 6);
  }
  const hillIndices: number[] = [];
  for (let i = 0; i < hillPoints - 1; i++) hillIndices.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
  const hillGeometry = new BufferGeometry();
  hillGeometry.setAttribute("position", new BufferAttribute(hillPositions, 3));
  hillGeometry.setIndex(hillIndices);
  const hills = new Mesh(
    hillGeometry,
    new ShaderMaterial({
      uniforms: { uColor: { value: new Color("#141029") } },
      vertexShader: "void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `uniform vec3 uColor;
void main() {
  gl_FragColor = vec4(uColor, 1.0);
  ${COLORSPACE_FRAGMENT}
}`,
      side: DoubleSide,
      toneMapped: false,
    }),
  );
  scene.add(hills);

  const blades = Math.round(5200 * Math.max(0.4, quality.density));
  const bladePositions = new Float32Array(blades * 6);
  const bladeShade = new Float32Array(blades * 2);
  for (let i = 0; i < blades; i++) {
    const depth = Math.pow(rand(), 1.4);
    const z = 6 - depth * 34;
    const x = (rand() * 2 - 1) * (2.4 + depth * 17);
    const tall = (0.08 + rand() * 0.2) * (1 + depth * 0.6);
    const lean = (rand() - 0.5) * 0.08;
    bladePositions.set([x, 0, z, x + lean, tall, z + lean * 0.5], i * 6);
    bladeShade.set([0, 0.4 + rand() * 0.6], i * 2);
  }
  const bladeGeometry = new BufferGeometry();
  bladeGeometry.setAttribute("position", new BufferAttribute(bladePositions, 3));
  bladeGeometry.setAttribute("aShade", new BufferAttribute(bladeShade, 1));
  const grass = new LineSegments(
    bladeGeometry,
    new ShaderMaterial({
      uniforms: { uRoot: { value: new Color("#0c1217") }, uTip: { value: new Color("#3d4a5e") }, uFog: { value: new Color("#2c2558") } },
      vertexShader: /* glsl */ `
        attribute float aShade;
        varying float vShade;
        varying float vDepth;
        void main() {
          vShade = aShade;
          vec4 view = modelViewMatrix * vec4(position, 1.0);
          vDepth = -view.z;
          gl_Position = projectionMatrix * view;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uRoot;
        uniform vec3 uTip;
        uniform vec3 uFog;
        varying float vShade;
        varying float vDepth;
        void main() {
          vec3 color = mix(uRoot, uTip, vShade);
          gl_FragColor = vec4(mix(color, uFog, smoothstep(4.0, 34.0, vDepth) * 0.8), 1.0);
          ${COLORSPACE_FRAGMENT}
        }
      `,
      toneMapped: false,
    }),
  );
  grass.frustumCulled = false;
  scene.add(grass);

  const count = Math.round(400 * Math.max(0.6, quality.density));
  const flowers = plantField(count, rand);
  const slots = Math.ceil(count / 4);
  const early = new Float32Array(slots * 4);
  const earlyTarget = new Float32Array(count);
  const earlyUniform = Array.from({ length: slots }, () => new Vector4(0, 0, 0, 0));

  const petals = new ShaderMaterial({
    uniforms: {
      uProgress: { value: 0 },
      uEarly: { value: earlyUniform },
      uBase: { value: new Color("#4b3d78") },
      uTip: { value: new Color("#f1ecf6") },
      uMoonDir: { value: MOON_DIR.clone() },
      uFog: { value: new Color("#2a2456") },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aHead;
      attribute vec3 aPetal;
      uniform float uProgress;
      uniform vec4 uEarly[${slots}];
      varying float vAlong;
      varying vec3 vNormal;
      varying float vFold;
      varying float vDepth;
      mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
      mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
      void main() {
        int id = int(aPetal.z + 0.5);
        float early = uEarly[id / 4][id - (id / 4) * 4];
        float fold = smoothstep(aPetal.y, aPetal.y + ${FOLD_SPAN}, uProgress);
        fold = max(fold, early);
        vFold = fold;
        float along = position.y / ${PETAL_LENGTH.toFixed(2)};
        vAlong = along;
        float tilt = mix(0.62, 0.08, fold) + along * mix(0.55, -0.28, fold);
        mat3 turn = rotY(aPetal.x) * rotX(tilt);
        vec3 p = turn * vec3(position.x, position.y, position.z * (1.0 + fold));
        vec3 world = aHead.xyz + p * aHead.w;
        vNormal = turn * vec3(0.0, 0.0, 1.0);
        vec4 view = viewMatrix * vec4(world, 1.0);
        vDepth = -view.z;
        gl_Position = projectionMatrix * view;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uBase;
      uniform vec3 uTip;
      uniform vec3 uMoonDir;
      uniform vec3 uFog;
      varying float vAlong;
      varying vec3 vNormal;
      varying float vFold;
      varying float vDepth;
      void main() {
        vec3 n = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
        float light = 0.5 + 0.5 * abs(dot(n, uMoonDir));
        vec3 color = mix(uBase, uTip, smoothstep(0.0, 0.8, vAlong)) * light;
        color += uTip * smoothstep(0.3, 1.0, vAlong) * 0.22 * (1.0 - vFold * 0.7);
        color *= mix(1.0, 0.7, vFold);
        color += vec3(1.0, 0.72, 0.42) * pow(1.0 - vAlong, 2.0) * 0.35 * (1.0 - vFold);
        color = mix(color, uFog, smoothstep(6.0, 32.0, vDepth) * 0.75);
        gl_FragColor = vec4(color, 1.0);
        ${COLORSPACE_FRAGMENT}
      }
    `,
    side: DoubleSide,
    toneMapped: false,
  });
  const petalMesh = new Mesh(petalGeometry(flowers), petals);
  petalMesh.frustumCulled = false;
  scene.add(petalMesh);

  const stemPositions = new Float32Array(count * 12);
  flowers.forEach((flower, i) => {
    const bend = (rand() - 0.5) * 0.12;
    const mid = [flower.head.x + bend, flower.head.y * 0.5, flower.head.z];
    stemPositions.set([flower.head.x, 0, flower.head.z, ...mid, ...mid, flower.head.x, flower.head.y, flower.head.z], i * 12);
  });
  const stemGeometry = new BufferGeometry();
  stemGeometry.setAttribute("position", new BufferAttribute(stemPositions, 3));
  const stems = new LineSegments(stemGeometry, new LineBasicMaterial({ color: new Color("#2b3d3c"), transparent: true, opacity: 0.85 }));
  scene.add(stems);

  const heartGeometry = new BufferGeometry();
  heartGeometry.setAttribute("position", new BufferAttribute(new Float32Array(flowers.flatMap((f) => [f.head.x, f.head.y + 0.02, f.head.z])), 3));
  heartGeometry.setAttribute("aPetal", new BufferAttribute(new Float32Array(flowers.flatMap((f, i) => [f.scale, f.delay, i])), 3));
  const hearts = new Points(
    heartGeometry,
    new ShaderMaterial({
      uniforms: { uProgress: { value: 0 }, uEarly: { value: earlyUniform }, uPixelRatio: { value: quality.pixelRatio * quality.renderScale } },
      vertexShader: /* glsl */ `
        attribute vec3 aPetal;
        uniform float uProgress;
        uniform vec4 uEarly[${slots}];
        uniform float uPixelRatio;
        varying float vGlow;
        void main() {
          int id = int(aPetal.z + 0.5);
          float fold = max(smoothstep(aPetal.y, aPetal.y + ${FOLD_SPAN}, uProgress), uEarly[id / 4][id - (id / 4) * 4]);
          vGlow = 1.0 - fold;
          vec4 view = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * view;
          gl_PointSize = 260.0 * aPetal.x * uPixelRatio / -view.z * (0.3 + 0.7 * vGlow);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vGlow;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = pow(max(0.0, 1.0 - d), 2.6) * (0.1 + 0.9 * vGlow) * 0.9;
          gl_FragColor = vec4(vec3(1.0, 0.74, 0.45) * a, a);
          ${COLORSPACE_FRAGMENT}
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
    }),
  );
  hearts.frustumCulled = false;
  scene.add(hearts);


  let width = 1;
  let height = 1;
  /** The shared scroll state, so a hover only counts while this scene is the one on screen. */
  let stage: Stage | null = null;
  const projected = new Vector3();
  /** Closes the flower under the pointer: the one whose projected head is nearest, relative to its size on screen. */
  const closeUnder = (clientX: number, clientY: number, minimumReach: number) => {
    if (stage?.current !== "flowers") return;
    const pixelsPerUnit = height / 2 / Math.tan((camera.fov * Math.PI) / 360);
    let best = -1;
    let bestScore = 1;
    flowers.forEach((flower, index) => {
      projected.copy(flower.head).project(camera);
      if (projected.z > 1) return;
      const x = (projected.x * 0.5 + 0.5) * width;
      const y = (-projected.y * 0.5 + 0.5) * height;
      const reach = Math.max(minimumReach, (PETAL_LENGTH * flower.scale * pixelsPerUnit) / flower.head.distanceTo(EYE));
      const score = Math.hypot(x - clientX, y - clientY) / reach;
      if (score < bestScore) {
        bestScore = score;
        best = index;
      }
    });
    if (best >= 0) earlyTarget[best] = 1;
  };
  const onMove = (event: PointerEvent) => {
    if (event.pointerType === "mouse") closeUnder(event.clientX, event.clientY, 20);
  };
  const onDown = (event: PointerEvent) => closeUnder(event.clientX, event.clientY, 32);
  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerdown", onDown, { passive: true });

  const heartUniforms = (hearts.material as ShaderMaterial).uniforms;
  camera.updateMatrixWorld();

  return {
    id: "flowers",
    scene,
    camera,
    update(frame) {
      stage = frame.stage;
      const k = frame.quality.reduced ? 1 : damp(5, frame.delta);
      let changed = false;
      let moving = false;
      for (let i = 0; i < count; i++) {
        if (frame.window >= flowers[i].delay + FOLD_SPAN) earlyTarget[i] = 0;
        const next = approach(early[i], earlyTarget[i], k, 0.01);
        changed ||= next !== early[i];
        early[i] = next;
        moving ||= next !== earlyTarget[i];
      }
      if (changed) earlyUniform.forEach((slot, i) => slot.fromArray(early, i * 4));
      petals.uniforms.uProgress.value = frame.window;
      heartUniforms.uProgress.value = frame.window;
      sky.material.uniforms.uHorizonY.value = horizonUv(camera);
      return moving;
    },
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      fitCamera(camera, width, height);
      camera.fov = width < 768 ? 62 : 46;
      camera.updateProjectionMatrix();
    },
    dispose() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      disposeTree(scene);
    },
  };
};
