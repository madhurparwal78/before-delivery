import { add, cross, normalise, scale, sub, type Vec3 } from './glmath.js';
import { gl3, palette, type Rgb } from '../palette.js';

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  colours: Float32Array;
  count: number;
}

export class MeshBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly colours: number[] = [];

  triangle(a: Vec3, b: Vec3, c: Vec3, colour: Rgb, normal?: Vec3): void {
    const face = normal ?? normalise(cross(sub(b, a), sub(c, a)));
    const [red, green, blue] = gl3(colour);
    for (const point of [a, b, c]) {
      this.positions.push(point[0], point[1], point[2]);
      this.normals.push(face[0], face[1], face[2]);
      this.colours.push(red, green, blue);
    }
  }

  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, colour: Rgb, normal?: Vec3): void {
    this.triangle(a, b, c, colour, normal);
    this.triangle(a, c, d, colour, normal);
  }

  /** A box in a local frame, given its half extents. */
  box(
    origin: Vec3,
    axes: { right: Vec3; up: Vec3; forward: Vec3 },
    half: Vec3,
    colour: Rgb,
  ): void {
    const { right, up, forward } = axes;
    const corner = (sx: number, sy: number, sz: number): Vec3 =>
      add(
        origin,
        add(
          scale(right, sx * half[0]),
          add(scale(up, sy * half[1]), scale(forward, sz * half[2])),
        ),
      );
    this.quad(corner(-1, -1, 1), corner(1, -1, 1), corner(1, 1, 1), corner(-1, 1, 1), colour, forward);
    this.quad(
      corner(1, -1, -1),
      corner(-1, -1, -1),
      corner(-1, 1, -1),
      corner(1, 1, -1),
      colour,
      scale(forward, -1),
    );
    this.quad(corner(1, -1, 1), corner(1, -1, -1), corner(1, 1, -1), corner(1, 1, 1), colour, right);
    this.quad(
      corner(-1, -1, -1),
      corner(-1, -1, 1),
      corner(-1, 1, 1),
      corner(-1, 1, -1),
      colour,
      scale(right, -1),
    );
    this.quad(corner(-1, 1, 1), corner(1, 1, 1), corner(1, 1, -1), corner(-1, 1, -1), colour, up);
    this.quad(
      corner(-1, -1, -1),
      corner(1, -1, -1),
      corner(1, -1, 1),
      corner(-1, -1, 1),
      colour,
      scale(up, -1),
    );
  }

  data(): MeshData {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      colours: new Float32Array(this.colours),
      count: this.positions.length / 3,
    };
  }

  /**
   * The same shape pushed out along its normals. Drawn with front faces culled, only the far
   * side shows, which reads as an ink outline around the silhouette.
   */
  outline(amount: number, colour: Rgb): MeshData {
    const positions = new Float32Array(this.positions.length);
    const normals = new Float32Array(this.normals.length);
    const colours = new Float32Array(this.colours.length);
    const [red, green, blue] = gl3(colour);
    const vertices = this.positions.length / 3;
    for (let index = 0; index < vertices; index += 1) {
      const at = index * 3;
      for (let axis = 0; axis < 3; axis += 1) {
        positions[at + axis] = this.positions[at + axis]! + this.normals[at + axis]! * amount;
        normals[at + axis] = this.normals[at + axis]!;
      }
      colours[at] = red;
      colours[at + 1] = green;
      colours[at + 2] = blue;
    }
    return { positions, normals, colours, count: vertices };
  }
}

function hash(x: number, y: number, z: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return value - Math.floor(value);
}

function noise(point: Vec3, frequency: number): number {
  const p: Vec3 = [point[0] * frequency, point[1] * frequency, point[2] * frequency];
  const base: Vec3 = [Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2])];
  const fraction: Vec3 = [p[0] - base[0], p[1] - base[1], p[2] - base[2]];
  const smooth = fraction.map((value) => value * value * (3 - 2 * value)) as Vec3;
  let total = 0;
  for (let corner = 0; corner < 8; corner += 1) {
    const dx = corner & 1;
    const dy = (corner >> 1) & 1;
    const dz = (corner >> 2) & 1;
    const weight =
      (dx ? smooth[0] : 1 - smooth[0]) *
      (dy ? smooth[1] : 1 - smooth[1]) *
      (dz ? smooth[2] : 1 - smooth[2]);
    total += weight * hash(base[0] + dx, base[1] + dy, base[2] + dz);
  }
  return total;
}

