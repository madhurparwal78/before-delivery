import type { Colours } from "../../shared/types";
import { writeGlb, type Material, type SceneNode } from "./glb";
import { addTo, annulus, box, cylinder, emptyMesh, extrude, grid, lathe, random, regularPolygon, sheet, sphere, torus, type Mesh, type Vec3 } from "./mesh";

/** Eight islands, each its own form in its own colours: land and shallows from shared code, the structure from its own builder. */

type Rgb = Vec3;

const channel = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16) / 255;
const srgb = (hex: string): Rgb => [channel(hex, 1), channel(hex, 3), channel(hex, 5)];
const linear = (value: number) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
const toLinear = (color: Rgb): Rgb => [linear(color[0]), linear(color[1]), linear(color[2])];
const blend = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const luminance = (color: Rgb) => 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];

interface Palette {
  ground: Rgb;
  ink: Rgb;
  accent: Rgb;
  land: Rgb;
  shore: Rgb;
  rock: Rgb;
}

function paletteOf(colours: Colours): Palette {
  const ground = srgb(colours.ground);
  const ink = srgb(colours.ink);
  const accent = srgb(colours.accent);
  const light = luminance(ground) > 0.55;
  return {
    ground: toLinear(ground),
    ink: toLinear(ink),
    accent: toLinear(accent),
    land: toLinear(blend(ground, ink, light ? 0.2 : 0.32)),
    shore: toLinear(blend(ink, accent, 0.28)),
    rock: toLinear(blend(ground, [0.04, 0.05, 0.07], light ? 0.55 : 0.3)),
  };
}

const matte = (color: Rgb, alpha?: number): Material => ({ color, roughness: 0.82, metallic: 0.02, ...(alpha === undefined ? {} : { alpha }) });
const bright = (color: Rgb): Material => ({ color, roughness: 0.42, metallic: 0.25, emissive: color.map((v) => v * 0.28) as Rgb });
const part = (name: string, mesh: Mesh, material: Material, translation?: Vec3): SceneNode => ({ name, mesh, material, ...(translation ? { translation } : {}) });

const smooth = (t: number) => t * t * (3 - 2 * t);
const SHORE_HEIGHT = 0.5;

interface Landform {
  radius: number;
  hill?: { height: number; radius: number };
  seed: number;
}

function coast(angle: number, seed: number): number {
  return 1 + 0.09 * Math.sin(3 * angle + seed) + 0.06 * Math.sin(5 * angle + seed * 2.1) + 0.03 * Math.sin(9 * angle + seed * 3.3);
}

/** The land: a plateau that eases into a beach and then drops below the water, with a ragged coastline. */
function landMesh(palette: Palette, form: Landform): Mesh {
  const rows = 46;
  const columns = 112;
  const landRows = 34;
  const noise = random(form.seed);
  const jitter = Array.from({ length: columns }, () => noise());
  const radiusAt = (row: number): number => (row <= landRows ? row / landRows : 1 + ((row - landRows) / (rows - 1 - landRows)) * 0.08);
  const heightAt = (t: number, angle: number): number => {
    const wobble = 0.03 * Math.sin(angle * 7 + form.seed) * Math.sin(t * 9);
    if (t <= 1) {
      const slope = t < 0.62 ? 1 : 1 - smooth((t - 0.62) / 0.38);
      const hill = form.hill ? form.hill.height * Math.exp(-((t * form.radius) ** 2) / (2 * (form.hill.radius / 2) ** 2)) : 0;
      return SHORE_HEIGHT * slope + hill * slope + wobble * slope;
    }
    return -((t - 1) / 0.08) * 0.75;
  };
  return grid(rows, columns, (row, column) => {
    const angle = (column / columns) * Math.PI * 2;
    const t = radiusAt(row);
    const reach = form.radius * coast(angle, form.seed) * t;
    return [Math.cos(angle) * reach, heightAt(t, angle) + (row > 0 && row <= landRows ? (jitter[column] as number) * 0.012 : 0), Math.sin(angle) * reach];
  }, {
    wrap: true,
    color: (row, column) => {
      const t = radiusAt(row);
      if (t > 1) return blend(palette.shore, palette.rock, Math.min(1, (t - 1) / 0.04));
      const beach = smooth(Math.min(1, Math.max(0, (t - 0.66) / 0.3)));
      const grain = 0.94 + (jitter[column] as number) * 0.12;
      return blend(palette.land, palette.shore, beach).map((v) => v * grain) as Rgb;
    },
  });
}

