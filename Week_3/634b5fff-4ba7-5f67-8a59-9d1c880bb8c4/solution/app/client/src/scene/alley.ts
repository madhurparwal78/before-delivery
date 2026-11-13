import { ConeGeometry, CylinderGeometry, SphereGeometry, type BufferGeometry } from "three";
import { GeoBuilder } from "./builder.js";
import { MOUTH_Z, SHELF_PLANE_Z, START_Z } from "./path.js";
import { seeded } from "./random.js";

/** Where the narrow part of the alley stops and the court before the shelf wall begins. */
const ALLEY_END_Z = MOUTH_Z - 1.5;
const ALLEY_START_Z = START_Z + 12;
const HALF_WIDTH = 3.3;
const COURT_HALF_WIDTH = 17;
/** The ground ends here, a few units short of the shelf wall, so the wall's lower rows stay in view. */
const GROUND_END_Z = SHELF_PLANE_Z + 8;

const WALLS = ["#33466b", "#38496e", "#2f405f", "#3d4f75", "#34456a"];
const TRIM = ["#5a729f", "#52698f", "#6580ad"];
const DOORS = ["#0a1220", "#111b2f", "#0c1727"];
const SNOW = "#cbd7ea";
const SNOW_SHADE = "#93a6c8";
const IRON = "#080d18";
const PANE = "#0b1424";

type Side = -1 | 1;

const front = (side: Side): number => side * HALF_WIDTH;

const windowPane = (b: GeoBuilder, side: Side, z: number, y: number, rand: () => number): void => {
  const x = front(side);
  const trim = TRIM[Math.floor(rand() * TRIM.length)] as string;
  b.box(0.12, 1.7, 1.15, trim, { x: x - side * 0.04, y, z });
  b.box(0.12, 1.5, 0.95, PANE, { x: x - side * 0.1, y, z }, 0.7 + rand() * 0.9);
  b.box(0.14, 0.06, 0.95, trim, { x: x - side * 0.12, y, z });
  b.box(0.14, 1.5, 0.06, trim, { x: x - side * 0.12, y, z });
  b.box(0.45, 0.1, 1.45, trim, { x: x - side * 0.22, y: y - 0.9, z });
  b.box(0.4, 0.22, 1.4, SNOW, { x: x - side * 0.24, y: y - 0.74, z, rz: side * 0.12 }, 0.8 + rand() * 0.25);
  if (rand() < 0.4) {
    b.box(0.08, 1.6, 0.5, "#162239", { x: x - side * 0.12, y, z: z - 0.8 });
    b.box(0.08, 1.6, 0.5, "#162239", { x: x - side * 0.12, y, z: z + 0.8 });
  }
};

const doorway = (b: GeoBuilder, side: Side, z: number, rand: () => number): void => {
  const x = front(side);
  const door = DOORS[Math.floor(rand() * DOORS.length)] as string;
  b.box(0.3, 2.9, 1.7, TRIM[0] as string, { x: x - side * 0.1, y: 1.45, z });
  b.box(0.4, 2.6, 1.3, door, { x: x - side * 0.18, y: 1.3, z });
  for (let plank = -2; plank <= 2; plank += 1) b.box(0.42, 2.6, 0.04, "#050912", { x: x - side * 0.2, y: 1.3, z: z + plank * 0.24 });
  b.box(0.5, 0.18, 2.1, TRIM[1] as string, { x: x - side * 0.25, y: 2.95, z });
  b.box(0.55, 0.14, 2.0, SNOW, { x: x - side * 0.27, y: 3.12, z, rz: side * 0.1 }, 0.9);
  b.box(0.9, 0.22, 1.9, "#1b2842", { x: x - side * 0.6, y: 0.11, z });
  b.box(0.8, 0.12, 1.7, SNOW, { x: x - side * 0.62, y: 0.28, z }, 0.85);
  b.cylinder(0.05, 0.05, 0.3, "#1a2338", { x: x - side * 0.42, y: 1.4, z: z + 0.4, rx: Math.PI / 2 }, 8);
};