function mixRgb(from: Rgb, to: Rgb, amount: number): Rgb {
  return [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
    from[2] + (to[2] - from[2]) * amount,
  ];
}

/** Bramble itself: sunlit greens and ochres laid down from noise. */
export function planetMesh(radius: number): { surface: MeshData; rim: MeshData } {
  const builder = new MeshBuilder();
  const lonSteps = 96;
  const latSteps = 48;
  const point = (latIndex: number, lonIndex: number): Vec3 => {
    const phi = (latIndex / latSteps) * Math.PI - Math.PI / 2;
    const lambda = (lonIndex / lonSteps) * Math.PI * 2;
    const cosPhi = Math.cos(phi);
    return [cosPhi * Math.sin(lambda), Math.sin(phi), cosPhi * Math.cos(lambda)];
  };
  const shade = (unit: Vec3): Rgb => {
    const land = noise(unit, 2.6);
    const patch = noise([unit[0] + 7, unit[1] - 3, unit[2] + 1], 6.5);
    const green = mixRgb(palette.grassDark, palette.grassLight, patch);
    const ochre = mixRgb(palette.ochre, palette.ochreLight, patch);
    return mixRgb(green, ochre, Math.max(0, Math.min(1, (land - 0.52) * 4)));
  };
  for (let latIndex = 0; latIndex < latSteps; latIndex += 1) {
    for (let lonIndex = 0; lonIndex < lonSteps; lonIndex += 1) {
      const a = point(latIndex, lonIndex);
      const b = point(latIndex, lonIndex + 1);
      const c = point(latIndex + 1, lonIndex + 1);
      const d = point(latIndex + 1, lonIndex);
      const colour = shade(a);
      builder.triangle(scale(a, radius), scale(b, radius), scale(c, radius), colour, a);
      builder.triangle(scale(a, radius), scale(c, radius), scale(d, radius), colour, a);
    }
  }
  const rim = new MeshBuilder();
  const grown = radius * 1.004;
  for (let latIndex = 0; latIndex < latSteps; latIndex += 1) {
    for (let lonIndex = 0; lonIndex < lonSteps; lonIndex += 1) {
      const a = point(latIndex, lonIndex);
      const b = point(latIndex, lonIndex + 1);
      const c = point(latIndex + 1, lonIndex + 1);
      const d = point(latIndex + 1, lonIndex);
      rim.triangle(scale(a, grown), scale(b, grown), scale(c, grown), palette.ink, a);
      rim.triangle(scale(a, grown), scale(c, grown), scale(d, grown), palette.ink, a);
    }
  }
  return { surface: builder.data(), rim: rim.data() };
}

export interface SurfaceFrame {
  origin: Vec3;
  up: Vec3;
  north: Vec3;
  east: Vec3;
}

export function surfaceFrame(unit: Vec3, radius: number, height = 0): SurfaceFrame {
  const up = normalise(unit);
  const polar: Vec3 = [0, 1, 0];
  const east = normalise(cross(polar, up));
  const safeEast = Number.isFinite(east[0]) && Math.hypot(...east) > 0.001 ? east : ([1, 0, 0] as Vec3);
  const north = normalise(cross(up, safeEast));
  return { origin: scale(up, radius + height), up, north, east: safeEast };
}

export const HOME_HEIGHT_M = 1.6;
export const COURIER_HEIGHT_M = 1.1;

