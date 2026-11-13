import {
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  PointLight,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { EDITION_SIZE, type Chapter } from '../../shared/copy.js';
import { chapterAt, strikeChapters } from './chapters.js';
import { buildVision } from './visions.js';

export type ShelfCellState = 'available' | 'held' | 'yours' | 'taken';

export interface CellRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SceneReadout {
  progress: number;
  chapter: Chapter;
  cameraPosition: { x: number; y: number; z: number };
  lightIntensity: number;
  litMatches: number;
  holdRemainingMs: number | null;
  matchLength: number | null;
}

export interface SceneHandle {
  readonly readout: SceneReadout;
  setProgress(progress: number): void;
  strike(): boolean;
  burning(): boolean;
  setShelfStates(states: ShelfCellState[]): void;
  setShelfCells(cells: CellRect[]): void;
  focusBox(boxNumber: number | null): void;
  setHold(remainingMs: number | null, holdMs: number): void;
}

export interface SceneOptions {
  canvas: HTMLCanvasElement;
  reducedMotion: boolean;
  onMatchOut: (bundle: boolean) => void;
}

const BURN_MS = 12_000;
const SPARK_MS = 180;
const FLARE_MS = 320;
const RISE_MS = 900;
const SHELF_Z = -27;

const cameraWaypoints = [
  new Vector3(0, 1.7, 16),
  new Vector3(-1.6, 1.7, 9),
  new Vector3(1.6, 1.7, 3),
  new Vector3(-1.6, 1.8, -3),
  new Vector3(0.4, 2.6, -9),
  new Vector3(0, 1.9, -15),
  new Vector3(0, 2, -21.5),
];

const targetWaypoints = [
  new Vector3(0, 1.4, 8),
  new Vector3(-3.2, 1.2, 8.6),
  new Vector3(3.2, 1.2, 2.6),
  new Vector3(-3.2, 1.4, -3.4),
  new Vector3(0.5, 3.2, -9.5),
  new Vector3(0, 2, -15.4),
  new Vector3(0, 2, SHELF_Z),
];

const visionPlaces: Partial<Record<Chapter, Vector3>> = {
  stove: new Vector3(-3.2, 0, 8.6),
  goose: new Vector3(3.2, 0, 2.6),
  tree: new Vector3(-3.2, 0, -3.4),
  star: new Vector3(0.5, 0, -9.5),
  grandmother: new Vector3(0, 0, -15.4),
};

const cellColours: Record<ShelfCellState, number> = {
  available: 0x39404e,
  held: 0x4b5360,
  yours: 0x6d5524,
  taken: 0x11151f,
};

export function webglAvailable(): boolean {
  try {
    const probe = document.createElement('canvas');
    return probe.getContext('webgl2') !== null || probe.getContext('webgl') !== null;
  } catch {
    return false;
  }
}

export function createScene(options: SceneOptions): SceneHandle {
  const renderer = new WebGLRenderer({ canvas: options.canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.setClearColor(0x070b14, 1);

  const scene = new Scene();
  const camera = new PerspectiveCamera(52, 1, 0.1, 200);
  scene.add(camera);

  const cameraCurve = new CatmullRomCurve3(cameraWaypoints, false, 'catmullrom', 0.15);
  cameraCurve.arcLengthDivisions = 4000;
  const targetCurve = new CatmullRomCurve3(targetWaypoints, false, 'catmullrom', 0.15);
  targetCurve.arcLengthDivisions = 2000;

  scene.add(new AmbientLight(0x1b2538, 0.55));
  const moon = new DirectionalLight(0x9fb6d8, 0.3);
  moon.position.set(-6, 16, 8);
  scene.add(moon);

  const ground = new Mesh(
    new PlaneGeometry(60, 96),
    new MeshStandardMaterial({ color: 0xbdcbdd, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.z = -6;
  ground.receiveShadow = true;
  scene.add(ground);

  const brick = new MeshStandardMaterial({ color: 0x19202e, roughness: 0.95 });
  for (const side of [-1, 1]) {
    const wall = new Mesh(new BoxGeometry(1.2, 13, 58), brick);
    wall.position.set(side * 5.6, 6.5, -6);
    wall.receiveShadow = true;
    scene.add(wall);
  }
  const windowGlow = new MeshStandardMaterial({ color: 0x2a3348, emissive: 0x6d5a24, roughness: 0.6 });
  for (let pane = 0; pane < 20; pane += 1) {
    const side = pane % 2 === 0 ? -1 : 1;
    const sill = new Mesh(new PlaneGeometry(0.8, 1.1), windowGlow);
    sill.position.set(side * 4.98, 2.6 + (pane % 3) * 2.4, 13 - pane * 2);
    sill.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    scene.add(sill);
  }

  const snow = makeSnow();
  scene.add(snow.points);

  const visions = new Map<Chapter, Group>();
  for (const chapter of strikeChapters) {
    const vision = buildVision(chapter);
    if (vision === null) continue;
    const place = visionPlaces[chapter];
    if (place !== undefined) vision.position.copy(place);
    vision.visible = false;
    visions.set(chapter, vision);
    scene.add(vision);
  }

  const storyMatch = makeMatch();
  storyMatch.group.position.set(0.3, -0.26, -0.8);
  storyMatch.group.scale.setScalar(0.28);
  camera.add(storyMatch.group);
  const flameLight = new PointLight(0xffb347, 0, 30, 2);
  flameLight.castShadow = true;
  flameLight.shadow.mapSize.set(512, 512);
  flameLight.position.set(0.3, -0.1, -0.8);
  camera.add(flameLight);

  const shelf = makeShelf(scene);

  const holdMatch = makeMatch();
  holdMatch.group.visible = false;
  scene.add(holdMatch.group);
  const holdLight = new PointLight(0xffb347, 0, 3.2, 2);
  scene.add(holdLight);

  const readout: SceneReadout = {
    progress: 0,
    chapter: 'alley',
    cameraPosition: { x: 0, y: 0, z: 0 },
    lightIntensity: 0,
    litMatches: 0,
    holdRemainingMs: null,
    matchLength: null,
  };

  let progress = 0;
  let strikeAt: number | null = null;
  let litChapter: Chapter | null = null;
  let outAt: number | null = null;
  let holdRemainingMs: number | null = null;
  let holdFullMs = 1;
  let focused: number | null = null;
  let focusStart = 0;
  let focusFrom = new Vector3();
  let focusLookFrom = new Vector3();
  let settling = false;

  const clamped = (): number => Math.min(1, Math.max(0, progress));
  const isBundle = (chapter: Chapter | null): boolean => chapter === 'grandmother';

  function lookPoint(): Vector3 {
    return new Vector3(0, 0, -1).applyQuaternion(camera.quaternion).multiplyScalar(6).add(camera.position);
  }

  function updateCamera(now: number): void {
    const pathPoint = cameraCurve.getPointAt(clamped());
    const pathTarget = targetCurve.getPointAt(clamped());
    if (focused !== null) {
      const box = shelf.centreOf(focused);
      const wanted = new Vector3(box.x * 0.4, box.y * 0.35 + 1.3, SHELF_Z + 2.2);
      const ratio = options.reducedMotion ? 1 : Math.min(1, (now - focusStart) / 700);
      const eased = 1 - (1 - ratio) ** 3;
      camera.position.lerpVectors(focusFrom, wanted, eased);
      camera.lookAt(new Vector3().lerpVectors(focusLookFrom, box, eased));
      return;
    }
    if (settling) {
      const ratio = options.reducedMotion ? 1 : Math.min(1, (now - focusStart) / 700);
      const eased = 1 - (1 - ratio) ** 3;
      camera.position.lerpVectors(focusFrom, pathPoint, eased);
      camera.lookAt(new Vector3().lerpVectors(focusLookFrom, pathTarget, eased));
      if (ratio >= 1) settling = false;
      return;
    }
    camera.position.copy(pathPoint);
    camera.lookAt(pathTarget);
  }

  function matchIntensity(now: number): number {
    if (litChapter === null) return 0;
    const peak = isBundle(litChapter) ? 2 : 1;
    if (options.reducedMotion || strikeAt === null) return peak;
    const elapsed = now - strikeAt;
    if (elapsed >= SPARK_MS + FLARE_MS) return peak;
    return peak * (elapsed / (SPARK_MS + FLARE_MS));
  }

  function updateVisions(now: number): void {
    for (const [chapter, vision] of visions) {
      let openness = 0;
      if (litChapter === chapter) {
        openness = options.reducedMotion ? 1 : Math.min(1, (now - (strikeAt ?? now)) / RISE_MS);
      } else if (outAt !== null && !options.reducedMotion) {
        openness = Math.max(0, 1 - (now - outAt) / RISE_MS);
      }
      vision.visible = openness > 0.002;
      vision.scale.set(1, Math.max(0.002, openness), 1);
      const place = visionPlaces[chapter];
      vision.position.y = (place?.y ?? 0) + (openness - 1) * 1.4;
    }
  }

  function updateHoldMatch(): void {
    if (holdRemainingMs === null || focused === null) {
      holdMatch.group.visible = false;
      holdLight.intensity = 0;
      return;
    }
    const exact = Math.max(0, Math.min(1, holdRemainingMs / holdFullMs));
    const shown = options.reducedMotion
      ? Math.floor(Math.max(0, holdRemainingMs) / 10_000) * 10_000 / holdFullMs
      : exact;
    const point = shelf.centreOf(focused);
    const size = shelf.cellSize();
    holdMatch.group.visible = exact > 0;
    holdMatch.group.scale.setScalar(size * 1.6);
    holdMatch.group.position.set(point.x, point.y + size * 0.4, point.z + size * 0.6);
    holdMatch.setLength(Math.max(0.03, shown));
    holdLight.position.set(point.x, point.y + size * (0.4 + shown * 1.6), point.z + size * 0.8);
    holdLight.intensity = exact > 0 ? 3 : 0;
  }

  function render(now: number): void {
    requestAnimationFrame(render);
    if (litChapter !== null && strikeAt !== null && !options.reducedMotion && now - strikeAt >= BURN_MS) {
      const bundle = isBundle(litChapter);
      litChapter = null;
      strikeAt = null;
      outAt = now;
      options.onMatchOut(bundle);
    }
    const intensity = matchIntensity(now);
    const flicker = options.reducedMotion ? 1 : 0.88 + Math.sin(now / 80) * 0.12;
    flameLight.intensity = intensity * 9 * flicker;
    storyMatch.group.visible = intensity > 0;
    storyMatch.setBundle(isBundle(litChapter));
    storyMatch.setLength(
      options.reducedMotion || strikeAt === null ? 1 : Math.max(0.12, 1 - (now - strikeAt) / BURN_MS),
    );
    updateVisions(now);
    updateCamera(now);
    if (focused === null) shelf.project(camera);
    updateHoldMatch();
    if (!options.reducedMotion) snow.drift(now);

    readout.progress = progress;
    readout.chapter = chapterAt(progress);
    readout.cameraPosition = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    readout.lightIntensity = intensity;
    readout.litMatches = litChapter === null ? 0 : isBundle(litChapter) ? 12 : 1;
    readout.holdRemainingMs = holdRemainingMs;
    readout.matchLength =
      holdRemainingMs === null ? null : Math.max(0, Math.min(1, holdRemainingMs / holdFullMs));

    renderer.render(scene, camera);
  }

  function resize(): void {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }

  window.addEventListener('resize', resize);
  resize();
  camera.position.copy(cameraCurve.getPointAt(0));
  camera.lookAt(targetCurve.getPointAt(0));
  requestAnimationFrame(render);

  return {
    readout,
    setProgress(next) {
      progress = Math.min(1, Math.max(0, next));
      if (options.reducedMotion && litChapter !== null && chapterAt(progress) !== litChapter) {
        litChapter = null;
        strikeAt = null;
        outAt = performance.now();
      }
    },
    strike() {
      const chapter = chapterAt(progress);
      if (!strikeChapters.includes(chapter) || litChapter !== null) return false;
      litChapter = chapter;
      strikeAt = performance.now();
      outAt = null;
      return true;
    },
    burning() {
      return litChapter !== null;
    },
    setShelfStates(states) {
      shelf.setStates(states);
    },
    setShelfCells(cells) {
      shelf.setCells(cells);
    },
    focusBox(boxNumber) {
      if (boxNumber === focused) return;
      focusFrom = camera.position.clone();
      focusLookFrom = lookPoint();
      focusStart = performance.now();
      settling = boxNumber === null;
      focused = boxNumber;
    },
    setHold(remainingMs, holdMs) {
      holdRemainingMs = remainingMs;
      holdFullMs = holdMs > 0 ? holdMs : 1;
    },
  };
}

interface MatchHandle {
  group: Group;
  setLength(ratio: number): void;
  setBundle(bundle: boolean): void;
}

function makeMatch(): MatchHandle {
  const group = new Group();
  const wood = new MeshStandardMaterial({ color: 0xd8c08a, roughness: 0.9 });
  const flameMaterial = new MeshStandardMaterial({
    color: 0xffe7a8,
    emissive: 0xffb347,
    emissiveIntensity: 2.4,
    roughness: 0.2,
  });
  const stick = new Mesh(new CylinderGeometry(0.05, 0.06, 1, 8), wood);
  group.add(stick);
  const flame = new Mesh(new ConeGeometry(0.14, 0.42, 12), flameMaterial);
  group.add(flame);
  const bundle = new Group();
  for (let other = 0; other < 11; other += 1) {
    const angle = (other / 11) * Math.PI * 2;
    const twin = new Mesh(new CylinderGeometry(0.04, 0.05, 0.9, 6), wood);
    twin.position.set(Math.cos(angle) * 0.14, -0.05, Math.sin(angle) * 0.14);
    bundle.add(twin);
  }
  bundle.visible = false;
  group.add(bundle);

  return {
    group,
    setLength(ratio) {
      const length = Math.max(0.03, ratio);
      stick.scale.y = length;
      stick.position.y = length / 2;
      flame.position.y = length + 0.18;
    },
    setBundle(lit) {
      bundle.visible = lit;
      flame.scale.setScalar(lit ? 2 : 1);
    },
  };
}

interface ShelfHandle {
  setStates(states: ShelfCellState[]): void;
  setCells(cells: CellRect[]): void;
  project(camera: PerspectiveCamera): void;
  centreOf(boxNumber: number): Vector3;
  cellSize(): number;
}

/** The 3D boxes are placed under the DOM grid's own cells, so each cell lies over its box. */
function makeShelf(scene: Scene): ShelfHandle {
  const bodies = new InstancedMesh(
    new BoxGeometry(1, 1, 0.3),
    new MeshStandardMaterial({ color: 0xffffff, roughness: 0.78 }),
    EDITION_SIZE,
  );
  bodies.instanceMatrix.setUsage(DynamicDrawUsage);
  bodies.castShadow = true;
  bodies.receiveShadow = true;
  scene.add(bodies);

  const standing = new InstancedMesh(
    new CylinderGeometry(0.06, 0.07, 1, 6),
    new MeshStandardMaterial({ color: 0xd8c08a, roughness: 0.9 }),
    EDITION_SIZE,
  );
  standing.instanceMatrix.setUsage(DynamicDrawUsage);
  scene.add(standing);

  const notches = new InstancedMesh(
    new BoxGeometry(1, 1, 0.22),
    new MeshStandardMaterial({ color: 0x070b14, roughness: 1 }),
    EDITION_SIZE,
  );
  notches.instanceMatrix.setUsage(DynamicDrawUsage);
  scene.add(notches);

  const backing = new Mesh(
    new PlaneGeometry(40, 30),
    new MeshStandardMaterial({ color: 0x0b1120, roughness: 1 }),
  );
  backing.position.set(0, 2, SHELF_Z - 0.4);
  backing.receiveShadow = true;
  scene.add(backing);

  const helper = new Object3D();
  const colour = new Color();
  let states: ShelfCellState[] = new Array(EDITION_SIZE).fill('available');
  let cells: CellRect[] = [];
  const places: Vector3[] = Array.from({ length: EDITION_SIZE }, () => new Vector3(0, 2, SHELF_Z));
  let size = 0.3;

  function toShelfPlane(camera: PerspectiveCamera, px: number, py: number): Vector3 {
    const point = new Vector3(
      (px / window.innerWidth) * 2 - 1,
      -(py / window.innerHeight) * 2 + 1,
      0.5,
    );
    point.unproject(camera);
    const direction = point.sub(camera.position).normalize();
    const distance = (SHELF_Z - camera.position.z) / direction.z;
    return camera.position.clone().add(direction.multiplyScalar(distance));
  }

  function write(): void {
    for (let index = 0; index < EDITION_SIZE; index += 1) {
      const state = states[index] ?? 'available';
      const point = places[index] as Vector3;
      helper.rotation.set(0, 0, 0);
      helper.position.copy(point);
      helper.scale.set(size * 0.88, size * 0.88, 1);
      helper.updateMatrix();
      bodies.setMatrixAt(index, helper.matrix);
      bodies.setColorAt(index, colour.setHex(cellColours[state]));

      const hasMatch = state === 'held' || state === 'yours';
      const matchScale = hasMatch ? size : 0.0001;
      helper.position.set(point.x, point.y + (hasMatch ? size * 0.75 : 0), point.z + size * 0.4);
      helper.scale.set(matchScale * 0.9, matchScale * 1.5, matchScale * 0.9);
      helper.updateMatrix();
      standing.setMatrixAt(index, helper.matrix);

      const notched = state === 'taken';
      const notchScale = notched ? size * 0.45 : 0.0001;
      helper.position.set(point.x + size * 0.34, point.y + size * 0.34, point.z + size * 0.2);
      helper.scale.set(notchScale, notchScale, 1);
      helper.rotation.set(0, 0, Math.PI / 4);
      helper.updateMatrix();
      notches.setMatrixAt(index, helper.matrix);
    }
    bodies.instanceMatrix.needsUpdate = true;
    if (bodies.instanceColor !== null) bodies.instanceColor.needsUpdate = true;
    standing.instanceMatrix.needsUpdate = true;
    notches.instanceMatrix.needsUpdate = true;
  }

  return {
    setStates(next) {
      states = next;
      write();
    },
    setCells(next) {
      cells = next;
    },
    project(camera) {
      if (cells.length === 0) return;
      for (let index = 0; index < EDITION_SIZE; index += 1) {
        const cell = cells[index];
        if (cell === undefined) continue;
        (places[index] as Vector3).copy(
          toShelfPlane(camera, cell.left + cell.width / 2, cell.top + cell.height / 2),
        );
      }
      const sample = cells[0];
      if (sample !== undefined) {
        const left = toShelfPlane(camera, sample.left, sample.top + sample.height / 2);
        const right = toShelfPlane(camera, sample.left + sample.width, sample.top + sample.height / 2);
        size = Math.max(0.05, right.distanceTo(left));
      }
      write();
    },
    centreOf(boxNumber) {
      return (places[boxNumber - 1] ?? new Vector3(0, 2, SHELF_Z)).clone();
    },
    cellSize() {
      return size;
    },
  };
}

interface SnowHandle {
  points: Points;
  drift(now: number): void;
}

/** Snow drifts across every story chapter; no other decorative loop exists. */
function makeSnow(): SnowHandle {
  const count = 700;
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  for (let flake = 0; flake < count; flake += 1) {
    positions[flake * 3] = (Math.random() - 0.5) * 20;
    positions[flake * 3 + 1] = Math.random() * 15;
    positions[flake * 3 + 2] = 18 - Math.random() * 52;
    speeds[flake] = 15 / (8 + Math.random() * 12);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  const points = new Points(
    geometry,
    new PointsMaterial({ color: 0xdfe8f5, size: 0.07, transparent: true, opacity: 0.85 }),
  );
  let last = 0;
  return {
    points,
    drift(now) {
      const step = last === 0 ? 0 : Math.min(0.1, (now - last) / 1000);
      last = now;
      const array = geometry.getAttribute('position') as BufferAttribute;
      for (let flake = 0; flake < count; flake += 1) {
        let height = array.getY(flake) - (speeds[flake] ?? 1) * step;
        if (height < 0) height = 15;
        array.setY(flake, height);
      }
      array.needsUpdate = true;
    },
  };
}