const building = (b: GeoBuilder, side: Side, z0: number, length: number, height: number, rand: () => number): void => {
  const x = front(side);
  const wall = WALLS[Math.floor(rand() * WALLS.length)] as string;
  const depth = 5;
  b.box(depth, height, length, wall, { x: x + side * depth * 0.5, y: height / 2, z: z0 });
  b.box(0.3, 0.9, length + 0.1, "#2a3c5d", { x: x - side * 0.1, y: 0.45, z: z0 });
  b.box(0.35, 0.2, length + 0.3, "#465d86", { x: x - side * 0.15, y: height - 0.1, z: z0 });
  b.box(0.7, 0.22, length + 0.3, SNOW, { x: x - side * 0.3, y: height + 0.02, z: z0, rz: side * 0.09 }, 0.85);
  const pitch = 0.5;
  b.box(depth * 1.2, 0.5, length + 0.8, SNOW_SHADE, { x: x + side * depth * 0.55, y: height + 1.0, z: z0, rz: -side * pitch }, 0.55);
  const chimneys = rand() < 0.7 ? 1 : 0;
  for (let i = 0; i < chimneys; i += 1) {
    const cz = z0 + (rand() - 0.5) * length * 0.6;
    b.box(0.9, 2.2, 0.9, "#0b1220", { x: x + side * 2.4, y: height + 2.6, z: cz });
    b.box(1.05, 0.2, 1.05, SNOW, { x: x + side * 2.4, y: height + 3.8, z: cz }, 0.8);
  }
  const floors = Math.max(2, Math.floor(height / 3.2));
  const slots = Math.max(1, Math.floor(length / 2.1));
  const door = rand() < 0.65 ? Math.floor(rand() * slots) : -1;
  for (let slot = 0; slot < slots; slot += 1) {
    const z = z0 - length / 2 + (slot + 0.5) * (length / slots);
    for (let floor = 0; floor < floors; floor += 1) {
      if (floor === 0 && slot === door) doorway(b, side, z, rand);
      else if (rand() < 0.88) windowPane(b, side, z, 2.4 + floor * 2.9 - (floor === 0 ? -0.2 : 0), rand);
    }
  }
};

const lamp = (b: GeoBuilder, x: number, z: number, side: Side): void => {
  const lantern = x - side * 0.6;
  b.cylinder(0.09, 0.12, 4, IRON, { x, y: 2, z }, 8);
  b.cylinder(0.2, 0.2, 0.3, IRON, { x, y: 0.15, z }, 8);
  b.box(0.7, 0.07, 0.07, IRON, { x: x - side * 0.3, y: 3.75, z });
  b.box(0.42, 0.55, 0.42, "#223049", { x: lantern, y: 3.45, z }, 0.9);
  b.box(0.52, 0.1, 0.52, IRON, { x: lantern, y: 3.78, z });
  b.add(new ConeGeometry(0.34, 0.26, 4), IRON, { x: lantern, y: 3.97, z, ry: Math.PI / 4 });
  b.box(0.5, 0.08, 0.5, SNOW, { x: lantern, y: 4.04, z }, 0.7);
};

const drift = (b: GeoBuilder, x: number, z: number, sx: number, sy: number, sz: number, shade: number): void => {
  b.add(new SphereGeometry(1, 28, 12), SNOW, { x, y: 0, z, sx, sy, sz }, shade);
};

const crate = (b: GeoBuilder, x: number, z: number, size: number, turn: number): void => {
  b.box(size, size, size, "#16213a", { x, y: size / 2, z, ry: turn });
  b.box(size * 1.04, 0.05, size * 1.04, "#0b1220", { x, y: size * 0.2, z, ry: turn });
  b.box(size * 1.04, 0.05, size * 1.04, "#0b1220", { x, y: size * 0.8, z, ry: turn });
  b.box(size * 1.02, 0.12, size * 1.02, SNOW, { x, y: size + 0.04, z, ry: turn }, 0.9);
};

const barrel = (b: GeoBuilder, x: number, z: number): void => {
  b.add(new CylinderGeometry(0.42, 0.38, 1.0, 14), "#1a253d", { x, y: 0.5, z });
  b.add(new CylinderGeometry(0.43, 0.43, 0.06, 14), "#0a111f", { x, y: 0.28, z });
  b.add(new CylinderGeometry(0.43, 0.43, 0.06, 14), "#0a111f", { x, y: 0.76, z });
  b.add(new CylinderGeometry(0.4, 0.4, 0.1, 14), SNOW, { x, y: 1.02, z }, 0.9);
};

