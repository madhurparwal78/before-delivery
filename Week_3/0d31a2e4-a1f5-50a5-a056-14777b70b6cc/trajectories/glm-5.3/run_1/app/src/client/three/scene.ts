import * as THREE from "three";

const INK = 0x241b4e;
const CREAM = 0xf7eddb;
const CREAM_DEEP = 0xeadcc0;
const PINK = 0xff4f81;
const TEAL = 0x1c8f7a;
const RED = 0xd92646;

export type Obstacle = {
  sweepers: { x: number; z: number; armLen: number; speed: number; phase: number }[];
  platforms: { z: number; slideAmp: number; slideSpeed: number; slidePhase: number }[];
  bumpers: { x: number; z: number; radius: number }[];
};

/** Derives the same course layout as the server's generator, from the seed. */
export function courseFromSeed(kind: "race" | "survival" | "final", seed: number): { length: number; ringRadius: number; obstacles: Obstacle } {
  const rng = mulberry32(seed);
  if (kind === "survival") {
    const sweepers: Obstacle["sweepers"] = [{ x: 0, z: 0, armLen: 14.9, speed: pick(rng, [0.75, 0.9, 1.05]), phase: rng() * Math.PI * 2 }];
    const count = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < count; i++) {
      sweepers.push({
        x: range(rng, -3, 3),
        z: range(rng, -3, 3),
        armLen: range(rng, 5.5, 7.5),
        speed: pick(rng, [1.0, 1.25, 1.5, 1.75]),
        phase: rng() * Math.PI * 2
      });
    }
    const bumpers: Obstacle["bumpers"] = [];
    const bumperCount = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < bumperCount; i++) {
      bumpers.push({ x: range(rng, -5, 5), z: range(rng, -5, 5), radius: range(rng, 0.8, 1.1) });
    }
    return { length: 0, ringRadius: 15, obstacles: { sweepers, platforms: [], bumpers } };
  }
  const length = kind === "race" ? int(rng, 100, 140) : int(rng, 60, 80);
  const sweepers: Obstacle["sweepers"] = [];
  const platforms: Obstacle["platforms"] = [];
  const bumpers: Obstacle["bumpers"] = [];
  for (let z = 16; z < length - 6; z += int(rng, 7, 12)) {
    const roll = rng();
    if (roll < 0.45) {
      sweepers.push({
        x: range(rng, -1.5, 1.5),
        z,
        armLen: 3.2,
        speed: pick(rng, [0.9, 1.15, 1.4]),
        phase: rng() * Math.PI * 2
      });
    } else if (roll < 0.75) {
      bumpers.push({ x: pick(rng, [-4.3, -2, 0, 2, 4.3]), z, radius: range(rng, 0.4, 0.55) });
    } else {
      platforms.push({
        z,
        slideAmp: range(rng, 1.2, 1.8),
        slideSpeed: range(rng, 1.4, 2.2),
        slidePhase: rng() * Math.PI * 2
      });
    }
  }
  return { length, ringRadius: 0, obstacles: { sweepers, platforms, bumpers } };
}

function mulberry32(seed: number): () => number {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const range = (rng: () => number, min: number, max: number): number => min + rng() * (max - min);
const int = (rng: () => number, min: number, max: number): number => min + Math.floor(rng() * (max - min + 1));
const pick = <T,>(rng: () => number, items: T[]): T => items[Math.floor(rng() * items.length)] as T;

export type BeanMesh = { userId: number; group: THREE.Group; body: THREE.Mesh; ring: THREE.Mesh | null };

export type Scene = {
  renderer: THREE.WebGLRenderer;
  three: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  beans: Map<number, BeanMesh>;
  course: { length: number; ringRadius: number; obstacles: Obstacle };
  resize: () => void;
  render: () => void;
  dispose: () => void;
};

export function hueColor(hue: number): THREE.Color {
  return new THREE.Color().setHSL(hue / 360, 0.72, 0.62);
}

export function createScene(
  canvas: HTMLCanvasElement,
  kind: "race" | "survival" | "final",
  seed: number
): Scene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setClearColor(CREAM, 1);
  const three = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
  three.add(new THREE.AmbientLight(0xffffff, 0.85));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(20, 40, -10);
  three.add(sun);

  const course = courseFromSeed(kind, seed);
  buildCourse(three, kind, course);
  const beans = new Map<number, BeanMesh>();

  const resize = (): void => {
    const parent = canvas.parentElement;
    if (!parent) return;
    const width = Math.max(1, parent.clientWidth);
    const height = Math.max(1, parent.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();

  return {
    renderer,
    three,
    camera,
    beans,
    course,
    resize,
    render: () => renderer.render(three, camera),
    dispose: () => {
      renderer.dispose();
      three.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else if (material) material.dispose();
      });
    }
  };
}

