// The low-poly 3D world both canvases share: the course from the round's seed, and one mesh per bean in its hue.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  BUMPER_HEIGHT, type Course, COURSE_HALF_WIDTH, platformX, SWEEPER_HALF_THICKNESS, SWEEPER_TOP, sweeperAngle,
} from "../shared/course.js";
import { BEAN_BODY, hueOf } from "../shared/rules.js";

export const PALETTE = {
  sky: 0xfbf1de,
  floor: 0xf1e3c4,
  obstacle: 0xd9d2e6,
  platform: 0xe9dcc0,
  ink: 0x231942,
  pink: 0xff4f7b,
  teal: 0x08776a,
  red: 0xc8102e,
  eye: 0xfffaf0,
} as const;

const BEAN_HALF_HEIGHT = 0.7;

// The scenes shade in the same sRGB values the stylesheet uses, so a bean mesh shows the hue its SVG bean shows.
THREE.ColorManagement.enabled = false;

function outlined(geometry: THREE.BufferGeometry, color: number): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color, flatShading: true }));
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 30), new THREE.LineBasicMaterial({ color: PALETTE.ink })));
  return mesh;
}

// Everything that never moves is merged into one mesh per colour and one set of ink outlines, to keep draw calls few.
class StaticParts {
  private readonly solids = new Map<number, THREE.BufferGeometry[]>();
  private readonly edges: THREE.BufferGeometry[] = [];

  add(geometry: THREE.BufferGeometry, color: number, x: number, y: number, z: number): void {
    const placed = geometry.translate(x, y, z);
    const list = this.solids.get(color) ?? [];
    list.push(placed.index === null ? placed : placed.toNonIndexed());
    this.solids.set(color, list);
    this.edges.push(new THREE.EdgesGeometry(placed, 30));
  }

  addTo(scene: THREE.Scene): void {
    for (const [color, list] of this.solids) {
      const merged = mergeGeometries(list);
      if (merged !== null) scene.add(new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ color, flatShading: true })));
    }
    const lines = mergeGeometries(this.edges);
    if (lines !== null) scene.add(new THREE.LineSegments(lines, new THREE.LineBasicMaterial({ color: PALETTE.ink })));
  }
}

export interface World {
  scene: THREE.Scene;
  course: Course;
  setTick: (tick: number) => void;
}

export function buildWorld(course: Course): World {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.sky);
  // Lambert shading divides by π: these intensities bring upward faces to about full colour and no face past it,
  // so the cream stays cream and bean bodies keep their hue instead of washing out to pastel.
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8cbb0, 2.6));
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  sun.position.set(6, 14, -8);
  scene.add(sun);
  const movers: ((tick: number) => void)[] = [];
  const parts = new StaticParts();

  if (course.kind === "survival") {
    parts.add(new THREE.CylinderGeometry(course.arenaRadius, course.arenaRadius, 0.6, 32), PALETTE.floor, 0, -0.3, 0);
  } else {
    for (const floor of course.floors) {
      const depth = floor.zMax - floor.zMin;
      parts.add(new THREE.BoxGeometry(floor.xMax - floor.xMin, 0.6, depth), PALETTE.floor, (floor.xMax + floor.xMin) / 2, -0.3, floor.zMin + depth / 2);
    }
    // The finish line starts at finishZ: a bean finishes on the first tick its z reaches it.
    const line = new THREE.Mesh(new THREE.BoxGeometry(COURSE_HALF_WIDTH * 2, 0.06, 1), new THREE.MeshBasicMaterial({ color: PALETTE.pink }));
    line.position.set(0, 0.03, course.finishZ + 0.5);
    scene.add(line);
    for (const side of [-1, 1]) {
      parts.add(new THREE.BoxGeometry(0.3, 1.6, 0.3), PALETTE.obstacle, side * (COURSE_HALF_WIDTH + 0.15), 0.8, course.finishZ + 0.5);
    }
  }

  for (const platform of course.platforms) {
    const depth = platform.zMax - platform.zMin;
    const slab = outlined(new THREE.BoxGeometry(platform.halfWidth * 2, 0.5, depth), PALETTE.platform);
    slab.position.set(0, -0.25, platform.zMin + depth / 2);
    scene.add(slab);
    movers.push((tick) => { slab.position.x = platformX(platform, tick); });
  }

  for (const sweeper of course.sweepers) {
    const pivot = new THREE.Group();
    pivot.position.set(sweeper.x, 0, sweeper.z);
    const post = outlined(new THREE.CylinderGeometry(0.35, 0.45, SWEEPER_TOP + 0.4, 8), PALETTE.obstacle);
    post.position.y = (SWEEPER_TOP + 0.4) / 2;
    pivot.add(post);
    for (let arm = 0; arm < sweeper.arms; arm++) {
      const bar = outlined(new THREE.BoxGeometry(sweeper.radius, SWEEPER_TOP - 0.2, SWEEPER_HALF_THICKNESS * 2), PALETTE.obstacle);
      const holder = new THREE.Group();
      holder.rotation.y = -(2 * Math.PI * arm) / sweeper.arms;
      bar.position.set(sweeper.radius / 2, 0.2 + (SWEEPER_TOP - 0.2) / 2, 0);
      holder.add(bar);
      pivot.add(holder);
    }
    scene.add(pivot);
    // The simulation measures the arm angle from +x toward +z; three.js turns positive yaw from +x toward -z.
    movers.push((tick) => { pivot.rotation.y = -sweeperAngle(sweeper, tick); });
  }

  for (const bumper of course.bumpers) {
    parts.add(new THREE.CylinderGeometry(bumper.radius, bumper.radius, BUMPER_HEIGHT, 10), PALETTE.obstacle, bumper.x, BUMPER_HEIGHT / 2, bumper.z);
  }
  parts.addTo(scene);

  return { scene, course, setTick: (tick) => { for (const move of movers) move(tick); } };
}

