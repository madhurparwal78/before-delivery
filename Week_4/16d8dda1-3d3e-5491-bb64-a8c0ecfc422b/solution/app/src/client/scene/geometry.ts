import { Vector3 } from 'three';
import type { SessionSnapshot } from '../../shared/wire';

export type Room = SessionSnapshot['room'];

/** Floor-plan coordinates: one cell is one world unit, the room is centred on the origin, row 0 is the front wall. */
export const cellX = (room: Room, column: number): number => column + 0.5 - room.columns / 2;
const cellZ = (room: Room, row: number): number => row + 0.5 - room.rows / 2;
export const frontWallZ = (room: Room): number => -room.rows / 2;
export const cellCenter = (room: Room, column: number, row: number): Vector3 =>
  new Vector3(cellX(room, column), 0, cellZ(room, row));

export const BOARD_CELLS = 4;
export const BOARD_CENTER_HEIGHT = 1.75;
export const WALL_HEIGHT = 3.3;
export const PAPER = '#FBF7EE';
export const INK = '#1B2723';
export const SLATE = '#2F4B41';
export const BRICK = '#A6361F';

export const WALK_MS = 640;
export const RETURN_STAGGER_MS = 120;
export const HAND_LIFT_MS = 220;
export const SPOTLIGHT_FADE_MS = 320;
export const BOARD_BRIGHTEN_MS = 320;
export const RING_REFILL_MS = 280;
export const CAMERA_GLIDE_MS = 650;
export const MODEL_TURN_MS = 30000;
export const DIMMED_STRENGTH = 0.4;

/** Where a table's dealt learners stand: evenly around the table cell. */
export function tableSlot(centre: Vector3, index: number, count: number): Vector3 {
  const angle = Math.PI / 4 + (index / Math.max(1, count)) * Math.PI * 2;
  return new Vector3(centre.x + Math.cos(angle) * 0.66, 0, centre.z + Math.sin(angle) * 0.66);
}
