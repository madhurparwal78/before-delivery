import {
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  LatheGeometry,
  Shape,
  SphereGeometry,
  Vector2,
  Color,
} from "three";
import { GeoBuilder } from "./builder.js";
import { FLAME, GLOW } from "./flames.js";
import type { Chapter } from "../../../shared/domain.js";
import type { Vec3 } from "./types.js";

export type VisionChapter = Exclude<Chapter, "alley" | "shelf">;

/** A flame or halo in a vision's own coordinates (+z toward the reader, y up, origin on the ground). */
interface FlameSpec {
  at: Vec3;
  size: number;
  alpha: number;
  kind: number;
}

export interface VisionModel {
  /** Ordinary lit surfaces. */
  matte: BufferGeometry | null;
  /** Surfaces that shine a little on their own. */
  radiant: BufferGeometry | null;
  /** Self-lit shapes, added to the picture. */
  glow: BufferGeometry | null;
  glowCastsShadow: boolean;
  flames: FlameSpec[];
  /** How far in front of the camera it stands, how much it is scaled, how far it is lifted. */
  distance: number;
  scale: number;
  lift: number;
  /** How far to the reader's right of the type column it stands when the view is wide enough to clear it. */
  aside?: number;
  /** Where it starts when risen amount is 0, relative to its place. */
  from: Vec3;
}

const IRON = "#3a4052";
const IRON_DARK = "#232836";
const BRASS = "#d9a73f";
const WOOD = "#4a3830";

/** A door of `height` with a round top of half-width `half`, standing on y 0 and facing +z. */
const arch = (half: number, height: number, depth: number): BufferGeometry => {
  const shape = new Shape();
  shape.moveTo(-half, 0);
  shape.lineTo(-half, height - half);
  shape.absarc(0, height - half, half, Math.PI, 0, true);
  shape.lineTo(half, 0);
  shape.closePath();
  return new ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 24 });
};

const stoveModel = (): VisionModel => {
  const matte = new GeoBuilder();
  const glow = new GeoBuilder();
  matte.cylinder(0.74, 0.78, 0.1, IRON_DARK, { y: 0.45 }, 20);
  for (let i = 0; i < 4; i += 1) {
    const angle = Math.PI / 4 + (i * Math.PI) / 2;
    const x = Math.cos(angle) * 0.56;
    const z = Math.sin(angle) * 0.56;
    matte.ball(0.1, BRASS, { x, y: 0.1, z }, 1, 14);
    matte.cylinder(0.05, 0.075, 0.3, BRASS, { x, y: 0.28, z }, 10);
  }
  matte.cylinder(0.64, 0.68, 1.1, IRON, { y: 1.05 }, 24);
  matte.cylinder(0.69, 0.69, 0.06, BRASS, { y: 0.66 }, 24);
  matte.cylinder(0.69, 0.69, 0.06, BRASS, { y: 1.5 }, 24);
  matte.cylinder(0.74, 0.74, 0.08, IRON_DARK, { y: 1.64 }, 24);
  matte.cylinder(0.12, 0.2, 0.14, BRASS, { y: 1.75 }, 14);
  matte.ball(0.15, BRASS, { y: 1.93 }, 1, 16);
  matte.add(new ConeGeometry(0.06, 0.2, 10), BRASS, { y: 2.12 });
  matte.add(arch(0.33, 0.8, 0.05), BRASS, { y: 0.7, z: 0.645 });
  matte.add(arch(0.26, 0.66, 0.06), IRON_DARK, { y: 0.74, z: 0.665 });
  matte.ball(0.04, BRASS, { x: 0.2, y: 1.05, z: 0.74 }, 1, 10);
  matte.box(0.4, 0.04, 0.05, IRON_DARK, { y: 0.78, z: 0.7 });
  matte.box(0.4, 0.04, 0.05, IRON_DARK, { y: 0.72, z: 0.7 });
  matte.add(new CylinderGeometry(0.1, 0.1, 2.1, 16), IRON, { x: -1.5, y: 1.3, z: -0.18, rz: Math.PI / 2 });
  matte.ball(0.13, IRON, { x: -2.55, y: 1.3, z: -0.18 }, 1, 16);
  matte.cylinder(0.1, 0.1, 3.4, IRON, { x: -2.55, y: 3, z: -0.18 }, 16);
  matte.ball(0.21, "#8a6a2c", { x: 0.28, y: 1.88, z: 0.02, sy: 0.85 }, 1, 14);
  matte.cylinder(0.025, 0.06, 0.2, "#8a6a2c", { x: 0.45, y: 1.97, z: 0.02, rz: -0.9 }, 8);
  matte.cylinder(0.08, 0.08, 0.03, "#8a6a2c", { x: 0.28, y: 2.07, z: 0.02 }, 10);
  for (let i = 0; i < 3; i += 1) {
    matte.cylinder(0.09, 0.09, 0.6, "#3d2a22", { x: -1.15, y: 0.1 + (i === 2 ? 0.16 : 0), z: 0.55 + (i === 1 ? 0.18 : 0) - (i === 2 ? 0.1 : 0), rz: Math.PI / 2, ry: 0.2 * i }, 8);
  }
  glow.add(arch(0.19, 0.46, 0.02), "#ff9a30", { y: 0.8, z: 0.715 });
  return {
    matte: matte.build(),
    radiant: null,
    glow: glow.build(),
    glowCastsShadow: false,
    flames: [
      { at: { x: 0, y: 1.0, z: 0.78 }, size: 0.5, alpha: 1, kind: FLAME },
      { at: { x: 0, y: 1.05, z: 0.9 }, size: 2.4, alpha: 0.35, kind: GLOW },
    ],
    distance: 5.6,
    scale: 0.8,
    lift: 0,
    from: { x: 0, y: -3.2, z: 0 },
  };
};

