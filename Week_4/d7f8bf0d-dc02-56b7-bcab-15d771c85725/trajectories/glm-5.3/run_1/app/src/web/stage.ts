import * as THREE from 'three';
import type { LayoutContent, SessionSnapshot } from '../shared/domain';

/**
 * The club-hall layout stage: a procedural HO-scale scene. Floor, trestle legs,
 * modules, track, signals at block ends, station name boards and low-poly
 * freight stock, all built here by code with no external artwork.
 */

export interface StageHandle {
  /** Rebuild the whole scene from a layout content. */
  buildFromLayout(content: LayoutContent): void;
  /** Update train positions and block states without rebuilding the scene. */
  updateSession(session: SessionSnapshot | null, blockPoints: (id: string) => { x: number; y: number } | null): void;
  /** Apply camera state. */
  setCamera(heading: number, zoom: number, panX: number, panY: number): void;
  /** Project a block's track centre to CSS pixels for the current camera. */
  blockScreenPoint(content: LayoutContent, blockId: string): { x: number; y: number } | null;
  /** The camera controller. */
  controls: CameraControls;
  /** Pause or resume view-only rendering (WebGL context loss). */
  setPaused(paused: boolean): void;
  /** Whether the WebGL context is lost. */
  isLost(): boolean;
  render(): void;
  dispose(): void;
}

export interface CameraControls {
  heading: number;
  zoom: number;
  panX: number;
  panY: number;
  rotate(deltaDegrees: number): void;
  zoomBy(factor: number): void;
  panBy(dx: number, dy: number): void;
  reset(): void;
}

const MM_PER_WORLD = 0.001;

interface BlockMeshes {
  group: THREE.Group;
  track: THREE.Mesh[];
  blockId: string;
  centre: THREE.Vector3;
}