function buildCourse(three: THREE.Scene, kind: "race" | "survival" | "final", course: { length: number; ringRadius: number; obstacles: Obstacle }): void {
  const flat = (color: number): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ color, flatShading: true });
  const inkMat = flat(INK);
  const creamMat = flat(CREAM_DEEP);

  if (kind === "survival") {
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(course.ringRadius, course.ringRadius, 0.6, 24), flat(CREAM));
    floor.position.y = -0.3;
    three.add(floor);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(course.ringRadius, 0.28, 8, 40), inkMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.02;
    three.add(rim);
  } else {
    const floor = new THREE.Mesh(new THREE.BoxGeometry(10, 0.6, course.length + 18), flat(CREAM));
    floor.position.set(0, -0.3, (course.length - 18) / 2);
    three.add(floor);
    const finish = new THREE.Mesh(new THREE.BoxGeometry(10, 0.1, 0.5), flat(PINK));
    finish.position.set(0, 0.02, course.length);
    three.add(finish);
    const finishPost = new THREE.Mesh(new THREE.BoxGeometry(10, 1.4, 0.2), flat(PINK));
    finishPost.position.set(0, 0.7, course.length + 0.4);
    three.add(finishPost);
  }

  for (const bumper of course.obstacles.bumpers) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(bumper.radius, bumper.radius, 1.1, 12), inkMat);
    mesh.position.set(bumper.x, 0.55, bumper.z);
    three.add(mesh);
  }
  for (const platform of course.obstacles.platforms) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.3, 2.2), creamMat);
    mesh.position.set(0, 0.15, platform.z);
    mesh.userData["platform"] = platform;
    three.add(mesh);
  }
  for (const sweeper of course.obstacles.sweepers) {
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.2, 10), inkMat);
    hub.position.set(sweeper.x, 0.6, sweeper.z);
    three.add(hub);
    const arm = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, sweeper.armLen * 2), inkMat);
    arm.add(bar);
    arm.position.set(sweeper.x, 0.9, sweeper.z);
    arm.userData["sweeper"] = sweeper;
    three.add(arm);
  }
}

export function addBean(
  scene: Scene,
  userId: number,
  hue: number,
  marker: "last_slot" | "first_out" | null = null
): BeanMesh {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.45, 10, 8),
    new THREE.MeshLambertMaterial({ color: hueColor(hue), flatShading: true })
  );
  body.scale.set(1, 0.9, 1.15);
  group.add(body);
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), new THREE.MeshLambertMaterial({ color: INK }));
  eyeL.position.set(-0.16, 0.1, 0.42);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.16;
  group.add(eyeL, eyeR);

  let ring: THREE.Mesh | null = null;
  if (marker) {
    ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.7, 0.09, 6, 20),
      new THREE.MeshLambertMaterial({ color: marker === "last_slot" ? TEAL : RED, flatShading: true })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.5;
    group.add(ring);
  }

  scene.three.add(group);
  const bean: BeanMesh = { userId, group, body, ring };
  scene.beans.set(userId, bean);
  return bean;
}

/** Moves every obstacle to where the tick puts it. */
export function animateObstacles(scene: Scene, tick: number): void {
  const t = tick / 20;
  scene.three.traverse((obj) => {
    const platform = obj.userData["platform"] as Obstacle["platforms"][number] | undefined;
    if (platform) {
      obj.position.x = platform.slideAmp * Math.sin(t * platform.slideSpeed * Math.PI + platform.slidePhase);
    }
    const sweeper = obj.userData["sweeper"] as Obstacle["sweepers"][number] | undefined;
    if (sweeper) {
      obj.rotation.y = -(t * sweeper.speed * Math.PI * 2 + sweeper.phase);
    }
  });
}

/** Frames the given beans with a follow camera behind the lead or followed bean. */
export function followCamera(
  scene: Scene,
  kind: "race" | "survival" | "final",
  positions: Map<number, { x: number; y: number; z: number }>,
  followUserId: number | null
): void {
  const camera = scene.camera;
  if (followUserId === null || !positions.has(followUserId)) {
    if (kind === "survival") {
      camera.position.set(0, 34, 26);
      camera.lookAt(0, 0, 0);
    } else {
      const length = scene.course.length;
      camera.position.set(0, 30, length / 2 - 18);
      camera.lookAt(0, 0, length / 2);
    }
    return;
  }
  const pos = positions.get(followUserId);
  if (!pos) return;
  if (kind === "survival") {
    const angle = Math.atan2(pos.z, pos.x);
    camera.position.set(pos.x + Math.cos(angle) * 9, 7, pos.z + Math.sin(angle) * 9);
    camera.lookAt(pos.x, 0.5, pos.z);
  } else {
    camera.position.set(pos.x, 5.5, pos.z - 9);
    camera.lookAt(pos.x, 0.5, pos.z + 3);
  }
}
