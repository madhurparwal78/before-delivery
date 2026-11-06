import * as THREE from 'three';
import { footprintAt } from '../../shared/catalog.js';
import type { BuildingType } from '../../shared/types.js';
import {
  GROUND_CELLS,
  PALETTE,
  type CameraState,
  type IslandRenderer,
  type SceneBuilding
} from './types.js';

const VIEW_CELLS = 34;
const ELEVATION_DEGREES = 35;
const RISE_MS = 550;
const COLLAPSE_MS = 550;
const PULSE_MS = 250;

function saltTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (context === null) return new THREE.Texture();
  context.fillStyle = '#d8d2c2';
  context.fillRect(0, 0, 512, 512);
  let seed = 20260101;
  const random = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let patch = 0; patch < 900; patch += 1) {
    const grey = 190 + Math.floor(random() * 50);
    context.fillStyle = `rgb(${grey},${grey - 4},${grey - 16})`;
    context.fillRect(random() * 512, random() * 512, 2 + random() * 10, 2 + random() * 10);
  }
  context.strokeStyle = 'rgba(120,114,100,0.55)';
  context.lineWidth = 1;
  for (let crack = 0; crack < 120; crack += 1) {
    context.beginPath();
    let x = random() * 512;
    let y = random() * 512;
    context.moveTo(x, y);
    for (let step = 0; step < 6; step += 1) {
      x += (random() - 0.5) * 70;
      y += (random() - 0.5) * 70;
      context.lineTo(x, y);
    }
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 4);
  return texture;
}

function badgeTexture(level: number): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context !== null) {
    context.fillStyle = 'rgba(20,26,46,0.85)';
    context.beginPath();
    context.arc(32, 32, 28, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = '#f2efe6';
    context.lineWidth = 3;
    context.stroke();
    context.fillStyle = '#f2efe6';
    context.font = 'bold 34px monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(String(level), 32, 34);
  }
  return new THREE.CanvasTexture(canvas);
}

type BuildingShape = { height: number; build: (width: number, depth: number) => THREE.BufferGeometry };

const SHAPES: Record<BuildingType, BuildingShape> = {
  brine_pan: {
    height: 0.4,
    build: (width, depth) => new THREE.BoxGeometry(width * 0.92, 0.4, depth * 0.92)
  },
  peat_cutter: {
    height: 0.9,
    build: (width, depth) => new THREE.BoxGeometry(width * 0.8, 0.9, depth * 0.8)
  },
  copper_sluice: {
    height: 0.7,
    build: (width, depth) => new THREE.CylinderGeometry(Math.min(width, depth) * 0.42, Math.min(width, depth) * 0.46, 0.7, 6)
  },
  brine_cistern: {
    height: 1.4,
    build: (width, depth) => new THREE.CylinderGeometry(Math.min(width, depth) * 0.4, Math.min(width, depth) * 0.4, 1.4, 12)
  },
  peat_rick: {
    height: 1.3,
    build: (width, depth) => new THREE.ConeGeometry(Math.min(width, depth) * 0.5, 1.3, 6)
  },
  copper_vault: {
    height: 1.1,
    build: (width, depth) => new THREE.BoxGeometry(width * 0.7, 1.1, depth * 0.7)
  },
  tide_barracks: {
    height: 1.2,
    build: (width, depth) => new THREE.BoxGeometry(width * 0.86, 1.2, depth * 0.6)
  },
  driftwood_camp: {
    height: 0.8,
    build: (width, depth) => new THREE.BoxGeometry(width * 0.6, 0.8, depth * 0.86)
  },
  kiln_tower: {
    height: 2.4,
    build: (width, depth) => new THREE.CylinderGeometry(Math.min(width, depth) * 0.26, Math.min(width, depth) * 0.38, 2.4, 8)
  }
};

