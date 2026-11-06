import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector3,
  Vector4,
} from "three";

import type { SceneFactory } from "../types";
import { COLORSPACE_FRAGMENT, NOISE_GLSL, PALETTE, disposeTree, fitCamera, mix, range, smooth } from "./common";

const MOON_DIR = new Vector3(0.27, 0.27, -1).normalize();
const MOON_DIR_NARROW = new Vector3(0.1, 0.34, -1).normalize();

/** Directional waves: [dir x, dir z, frequency, speed, amplitude]. Shared by the shader and the boat's bobbing. */
const WAVES: Array<[number, number, number, number, number]> = [
  [1, 0.35, 0.55, 0.9, 0.055],
  [-0.4, 1, 0.9, 1.25, 0.035],
  [0.8, -0.6, 1.6, 1.7, 0.018],
  [0.2, 0.98, 2.7, 2.3, 0.009],
  [-0.9, -0.3, 3.9, 2.9, 0.005],
];

const ENV_GLSL = /* glsl */ `
${NOISE_GLSL}
uniform vec3 uMoonDir;
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uShore;
uniform vec3 uMoonColor;

float shoreLine(float az) {
  return 0.014 + 0.028 * shNoise(vec2(az * 5.0, 1.3)) + 0.012 * shNoise(vec2(az * 19.0, 4.1));
}

vec3 environment(vec3 d, float starAmount, float soft, float disc) {
  float el = d.y;
  float az = atan(d.x, -d.z);
  vec3 color = mix(uHorizon, uTop, pow(smoothstep(0.0, 0.55, el), 0.55));
  float m = max(dot(d, uMoonDir), 0.0);
  color += uMoonColor * (smoothstep(0.99955 - disc * 0.0011, 0.99965, m) * mix(1.6, 0.55, disc) + pow(m, mix(1400.0, 500.0, disc)) * 0.45) + vec3(0.7, 0.68, 1.0) * pow(m, 90.0) * 0.035;
  vec2 cell = floor(vec2(az * 60.0, el * 60.0));
  float star = step(0.992, shHash(cell)) * smoothstep(0.02, 0.2, el);
  vec2 local = fract(vec2(az * 60.0, el * 60.0)) - 0.5;
  color += vec3(0.9, 0.88, 1.0) * star * smoothstep(0.18, 0.0, length(local)) * starAmount;
  float shore = shoreLine(az);
  float onShore = smoothstep(shore + soft, shore - soft, el);
  color = mix(color, uShore, onShore);
  return color;
}
`;

