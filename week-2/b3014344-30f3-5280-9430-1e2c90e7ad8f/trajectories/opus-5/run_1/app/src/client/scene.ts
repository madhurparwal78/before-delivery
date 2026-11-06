import * as THREE from "three";
import { prefersReducedMotion, qsa } from "./dom.js";

const SECTIONS = ["hero", "work", "process", "pricing", "contact"] as const;
type SectionName = (typeof SECTIONS)[number];

const SECTION_SPACING = 14;
const CAMERA_DISTANCE = 11;
const TURN_SECONDS = 37.5;
const CATCH_UP_SECONDS = 1 / 3;

const INK = 0x14110f;
const BONE = 0xf3eee4;
const COBALT = 0x1b4dd1;
const SEAM = 0xd8471f;

function monolith(): THREE.Object3D {
  const group = new THREE.Group();
  const slab = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.35, 6, 7, 1),
    new THREE.MeshStandardMaterial({ color: INK, flatShading: true, roughness: 0.6 }),
  );
  const seam = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 6, 0.08),
    new THREE.MeshStandardMaterial({ color: SEAM }),
  );
  seam.position.set(1.0, 0, 0.8);
  group.add(slab, seam);
  return group;
}

function cardDeck(count: number): THREE.Object3D {
  const group = new THREE.Group();
  const geometry = new THREE.BoxGeometry(3.2, 4.4, 0.08);
  for (let index = 0; index < Math.max(1, count); index += 1) {
    const card = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: index % 2 === 0 ? BONE : COBALT, roughness: 0.5 }),
    );
    card.position.set(index * 0.4 - count * 0.2, -index * 0.25, index * -0.6);
    card.rotation.z = (index % 2 === 0 ? 1 : -1) * 0.05;
    group.add(card);
  }
  return group;
}

function processRail(): THREE.Object3D {
  const group = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-6, -2.5, 0),
    new THREE.Vector3(-2, 0.5, 1),
    new THREE.Vector3(2, 1.5, -1),
    new THREE.Vector3(6, 3, 0),
  ]);
  const rail = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 48, 0.08, 8, false),
    new THREE.MeshStandardMaterial({ color: INK }),
  );
  group.add(rail);
  for (let index = 0; index < 4; index += 1) {
    const bead = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 20, 16),
      new THREE.MeshStandardMaterial({ color: index === 0 ? SEAM : COBALT, roughness: 0.4 }),
    );
    bead.position.copy(curve.getPoint(index / 3));
    group.add(bead);
  }
  return group;
}

function foldingSheet(): { object: THREE.Object3D; left: THREE.Object3D; right: THREE.Object3D } {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: 0xe4dbcc,
    roughness: 0.9,
    side: THREE.DoubleSide,
  });
  const left = new THREE.Mesh(new THREE.PlaneGeometry(4, 5.4), material);
  const right = new THREE.Mesh(new THREE.PlaneGeometry(4, 5.4), material);
  const leftPivot = new THREE.Group();
  const rightPivot = new THREE.Group();
  left.position.x = -2;
  right.position.x = 2;
  leftPivot.add(left);
  rightPivot.add(right);
  const crease = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 5.4, 0.05),
    new THREE.MeshStandardMaterial({ color: SEAM }),
  );
  group.add(leftPivot, rightPivot, crease);
  return { object: group, left: leftPivot, right: rightPivot };
}

export function startScene(container: HTMLElement): void {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    container.dataset.sceneMode = "still";
    return;
  }
  if (!renderer.getContext()) {
    container.dataset.sceneMode = "still";
    return;
  }
  container.dataset.sceneMode = "webgl";
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  const canvas = renderer.domElement;
  canvas.setAttribute("aria-hidden", "true");
  canvas.classList.add("scene-canvas");
  container.prepend(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 200);
  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(4, 8, 10);
  scene.add(key);

  const deckCount = qsa("[data-case-card]").length;
  const sheet = foldingSheet();
  const monolithObject = monolith();
  const objects: Record<SectionName, THREE.Object3D> = {
    hero: monolithObject,
    work: cardDeck(deckCount),
    process: processRail(),
    pricing: sheet.object,
    contact: new THREE.Mesh(
      new THREE.TorusGeometry(2.2, 0.26, 16, 48),
      new THREE.MeshStandardMaterial({ color: COBALT }),
    ),
  };
  SECTIONS.forEach((name, index) => {
    const object = objects[name];
    object.position.z = -index * SECTION_SPACING;
    scene.add(object);
  });

  const sectionElements = (): Array<{ name: SectionName; element: HTMLElement }> =>
    SECTIONS.flatMap((name) => {
      const element = document.querySelector<HTMLElement>(`[data-section="${name}"]`);
      return element ? [{ name, element }] : [];
    });

  const quoteRegion = document.querySelector<HTMLElement>('[data-section="pricing"] [data-quote]');

  let cameraZ = CAMERA_DISTANCE;
  let turn = 0;
  let last = performance.now();

  const scrollProgress = (): { index: number; fraction: number; name: SectionName } => {
    const items = sectionElements();
    const middle = window.innerHeight / 2;
    let current = 0;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!item) continue;
      if (item.element.getBoundingClientRect().top <= middle) current = index;
    }
    const item = items[current];
    if (!item) return { index: 0, fraction: 0, name: "hero" };
    const rect = item.element.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (middle - rect.top) / Math.max(1, rect.height)));
    return { index: current, fraction, name: item.name };
  };

  const render = (now: number): void => {
    const delta = Math.min(0.1, (now - last) / 1000);
    last = now;
    const reduced = prefersReducedMotion();
    const position = scrollProgress();
    container.dataset.sceneSection = position.name;

    const distance = CAMERA_DISTANCE * Math.min(2.4, Math.max(1, 1100 / window.innerWidth));
    const targetZ = distance - (position.index + (reduced ? 0 : position.fraction)) * SECTION_SPACING;
    if (reduced) {
      cameraZ = targetZ;
    } else {
      const factor = 1 - Math.exp(-delta / CATCH_UP_SECONDS);
      cameraZ += (targetZ - cameraZ) * factor;
    }
    camera.position.set(0, 0.4, cameraZ);
    camera.lookAt(0, 0, cameraZ - distance);
    for (const name of SECTIONS) objects[name].visible = name === position.name;

    if (!reduced && position.name === "hero") {
      turn = (turn + (360 / TURN_SECONDS) * delta) % 360;
      monolithObject.rotation.y = (turn * Math.PI) / 180;
    }
    container.dataset.sceneTurn = turn.toFixed(1);

    const tilt = Number(quoteRegion?.dataset.tilt ?? "0");
    sheet.left.rotation.y = (tilt * Math.PI) / 180;
    sheet.right.rotation.y = (-tilt * Math.PI) / 180;

    renderer.render(scene, camera);
    window.requestAnimationFrame(render);
  };
  window.requestAnimationFrame(render);

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}
