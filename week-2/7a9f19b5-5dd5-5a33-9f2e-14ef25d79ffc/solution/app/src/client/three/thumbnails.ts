// Still thumbnails for catalogue cards: one shared offscreen renderer draws each fitting once, in its finish and
// light colour, to a transparent PNG.
import * as THREE from "three";
import type { FittingKind } from "../lib/format";
import { buildFitting, lightCone, poolRadiusM, webglContext } from "./fittings";

const WIDTH = 480;
const HEIGHT = 360;
const DROP_M = 0.42;
const cache = new Map<string, string>();
let renderer: THREE.WebGLRenderer | null | undefined;

function sharedRenderer(): THREE.WebGLRenderer | null {
  if (renderer !== undefined) return renderer;
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = webglContext(canvas, true);
  renderer = context
    ? new THREE.WebGLRenderer({ canvas, context, antialias: true, alpha: true, preserveDrawingBuffer: true })
    : null;
  if (renderer) {
    renderer.setSize(WIDTH, HEIGHT, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
  }
  return renderer;
}

/** A PNG data URL of the fitting, or null when WebGL is unavailable. */
export function thumbnail(kind: FittingKind, finish: string, beam: number, cct: number): string | null {
  const key = `${kind}:${finish}:${beam}:${cct}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const shared = sharedRenderer();
  if (!shared) return null;
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight("#ffffff", 0.9));
  const key1 = new THREE.DirectionalLight("#fff4e6", 1.6);
  key1.position.set(1, 1.4, 2);
  scene.add(key1);
  const model = buildFitting(kind, finish, cct).group;
  model.rotation.y = THREE.MathUtils.degToRad(28);
  const cone = lightCone(cct, 0.5);
  const radius = poolRadiusM(DROP_M, beam);
  cone.scale.set(radius, DROP_M, radius);
  scene.add(model, cone);
  const box = new THREE.Box3().setFromObject(model).union(
    new THREE.Box3(new THREE.Vector3(-radius, -DROP_M, -radius), new THREE.Vector3(radius, 0, radius)),
  );
  const centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const camera = new THREE.PerspectiveCamera(30, WIDTH / HEIGHT, 0.01, 20);
  const distance = (Math.max(size.y, size.x / camera.aspect) * 1.25) / 2 / Math.tan(THREE.MathUtils.degToRad(15));
  camera.position.set(centre.x, centre.y + distance * 0.18, centre.z + distance);
  camera.lookAt(centre);
  shared.render(scene, camera);
  const url = shared.domElement.toDataURL("image/png");
  cache.set(key, url);
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh) object.geometry.dispose();
  });
  return url;
}