function paperBoat(): BufferGeometry {
  const keelA = [-0.45, 0, 0];
  const keelB = [0.45, 0, 0];
  const top = (x: number, z: number) => [x, 0.32, z];
  const apex = [0, 0.95, 0];
  const faces: number[][][] = [
    [keelA, keelB, top(0.8, 0.22)],
    [keelA, top(0.8, 0.22), top(-0.8, 0.22)],
    [keelB, keelA, top(-0.8, -0.22)],
    [keelB, top(-0.8, -0.22), top(0.8, -0.22)],
    [keelB, top(0.8, -0.22), top(0.8, 0.22)],
    [keelA, top(-0.8, 0.22), top(-0.8, -0.22)],
    [top(-0.38, 0.2), top(0.38, 0.2), apex],
    [top(0.38, -0.2), top(-0.38, -0.2), apex],
    [top(-0.38, 0.2), apex, top(-0.38, -0.2)],
    [top(0.38, -0.2), apex, top(0.38, 0.2)],
  ];
  const positions = new Float32Array(faces.length * 9);
  faces.forEach((face, i) => face.forEach((vertex, j) => positions.set(vertex, i * 9 + j * 3)));
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Still water: a moonlit lake with a folded paper boat. Across the window's progress the ripples
 * calm from choppy to mirror-still (the moon's glitter path tightens into a clean reflection)
 * and the boat drifts toward the centre. The ripples loop at the size scroll sets (frozen under
 * reduced motion).
 */
export const createWaterScene: SceneFactory = () => {
  const scene = new Scene();
  const camera = new PerspectiveCamera(42, 1, 0.1, 500);
  camera.position.set(0, 1.55, 8);
  camera.lookAt(0, 1.05, -30);

  const envUniforms = {
    uMoonDir: { value: MOON_DIR.clone() },
    uTop: { value: new Color("#0b0920") },
    uHorizon: { value: new Color("#3b3070") },
    uShore: { value: new Color("#07060f") },
    uMoonColor: { value: PALETTE.moon.clone() },
  };

  const sky = new Mesh(
    new PlaneGeometry(2, 2),
    new ShaderMaterial({
      uniforms: { ...envUniforms, uInvProjection: { value: new Matrix4() }, uCameraWorld: { value: new Matrix4() } },
      vertexShader: /* glsl */ `
        varying vec2 vNdc;
        void main() {
          vNdc = position.xy;
          gl_Position = vec4(position.xy, 1.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        ${ENV_GLSL}
        uniform mat4 uInvProjection;
        uniform mat4 uCameraWorld;
        varying vec2 vNdc;
        void main() {
          vec4 view = uInvProjection * vec4(vNdc, 1.0, 1.0);
          vec3 dir = normalize((uCameraWorld * vec4(view.xyz / view.w, 0.0)).xyz);
          gl_FragColor = vec4(environment(dir, 1.0, 0.0015, 0.0), 1.0);
          ${COLORSPACE_FRAGMENT}
        }
      `,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    }),
  );
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);

  const water = new ShaderMaterial({
    uniforms: {
      ...envUniforms,
      uTime: { value: 0 },
      uAmp: { value: 1 },
      uStill: { value: 0 },
      uCamera: { value: new Vector3() },
      uDeep: { value: new Color("#090717") },
      uWaves: { value: WAVES.map(([x, z, , s, a]) => new Vector4(x, z, s, a)) },
      uWaveFreq: { value: WAVES.map(([, , f]) => f) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      ${ENV_GLSL}
      uniform float uTime;
      uniform float uAmp;
      uniform float uStill;
      uniform vec3 uCamera;
      uniform vec3 uDeep;
      uniform vec4 uWaves[${WAVES.length}];
      uniform float uWaveFreq[${WAVES.length}];
      varying vec3 vWorld;
      void main() {
        vec2 p = vWorld.xz;
        vec2 slope = vec2(0.0);
        for (int i = 0; i < ${WAVES.length}; i++) {
          vec2 dir = normalize(uWaves[i].xy);
          float f = uWaveFreq[i];
          float phase = dot(dir, p) * f + uTime * uWaves[i].z;
          slope += dir * f * cos(phase) * uWaves[i].w;
        }
        float dist = length(vWorld - uCamera);
        slope *= uAmp * mix(1.0, 0.18, smoothstep(8.0, 55.0, dist));
        vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));
        vec3 view = normalize(vWorld - uCamera);
        vec3 reflected = reflect(view, normal);
        reflected.y = abs(reflected.y);
        float fresnel = 0.03 + 0.97 * pow(1.0 - max(dot(-view, normal), 0.0), 5.0);
        vec3 mirror = environment(reflected, uStill, mix(0.03, 0.002, uStill), 1.0);
        float glint = pow(max(dot(reflected, uMoonDir), 0.0), mix(260.0, 1800.0, uStill)) * mix(0.5, 0.45, uStill);
        vec3 color = mix(uDeep, mirror, clamp(fresnel * 0.92 + 0.12, 0.0, 1.0)) + uMoonColor * glint;
        color = mix(color, uHorizon * 0.8, smoothstep(60.0, 240.0, dist) * 0.6);
        gl_FragColor = vec4(color, mix(0.78, 1.0, smoothstep(0.0, 0.5, fresnel + uAmp * 0.6)));
        ${COLORSPACE_FRAGMENT}
      }
    `,
    transparent: true,
    toneMapped: false,
  });
  const lake = new Mesh(new PlaneGeometry(900, 900).rotateX(-Math.PI / 2), water);
  lake.renderOrder = 1;
  scene.add(lake);

  const boatGeometry = paperBoat();
  const paper = (dim: number) =>
    new ShaderMaterial({
      uniforms: {
        uMoonDir: { value: MOON_DIR.clone() },
        uPaper: { value: new Color("#efe7da") },
        uShade: { value: new Color("#3a2f66") },
        uDim: { value: dim },
        uOpacity: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uMoonDir;
        uniform vec3 uPaper;
        uniform vec3 uShade;
        uniform float uDim;
        uniform float uOpacity;
        varying vec3 vNormal;
        void main() {
          vec3 n = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
          float light = max(dot(n, uMoonDir), 0.0);
          float rim = pow(1.0 - abs(n.z), 2.0) * 0.15;
          vec3 color = (mix(uShade * 0.9, uPaper, 0.5 + 0.5 * light) + rim) * uDim;
          gl_FragColor = vec4(color, uOpacity);
          ${COLORSPACE_FRAGMENT}
        }
      `,
      side: DoubleSide,
      transparent: dim < 1,
      depthWrite: dim >= 1,
      depthTest: dim >= 1,
      toneMapped: false,
    });
  const boat = new Group();
  const hullMaterial = paper(1);
  const hull = new Mesh(boatGeometry, hullMaterial);
  hull.renderOrder = 2;
  boat.add(hull);
  const reflection = new Mesh(boatGeometry, paper(0.45));
  reflection.scale.y = -1;
  reflection.renderOrder = 3;
  boat.add(reflection);
  boat.scale.setScalar(1);
  scene.add(boat);

  let narrow = false;

  const waveAt = (x: number, z: number, time: number, amp: number) => {
    let height = 0;
    let sx = 0;
    let sz = 0;
    WAVES.forEach(([dx, dz, f, s, a]) => {
      const length = Math.hypot(dx, dz);
      const ux = dx / length;
      const uz = dz / length;
      const phase = (ux * x + uz * z) * f + time * s;
      height += Math.sin(phase) * a;
      sx += ux * f * Math.cos(phase) * a;
      sz += uz * f * Math.cos(phase) * a;
    });
    return { height: height * amp, sx: sx * amp, sz: sz * amp };
  };

  const skyUniforms = (sky.material as ShaderMaterial).uniforms;

  return {
    id: "water",
    scene,
    camera,
    update({ elapsed, window, quality: { reduced } }) {
      const still = smooth(range(window, 0, 0.85));
      const amp = mix(1, 0.02, still);
      water.uniforms.uTime.value = elapsed;
      water.uniforms.uAmp.value = amp;
      water.uniforms.uStill.value = still;
      water.uniforms.uCamera.value.copy(camera.position);

      const drift = smooth(window);
      const x = narrow ? mix(1.1, 0.15, drift) : mix(3.2, 0.9, drift);
      const z = mix(-5.2, -4.2, drift);
      const wave = waveAt(x, z, elapsed, amp * 3);
      boat.position.set(x, wave.height * 0.6 - 0.04, z);
      boat.rotation.set(wave.sz * 0.9, mix(0.5, -0.25, drift), -wave.sx * 0.9);
      (reflection.material as ShaderMaterial).uniforms.uOpacity.value = still * 0.32;

      camera.updateMatrixWorld();
      skyUniforms.uInvProjection.value.copy(camera.projectionMatrixInverse);
      skyUniforms.uCameraWorld.value.copy(camera.matrixWorld);
      return !reduced;
    },
    resize(width, height) {
      fitCamera(camera, width, height);
      narrow = width < 768;
      camera.fov = narrow ? 58 : 42;
      camera.updateProjectionMatrix();
      const moon = narrow ? MOON_DIR_NARROW : MOON_DIR;
      envUniforms.uMoonDir.value.copy(moon);
      hullMaterial.uniforms.uMoonDir.value.copy(moon);
    },
    dispose() {
      disposeTree(scene);
    },
  };
};