const gooseModel = (): VisionModel => {
  const matte = new GeoBuilder();
  const cloth = "#e8eef8";
  matte.box(2.5, 0.09, 1.4, WOOD, { y: 0.9 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) matte.box(0.11, 0.9, 0.11, WOOD, { x: sx * 1.08, y: 0.45, z: sz * 0.55 });
  matte.box(2.62, 0.04, 1.52, cloth, { y: 0.96 });
  const hem = new Shape();
  hem.moveTo(-1.31, 0.97);
  hem.lineTo(-1.31, 0.3);
  const scallops = 9;
  for (let i = 0; i < scallops; i += 1) {
    const x = -1.31 + (2.62 * i) / scallops;
    const step = 2.62 / scallops;
    hem.quadraticCurveTo(x + step / 2, 0.2, x + step, 0.3);
  }
  hem.lineTo(1.31, 0.97);
  hem.closePath();
  matte.add(new ExtrudeGeometry(hem, { depth: 0.03, bevelEnabled: false, curveSegments: 8 }), cloth, { z: 0.75 }, 0.96);
  matte.box(0.03, 0.62, 1.52, cloth, { x: -1.31, y: 0.65 }, 0.9);
  matte.box(0.03, 0.62, 1.52, cloth, { x: 1.31, y: 0.65 }, 0.9);
  matte.cylinder(0.78, 0.7, 0.05, "#dbe5f2", { y: 1.0, sx: 1.5 }, 28);
  matte.cylinder(0.66, 0.6, 0.03, "#f2f6fb", { y: 1.035, sx: 1.5 }, 28);
  const turn = 0.5;
  const big = 1.15;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const spot = (x: number, y: number, z: number): { x: number; y: number; z: number; ry: number } => ({
    x: (x * cos + z * sin) * big,
    y: 1.0 + (y - 1.0) * big,
    z: (-x * sin + z * cos) * big,
    ry: turn,
  });
  matte.add(new SphereGeometry(0.5 * big, 24, 14), "#7f4620", { ...spot(0, 1.36, 0), sx: 1.2, sy: 0.62, sz: 0.74 });
  matte.add(new SphereGeometry(0.4 * big, 18, 10), "#a8602a", { ...spot(-0.05, 1.5, 0.04), sx: 1.1, sy: 0.4, sz: 0.62 });
  for (const side of [-1, 1]) {
    matte.add(new SphereGeometry(0.3 * big, 14, 8), "#6d3b1a", { ...spot(-0.05, 1.3, side * 0.3), sx: 1.35, sy: 0.55, sz: 0.4 });
    matte.add(new CylinderGeometry(0.075 * big, 0.05 * big, 0.42 * big, 10), "#8e5222", { ...spot(0.5, 1.32, side * 0.26), rz: -0.7 });
    matte.add(new SphereGeometry(0.075 * big, 10, 8), "#9a5a26", { ...spot(0.68, 1.5, side * 0.26) });
    matte.add(new ConeGeometry(0.06 * big, 0.15 * big, 8), "#f3f5fa", { ...spot(0.74, 1.58, side * 0.26), rz: -0.7 });
  }
  matte.add(new ConeGeometry(0.1 * big, 0.24 * big, 10), "#8e5222", { ...spot(1.0, 1.36, 0), rz: -1.45 });
  const fruit: [number, number, number, string, number][] = [
    [-0.66, 1.1, 0.42, "#a8262e", 0.1], [-0.88, 1.09, 0.14, "#a8262e", 0.095], [0.66, 1.1, 0.44, "#a8262e", 0.1],
    [0.9, 1.09, 0.16, "#a8262e", 0.09], [0, 1.09, 0.6, "#a8262e", 0.1], [-0.36, 1.08, 0.56, "#3d2549", 0.07],
    [0.38, 1.08, 0.58, "#3d2549", 0.07], [0.18, 1.08, 0.66, "#3d2549", 0.065], [-0.18, 1.08, 0.64, "#a8262e", 0.08],
    [1.1, 1.14, 0.12, "#a8262e", 0.1], [1.22, 1.12, -0.14, "#3d2549", 0.07], [0.96, 1.12, -0.18, "#a8262e", 0.09],
  ];
  for (const [x, y, z, color, r] of fruit) matte.ball(r, color, { x, y, z }, 1, 10);
  for (const [x, z] of [[-1, 0.2], [1, 0.2]] as const) {
    matte.cylinder(0.27, 0.22, 0.03, "#eef3fa", { x: x * 0.98, y: 1.01, z: z + 0.2 }, 20);
    matte.cylinder(0.17, 0.17, 0.035, "#c6d2e4", { x: x * 0.98, y: 1.012, z: z + 0.2 }, 20);
    matte.box(0.04, 0.01, 0.32, "#c4cfe0", { x: x * 0.98 - 0.35 * x, y: 1.0, z: z + 0.25 });
    matte.box(0.05, 0.01, 0.3, "#c4cfe0", { x: x * 0.98 + 0.34 * x, y: 1.0, z: z + 0.25 });
  }
  for (const x of [-0.5, 0.5]) {
    matte.cylinder(0.03, 0.03, 0.14, "#aabbd8", { x, y: 1.1, z: -0.4 }, 10);
    matte.cylinder(0.075, 0.03, 0.12, "#b9c8e2", { x, y: 1.23, z: -0.4 }, 12);
  }
  const candles: Vec3[] = [{ x: -1.05, y: 0, z: -0.45 }, { x: 1.05, y: 0, z: -0.45 }];
  const flames: FlameSpec[] = [];
  for (const c of candles) {
    matte.cylinder(0.04, 0.07, 0.4, BRASS, { x: c.x, y: 1.18, z: c.z }, 10);
    matte.cylinder(0.12, 0.12, 0.03, BRASS, { x: c.x, y: 1.0, z: c.z }, 12);
    matte.cylinder(0.03, 0.03, 0.34, "#efe6cf", { x: c.x, y: 1.55, z: c.z }, 10);
    flames.push({ at: { x: c.x, y: 1.85, z: c.z }, size: 0.24, alpha: 1, kind: FLAME });
  }
  flames.push({ at: { x: 0, y: 1.8, z: 0.1 }, size: 0.7, alpha: 0.18, kind: GLOW });
  flames.push({ at: { x: -0.2, y: 1.95, z: 0.1 }, size: 0.5, alpha: 0.12, kind: GLOW });
  flames.push({ at: { x: 0.25, y: 2.1, z: 0.1 }, size: 0.55, alpha: 0.1, kind: GLOW });
  return {
    matte: matte.build(),
    radiant: null,
    glow: null,
    glowCastsShadow: false,
    flames,
    distance: 5.2,
    scale: 0.82,
    lift: 0,
    from: { x: 0, y: -2.2, z: 0 },
  };
};

const treeModel = (): VisionModel => {
  const matte = new GeoBuilder();
  const glow = new GeoBuilder();
  const flames: FlameSpec[] = [];
  matte.cylinder(0.1, 0.13, 0.7, "#4a3328", { y: 0.35 }, 10);
  const tiers: [number, number, number][] = [[1.2, 1.1, 0.45], [0.96, 1.0, 1.15], [0.74, 0.9, 1.85], [0.54, 0.8, 2.5], [0.34, 0.65, 3.1]];
  const counts = [8, 7, 6, 5, 3];
  tiers.forEach(([radius, height, base], i) => {
    matte.add(new ConeGeometry(radius, height, 16), "#1d5143", { y: base + height / 2 }, 0.8 + (i % 2) * 0.28);
    matte.cylinder(radius * 0.99, radius, 0.06, "#d4e2f0", { y: base + 0.03 }, 16, 0.9);
    const n = counts[i] ?? 3;
    for (let k = 0; k < n; k += 1) {
      const angle = (k / n) * Math.PI * 2 + i * 0.7;
      const x = Math.cos(angle) * radius * 0.86;
      const z = Math.sin(angle) * radius * 0.86;
      matte.cylinder(0.024, 0.024, 0.17, "#efe6cf", { x, y: base + 0.14, z }, 8);
      flames.push({ at: { x, y: base + 0.34, z }, size: 0.17, alpha: 1, kind: FLAME });
    }
  });
  const baubles: [number, number, number, string][] = [
    [0.55, 0.95, 0.85, "#b3262e"], [-0.6, 0.85, 0.8, "#c9a23c"], [0.1, 1.55, 0.75, "#3a5fa8"], [-0.45, 1.65, 0.5, "#b3262e"],
    [0.5, 1.7, 0.4, "#d8dde8"], [-0.1, 2.2, 0.45, "#c9a23c"], [0.3, 2.35, 0.3, "#b3262e"], [-0.25, 2.8, 0.25, "#3a5fa8"],
  ];
  for (const [x, y, z, color] of baubles) matte.ball(0.075, color, { x, y, z }, 1, 10);
  matte.box(0.5, 0.36, 0.5, "#7a2a34", { x: -0.85, y: 0.18, z: 1.0, ry: 0.4 });
  matte.box(0.52, 0.06, 0.1, "#d9b24a", { x: -0.85, y: 0.37, z: 1.0, ry: 0.4 });
  matte.box(0.4, 0.3, 0.4, "#2b4a7a", { x: 0.9, y: 0.15, z: 1.05, ry: -0.3 });
  matte.box(0.42, 0.06, 0.08, "#d9b24a", { x: 0.9, y: 0.31, z: 1.05, ry: -0.3 });
  const star = new Shape();
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? 0.24 : 0.1;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  glow.add(new ExtrudeGeometry(star, { depth: 0.06, bevelEnabled: false }), "#ffe27a", { y: 3.8, z: -0.03 });
  flames.push({ at: { x: 0, y: 3.8, z: 0.1 }, size: 1.1, alpha: 0.7, kind: GLOW });
  return {
    matte: matte.build(),
    radiant: null,
    glow: glow.build(),
    glowCastsShadow: false,
    flames,
    distance: 6.4,
    scale: 0.82,
    lift: 0,
    from: { x: 0, y: -4.2, z: 0 },
  };
};

const streak = (): BufferGeometry => {
  const steps = 14;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const head = new Color("#fff0b0");
  const length = 4.2;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const width = 0.065 * (1 - t) * (1 - 0.35 * t);
    const x = -t * length * 0.82;
    const y = t * length * 0.58;
    const fade = 0.85 * Math.pow(1 - t, 1.6);
    for (const side of [-1, 1]) {
      positions.push(x + side * width * 0.58, y + side * width * 0.82, 0);
      colors.push(head.r * fade, head.g * fade, head.b * fade);
    }
    if (i < steps) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("color", new BufferAttribute(new Float32Array(colors), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
};

const starModel = (): VisionModel => {
  const glow = new GeoBuilder();
  const star = new Shape();
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? 0.34 : 0.12;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  glow.add(new ExtrudeGeometry(star, { depth: 0.14, bevelEnabled: false }), "#e9d9a4", { x: 0.1, y: 3.0, z: -0.07, rz: -0.35 });
  glow.add(streak(), "#ffffff", { x: 0.1, y: 3.0, z: 0.0 });
  const flames: FlameSpec[] = [
    { at: { x: 0.1, y: 3.0, z: 0.12 }, size: 1.8, alpha: 0.4, kind: GLOW },
    { at: { x: 0.1, y: 3.0, z: 0.12 }, size: 0.8, alpha: 0.8, kind: GLOW },
  ];
  for (let i = 0; i < 8; i += 1) {
    const t = 0.12 + i * 0.1;
    flames.push({ at: { x: 0.1 - t * 3.4, y: 3.0 + t * 2.4 + (i % 2 ? 0.1 : -0.12), z: 0.1 }, size: 0.22 - i * 0.015, alpha: 0.8, kind: GLOW });
  }
  return {
    matte: null,
    radiant: null,
    glow: glow.build(),
    glowCastsShadow: true,
    flames,
    distance: 3.5,
    scale: 0.5,
    lift: 1.82,
    aside: 1.02,
    from: { x: -3.4, y: 4.6, z: 0 },
  };
};

/** A turned figure whose skirt falls in folds that deepen toward the hem. */
const drapedSkirt = (profile: Vector2[]): BufferGeometry => {
  const skirt = new LatheGeometry(profile, 72);
  const position = skirt.getAttribute("position") as BufferAttribute;
  const waist = 1.9;
  for (let i = 0; i < position.count; i += 1) {
    const y = position.getY(i);
    if (y >= waist) continue;
    const fold = 1 + 0.07 * (1 - y / waist) * Math.sin(Math.atan2(position.getX(i), position.getZ(i)) * 9);
    position.setX(i, position.getX(i) * fold);
    position.setZ(i, position.getZ(i) * fold);
  }
  skirt.computeVertexNormals();
  return skirt;
};

const grandmotherModel = (): VisionModel => {
  const radiant = new GeoBuilder();
  const matte = new GeoBuilder();
  const profile = [
    [0.001, 0], [1.0, 0], [0.98, 0.14], [0.86, 0.7], [0.62, 1.3], [0.4, 1.75], [0.33, 2.0], [0.44, 2.3], [0.36, 2.52], [0.12, 2.6],
  ].map(([x, y]) => new Vector2(x, y));
  radiant.add(drapedSkirt(profile), "#e3dcef", {}, 1);
  radiant.add(new SphereGeometry(0.5, 16, 10), "#a8b6dc", { y: 2.35, sx: 0.95, sy: 0.38, sz: 0.75 });
  radiant.add(new ConeGeometry(0.52, 0.62, 3), "#a8b6dc", { y: 2.1, z: 0.05, ry: Math.PI / 2, sx: 1.3 }, 0.95);
  const skin = "#efdcc9";
  radiant.ball(0.23, skin, { y: 2.84 }, 1, 18);
  radiant.ball(0.26, "#eef1f8", { y: 2.92, z: -0.05, sy: 0.9 }, 1, 18);
  radiant.ball(0.13, "#eef1f8", { y: 3.1, z: -0.2 }, 1, 12);
  matte.ball(0.022, "#2a2430", { x: -0.085, y: 2.85, z: 0.21 }, 1, 8);
  matte.ball(0.022, "#2a2430", { x: 0.085, y: 2.85, z: 0.21 }, 1, 8);
  matte.ball(0.035, "#e8a89a", { x: -0.14, y: 2.78, z: 0.17 }, 1, 8);
  matte.ball(0.035, "#e8a89a", { x: 0.14, y: 2.78, z: 0.17 }, 1, 8);
  matte.ball(0.03, skin, { y: 2.8, z: 0.225 }, 0.95, 8);
  matte.box(0.1, 0.012, 0.01, "#a85a58", { y: 2.72, z: 0.22 });
  for (const side of [-1, 1]) {
    radiant.add(new CylinderGeometry(0.13, 0.08, 0.95, 12), "#cfc8e0", { x: side * 0.36, y: 2.0, z: 0.3, rx: -0.95, rz: side * -0.55 });
    radiant.ball(0.08, skin, { x: side * 0.09, y: 1.76, z: 0.7 }, 1, 12);
  }
  const flames: FlameSpec[] = [];
  for (let i = 0; i < 12; i += 1) {
    const spread = ((i - 5.5) / 5.5) * 0.5;
    const tilt = (i % 3) * 0.04;
    const baseX = 0;
    const baseY = 1.72;
    const baseZ = 0.72;
    const length = 0.5 + tilt;
    const tipX = baseX + Math.sin(spread) * length;
    const tipY = baseY + Math.cos(spread) * length * 0.95;
    const tipZ = baseZ + ((i % 2) - 0.5) * 0.06;
    matte.add(new CylinderGeometry(0.011, 0.011, length, 6), "#e4d9bb", { x: (baseX + tipX) / 2, y: (baseY + tipY) / 2, z: (baseZ + tipZ) / 2, rz: -spread });
    matte.ball(0.021, "#6a2c20", { x: tipX, y: tipY, z: tipZ }, 1, 8);
    flames.push({ at: { x: tipX, y: tipY + 0.1, z: tipZ }, size: 0.24, alpha: 1, kind: FLAME });
  }
  matte.cylinder(0.04, 0.04, 0.06, "#8a2a32", { x: 0, y: 1.78, z: 0.72 }, 8);
  flames.push({ at: { x: 0, y: 2.55, z: -0.35 }, size: 6.2, alpha: 0.5, kind: GLOW });
  flames.push({ at: { x: 0, y: 2.85, z: 0.1 }, size: 1.5, alpha: 0.35, kind: GLOW });
  return {
    matte: matte.build(),
    radiant: radiant.build(),
    glow: null,
    glowCastsShadow: false,
    flames,
    distance: 7.2,
    scale: 1.36,
    lift: 0.1,
    aside: -2.3,
    from: { x: 0, y: -4.2, z: 0 },
  };
};

export const buildVision = (chapter: VisionChapter): VisionModel => {
  switch (chapter) {
    case "stove":
      return stoveModel();
    case "goose":
      return gooseModel();
    case "tree":
      return treeModel();
    case "star":
      return starModel();
    case "grandmother":
      return grandmotherModel();
  }
};