const MATERIAL_COLOURS: Record<BuildingType, number> = {
  brine_pan: 0xb9c6c4,
  peat_cutter: 0x8a7a63,
  copper_sluice: 0xb07a4a,
  brine_cistern: 0x9fb4b8,
  peat_rick: 0x7d6a52,
  copper_vault: 0xc08a52,
  tide_barracks: 0xaab0bd,
  driftwood_camp: 0x95836a,
  kiln_tower: 0xd1cbbb
};

type Entry = {
  group: THREE.Group;
  mesh: THREE.Mesh;
  badge: THREE.Sprite;
  scaffold: THREE.Mesh;
  level: number;
  destroyed: boolean;
  animationStart: number;
  animation: 'rise' | 'collapse' | 'pulse' | null;
};

export function createWebglRenderer(container: HTMLElement): IslandRenderer | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    return null;
  }
  if (renderer.getContext() === null) return null;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.append(renderer.domElement);
  renderer.domElement.classList.add('island-canvas');

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 400);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_CELLS, GROUND_CELLS),
    new THREE.MeshLambertMaterial({ map: saltTexture(), color: PALETTE.crust })
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const waterMaterial = new THREE.MeshLambertMaterial({
    color: PALETTE.teal,
    transparent: true,
    opacity: 0.85
  });
  const water = new THREE.Group();
  const ringWidth = 2;
  const half = GROUND_CELLS / 2;
  const frames: [number, number, number, number][] = [
    [0, -half + 1, GROUND_CELLS, ringWidth],
    [0, half - 1, GROUND_CELLS, ringWidth],
    [-half + 1, 0, ringWidth, GROUND_CELLS - 2 * ringWidth],
    [half - 1, 0, ringWidth, GROUND_CELLS - 2 * ringWidth]
  ];
  for (const [cx, cz, width, depth] of frames) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(width, 0.18, depth), waterMaterial);
    plate.position.set(cx, 0.04, cz);
    water.add(plate);
  }
  scene.add(water);

  const light = new THREE.DirectionalLight(0xffd9a8, 1.15);
  light.position.set(-18, 20, 10);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0x6c7ba8, 0.55));

  const entries = new Map<number, Entry>();
  const buildingRoot = new THREE.Group();
  scene.add(buildingRoot);

  const cursor = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: PALETTE.orange, transparent: true, opacity: 0.6 })
  );
  cursor.rotation.x = -Math.PI / 2;
  cursor.position.y = 0.06;
  scene.add(cursor);

  const ghostMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: PALETTE.teal, transparent: true, opacity: 0.5 })
  );
  ghostMesh.visible = false;
  scene.add(ghostMesh);

  const unitRoot = new THREE.Group();
  scene.add(unitRoot);
  const unitGeometry = new THREE.SphereGeometry(0.3, 8, 6);
  const unitMaterial = new THREE.MeshLambertMaterial({ color: PALETTE.orange });

  let reducedMotion = false;
  let cameraState: CameraState = { azimuth: 0, zoom: 1, panX: 20, panY: 20 };
  let width = container.clientWidth || 1;
  let height = container.clientHeight || 1;

  const worldX = (cell: number): number => cell - GROUND_CELLS / 2;

  const applyCamera = (): void => {
    const aspect = width / height;
    const size = VIEW_CELLS / cameraState.zoom;
    camera.left = (-size * aspect) / 2;
    camera.right = (size * aspect) / 2;
    camera.top = size / 2;
    camera.bottom = -size / 2;
    const target = new THREE.Vector3(worldX(cameraState.panX), 0, worldX(cameraState.panY));
    const azimuth = (cameraState.azimuth * Math.PI) / 180;
    const elevation = (ELEVATION_DEGREES * Math.PI) / 180;
    const distance = 60;
    camera.position.set(
      target.x + distance * Math.cos(elevation) * Math.sin(azimuth),
      target.y + distance * Math.sin(elevation),
      target.z + distance * Math.cos(elevation) * Math.cos(azimuth)
    );
    camera.lookAt(target);
    camera.updateProjectionMatrix();
  };

  const makeEntry = (building: SceneBuilding, at: number): Entry => {
    const footprint = footprintAt(building.type, building.rotation);
    const shape = SHAPES[building.type];
    const mesh = new THREE.Mesh(
      shape.build(footprint.width, footprint.depth),
      new THREE.MeshLambertMaterial({ color: MATERIAL_COLOURS[building.type] })
    );
    mesh.position.y = shape.height / 2;
    const badge = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: badgeTexture(building.level), transparent: true })
    );
    badge.scale.set(1.2, 1.2, 1);
    badge.position.y = shape.height + 0.9;
    const scaffold = new THREE.Mesh(
      new THREE.TorusGeometry(Math.max(footprint.width, footprint.depth) * 0.6, 0.06, 6, 18),
      new THREE.MeshBasicMaterial({ color: PALETTE.orange })
    );
    scaffold.rotation.x = Math.PI / 2;
    scaffold.position.y = 0.3;
    scaffold.visible = building.working;
    const group = new THREE.Group();
    group.add(mesh, badge, scaffold);
    buildingRoot.add(group);
    return {
      group,
      mesh,
      badge,
      scaffold,
      level: building.level,
      destroyed: building.destroyed,
      animationStart: at,
      animation: reducedMotion ? null : 'rise'
    };
  };

  const placeEntry = (entry: Entry, building: SceneBuilding): void => {
    const footprint = footprintAt(building.type, building.rotation);
    entry.group.position.set(
      worldX(building.x) + footprint.width / 2,
      0,
      worldX(building.y) + footprint.depth / 2
    );
  };

  let animating = false;

  const renderOnce = (): void => {
    renderer.render(scene, camera);
  };

  applyCamera();

  return {
    kind: 'webgl',
    setBuildings(buildings) {
      const at = performance.now();
      const seen = new Set<number>();
      for (const building of buildings) {
        seen.add(building.id);
        let entry = entries.get(building.id);
        if (!entry) {
          entry = makeEntry(building, at);
          entries.set(building.id, entry);
        }
        placeEntry(entry, building);
        if (entry.level !== building.level) {
          entry.level = building.level;
          entry.badge.material.map?.dispose();
          entry.badge.material.map = badgeTexture(building.level);
          entry.badge.material.needsUpdate = true;
          if (!reducedMotion) {
            entry.animation = 'pulse';
            entry.animationStart = at;
          }
        }
        if (entry.destroyed !== building.destroyed) {
          entry.destroyed = building.destroyed;
          entry.animation = reducedMotion ? null : building.destroyed ? 'collapse' : 'rise';
          entry.animationStart = at;
          if (reducedMotion) {
            entry.group.visible = !building.destroyed;
            entry.group.scale.setScalar(1);
          }
        }
        entry.scaffold.visible = building.working;
        if (entry.animation === null) {
          entry.group.visible = !building.destroyed;
          entry.group.scale.setScalar(building.destroyed ? 1 : 1);
        }
      }
      for (const [id, entry] of entries) {
        if (seen.has(id)) continue;
        buildingRoot.remove(entry.group);
        entries.delete(id);
      }
      renderOnce();
    },
    setUnits(units) {
      while (unitRoot.children.length > units.length) {
        const last = unitRoot.children[unitRoot.children.length - 1];
        if (last) unitRoot.remove(last);
      }
      while (unitRoot.children.length < units.length) {
        unitRoot.add(new THREE.Mesh(unitGeometry, unitMaterial));
      }
      units.forEach((unit, index) => {
        const mesh = unitRoot.children[index];
        if (!mesh) return;
        mesh.visible = unit.alive;
        mesh.position.set(worldX(unit.x), 0.35, worldX(unit.y));
      });
      renderOnce();
    },
    setGhost(ghost) {
      if (ghost === null) {
        ghostMesh.visible = false;
        renderOnce();
        return;
      }
      const footprint = footprintAt(ghost.type, ghost.rotation);
      const shape = SHAPES[ghost.type];
      ghostMesh.geometry.dispose();
      ghostMesh.geometry = new THREE.BoxGeometry(
        footprint.width * 0.92,
        shape.height,
        footprint.depth * 0.92
      );
      ghostMesh.position.set(
        worldX(ghost.x) + footprint.width / 2,
        shape.height / 2,
        worldX(ghost.y) + footprint.depth / 2
      );
      (ghostMesh.material as THREE.MeshBasicMaterial).color.setHex(
        ghost.valid ? PALETTE.teal : PALETTE.danger
      );
      ghostMesh.visible = true;
      renderOnce();
    },
    setCursor(x, y) {
      cursor.position.x = worldX(x) + 0.5;
      cursor.position.z = worldX(y) + 0.5;
      renderOnce();
    },
    setCamera(next) {
      cameraState = next;
      applyCamera();
      renderOnce();
    },
    setReducedMotion(reduced) {
      reducedMotion = reduced;
    },
    pickCell(clientX, clientY) {
      const bounds = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - bounds.left) / bounds.width) * 2 - 1,
        -(((clientY - bounds.top) / bounds.height) * 2 - 1)
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, camera);
      const point = new THREE.Vector3();
      const hit = raycaster.ray.intersectPlane(
        new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
        point
      );
      if (hit === null) return null;
      const x = Math.floor(point.x + GROUND_CELLS / 2);
      const y = Math.floor(point.z + GROUND_CELLS / 2);
      if (x < 0 || y < 0 || x >= GROUND_CELLS || y >= GROUND_CELLS) return null;
      return { x, y };
    },
    resize(nextWidth, nextHeight) {
      width = Math.max(1, nextWidth);
      height = Math.max(1, nextHeight);
      renderer.setSize(width, height, false);
      applyCamera();
      renderOnce();
    },
    frame(nowMs) {
      animating = false;
      for (const entry of entries.values()) {
        if (entry.animation === null) continue;
        const elapsed = nowMs - entry.animationStart;
        if (entry.animation === 'rise') {
          const progress = Math.min(1, elapsed / RISE_MS);
          entry.group.visible = true;
          entry.group.position.y = -1.6 * (1 - progress);
          entry.group.scale.setScalar(0.6 + 0.4 * progress);
          if (progress >= 1) {
            entry.animation = null;
            entry.group.position.y = 0;
            entry.group.scale.setScalar(1);
          } else animating = true;
        } else if (entry.animation === 'collapse') {
          const progress = Math.min(1, elapsed / COLLAPSE_MS);
          entry.group.position.y = -1.4 * progress;
          entry.group.scale.setScalar(1 - 0.55 * progress);
          if (progress >= 1) {
            entry.animation = null;
            entry.group.visible = false;
            entry.group.position.y = 0;
            entry.group.scale.setScalar(1);
          } else animating = true;
        } else {
          const progress = Math.min(1, elapsed / PULSE_MS);
          entry.badge.scale.setScalar(1.2 + 0.5 * Math.sin(progress * Math.PI));
          if (progress >= 1) {
            entry.animation = null;
            entry.badge.scale.setScalar(1.2);
          } else animating = true;
        }
      }
      if (!reducedMotion) {
        const ripple = (Math.sin(nowMs / 1300) + 1) / 2;
        waterMaterial.opacity = 0.7 + 0.18 * ripple;
        for (const entry of entries.values()) {
          if (entry.scaffold.visible) entry.scaffold.rotation.z = (nowMs / 5000) * Math.PI * 2;
        }
      }
      renderOnce();
      return animating;
    },
    dispose() {
      renderer.dispose();
      renderer.domElement.remove();
    }
  };
}