function shallows(palette: Palette, radius: number): SceneNode[] {
  const water = lathe([[0, 0.012], [radius * 1.3, 0.012]], 72);
  const foam = annulus(radius * 1.04, radius * 1.1, 0.012, 96);
  return [
    part("shallows", water, matte(blend(palette.accent, [0, 0.01, 0.02], 0.55), 0.22)),
    part("foam", foam, matte(palette.ink, 0.42), [0, 0.03, 0]),
  ];
}

function landNodes(palette: Palette, form: Landform): SceneNode[] {
  return [part("land", landMesh(palette, form), { color: [1, 1, 1], roughness: 0.95, metallic: 0 }), ...shallows(palette, form.radius)];
}

/** An emblem is a pole carrying one pennant to a single side, so no turn of it ever looks like another. */
function emblem(palette: Palette, outline: [number, number][], height: number): SceneNode {
  const pole = cylinder(0.035, 0.035, 1.3, 10);
  const flag = extrude(outline.map(([x, up]) => [x, -up] as [number, number]), 0.035);
  const mesh = emptyMesh();
  addTo(mesh, pole);
  addTo(mesh, flag, { rx: Math.PI / 2, at: [0, 1.28, 0] });
  addTo(mesh, sphere(0.07, 12, 8), { at: [0, 1.3, 0] });
  return { name: "emblem", translation: [0, height, 0], children: [part("emblem-shape", mesh, bright(palette.accent))] };
}

const PENNANT: [number, number][] = [[0.03, 0], [0.95, -0.22], [0.03, -0.5]];
const SWALLOWTAIL: [number, number][] = [[0.03, 0], [1.0, 0], [0.72, -0.25], [1.0, -0.5], [0.03, -0.5]];
const BLADE: [number, number][] = [[0.03, 0], [0.5, -0.04], [1.1, -0.26], [0.5, -0.46], [0.03, -0.5]];
const LEAF: [number, number][] = [[0.03, -0.25], [0.3, -0.02], [0.8, -0.05], [1.1, -0.25], [0.8, -0.45], [0.3, -0.48]];
const NIB: [number, number][] = [[0.03, 0], [0.6, -0.12], [1.15, -0.5], [0.55, -0.4], [0.03, -0.5]];

function ledgerwick(p: Palette): SceneNode[] {
  const paper = emptyMesh();
  const board = emptyMesh();
  const rules = emptyMesh();
  const thickness = 0.28;
  let y = SHORE_HEIGHT;
  for (let i = 0; i < 8; i++) {
    const width = 3.2 - i * 0.28;
    const turn = (i % 2 === 0 ? 1 : -1) * (0.05 + i * 0.02);
    addTo(i % 2 === 0 ? paper : board, box(width, thickness, width * 0.72), { at: [0, y, 0], ry: turn });
    for (let line = 0; line < 6; line++) addTo(rules, box(width * 0.82, 0.01, 0.025), { at: [0, y + thickness, -width * 0.26 + line * width * 0.104], ry: turn });
    y += thickness;
  }
  return [
    part("slabs-paper", paper, matte(blend(p.ink, p.land, 0.1))),
    part("slabs-board", board, matte(blend(p.ground, p.ink, 0.45))),
    part("slab-rules", rules, bright(p.accent)),
    emblem(p, BLADE, 3.25),
  ];
}

