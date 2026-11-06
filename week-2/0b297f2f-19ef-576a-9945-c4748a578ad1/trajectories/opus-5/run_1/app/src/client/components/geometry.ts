export type Compass = 'north' | 'east' | 'south' | 'west';

export interface WallLike {
  id: string;
  name: string;
  lengthMm: number;
  heightMm: number;
}

export const facingYaw: Record<Compass, number> = {
  north: 0,
  east: 90,
  south: 180,
  west: 270,
};

export function compassOf(wall: { id: string; name: string }): Compass {
  const text = `${wall.id} ${wall.name}`.toLowerCase();
  if (text.includes('north')) return 'north';
  if (text.includes('east')) return 'east';
  if (text.includes('south')) return 'south';
  return 'west';
}

export interface RoomSize {
  widthMm: number;
  depthMm: number;
  heightMm: number;
}

export function roomSize(walls: readonly WallLike[]): RoomSize {
  const north = walls.find((wall) => compassOf(wall) === 'north');
  const east = walls.find((wall) => compassOf(wall) === 'east');
  return {
    widthMm: north?.lengthMm ?? 12000,
    depthMm: east?.lengthMm ?? 6000,
    heightMm: north?.heightMm ?? 4000,
  };
}

/** Where a work sits in the room, in metres, from its wall and offset. */
export function workPosition(
  compass: Compass,
  offsetMm: number,
  centreHeightMm: number,
  room: RoomSize,
): { x: number; y: number; z: number; rotationY: number } {
  const halfWidth = room.widthMm / 2000;
  const halfDepth = room.depthMm / 2000;
  const offset = offsetMm / 1000;
  const y = centreHeightMm / 1000;
  switch (compass) {
    case 'north':
      return { x: -halfWidth + offset, y, z: -halfDepth, rotationY: 0 };
    case 'south':
      return { x: halfWidth - offset, y, z: halfDepth, rotationY: Math.PI };
    case 'east':
      return { x: halfWidth, y, z: -halfDepth + offset, rotationY: -Math.PI / 2 };
    case 'west':
      return { x: -halfWidth, y, z: halfDepth - offset, rotationY: Math.PI / 2 };
  }
}

export function yawToDirection(yawDegrees: number): { x: number; z: number } {
  const radians = (yawDegrees * Math.PI) / 180;
  return { x: Math.sin(radians), z: -Math.cos(radians) };
}

export function normaliseYaw(yawDegrees: number): number {
  return ((Math.round(yawDegrees) % 360) + 360) % 360;
}

/** A pale-to-warm tint for a wall's planned lux in Light view. */
export function luxTint(plannedLux: number): [number, number, number] {
  const pale: [number, number, number] = [0.93, 0.92, 0.88];
  const warm: [number, number, number] = [0.85, 0.55, 0.25];
  const mix = Math.min(1, Math.max(0, plannedLux / 300));
  return [
    pale[0] + (warm[0] - pale[0]) * mix,
    pale[1] + (warm[1] - pale[1]) * mix,
    pale[2] + (warm[2] - pale[2]) * mix,
  ];
}