function beanBodyColor(userId: number): THREE.Color {
  return new THREE.Color().setHSL(hueOf(userId) / 360, BEAN_BODY.saturation / 100, BEAN_BODY.lightness / 100);
}

function eyePair(radius: number, forward: number): THREE.BufferGeometry {
  const pair = mergeGeometries([-1, 1].map((side) =>
    new THREE.IcosahedronGeometry(radius, 0).translate(side * 0.17, BEAN_HALF_HEIGHT + 0.28, forward)));
  if (pair === null) throw new Error("eye geometry did not merge");
  return pair;
}

const BEAN_SHAPE = {
  body: new THREE.CapsuleGeometry(0.45, 0.5, 2, 8).translate(0, BEAN_HALF_HEIGHT, 0),
  eyes: eyePair(0.11, 0.38),
  pupils: eyePair(0.055, 0.46),
  eyeMaterial: new THREE.MeshBasicMaterial({ color: PALETTE.eye }),
  pupilMaterial: new THREE.MeshBasicMaterial({ color: PALETTE.ink }),
};

// A bean: the jelly-bean body in its hue and two simple eyes facing its direction of travel.
export function makeBean(userId: number): THREE.Group {
  const group = new THREE.Group();
  const color = beanBodyColor(userId);
  group.add(new THREE.Mesh(BEAN_SHAPE.body, new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.12, flatShading: true })));
  group.add(new THREE.Mesh(BEAN_SHAPE.eyes, BEAN_SHAPE.eyeMaterial));
  group.add(new THREE.Mesh(BEAN_SHAPE.pupils, BEAN_SHAPE.pupilMaterial));
  return group;
}

export function makeRing(color: number, radius: number): THREE.Mesh {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.11, 6, 18), new THREE.MeshBasicMaterial({ color }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.08;
  return ring;
}

export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer | null {
  try {
    // No multisampling: software WebGL must keep a 12-bean round above 15 frames a second.
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "low-power" });
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.shadowMap.enabled = false;
    return renderer;
  } catch {
    return null;
  }
}

// Keeps the drawing buffer and camera matched to the canvas's laid-out size.
export function fitCanvas(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement, onResize: () => void): () => void {
  const observer = new ResizeObserver(() => {
    const width = Math.max(1, Math.round(canvas.clientWidth));
    const height = Math.max(1, Math.round(canvas.clientHeight));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    onResize();
  });
  observer.observe(canvas);
  return () => observer.disconnect();
}

export function overviewFraming(course: Course): { position: THREE.Vector3; target: THREE.Vector3 } {
  if (course.kind === "survival") return { position: new THREE.Vector3(0, 26, -24), target: new THREE.Vector3(0, 0, 0) };
  const middle = course.finishZ / 2;
  return { position: new THREE.Vector3(18, 62, middle - 58), target: new THREE.Vector3(0, 0, middle + 8) };
}