function monsoon(p: Palette): SceneNode[] {
  const rise = SHORE_HEIGHT + 1.15;
  const wood = blend(p.accent, p.ground, 0.58);
  const body = emptyMesh();
  const slats = emptyMesh();
  addTo(body, box(1.25, 0.95, 1.25), { at: [0, rise, 0] });
  addTo(body, box(1.4, 0.14, 1.4), { at: [0, rise + 0.95, 0] });
  for (let i = 0; i < 5; i++) {
    const offset = -0.5 + i * 0.25;
    addTo(slats, box(0.1, 0.95, 1.31), { at: [offset, rise, 0] });
    addTo(slats, box(1.31, 0.95, 0.1), { at: [0, rise, offset] });
  }
  const rain = emptyMesh();
  const noise = random(11);
  for (let i = 0; i < 22; i++) {
    const angle = noise() * Math.PI * 2;
    const reach = 0.9 + noise() * 1.5;
    const length = 1.5 + noise() * 1.2;
    addTo(rain, cylinder(0.022, 0.022, length, 6), { at: [Math.cos(angle) * reach, rise + 0.2 + noise() * 0.4, Math.sin(angle) * reach] });
  }
  return [
    part("crate", body, matte(wood)),
    part("crate-slats", slats, matte(blend(wood, p.ink, 0.22))),
    part("rain", rain, matte(blend(p.ink, [0.35, 0.55, 0.75], 0.6), 0.55)),
    emblem(p, PENNANT, 3.3),
  ];
}

function basalt(p: Palette): SceneNode[] {
  const columns = emptyMesh();
  const noise = random(23);
  const spacing = 0.64;
  for (let q = -2; q <= 2; q++) {
    for (let r = -2; r <= 2; r++) {
      if (Math.abs(q + r) > 2) continue;
      const x = spacing * (q + r / 2) * 1.04;
      const z = spacing * r * 0.9;
      const middle = r === 0 && Math.abs(q) === 2;
      const height = middle ? 2.15 : 0.55 + noise() * 1.3 + (1 - Math.hypot(x, z) / 2.4) * 0.5;
      addTo(columns, extrude(regularPolygon(6, 0.34, Math.PI / 6), height), { at: [x, SHORE_HEIGHT, z] });
    }
  }
  const beam = emptyMesh();
  addTo(beam, box(4.3, 0.24, 0.5), { at: [0, SHORE_HEIGHT + 2.15, 0] });
  addTo(beam, box(0.3, 0.5, 0.56), { at: [-1.95, SHORE_HEIGHT + 1.95, 0] });
  return [part("columns", columns, matte(blend(p.ground, p.ink, 0.18))), part("beam", beam, bright(p.accent)), emblem(p, BLADE, 3.3)];
}

function featherOutline(length: number, width: number): [number, number][] {
  return Array.from({ length: 16 }, (_, i) => {
    const angle = (i / 16) * Math.PI * 2;
    const x = Math.cos(angle) * length;
    const z = Math.sin(angle) * width * (1 - 0.3 * Math.max(0, Math.cos(angle)));
    return [x + (x > 0 ? x * 0.15 : 0), z] as [number, number];
  });
}

function quillstack(p: Palette): SceneNode[] {
  const quills = emptyMesh();
  const bands = emptyMesh();
  let y = SHORE_HEIGHT;
  for (let i = 0; i < 7; i++) {
    const scale = 1 - i * 0.07;
    const turn = i * 0.5;
    addTo(i % 2 === 0 ? quills : bands, extrude(featherOutline(1.75 * scale, 0.62 * scale), 0.3), { at: [Math.sin(i) * 0.12, y, 0], ry: turn });
    addTo(bands, extrude(featherOutline(1.75 * scale * 0.96, 0.02), 0.34), { at: [Math.sin(i) * 0.12, y - 0.02, 0], ry: turn });
    y += 0.3;
  }
  const nib = emptyMesh();
  addTo(nib, cylinder(0.26, 0.0, 1.0, 4), { at: [0, y, 0], ry: 0.4 });
  return [part("quills", quills, matte(blend(p.ink, p.ground, 0.25))), part("quill-bands", bands, bright(p.accent)), part("nib", nib, bright(p.accent)), emblem(p, NIB, 4.1)];
}

function leafOutline(length: number, width: number): [number, number][] {
  const top: [number, number][] = [];
  const bottom: [number, number][] = [];
  for (let i = 0; i <= 12; i++) {
    const s = -1 + (i / 12) * 2;
    const w = width * (1 - s * s) ** 0.8 + 0.001;
    top.push([s * length, w]);
    bottom.unshift([s * length, -w]);
  }
  return [...top, ...bottom];
}

