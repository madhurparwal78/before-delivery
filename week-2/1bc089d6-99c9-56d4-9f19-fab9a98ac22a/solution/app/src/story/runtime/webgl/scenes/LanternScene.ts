import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Line,
  LineBasicMaterial,
  Mesh,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
} from "three";

import type { SceneFactory } from "../types";
import {
  COLORSPACE_FRAGMENT,
  PALETTE,
  createGlowDisc,
  createSky,
  disposeTree,
  fitCamera,
  mix,
  smooth,
  viewExtents,
} from "./common";

const DISTANCE = 9;
const HOOPS = 9;

/** The lantern's outline: a round paper body pinched toward its top and bottom rims. */
function lanternProfile(points: number) {
  const profile: Vector2[] = [];
  for (let i = 0; i <= points; i++) {
    const t = i / points;
    const y = -1 + t * 2;
    const body = Math.sqrt(Math.max(0, 1 - y * y * 0.94));
    const bulge = 1 - 0.03 * Math.cos(t * Math.PI * 2 * HOOPS);
    profile.push(new Vector2(Math.max(0.3, body) * bulge, y * 1.08));
  }
  return profile;
}

/**
 * Lights out: a paper lantern glowing in the dark at the end of the page. Its flame flickers (frozen
 * under reduced motion) and shrinks across the footer's window progress, out at 1, as the whole scene
 * sinks to near-black.
 */