export function createStage(container: HTMLElement, reducedMotion: boolean): StageHandle {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#ffffff');

  const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.05, 400);
  const hallRoofLight = new THREE.HemisphereLight('#ffffff', '#dbe6ff', 1.1);
  scene.add(hallRoofLight);
  const key = new THREE.DirectionalLight('#ffffff', 1.4);
  key.position.set(30, 60, 40);
  scene.add(key);

  // ---- club hall floor: a saturated field-green floor ----
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(60, 0.2, 40),
    new THREE.MeshLambertMaterial({ color: '#23b04b' }),
  );
  floor.position.set(12, -0.1, 0);
  scene.add(floor);

  // pale gradient hall roof: a low, broad arch above.
  const roof = new THREE.Mesh(
    new THREE.CylinderGeometry(26, 26, 70, 24, 1, true, 0, Math.PI),
    new THREE.MeshLambertMaterial({ color: '#eef3ff', side: THREE.DoubleSide }),
  );
  roof.rotation.z = Math.PI / 2;
  roof.rotation.y = Math.PI / 2;
  roof.position.set(12, 16, 0);
  scene.add(roof);

  let lost = false;
  let paused = false;
  let content: LayoutContent | null = null;
  const blocks: BlockMeshes[] = [];
  const trainMeshes = new Map<string, THREE.Group>();
  const signalByBlock = new Map<string, THREE.Group>();
  const boardByStation = new Map<string, THREE.Mesh>();

  // ---- materials: matte low-poly ----
  const matTrack = new THREE.MeshLambertMaterial({ color: '#5a4633' });
  const matRail = new THREE.MeshLambertMaterial({ color: '#9aa4bb' });
  const matTrestle = new THREE.MeshLambertMaterial({ color: '#c98b52' });
  const matModule = new THREE.MeshLambertMaterial({ color: '#f6e7c8' });
  const matFree = new THREE.MeshLambertMaterial({ color: '#2fbd58' });
  const matReserved = new THREE.MeshLambertMaterial({ color: '#3fa9f5' });
  const matOccupied = new THREE.MeshLambertMaterial({ color: '#ff8b21' });
  const matOutOfService = new THREE.MeshLambertMaterial({ color: '#1c2438' });
  const matStock = new THREE.MeshLambertMaterial({ color: '#b04a2f' });
  const matStock2 = new THREE.MeshLambertMaterial({ color: '#3f6ea5' });
  const matSignal = new THREE.MeshLambertMaterial({ color: '#1c2438' });
  const matBoard = new THREE.MeshLambertMaterial({ color: '#ffffff' });

  const controls: CameraControls = {
    heading: 0,
    zoom: 1,
    panX: 0,
    panY: 0,
    rotate(delta) {
      controls.heading = (controls.heading + delta + 360) % 360;
      applyCamera();
    },
    zoomBy(factor) {
      controls.zoom = Math.min(4, Math.max(0.4, controls.zoom * factor));
      applyCamera();
    },
    panBy(dx, dy) {
      controls.panX += dx;
      controls.panY += dy;
      applyCamera();
    },
    reset() {
      controls.heading = 0;
      controls.zoom = 1;
      controls.panX = 0;
      controls.panY = 0;
      applyCamera();
    },
  };

  function applyCamera(): void {
    const radius = 26 / controls.zoom;
    const headingRad = (controls.heading * Math.PI) / 180;
    const cx = 12 + controls.panX * MM_PER_WORLD * 0.02;
    const cz = controls.panY * MM_PER_WORLD * 0.02;
    camera.position.set(
      cx + radius * Math.sin(headingRad),
      16 / controls.zoom,
      cz + radius * Math.cos(headingRad),
    );
    camera.lookAt(cx, 0, cz);
  }

  function fitAll(): void {
    if (!content) return;
    let minX = Infinity, maxX = -Infinity;
    for (const m of content.modules) {
      for (const p of m.pieces) {
        minX = Math.min(minX, p.start.x_mm, p.end.x_mm);
        maxX = Math.max(maxX, p.start.x_mm, p.end.x_mm);
      }
    }
    if (minX === Infinity) return;
    const centreMm = (minX + maxX) / 2;
    controls.panX = -(centreMm - 12000) * 0.02 * 50;
    controls.panX = -centreMm * MM_PER_WORLD * 0.02 * 50 / 50;
    controls.panX = -centreMm * MM_PER_WORLD;
    applyCamera();
  }

  function addTrackForPiece(group: THREE.Group, start: { x_mm: number; y_mm: number; heading_deg: number }, lengthMm: number, pieceKind: string, hand?: string): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    const worldLen = lengthMm * MM_PER_WORLD;
    if (pieceKind === 'curve') {
      const segments = 8;
      for (let i = 0; i < segments; i++) {
        const t0 = i / segments;
        const t1 = (i + 1) / segments;
        const seg = new THREE.Mesh(new THREE.BoxGeometry(0.006 * worldLen + 0.004, 0.004, 0.02), matTrack);
        seg.position.set(start.x_mm * MM_PER_WORLD + t0 * worldLen, 0.78, -start.y_mm * MM_PER_WORLD - t1 * 0.005);
        group.add(seg);
        meshes.push(seg);
      }
    } else {
      const bed = new THREE.Mesh(new THREE.BoxGeometry(worldLen, 0.004, 0.04), matTrack);
      const headingRad = (start.heading_deg * Math.PI) / 180;
      bed.position.set(
        start.x_mm * MM_PER_WORLD + (worldLen / 2) * Math.cos(headingRad),
        0.78,
        -start.y_mm * MM_PER_WORLD - (worldLen / 2) * Math.sin(headingRad),
      );
      bed.rotation.y = -headingRad;
      group.add(bed);
      meshes.push(bed);
      const railA = new THREE.Mesh(new THREE.BoxGeometry(worldLen, 0.001, 0.002), matRail);
      railA.position.copy(bed.position);
      railA.position.z += 0.008;
      railA.rotation.y = -headingRad;
      group.add(railA);
      const railB = railA.clone();
      railB.position.z -= 0.016;
      group.add(railB);
    }
    return meshes;
  }

  function buildFromLayout(next: LayoutContent): void {
    content = next;
    for (const b of blocks) {
      scene.remove(b.group);
    }
    blocks.length = 0;
    trainMeshes.clear();
    signalByBlock.clear();
    boardByStation.clear();

    // Module platforms with trestle legs.
    for (const m of next.modules) {
      if (m.trashed) continue;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const p of m.pieces) {
        minX = Math.min(minX, p.start.x_mm, p.end.x_mm);
        maxX = Math.max(maxX, p.start.x_mm, p.end.x_mm);
        minZ = Math.min(minZ, p.start.y_mm, p.end.y_mm);
        maxZ = Math.max(maxZ, p.start.y_mm, p.end.y_mm);
      }
      if (!Number.isFinite(minX)) continue;
      const widthMm = Math.max(600, maxX - minX + 400);
      const depthMm = Math.max(400, maxZ - minZ + 500);
      const centreMm = (minX + maxX) / 2;
      const platform = new THREE.Mesh(
        new THREE.BoxGeometry(widthMm * MM_PER_WORLD, 0.02, depthMm * MM_PER_WORLD),
        matModule,
      );
      platform.position.set(centreMm * MM_PER_WORLD, 0.74, -(minZ + maxZ) / 2 * MM_PER_WORLD);
      scene.add(platform);
      for (let lx = -1; lx <= 1; lx++) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.7, 0.02), matTrestle);
        leg.position.set(
          centreMm * MM_PER_WORLD + (lx * widthMm * MM_PER_WORLD) / 2.6,
          0.36,
          -(minZ + maxZ) / 2 * MM_PER_WORLD,
        );
        scene.add(leg);
      }
    }

    // Track grouped by block, with a state pad under each block.
    for (const block of next.blocks) {
      const group = new THREE.Group();
      group.userData.blockId = block.id;
      const track: THREE.Mesh[] = [];
      let count = 0;
      let centre = new THREE.Vector3();
      for (const m of next.modules) {
        if (m.trashed) continue;
        for (const p of m.pieces) {
          if (p.block_id !== block.id) continue;
          const meshes = addTrackForPiece(group, p.start, p.length_mm, p.kind, p.hand);
          track.push(...meshes);
          centre.add(new THREE.Vector3(p.start.x_mm * MM_PER_WORLD, 0.78, -p.start.y_mm * MM_PER_WORLD));
          count += 1;
        }
      }
      if (count > 0) centre.multiplyScalar(1 / count);
      scene.add(group);
      blocks.push({ group, track, blockId: block.id, centre });

      // Signal at the block's west end.
      const signal = new THREE.Group();
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.16), matSignal);
      post.position.set(centre.x - 0.4, 0.86, centre.z);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.02), matSignal);
      head.position.set(centre.x - 0.4, 0.95, centre.z);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.008), new THREE.MeshBasicMaterial({ color: '#23b04b' }));
      lamp.position.set(centre.x - 0.4, 0.98, centre.z);
      signal.add(post, head, lamp);
      signal.userData.lamp = lamp;
      scene.add(signal);
      signalByBlock.set(block.id, signal);
    }

    // Station name boards.
    for (const station of next.stations) {
      const firstBlock = next.blocks.find((b) => b.id === station.block_ids[0]);
      if (!firstBlock) continue;
      const blockEntry = blocks.find((b) => b.blockId === firstBlock.id);
      if (!blockEntry) continue;
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.005), matBoard);
      board.position.set(blockEntry.centre.x, 0.92, blockEntry.centre.z + 0.14);
      scene.add(board);
      boardByStation.set(station.id, board);
    }

    fitAll();
  }

  function updateSession(session: SessionSnapshot | null, blockPoints: (id: string) => { x: number; y: number } | null): void {
    void blockPoints;
    // Block state colours from committed state only.
    const stateByBlock = new Map<string, string>();
    if (session) {
      for (const b of session.blocks) stateByBlock.set(b.id, b.state);
    }
    for (const entry of blocks) {
      const state = stateByBlock.get(entry.blockId) ?? 'free';
      const material = state === 'occupied' ? matOccupied : state === 'reserved' ? matReserved : state === 'out_of_service' ? matOutOfService : matFree;
      for (const mesh of entry.track) {
        (mesh as THREE.Mesh).material = state === 'free' ? matTrack : material;
      }
      const signal = signalByBlock.get(entry.blockId);
      const lamp = signal?.userData.lamp as THREE.Mesh | undefined;
      if (lamp) {
        (lamp.material as THREE.MeshBasicMaterial).color.set(
          state === 'free' ? '#23b04b' : state === 'reserved' ? '#3fa9f5' : state === 'occupied' ? '#ff8b21' : '#1c2438',
        );
      }
    }
    // Trains: one low-poly freight car group per train, at the head position.
    if (session && content) {
      const live = new Set<string>();
      for (const train of session.trains) {
        live.add(train.id);
        let group = trainMeshes.get(train.id);
        if (!group) {
          group = new THREE.Group();
          const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.045, 0.05), matStock);
          body.position.y = 0.025;
          const cab = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.05), matStock2);
          cab.position.set(-0.05, 0.03, 0);
          group.add(body, cab);
          scene.add(group);
          trainMeshes.set(train.id, group);
        }
        const blockEntry = blocks.find((b) => b.blockId === train.head_block_id);
        if (!blockEntry) continue;
        const headingRad = train.direction === 'east' ? 0 : Math.PI;
        group.position.set(
          blockEntry.centre.x + (train.head_offset_mm - (blockEntry.centre.x ? 0 : 0)) * MM_PER_WORLD * 0 + train.head_offset_mm * MM_PER_WORLD - blockEntry.centre.x,
          0.8,
          blockEntry.centre.z,
        );
        group.rotation.y = -headingRad;
      }
      for (const [id, group] of trainMeshes) {
        if (!live.has(id)) {
          scene.remove(group);
          trainMeshes.delete(id);
        }
      }
    }
  }

  function blockScreenPoint(nextContent: LayoutContent, blockId: string): { x: number; y: number } | null {
    void nextContent;
    const entry = blocks.find((b) => b.blockId === blockId);
    if (!entry) return null;
    const projected = entry.centre.clone().project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    return {
      x: (projected.x * 0.5 + 0.5) * rect.width,
      y: (-projected.y * 0.5 + 0.5) * rect.height,
    };
  }

  // One pigeon crosses under the hall roof once per stage load; removed under reduced motion.
  const pigeon = createPigeon(scene, reducedMotion);

  let raf = 0;
  let lastRender = 0;
  function renderLoop(now: number): void {
    raf = requestAnimationFrame(renderLoop);
    if (paused || lost) return;
    const minInterval = reducedMotion ? 1000 : 16;
    if (now - lastRender < minInterval) return;
    lastRender = now;
    pigeon?.update(now);
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(renderLoop);

  const onLost = (event: Event): void => {
    event.preventDefault();
    lost = true;
  };
  renderer.domElement.addEventListener('webglcontextlost', onLost);
  const onRestored = (): void => {
    lost = false;
    if (content) buildFromLayout(content);
  };
  renderer.domElement.addEventListener('webglcontextrestored', onRestored);

  const onResize = (): void => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);

  applyCamera();

  return {
    buildFromLayout,
    updateSession,
    setCamera(heading, zoom, panX, panY) {
      controls.heading = heading;
      controls.zoom = zoom;
      controls.panX = panX;
      controls.panY = panY;
      applyCamera();
    },
    blockScreenPoint,
    controls,
    setPaused(value: boolean) {
      paused = value;
    },
    isLost: () => lost,
    render() {
      renderer.render(scene, camera);
    },
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('webglcontextlost', onLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onRestored);
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    },
  };
}

/** One pigeon crosses under the hall roof once per stage load; removed under reduced motion. */
export function createPigeon(scene: THREE.Scene, reducedMotion: boolean): { update: (now: number) => void } | null {
  if (reducedMotion) return null;
  const pigeon = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshLambertMaterial({ color: '#8b97b5' }));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), new THREE.MeshLambertMaterial({ color: '#aeb9d6' }));
  head.position.set(0.03, 0.02, 0);
  pigeon.add(body, head);
  pigeon.position.set(-20, 9, -8);
  scene.add(pigeon);
  const started = performance.now();
  return {
    update(now: number): void {
      const t = (now - started) / 3000;
      if (t >= 1) {
        scene.remove(pigeon);
        return;
      }
      pigeon.position.x = -20 + t * 64;
      pigeon.position.y = 9 + Math.sin(t * Math.PI * 4) * 0.4;
    },
  };
}
