import * as THREE from 'three';
import { skyPlane, type SceneModule } from './stage.js';
import { sceneTextures } from './textures.js';

export const CITY_WINDOWS = 4096;

export interface CityScene extends SceneModule {
  /** Lights exactly this many windows, the nearest ones staying lit longest. */
  setLitWindows(count: number): void;
}

const random = (seed: number): (() => number) => {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
};

/** The city at night: a skyline whose windows go dark from the farthest buildings in. */
export function cityScene(): CityScene {
  const textures = sceneTextures();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 800);
  camera.position.set(0, 7, 46);
  camera.lookAt(0, 9, 0);

  scene.background = new THREE.Color(0x0b0914);
  const sky = skyPlane(new THREE.Color(0x0b0914), new THREE.Color(0x2b1f45), 420, 200);
  sky.position.set(0, 40, -220);
  scene.add(sky);

  const stars = new THREE.Mesh(
    new THREE.PlaneGeometry(420, 180),
    new THREE.MeshBasicMaterial({ map: textures.stars, transparent: true, depthWrite: false, opacity: 0.8 }),
  );
  stars.position.set(0, 52, -210);
  scene.add(stars);

  const next = random(9731);
  interface Tower {
    x: number;
    z: number;
    width: number;
    depth: number;
    height: number;
  }
  const towers: Tower[] = [];
  const rows = 6;
  for (let row = 0; row < rows; row += 1) {
    const z = -18 - row * 26;
    const count = 9 + row * 2;
    for (let index = 0; index < count; index += 1) {
      const spread = 34 + row * 16;
      const width = 3 + next() * 3.4;
      towers.push({
        x: -spread + ((index + 0.5) / count) * spread * 2 + (next() - 0.5) * 2,
        z: z + (next() - 0.5) * 6,
        width,
        depth: 3 + next() * 3,
        height: 9 + next() * (12 + row * 3),
      });
    }
  }

  const blocks = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x0e0a1a }),
    towers.length,
  );
  const matrix = new THREE.Matrix4();
  const shade = new THREE.Color();
  for (const [index, tower] of towers.entries()) {
    matrix.makeScale(tower.width, tower.height, tower.depth);
    matrix.setPosition(tower.x, tower.height / 2, tower.z);
    blocks.setMatrixAt(index, matrix);
    const nearness = 1 - Math.min(1, Math.abs(tower.z) / 160);
    shade.setRGB(0.04 + nearness * 0.03, 0.03 + nearness * 0.025, 0.07 + nearness * 0.04);
    blocks.setColorAt(index, shade);
  }
  scene.add(blocks);

  interface Window {
    x: number;
    y: number;
    z: number;
    nearness: number;
  }
  const windows: Window[] = [];
  let tower = 0;
  while (windows.length < CITY_WINDOWS) {
    const home = towers[tower % towers.length]!;
    tower += 1;
    const columns = Math.max(2, Math.floor(home.width / 1.1));
    const levels = Math.max(3, Math.floor(home.height / 1.5));
    for (let column = 0; column < columns && windows.length < CITY_WINDOWS; column += 1) {
      for (let level = 0; level < levels && windows.length < CITY_WINDOWS; level += 1) {
        windows.push({
          x: home.x - home.width / 2 + ((column + 0.5) / columns) * home.width,
          y: 1.1 + ((level + 0.5) / levels) * (home.height - 1.6),
          z: home.z + home.depth / 2 + 0.02,
          nearness: home.z,
        });
      }
    }
  }
  // The nearest windows keep their light longest.
  windows.sort((left, right) => left.nearness - right.nearness);

  const panes = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.42, 0.62),
    new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }),
    CITY_WINDOWS,
  );
  const lit = new THREE.Color(0xff9a4d);
  const dark = new THREE.Color(0x0d0a18);
  for (const [index, pane] of windows.entries()) {
    matrix.makeTranslation(pane.x, pane.y, pane.z);
    panes.setMatrixAt(index, matrix);
    panes.setColorAt(index, lit);
  }
  scene.add(panes);

  let litCount = CITY_WINDOWS;

  const setLitWindows = (count: number): void => {
    const wanted = Math.max(0, Math.min(CITY_WINDOWS, Math.round(count)));
    if (wanted === litCount) return;
    // The list runs from the farthest window to the nearest, and darkness spreads from its start.
    const darkened = CITY_WINDOWS - wanted;
    const wasDarkened = CITY_WINDOWS - litCount;
    for (let index = Math.min(darkened, wasDarkened); index < Math.max(darkened, wasDarkened); index += 1) {
      panes.setColorAt(index, index < darkened ? dark : lit);
    }
    if (panes.instanceColor) panes.instanceColor.needsUpdate = true;
    litCount = wanted;
  };

  return {
    name: 'city',
    scene,
    camera,
    setLitWindows,
    update(progress) {
      camera.position.y = 7 + progress * 2.2;
      camera.lookAt(0, 9 + progress * 1.5, 0);
    },
  };
}