function neem(p: Palette): SceneNode[] {
  const terraces = emptyMesh();
  const ribs = emptyMesh();
  let y = SHORE_HEIGHT;
  const scales = [1, 0.8, 0.62, 0.45];
  for (const [i, scale] of scales.entries()) {
    addTo(terraces, extrude(leafOutline(2.2 * scale, 1.15 * scale), 0.34), { at: [i * 0.1, y, 0], ry: i * 0.16 });
    addTo(ribs, box(4.1 * scale, 0.014, 0.05), { at: [i * 0.1, y + 0.34, 0], ry: i * 0.16 });
    y += 0.34;
  }
  const nectar = emptyMesh();
  addTo(nectar, sphere(0.2, 20, 14), { at: [0.3, y, 0] });
  addTo(nectar, cylinder(0.2, 0.2, 0.04, 20), { at: [0.3, y - 0.02, 0] });
  return [part("terraces", terraces, matte(blend(p.land, p.accent, 0.12))), part("leaf-ribs", ribs, matte(p.ink)), part("nectar", nectar, bright(p.accent)), emblem(p, LEAF, 2.8)];
}

function reelhouse(p: Palette): SceneNode[] {
  const rig = emptyMesh();
  const holes = emptyMesh();
  const hub = emptyMesh();
  const centre = SHORE_HEIGHT + 0.5 + 1.38;
  const face = 0.51;
  addTo(rig, box(1.9, 0.5, 1.0), { at: [0, SHORE_HEIGHT, 0.34] });
  addTo(rig, cylinder(1.34, 1.34, 0.34, 72), { rx: Math.PI / 2, at: [0, centre, 0.17] });
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
    addTo(holes, cylinder(0.27, 0.27, 0.03, 32), { rx: Math.PI / 2, at: [Math.cos(angle) * 0.8, centre + Math.sin(angle) * 0.8, face] });
  }
  addTo(hub, cylinder(0.38, 0.38, 0.09, 36), { rx: Math.PI / 2, at: [0, centre, face] });
  addTo(hub, annulus(1.2, 1.32, 0.05, 72), { rx: Math.PI / 2, at: [0, centre, face] });
  const startY = centre - 0.95;
  const strip = sheet(24, 2, (u, v) => {
    const fall = 1 - (1 - u) ** 2;
    return [0.9 + u * 1.7, startY + (SHORE_HEIGHT + 0.03 - startY) * fall, 0.2 + v * 0.3];
  });
  return [
    part("reel", rig, matte(blend(p.ground, p.ink, 0.3))),
    part("reel-holes", holes, matte(blend(p.ground, [0, 0, 0], 0.5))),
    part("reel-hub", hub, bright(p.accent)),
    part("film", strip, matte(blend(p.ground, [0, 0, 0], 0.3))),
    emblem(p, SWALLOWTAIL, 4.2),
  ];
}

function tiffin(p: Palette): SceneNode[] {
  const steel = emptyMesh();
  const yellow = emptyMesh();
  const grey = emptyMesh();
  let y = SHORE_HEIGHT;
  const radii = [1.25, 1.15, 1.05, 0.95];
  for (const [i, radius] of radii.entries()) {
    addTo(i % 2 === 0 ? yellow : grey, cylinder(radius, radius, 0.5, 56), { at: [0, y, 0] });
    addTo(steel, cylinder(radius + 0.05, radius + 0.05, 0.06, 56), { at: [0, y + 0.5, 0] });
    y += 0.56;
  }
  addTo(steel, lathe([[0, y], [0.9, y], [0.8, y + 0.22], [0.4, y + 0.38], [0, y + 0.42]], 48));
  addTo(steel, torus(0.55, 0.05, 28, 10, Math.PI), { rz: Math.PI / 2, rx: 0, ry: 0, at: [0, y + 0.4, 0] });
  addTo(steel, box(0.08, y - SHORE_HEIGHT, 0.22), { at: [1.3, SHORE_HEIGHT, 0] });
  addTo(steel, box(0.08, y - SHORE_HEIGHT, 0.22), { at: [-1.3, SHORE_HEIGHT, 0] });
  return [
    part("tiers-yellow", yellow, matte(p.accent)),
    part("tiers-grey", grey, matte(blend(p.ground, p.ink, 0.5))),
    part("tier-steel", steel, { color: blend(p.ground, p.ink, 0.15), roughness: 0.3, metallic: 0.7 }),
    emblem(p, BLADE, 4.1),
  ];
}