const sled = (b: GeoBuilder, x: number, z: number): void => {
  b.box(0.6, 0.08, 1.5, "#1d2a45", { x, y: 0.36, z, ry: 0.2 });
  b.box(0.06, 0.3, 1.7, IRON, { x: x - 0.25, y: 0.15, z, ry: 0.2 });
  b.box(0.06, 0.3, 1.7, IRON, { x: x + 0.25, y: 0.15, z, ry: 0.2 });
  b.box(0.5, 0.06, 1.3, SNOW, { x, y: 0.43, z, ry: 0.2 }, 0.8);
};

const footprints = (b: GeoBuilder, rand: () => number): void => {
  for (let z = ALLEY_START_Z - 4; z > ALLEY_END_Z - 6; z -= 0.75) {
    const side = Math.floor(z / 0.75) % 2 === 0 ? 0.14 : -0.14;
    const sway = Math.sin(z * 0.23) * 1.1;
    b.add(new SphereGeometry(1, 8, 5), SNOW_SHADE, { x: sway + side, y: 0.015, z, sx: 0.09, sy: 0.04, sz: 0.2, ry: Math.sin(z * 0.23) * 0.3 }, 0.5 + rand() * 0.15);
  }
};

const court = (b: GeoBuilder, rand: () => number): void => {
  const length = ALLEY_END_Z - (SHELF_PLANE_Z - 1);
  const middle = (ALLEY_END_Z + SHELF_PLANE_Z - 1) / 2;
  for (const side of [-1, 1] as const) {
    b.box(3, 26, length, WALLS[1] as string, { x: side * (COURT_HALF_WIDTH + 1.5), y: 13, z: middle });
    for (let z = ALLEY_END_Z - 4; z > SHELF_PLANE_Z + 4; z -= 4.2) {
      for (let floor = 0; floor < 3; floor += 1) {
        if (rand() < 0.75) {
          b.box(0.2, 2.1, 1.4, TRIM[0] as string, { x: side * (COURT_HALF_WIDTH - 0.1), y: 4 + floor * 5.2, z });
          b.box(0.2, 1.9, 1.15, PANE, { x: side * (COURT_HALF_WIDTH - 0.2), y: 4 + floor * 5.2, z }, 0.8);
        }
      }
    }
  }
  lamp(b, -5.5, ALLEY_END_Z - 6, 1);
  lamp(b, 5.5, ALLEY_END_Z - 12, -1);
  drift(b, -9, ALLEY_END_Z - 7, 3.2, 0.5, 2.4, 0.9);
  drift(b, 8, ALLEY_END_Z - 10, 2.8, 0.45, 3.2, 0.85);
  drift(b, 0, GROUND_END_Z + 2, 14, 0.6, 1.4, 0.8);
};

/** The whole static world as one geometry: snowy ground, two rows of houses, lamp posts, drifts, the court. */
export const buildAlley = (): BufferGeometry => {
  const rand = seeded(1843);
  const b = new GeoBuilder(true);
  const groundLength = ALLEY_START_Z - GROUND_END_Z;
  b.box(COURT_HALF_WIDTH * 2 + 6, 3, groundLength, "#c4d0e4", { y: -1.5, z: (ALLEY_START_Z + GROUND_END_Z) / 2 });
  for (const side of [-1, 1] as const) {
    let z = ALLEY_START_Z;
    while (z > ALLEY_END_Z) {
      const length = 5 + rand() * 3.5;
      const height = 8 + rand() * 5;
      building(b, side, z - length / 2, length, height, rand);
      z -= length;
    }
    let lampZ = ALLEY_START_Z - 3 - (side === 1 ? 0 : 6);
    while (lampZ > ALLEY_END_Z) {
      lamp(b, side * (HALF_WIDTH - 0.7), lampZ, side);
      lampZ -= 12;
    }
    for (let z2 = ALLEY_START_Z - 2; z2 > ALLEY_END_Z; z2 -= 2 + rand() * 3) {
      drift(b, side * (HALF_WIDTH - 0.55 - rand() * 0.5), z2, 0.9 + rand() * 0.8, 0.25 + rand() * 0.35, 1.2 + rand() * 1.4, 0.75 + rand() * 0.3);
    }
  }
  crate(b, -2.5, 49, 0.8, 0.3);
  crate(b, -2.7, 49.8, 0.55, -0.2);
  barrel(b, 2.6, 44);
  barrel(b, 2.9, 43.2);
  crate(b, 2.4, 33, 0.9, 0.5);
  sled(b, -2.4, 38);
  barrel(b, -2.6, 28.5);
  footprints(b, rand);
  court(b, rand);
  return b.build();
};
