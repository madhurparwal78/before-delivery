import { BufferAttribute, Color, Mesh, PerspectiveCamera, PlaneGeometry, Scene, ShaderMaterial, Vector3 } from "three";

import type { SceneFactory } from "../types";
import {
  COLORSPACE_FRAGMENT,
  NOISE_GLSL,
  PALETTE,
  createGlowDisc,
  createNoise,
  createSky,
  createStars,
  disposeTree,
  fitCamera,
  mix,
  range,
  smooth,
} from "./common";

const TERRAIN_WIDTH = 140;
const TERRAIN_DEPTH = 78;
const TERRAIN_NEAR = 10;
const SUN_X = 14;
const SUN_X_NARROW = 3.5;
const SUN_Z = -64;

/** Height of the land at (x, z): a calm valley up close, rolling ridges toward the horizon. */
function heightField(seed: number) {
  const { fbm } = createNoise(seed);
  return (x: number, z: number) => {
    const far = smooth(range(z, -4, -60));
    const ridge = fbm(x * 0.045 + 3.1, z * 0.05 - 1.7) * 2 - 0.55;
    const swell = fbm(x * 0.11, z * 0.11 + 8.3) - 0.5;
    const valley = 1 - Math.exp(-((x * 0.09) ** 2));
    return ridge * mix(1.6, 6.4, far) * mix(0.55, 1, valley) + swell * mix(1.3, 1.6, far) - 0.6;
  };
}

/**
 * Hero: a dusk landscape drawn only with glowing contour lines under a low ember sun.
 * Scrolling through the hero sinks the sun to the horizon, cools the lines from ember to violet
 * and brings the stars out. Only scroll moves it.
 */