function staticBloom(p: Palette): SceneNode[] {
  const petals = emptyMesh();
  const stamens = emptyMesh();
  const noise = random(77);
  const layers = [
    { count: 11, reach: 1.9, rise: 1.4, lift: 0.1, width: 0.5 },
    { count: 9, reach: 1.45, rise: 2.0, lift: 0.2, width: 0.42 },
    { count: 7, reach: 1.0, rise: 2.4, lift: 0.3, width: 0.34 },
  ];
  for (const [layer, spec] of layers.entries()) {
    for (let i = 0; i < spec.count; i++) {
      const turn = (i / spec.count) * Math.PI * 2 + layer * 0.31;
      const seed = noise();
      const petal = sheet(14, 5, (u, v) => {
        const across = (v - 0.5) * 2 * spec.width * Math.sin(Math.PI * Math.min(1, u * 0.95 + 0.05)) ** 0.7;
        const glitch = (Math.round(Math.sin(u * 17 + seed * 40) * 3) / 3) * 0.05;
        const along = 0.12 + u * spec.reach + Math.sin(u * Math.PI) * 0.15;
        return [across + glitch, spec.lift + u ** 1.35 * spec.rise + glitch, along];
      });
      addTo(petals, petal, { ry: turn, at: [0, SHORE_HEIGHT, 0] });
    }
  }
  addTo(stamens, sphere(0.3, 24, 16), { at: [0, SHORE_HEIGHT + 0.25, 0] });
  for (let i = 0; i < 9; i++) {
    const angle = (i / 9) * Math.PI * 2;
    addTo(stamens, cylinder(0.03, 0.03, 1.1 + (i % 3) * 0.25, 6), { at: [Math.cos(angle) * 0.2, SHORE_HEIGHT + 0.4, Math.sin(angle) * 0.2], rz: Math.cos(angle) * 0.3, rx: Math.sin(angle) * 0.3 });
  }
  return [
    part("petals", petals, { color: blend(p.accent, p.ground, 0.08), roughness: 0.55, metallic: 0.1, emissive: p.accent.map((v) => v * 0.18) as Rgb }),
    part("stamens", stamens, bright(p.ink)),
    emblem(p, SWALLOWTAIL, 3.7),
  ];
}

const FORMS: Record<string, { land: Landform; build: (palette: Palette) => SceneNode[] }> = {
  ledgerwick: { land: { radius: 3.3, seed: 1.3 }, build: ledgerwick },
  "monsoon-crate": { land: { radius: 3.3, seed: 2.7, hill: { height: 1.15, radius: 3.0 } }, build: monsoon },
  "basalt-beam": { land: { radius: 3.3, seed: 4.1 }, build: basalt },
  quillstack: { land: { radius: 3.3, seed: 5.5 }, build: quillstack },
  "neem-nectar": { land: { radius: 3.3, seed: 6.9 }, build: neem },
  reelhouse: { land: { radius: 3.3, seed: 8.3 }, build: reelhouse },
  "tiffin-theory": { land: { radius: 3.3, seed: 9.7 }, build: tiffin },
  "static-bloom": { land: { radius: 3.3, seed: 11.1 }, build: staticBloom },
};

/** The island of a world as a binary glTF file, drawn in the world's own colours. */
export function islandModel(slug: string, colours: Colours): Uint8Array {
  const form = FORMS[slug];
  if (!form) throw new Error(`no island for ${slug}`);
  const palette = paletteOf(colours);
  return writeGlb({ name: "island", children: [...landNodes(palette, form.land), ...form.build(palette)] });
}
