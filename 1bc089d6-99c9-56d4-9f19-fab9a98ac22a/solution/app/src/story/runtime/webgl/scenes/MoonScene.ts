import {
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  PerspectiveCamera,
  RGBAFormat,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";

import type { SceneFactory } from "../types";
import {
  COLORSPACE_FRAGMENT,
  PALETTE,
  createGlowDisc,
  createNoise,
  createSky,
  createStars,
  disposeTree,
  fitCamera,
  mix,
  random,
  viewExtents,
} from "./common";

const DISTANCE = 10;

/** An equirectangular moon map made in code: R = albedo (maria are darker), G = height (craters with rims). */
function moonMap(width: number, height: number, craters: number) {
  const { fbm } = createNoise(91);
  const rand = random(93);
  const albedo = new Float32Array(width * height);
  const relief = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const lat = (y / height - 0.5) * Math.PI;
    for (let x = 0; x < width; x++) {
      const lon = (x / width) * Math.PI * 2;
      const sx = Math.cos(lat) * Math.cos(lon);
      const sz = Math.cos(lat) * Math.sin(lon);
      const sy = Math.sin(lat);
      const large = (fbm(sx * 1.5 + 4.2, sy * 1.5 + 1.1, 5) + fbm(sz * 1.5 - 2.7, sy * 1.5 + 6.3, 5)) * 0.5;
      const maria = Math.min(1, Math.max(0, (large - 0.46) / 0.07));
      const grain = (fbm(sx * 11 + 3.1, sy * 11, 3) + fbm(sz * 11, sy * 11 - 5.2, 3)) * 0.5;
      albedo[y * width + x] = 0.82 - maria * 0.36 + (grain - 0.5) * 0.16;
      relief[y * width + x] = (grain - 0.5) * 0.3 - maria * 0.15;
    }
  }
  for (let c = 0; c < craters; c++) {
    const size = Math.pow(rand(), 3.2);
    const radius = 1.5 + size * width * 0.028;
    const cx = rand() * width;
    const cy = height * (0.12 + rand() * 0.76);
    const lat = (cy / height - 0.5) * Math.PI;
    const stretch = 1 / Math.max(0.25, Math.cos(lat));
    const young = rand() < 0.25;
    for (let dy = -radius * 1.6; dy <= radius * 1.6; dy++) {
      for (let dx = -radius * 1.6 * stretch; dx <= radius * 1.6 * stretch; dx++) {
        const px = Math.round(cx + dx);
        const py = Math.round(cy + dy);
        if (py < 0 || py >= height) continue;
        const ix = ((px % width) + width) % width;
        const d = Math.hypot(dx / stretch, dy) / radius;
        if (d > 1.6) continue;
        const bowl = d < 1 ? -(1 - d * d) * 0.9 : 0;
        const rim = Math.exp(-((d - 1) ** 2) * 18) * 0.45;
        const index = py * width + ix;
        relief[index] += (bowl + rim) * (0.25 + size * 0.8);
        albedo[index] += rim * 0.06 + (young && d < 1.6 ? 0.09 * (1.6 - d) : 0) - (d < 0.9 ? 0.015 : 0);
      }
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = Math.round(Math.min(1, Math.max(0, albedo[i])) * 255);
    data[i * 4 + 1] = Math.round(Math.min(1, Math.max(0, relief[i] * 0.5 + 0.5)) * 255);
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 255;
  }
  const texture = new DataTexture(data, width, height, RGBAFormat);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Behind the ritual cards: a moon that turns through its phases across the chapter's window progress,
 * from new, through a crescent lit on the right, to full, and back through a crescent lit on the left to new.
 */
export const createMoonScene: SceneFactory = (quality) => {
  const scene = new Scene();
  const camera = new PerspectiveCamera(35, 1, 0.1, 200);
  camera.position.set(0, 0, DISTANCE);
  camera.lookAt(0, 0, 0);

  const sky = createSky(new Color("#120e2a"), new Color("#1c1640"), PALETTE.night, 0.4);
  sky.material.uniforms.uGlow.value = 0;
  scene.add(sky.mesh);
  const stars = createStars(Math.round(1400 * quality.density) + 400, 101, { minY: -1, size: 1.9 });
  stars.material.uniforms.uPixelRatio.value = quality.pixelRatio * quality.renderScale;
  stars.points.position.z = DISTANCE;
  scene.add(stars.points);

  const halo = createGlowDisc(new Color("#cfc6ff"), { core: 0, halo: 1 });
  scene.add(halo.mesh);

  const map = quality.software ? moonMap(512, 256, 70) : moonMap(1024, 512, 150);
  const material = new ShaderMaterial({
    uniforms: {
      uMap: { value: map },
      uSun: { value: new Vector3(0, 0, 1) },
      uTint: { value: PALETTE.moon.clone() },
      uDark: { value: new Color("#2a2350") },
      uTexel: { value: 1 / map.image.width },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vTangent;
      void main() {
        vUv = uv;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vTangent = normalize(mat3(modelMatrix) * vec3(-sin(uv.x * 6.2831853), 0.0, -cos(uv.x * 6.2831853)));
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uSun;
      uniform vec3 uTint;
      uniform vec3 uDark;
      uniform float uTexel;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vTangent;
      void main() {
        vec4 texel = texture2D(uMap, vUv);
        float hx = texture2D(uMap, vUv + vec2(uTexel, 0.0)).g - texture2D(uMap, vUv - vec2(uTexel, 0.0)).g;
        float hy = texture2D(uMap, vUv + vec2(0.0, uTexel * 2.0)).g - texture2D(uMap, vUv - vec2(0.0, uTexel * 2.0)).g;
        vec3 n = normalize(vNormal);
        vec3 t = normalize(vTangent - n * dot(vTangent, n));
        vec3 b = cross(n, t);
        float facing = dot(n, uSun);
        float grazing = 1.0 - smoothstep(0.0, 0.7, facing);
        vec3 bumped = normalize(n - (t * hx + b * hy) * mix(0.5, 2.4, grazing));
        float light = pow(max(dot(bumped, uSun), 0.0), 0.6) * smoothstep(-0.06, 0.14, facing);
        vec3 lit = uTint * texel.r * (0.01 + 1.32 * light);
        vec3 earthshine = uDark * texel.r * 0.12 * (1.0 - smoothstep(-0.1, 0.25, facing));
        gl_FragColor = vec4(lit + earthshine, 1.0);
        ${COLORSPACE_FRAGMENT}
      }
    `,
    toneMapped: false,
  });
  const segments = quality.software ? 56 : 96;
  const moon = new Mesh(new SphereGeometry(1, segments, Math.round(segments * 0.66)), material);
  moon.rotation.set(0.18, -0.6, 0.08);
  scene.add(moon);

  let radius = 1;
  const centre = new Vector3();
  const sun = new Vector3();

  return {
    id: "moon",
    scene,
    camera,
    update({ progress, window }) {
      const angle = Math.PI * Math.cos(Math.PI * window);
      sun.set(Math.sin(angle), 0.12, Math.cos(angle)).normalize();
      material.uniforms.uSun.value.copy(sun);
      const lit = (1 + Math.cos(angle)) / 2;
      halo.material.uniforms.uOpacity.value = 0.1 + lit * 0.75;
      halo.mesh.scale.setScalar(radius * mix(3.2, 4.6, lit));
      moon.rotation.y = -0.6 + progress * 0.25;
      stars.material.uniforms.uOpacity.value = mix(0.75, 0.45, lit);
      return false;
    },
    resize(width, height) {
      fitCamera(camera, width, height);
      const narrow = width < 768;
      const { halfWidth, halfHeight } = viewExtents(camera, DISTANCE);
      radius = narrow ? Math.min(halfHeight * 0.24, halfWidth * 0.55) : halfHeight * 0.3;
      centre.set(narrow ? 0 : halfWidth * 0.46, halfHeight * (narrow ? 0.6 : 0.5), 0);
      moon.position.copy(centre);
      moon.scale.setScalar(radius);
      halo.mesh.position.copy(centre).setZ(-0.5);
    },
    dispose() {
      disposeTree(scene);
    },
  };
};
