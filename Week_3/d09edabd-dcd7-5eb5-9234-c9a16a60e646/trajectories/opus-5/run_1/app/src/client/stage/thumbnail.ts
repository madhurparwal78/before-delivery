import * as THREE from 'three';
import type { Placement } from '../../shared/types.js';
import { gridFloor, lights, placementMesh, roomShell, toMetres } from './geometry.js';
import type { RoomSize } from './geometry.js';
import { planThumbnail } from './plan.js';

let renderer: THREE.WebGLRenderer | null = null;
let available: boolean | null = null;

function offscreen(): THREE.WebGLRenderer | null {
  if (available === false) return null;
  if (renderer) return renderer;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
    if (canvas.getContext('webgl2') === null && canvas.getContext('webgl') === null) {
      available = false;
      return null;
    }
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setSize(320, 180, false);
    available = true;
    return renderer;
  } catch {
    available = false;
    return null;
  }
}

/** A low-poly toon-lit render of the room's own primitives, by the app's renderer. */
export function renderRoomThumbnail(room: RoomSize, placements: Placement[]): HTMLCanvasElement {
  const engine = offscreen();
  if (!engine) return planThumbnail(room, placements);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0f14);
  for (const light of lights()) scene.add(light);
  scene.add(gridFloor());
  scene.add(roomShell(room));
  for (const placement of placements) scene.add(placementMesh(placement));
  const camera = new THREE.PerspectiveCamera(50, 320 / 180, 0.1, 200);
  const width = toMetres(room.widthMm);
  const depth = toMetres(room.depthMm);
  const radius = Math.max(width, depth) * 1.7;
  camera.position.set(width / 2 + radius * 0.6, radius * 0.8, depth / 2 + radius * 0.8);
  camera.lookAt(new THREE.Vector3(width / 2, 0.5, depth / 2));
  engine.render(scene, camera);
  const snapshot = document.createElement('canvas');
  snapshot.width = 320;
  snapshot.height = 180;
  const context = snapshot.getContext('2d');
  if (context) context.drawImage(engine.domElement, 0, 0);
  return snapshot;
}

export async function thumbnailBlob(
  room: RoomSize,
  placements: Placement[],
): Promise<Blob | null> {
  const canvas = renderRoomThumbnail(room, placements);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
}