export const createDuskScene: SceneFactory = (quality) => {
  const scene = new Scene();
  const camera = new PerspectiveCamera(38, 1, 0.1, 400);
  const base = new Vector3(0, 2.6, 9);
  const target = new Vector3(0, 2.1, -30);

  const sky = createSky(PALETTE.night2, PALETTE.ember, PALETTE.night, 0.52);
  sky.material.uniforms.uLift.value = 0.38;
  scene.add(sky.mesh);

  const stars = createStars(Math.round(900 * quality.density) + 200, 11, { minY: 0.03, size: 1.7 });
  stars.material.uniforms.uPixelRatio.value = quality.pixelRatio * quality.renderScale;
  scene.add(stars.points);

  const sun = createGlowDisc(PALETTE.ember, { core: 0.2, halo: 1.25 });
  sun.mesh.scale.setScalar(26);
  scene.add(sun.mesh);

  const segments = quality.software ? 110 : 200;
  const geometry = new PlaneGeometry(TERRAIN_WIDTH, TERRAIN_DEPTH, segments, Math.round(segments * 0.6));
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0, TERRAIN_NEAR - TERRAIN_DEPTH / 2);
  const height = heightField(7);
  const positions = geometry.getAttribute("position") as BufferAttribute;
  for (let i = 0; i < positions.count; i++) {
    positions.setY(i, height(positions.getX(i), positions.getZ(i)));
  }
  positions.needsUpdate = true;
  geometry.computeBoundingSphere();

  const land = new ShaderMaterial({
    uniforms: {
      uWarm: { value: PALETTE.ember.clone() },
      uCool: { value: PALETTE.dusk4.clone() },
      uGround: { value: PALETTE.night.clone() },
      uFog: { value: PALETTE.dusk6.clone() },
      uCooling: { value: 0 },
      uFlow: { value: 0 },
      uSunX: { value: SUN_X },
      uDensity: { value: 3.4 },
    },
    vertexShader: /* glsl */ `
      varying float vHeight;
      varying vec3 vWorld;
      varying float vDepth;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vHeight = position.y;
        vec4 view = viewMatrix * world;
        vDepth = -view.z;
        gl_Position = projectionMatrix * view;
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      uniform vec3 uWarm;
      uniform vec3 uCool;
      uniform vec3 uGround;
      uniform vec3 uFog;
      uniform float uCooling;
      uniform float uFlow;
      uniform float uSunX;
      uniform float uDensity;
      varying float vHeight;
      varying vec3 vWorld;
      varying float vDepth;
      void main() {
        float detail = shNoise(vWorld.xz * 0.55) - 0.5;
        float c = (vHeight + detail * 0.22) * uDensity + uFlow;
        float f = fract(c);
        float dist = min(f, 1.0 - f);
        float w = max(fwidth(c), 1e-4);
        float line = 1.0 - smoothstep(w * 0.55, w * 1.6, dist);
        float halo = exp(-dist * 9.0) * 0.26 * (1.0 - smoothstep(18.0, 55.0, vDepth));
        float major = 1.0 - step(0.5, mod(floor(c + 0.5), 5.0));
        line = line * mix(0.6, 1.15, major) + halo * mix(0.6, 1.0, major);
        line *= 1.0 - smoothstep(30.0, 78.0, vDepth) * 0.75;
        float fog = smoothstep(12.0, 72.0, vDepth);
        float sunward = exp(-pow((vWorld.x - uSunX) * 0.035, 2.0)) * smoothstep(8.0, 60.0, vDepth);
        vec3 lineColor = mix(uWarm, uCool, uCooling);
        lineColor = mix(lineColor, uWarm * 1.15, sunward * (1.0 - uCooling * 0.7));
        float glow = line * mix(1.25, 0.55, fog);
        vec3 ground = mix(uGround, uFog, pow(fog, 1.6) * 0.75);
        vec3 color = ground + lineColor * glow;
        gl_FragColor = vec4(color, 1.0);
        ${COLORSPACE_FRAGMENT}
      }
    `,
    toneMapped: false,
  });
  const terrain = new Mesh(geometry, land);
  scene.add(terrain);

  const horizonWarm = PALETTE.ember.clone();
  const horizonCool = PALETTE.dusk5.clone();
  const topWarm = new Color("#2a2052");
  const topCool = PALETTE.night.clone();
  let sunX = SUN_X;

  return {
    id: "dusk",
    scene,
    camera,
    update({ progress, window }) {
      // The sun sinks to the horizon across the hero's window progress; leaving the hero cools the land.
      const sinking = smooth(window);
      const leaving = range(progress, 0.62, 0.96);
      const cooling = smooth(Math.max(sinking * 0.55, leaving));

      sun.mesh.position.set(sunX, mix(5.2, -1.4, sinking) - leaving * 3, SUN_Z);
      sun.mesh.lookAt(camera.position);
      sun.material.uniforms.uOpacity.value = mix(1, 0.35, cooling);
      sun.material.uniforms.uColor.value.copy(PALETTE.emberStrong).lerp(PALETTE.ember, sinking);

      sky.material.uniforms.uHorizon.value.copy(horizonWarm).lerp(horizonCool, cooling);
      sky.material.uniforms.uTop.value.copy(topWarm).lerp(topCool, cooling);
      sky.material.uniforms.uGlow.value = mix(1.25, 0.35, cooling);

      stars.material.uniforms.uOpacity.value = 0.12 + smooth(range(cooling, 0.05, 0.85)) * 0.88;

      land.uniforms.uCooling.value = cooling;
      land.uniforms.uFog.value.copy(sky.material.uniforms.uHorizon.value).multiplyScalar(mix(0.55, 0.7, cooling));
      land.uniforms.uFlow.value = sinking * 0.6;

      camera.position.set(base.x, base.y + leaving * 0.6, base.z - leaving * 1.8);
      camera.lookAt(target.x, target.y - leaving * 0.4, target.z);
      return false;
    },
    resize(width, height) {
      fitCamera(camera, width, height);
      camera.fov = width < 768 ? 52 : 38;
      sunX = width < 768 ? SUN_X_NARROW : SUN_X;
      land.uniforms.uSunX.value = sunX;
      sky.material.uniforms.uHorizonY.value = width < 768 ? 0.5 : 0.52;
      camera.updateProjectionMatrix();
    },
    dispose() {
      disposeTree(scene);
    },
  };
};