export const createLanternScene: SceneFactory = (quality) => {
  const scene = new Scene();
  const camera = new PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0, DISTANCE);
  camera.lookAt(0, 0, 0);

  const top = new Color("#1c1638");
  const horizon = new Color("#2b2050");
  const sky = createSky(top, horizon, PALETTE.night, 0.3);
  sky.material.uniforms.uGlow.value = 0;
  scene.add(sky.mesh);

  const rig = new Group();
  scene.add(rig);

  const halo = createGlowDisc(new Color("#ff9d4d"), { core: 0, halo: 1 });
  halo.mesh.position.z = -1.2;
  halo.mesh.scale.setScalar(7.5);
  rig.add(halo.mesh);

  const lantern = new Group();
  rig.add(lantern);

  const paper = new ShaderMaterial({
    uniforms: {
      uFlame: { value: 1 },
      uFlicker: { value: 1 },
      uEdge: { value: new Color("#c4521c") },
      uWarm: { value: new Color("#ff9a45") },
      uHot: { value: new Color("#fff1c8") },
      uDark: { value: new Color("#1b1533") },
      uRim: { value: new Color("#5b4d8c") },
    },
    vertexShader: /* glsl */ `
      varying vec3 vLocal;
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec2 vUv;
      void main() {
        vLocal = position;
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-view.xyz);
        gl_Position = projectionMatrix * view;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uFlame;
      uniform float uFlicker;
      uniform vec3 uEdge;
      uniform vec3 uWarm;
      uniform vec3 uHot;
      uniform vec3 uDark;
      uniform vec3 uRim;
      varying vec3 vLocal;
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec2 vUv;
      void main() {
        float facing = clamp(dot(normalize(vNormal), normalize(vView)), 0.0, 1.0);
        float through = pow(facing, 0.9);
        float hot = exp(-pow((vLocal.y + 0.2) * 1.3, 2.0)) * pow(facing, 2.2);
        float rib = 1.0 - smoothstep(0.0, 0.03, abs(fract(vUv.x * 16.0) - 0.5) - 0.47);
        float hoop = 1.0 - smoothstep(0.0, 0.025, abs(fract(vUv.y * ${HOOPS}.0 + 0.5) - 0.5) - 0.475);
        rib = 1.0 - rib;
        hoop = 1.0 - hoop;
        float frame = max(rib * 0.55, hoop);
        float light = uFlame * uFlicker;
        vec3 paper = mix(uEdge, uWarm, smoothstep(0.0, 0.7, through));
        paper = mix(paper, uHot, smoothstep(0.25, 1.0, hot));
        vec3 glow = paper * (0.35 + 0.9 * through + 0.9 * hot) * light * 1.25;
        glow *= 1.0 - frame * 0.75;
        float rim = pow(1.0 - facing, 3.0) * 0.35;
        vec3 color = uDark * (1.0 - frame * 0.3) + uRim * rim + glow;
        gl_FragColor = vec4(color, 1.0);
        ${COLORSPACE_FRAGMENT}
      }
    `,
    toneMapped: false,
  });
  const body = new Mesh(new LatheGeometry(lanternProfile(quality.software ? 48 : 80), quality.software ? 40 : 64), paper);
  lantern.add(body);

  const rimMaterial = new ShaderMaterial({
    uniforms: { uColor: { value: new Color("#120e22") }, uGlow: { value: new Color("#7a4a2a") }, uFlame: { value: 1 } },
    vertexShader: "varying vec3 vNormal;\nvoid main() {\n  vNormal = normalize(normalMatrix * normal);\n  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n}",
    fragmentShader: `uniform vec3 uColor;\nuniform vec3 uGlow;\nuniform float uFlame;\nvarying vec3 vNormal;\nvoid main() {\n  float side = 0.5 + 0.5 * vNormal.x;\n  gl_FragColor = vec4(uColor + uGlow * uFlame * 0.4 * side, 1.0);\n  ${COLORSPACE_FRAGMENT}\n}`,
    toneMapped: false,
  });
  const capTop = new Mesh(new CylinderGeometry(0.34, 0.36, 0.12, 32), rimMaterial);
  capTop.position.y = 1.1;
  const capBottom = new Mesh(new CylinderGeometry(0.36, 0.32, 0.1, 32), rimMaterial);
  capBottom.position.y = -1.1;
  lantern.add(capTop, capBottom);

  const cord = new Line(
    new BufferGeometry().setFromPoints([new Vector3(0, 1.15, 0), new Vector3(0, 12, 0)]),
    new LineBasicMaterial({ color: new Color("#3a2f5e") }),
  );
  lantern.add(cord);

  const pool = createGlowDisc(new Color("#ff9d4d"), { core: 0, halo: 1 });
  pool.mesh.rotation.x = -Math.PI / 2.4;
  pool.mesh.scale.set(6, 2.2, 1);
  rig.add(pool.mesh);


  const darkLit = new Color("#1b1533");
  const darkOut = new Color("#0b0917");
  const rimLit = new Color("#5b4d8c");
  const rimOut = new Color("#241d40");
  const topNight = top.clone();
  const horizonNight = horizon.clone();

  return {
    id: "lantern",
    scene,
    camera,
    update({ elapsed, window, quality: { reduced } }) {
      const out = smooth(window);
      const flame = 1 - out;
      const flicker = 0.9 + 0.06 * Math.sin(elapsed * 9.3) + 0.04 * Math.sin(elapsed * 23.1 + 1.7);
      paper.uniforms.uFlame.value = flame;
      paper.uniforms.uFlicker.value = flicker;
      rimMaterial.uniforms.uFlame.value = flame;
      paper.uniforms.uDark.value.copy(darkLit).lerp(darkOut, out);
      paper.uniforms.uRim.value.copy(rimLit).lerp(rimOut, out);
      halo.material.uniforms.uOpacity.value = flame * flicker * 0.95;
      halo.mesh.scale.setScalar(mix(3.5, 7.5, flame));
      pool.material.uniforms.uOpacity.value = flame * 0.35;
      sky.material.uniforms.uTop.value.copy(topNight).lerp(PALETTE.black, out);
      sky.material.uniforms.uHorizon.value.copy(horizonNight).lerp(PALETTE.black, out);
      return !reduced && flame > 0;
    },
    resize(width, height) {
      fitCamera(camera, width, height);
      const narrow = width < 768;
      const { halfWidth, halfHeight } = viewExtents(camera, DISTANCE);
      const size = narrow ? Math.min(halfHeight * 0.3, halfWidth * 0.55) : halfHeight * 0.38;
      rig.position.set(narrow ? 0 : halfWidth * 0.3, halfHeight * (narrow ? 0.3 : 0.12), 0);
      lantern.scale.setScalar(size);
      halo.mesh.scale.setScalar(size * 7);
      pool.mesh.position.set(0, -size * 2.6, 0);
    },
    dispose() {
      disposeTree(scene);
    },
  };
};