/** A resident's home: a printed hut with a small pink stamp plate beside the route's end. */
export function homeMesh(frame: SurfaceFrame, builder: MeshBuilder): void {
  const axes = { right: frame.east, up: frame.up, forward: frame.north };
  const base = add(frame.origin, scale(frame.up, 0.5));
  builder.box(base, axes, [0.7, 0.5, 0.7], palette.ochreLight);
  const eaves = add(frame.origin, scale(frame.up, 1.05));
  builder.box(eaves, axes, [0.82, 0.08, 0.82], palette.ink);
  const ridgeTop = add(frame.origin, scale(frame.up, HOME_HEIGHT_M));
  const corners: Vec3[] = [
    add(add(eaves, scale(frame.east, -0.8)), scale(frame.north, -0.8)),
    add(add(eaves, scale(frame.east, 0.8)), scale(frame.north, -0.8)),
    add(add(eaves, scale(frame.east, 0.8)), scale(frame.north, 0.8)),
    add(add(eaves, scale(frame.east, -0.8)), scale(frame.north, 0.8)),
  ];
  for (let index = 0; index < 4; index += 1) {
    builder.triangle(corners[index]!, corners[(index + 1) % 4]!, ridgeTop, palette.grassDark);
  }
  const plateCentre = add(
    add(frame.origin, scale(frame.up, 0.45)),
    scale(frame.north, -0.72),
  );
  builder.box(plateCentre, axes, [0.22, 0.3, 0.04], palette.pink);
}

/** Bramble Depot: an open-air stand, nothing on it taller than a courier. */
export function depotMesh(stand: SurfaceFrame, builder: MeshBuilder): void {
  const frame = stand;
  const axes = { right: frame.east, up: frame.up, forward: frame.north };
  builder.box(add(frame.origin, scale(frame.up, 0.38)), axes, [0.9, 0.06, 0.6], palette.ochre);
  for (const side of [-0.8, 0.8]) {
    builder.box(
      add(add(frame.origin, scale(frame.up, 0.19)), scale(frame.east, side)),
      axes,
      [0.06, 0.19, 0.06],
      palette.ink,
    );
  }
  builder.box(add(frame.origin, scale(frame.up, 0.75)), axes, [0.55, 0.3, 0.06], palette.paper);
  builder.box(
    add(add(frame.origin, scale(frame.up, 0.75)), scale(frame.north, -0.07)),
    axes,
    [0.16, 0.16, 0.02],
    palette.pink,
  );
}

/** A small courier figure, built in local space: x right, y up, z forward. */
export function courierMesh(satchel: Rgb): MeshData {
  const builder = new MeshBuilder();
  const axes = {
    right: [1, 0, 0] as Vec3,
    up: [0, 1, 0] as Vec3,
    forward: [0, 0, 1] as Vec3,
  };
  for (const side of [-0.09, 0.09]) {
    builder.box([side, 0.14, 0], axes, [0.055, 0.14, 0.06], palette.ink);
  }
  builder.box([0, 0.52, 0], axes, [0.16, 0.24, 0.11], palette.pink);
  builder.box([0, 0.86, 0.005], axes, [0.13, 0.12, 0.12], palette.ochreLight);
  builder.box([0.2, 0.5, -0.02], axes, [0.07, 0.12, 0.13], satchel);
  builder.box([-0.17, 0.48, 0.02], axes, [0.04, 0.17, 0.045], palette.ochreLight);
  builder.box([0.17, 0.48, 0.02], axes, [0.04, 0.17, 0.045], palette.ochreLight);
  return builder.data();
}

export function courierOutline(satchel: Rgb): MeshData {
  const builder = new MeshBuilder();
  const axes = {
    right: [1, 0, 0] as Vec3,
    up: [0, 1, 0] as Vec3,
    forward: [0, 0, 1] as Vec3,
  };
  for (const side of [-0.09, 0.09]) {
    builder.box([side, 0.14, 0], axes, [0.055, 0.14, 0.06], satchel);
  }
  builder.box([0, 0.52, 0], axes, [0.16, 0.24, 0.11], satchel);
  builder.box([0, 0.86, 0.005], axes, [0.13, 0.12, 0.12], satchel);
  return builder.outline(0.028, palette.ink);
}

/** The carried parcel: brown paper tied with ink string, or pink tape for a rush parcel. */
export function parcelMesh(rush: boolean): MeshData {
  const builder = new MeshBuilder();
  const axes = {
    right: [1, 0, 0] as Vec3,
    up: [0, 1, 0] as Vec3,
    forward: [0, 0, 1] as Vec3,
  };
  builder.box([0, 0.5, 0.18], axes, [0.14, 0.11, 0.1], palette.parcelPaper);
  const tape = rush ? palette.pink : palette.ink;
  builder.box([0, 0.5, 0.185], axes, [0.03, 0.115, 0.105], tape);
  builder.box([0, 0.5, 0.185], axes, [0.145, 0.025, 0.105], tape);
  return builder.data();
}
