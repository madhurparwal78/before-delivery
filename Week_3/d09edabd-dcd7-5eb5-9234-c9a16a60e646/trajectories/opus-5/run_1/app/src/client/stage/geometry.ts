import * as THREE from 'three';
import type { Placement } from '../../shared/types.js';

export interface RoomSize {
  widthMm: number;
  depthMm: number;
  heightMm: number;
}

const colours: Record<string, number> = {
  door: 0x2f6f7f,
  box: 0x8a5a2b,
  cylinder: 0xb08d57,
  prop: 0x6b8f71,
};

export const toMetres = (mm: number): number => mm / 1000;

export function placementMesh(placement: Placement): THREE.Mesh {
  const width = toMetres(placement.widthMm);
  const depth = toMetres(placement.depthMm);
  const height = toMetres(placement.heightMm);
  const geometry =
    placement.kind === 'cylinder'
      ? new THREE.CylinderGeometry(width / 2, width / 2, height, 16)
      : new THREE.BoxGeometry(width, height, depth);
  const material = new THREE.MeshLambertMaterial({ color: colours[placement.kind] ?? 0x8a5a2b });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = placement.id;
  positionMesh(mesh, placement);
  return mesh;
}

export function positionMesh(mesh: THREE.Object3D, placement: Placement): void {
  mesh.position.set(
    toMetres(placement.xMm),
    toMetres(placement.yMm) + toMetres(placement.heightMm) / 2,
    toMetres(placement.zMm),
  );
  mesh.rotation.y = (placement.rotationDeg * Math.PI) / 180;
}

export function roomShell(room: RoomSize): THREE.Group {
  const group = new THREE.Group();
  const width = toMetres(room.widthMm);
  const depth = toMetres(room.depthMm);
  const height = toMetres(room.heightMm);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshLambertMaterial({ color: 0x1b222c }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(width / 2, 0, depth / 2);
  group.add(floor);

  const wallMaterial = new THREE.MeshLambertMaterial({
    color: 0x263040,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
  });
  const walls: [number, number, number, number][] = [
    [width / 2, height / 2, 0, 0],
    [width / 2, height / 2, depth, Math.PI],
    [0, height / 2, depth / 2, Math.PI / 2],
    [width, height / 2, depth / 2, -Math.PI / 2],
  ];
  for (const [x, y, z, rotation] of walls) {
    const span = rotation === 0 || Math.abs(rotation) === Math.PI ? width : depth;
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(span, height), wallMaterial);
    wall.position.set(x, y, z);
    wall.rotation.y = rotation;
    group.add(wall);
  }
  return group;
}

export function gridFloor(): THREE.GridHelper {
  const grid = new THREE.GridHelper(80, 80, 0x223042, 0x18202b);
  grid.position.y = -0.002;
  return grid;
}

export function lights(): THREE.Object3D[] {
  const ambient = new THREE.AmbientLight(0x4a5868, 1.1);
  const key = new THREE.DirectionalLight(0xffd9b0, 1.1);
  key.position.set(4, 8, 6);
  const fill = new THREE.DirectionalLight(0x5f7fa8, 0.5);
  fill.position.set(-5, 4, -4);
  return [ambient, key, fill];
}

export function entryPose(
  room: RoomSize,
  placements: Placement[],
): { x: number; z: number; heading: number } {
  const door = placements.find((placement) => placement.kind === 'door' && placement.entry);
  const width = toMetres(room.widthMm);
  if (!door) return { x: width / 2, z: 0.8, heading: 0 };
  return { x: toMetres(door.xMm), z: toMetres(door.zMm) + 0.8, heading: 0 };
}
