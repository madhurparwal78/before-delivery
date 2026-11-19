import {
  AmbientLight,
  BoxGeometry,
  Box3,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Layout, MirrorPerson } from '../types.js';

const PAPER_LIGHT = new Color('#f6efdd');
const PAPER_DARK = new Color('#eadfc4');
const WALL = new Color('#cbb995');
const SEAT = new Color('#d8c7a1');
const EXIT = new Color('#f2c14b');
const INK = new Color('#2f3337');
const TEAL = new Color('#4f8c82');
const HIDDEN = new Color('#bdb4a2');

const GLIDE_MS = 200;
const CAMERA_GLIDE_MS = 420;
const FRAME_MS = 20;

interface AvatarView {
  group: Group;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

export interface RoomScene {
  setLayout: (layout: Layout, modelUrl: string | null) => void;
  setPeople: (people: MirrorPerson[], ownId: string) => void;
  setRipple: (radius: number, mode: string, tile: { x: number; y: number } | null) => void;
  setReducedMotion: (reduced: boolean) => void;
  dispose: () => void;
}

export function createScene(canvas: HTMLCanvasElement, reducedAtStart: boolean): RoomScene | null {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: false, alpha: false });
  } catch {
    return null;
  }
  const scene = new Scene();
  scene.background = PAPER_LIGHT;
  const camera = new PerspectiveCamera(50, 16 / 9, 0.1, 200);
  const ambient = new AmbientLight(0xffffff, 2.2);
  const sun = new DirectionalLight(0xffffff, 1.1);
  sun.position.set(6, 12, 4);
  scene.add(ambient, sun);
  const floorGroup = new Group();
  const peopleGroup = new Group();
  const rippleGroup = new Group();
  const modelGroup = new Group();
  scene.add(floorGroup, peopleGroup, rippleGroup, modelGroup);

  const tileGeometry = new BoxGeometry(0.94, 0.08, 0.94);
  const wallGeometry = new BoxGeometry(0.94, 0.8, 0.94);
  const seatGeometry = new BoxGeometry(0.6, 0.24, 0.6);
  const baseGeometry = new CylinderGeometry(0.38, 0.38, 0.06, 12);
  const bodyGeometry = new BoxGeometry(0.5, 0.95, 0.26);

  let reduced = reducedAtStart;
  let layout: Layout | null = null;
  let avatars = new Map<string, AvatarView>();
  let cameraFrom = { x: 0, y: 0 };
  let cameraTo = { x: 0, y: 0 };
  let animationTimer: number | null = null;
  let animationStart = 0;

  const resize = (): void => {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  const placeCamera = (follow: { x: number; y: number }): void => {
    const span = layout === null ? 10 : Math.max(layout.width, layout.height);
    const middle =
      layout === null
        ? follow
        : { x: (follow.x + (layout.width - 1) / 2) / 2, y: (follow.y + (layout.height - 1) / 2) / 2 };
    camera.position.set(middle.x + span * 0.55, span * 0.95, middle.y + span * 0.95);
    camera.lookAt(middle.x, 0, middle.y);
  };

  const render = (): void => {
    resize();
    renderer.render(scene, camera);
  };

  const easeOut = (ratio: number): number => 1 - (1 - ratio) * (1 - ratio) * (1 - ratio);

  const stopAnimation = (): void => {
    if (animationTimer !== null) window.clearTimeout(animationTimer);
    animationTimer = null;
  };

  const settle = (): void => {
    for (const avatar of avatars.values()) {
      avatar.group.position.set(avatar.to.x, 0, avatar.to.y);
      avatar.from = { ...avatar.to };
    }
    cameraFrom = { ...cameraTo };
    placeCamera(cameraTo);
    render();
  };

  const tick = (): void => {
    const elapsed = Date.now() - animationStart;
    const avatarRatio = Math.min(1, elapsed / GLIDE_MS);
    const cameraRatio = Math.min(1, elapsed / CAMERA_GLIDE_MS);
    for (const avatar of avatars.values()) {
      const eased = easeOut(avatarRatio);
      avatar.group.position.set(
        avatar.from.x + (avatar.to.x - avatar.from.x) * eased,
        0,
        avatar.from.y + (avatar.to.y - avatar.from.y) * eased
      );
    }
    const cameraEased = easeOut(cameraRatio);
    placeCamera({
      x: cameraFrom.x + (cameraTo.x - cameraFrom.x) * cameraEased,
      y: cameraFrom.y + (cameraTo.y - cameraFrom.y) * cameraEased
    });
    render();
    if (avatarRatio >= 1 && cameraRatio >= 1) {
      settle();
      animationTimer = null;
      return;
    }
    animationTimer = window.setTimeout(tick, FRAME_MS);
  };

  const startAnimation = (): void => {
    if (reduced) {
      stopAnimation();
      settle();
      return;
    }
    stopAnimation();
    animationStart = Date.now();
    tick();
  };

  const setLayout = (next: Layout, modelUrl: string | null): void => {
    layout = next;
    floorGroup.clear();
    for (let y = 0; y < next.height; y += 1) {
      for (let x = 0; x < next.width; x += 1) {
        const isExit = next.exits.some((exit) => exit.x === x && exit.y === y);
        const colour = isExit ? EXIT : (x + y) % 2 === 0 ? PAPER_LIGHT : PAPER_DARK;
        const tile = new Mesh(tileGeometry, new MeshBasicMaterial({ color: colour }));
        tile.position.set(x, 0, y);
        floorGroup.add(tile);
      }
    }
    for (const wall of next.walls) {
      const block = new Mesh(wallGeometry, new MeshBasicMaterial({ color: WALL }));
      block.position.set(wall.x, 0.42, wall.y);
      floorGroup.add(block);
    }
    for (const seat of next.seats) {
      const stool = new Mesh(seatGeometry, new MeshBasicMaterial({ color: SEAT }));
      stool.position.set(seat.x, 0.16, seat.y);
      floorGroup.add(stool);
    }
    if (modelUrl !== null) {
      modelGroup.clear();
      new GLTFLoader().load(
        modelUrl,
        (loaded) => {
          const bounds = new Box3().setFromObject(loaded.scene);
          const size = bounds.getSize(new Vector3());
          const widest = Math.max(size.x, size.z, 0.001);
          const scale = 1.6 / widest;
          loaded.scene.scale.setScalar(scale);
          loaded.scene.position.set(next.width / 2 - 0.5, 0.08, next.height / 2 - 0.5);
          modelGroup.add(loaded.scene);
          render();
        },
        undefined,
        () => undefined
      );
    }
    render();
  };

  const avatarFor = (person: MirrorPerson, own: boolean): Group => {
    const group = new Group();
    const baseColour = own ? EXIT : person.avatar === 'hidden' ? HIDDEN : TEAL;
    const bodyColour = person.avatar === 'shown' ? INK : HIDDEN;
    const base = new Mesh(baseGeometry, new MeshBasicMaterial({ color: baseColour }));
    base.position.set(0, 0.1, 0);
    const body = new Mesh(bodyGeometry, new MeshBasicMaterial({ color: bodyColour }));
    body.position.set(0, person.seated ? 0.4 : 0.58, 0);
    group.add(base, body);
    return group;
  };

  const setPeople = (people: MirrorPerson[], ownId: string): void => {
    const next = new Map<string, AvatarView>();
    for (const person of people) {
      const existing = avatars.get(person.personId);
      const group = avatarFor(person, person.personId === ownId);
      group.position.set(existing?.from.x ?? person.x, 0, existing?.from.y ?? person.y);
      next.set(person.personId, {
        group,
        from: existing?.from ?? { x: person.x, y: person.y },
        to: { x: person.x, y: person.y }
      });
      if (person.personId === ownId) cameraTo = { x: person.x, y: person.y };
    }
    peopleGroup.clear();
    for (const avatar of next.values()) peopleGroup.add(avatar.group);
    avatars = next;
    startAnimation();
  };

  const setRipple = (radius: number, mode: string, tile: { x: number; y: number } | null): void => {
    rippleGroup.clear();
    if (mode !== 'none' && tile !== null && layout !== null) {
      for (let y = tile.y - radius; y <= tile.y + radius; y += 1) {
        for (let x = tile.x - radius; x <= tile.x + radius; x += 1) {
          if (x < 0 || y < 0 || x >= layout.width || y >= layout.height) continue;
          const distance = Math.max(Math.abs(x - tile.x), Math.abs(y - tile.y));
          if (distance !== radius) continue;
          const ring = new Mesh(tileGeometry, new MeshBasicMaterial({ color: TEAL }));
          ring.position.set(x, 0.12, y);
          rippleGroup.add(ring);
        }
      }
    }
    render();
  };

  const setReducedMotion = (next: boolean): void => {
    reduced = next;
    if (reduced) {
      stopAnimation();
      settle();
    }
  };

  resize();
  placeCamera(cameraTo);
  render();

  return {
    setLayout,
    setPeople,
    setRipple,
    setReducedMotion,
    dispose: () => {
      stopAnimation();
      renderer.dispose();
    }
  };
}
