import { box, cylinder, extrude, lathe, merge, place, sphere, torus, type Mesh } from "./geometry.js";
import type { Colours, Project } from "../shared/types.js";

export type Paint = keyof Colours;

export interface Part {
  paint: Paint;
  mesh: Mesh;
}

export interface Island {
  body: Part[];
  emblem: Part[];
  emblemHeight: number;
}

const BASE_SEGMENTS = 128;

function rockBase(radius: number, jag: number): Mesh {
  const profile: Array<[number, number]> = [];
  const rings = 26;
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    const r = radius * Math.cos(t * Math.PI * 0.5) ** 0.7 * (1 + (j % 2 === 0 ? 0 : -jag));
    profile.push([Math.max(r, 0.001), -t * radius * 1.1]);
  }
  const top: Array<[number, number]> = [];
  for (let j = 0; j <= 12; j++) top.push([(radius * j) / 12, 0]);
  return merge(lathe(top, BASE_SEGMENTS), lathe(profile, BASE_SEGMENTS));
}

function emblemFlag(): Part[] {
  const flag: Array<[number, number]> = [
    [0, 0],
    [0.75, 0.22],
    [0, 0.44],
  ];
  return [
    { paint: "ink", mesh: cylinder(0.035, 0.035, 1.1, 24) },
    {
      paint: "accent",
      mesh: place(extrude(flag, 0.05), { at: [0.03, 0.55, 0.025], rotate: [Math.PI / 2, 0, 0], scale: [1, 1, 1] }),
    },
  ];
}

function ledgerwick(): Part[] {
  const slabs: Mesh[] = [];
  const rules: Mesh[] = [];
  for (let i = 0; i < 7; i++) {
    const w = 2.4 - i * 0.22;
    slabs.push(place(box(w, 0.26, w * 0.72), { at: [0, 0.13 + i * 0.32, 0], rotate: [0, i * 0.06, 0] }));
    rules.push(place(box(w + 0.04, 0.05, w * 0.72 + 0.04), { at: [0, 0.285 + i * 0.32, 0], rotate: [0, i * 0.06, 0] }));
  }
  return [
    { paint: "ink", mesh: merge(...slabs) },
    { paint: "accent", mesh: merge(...rules) },
  ];
}

function monsoonCrate(): Part[] {
  const hillProfile: Array<[number, number]> = [];
  for (let j = 0; j <= 16; j++) {
    const t = j / 16;
    hillProfile.push([Math.max(2.1 * Math.sin(t * Math.PI * 0.5), 0.001), 1.1 * Math.cos(t * Math.PI * 0.5)]);
  }
  const rain: Mesh[] = [];
  for (let i = 0; i < 28; i++) {
    const a = i * 2.39996;
    const r = 0.4 + (i % 7) * 0.27;
    rain.push(place(cylinder(0.025, 0.025, 1.2, 10), { at: [Math.cos(a) * r, 3.4 + (i % 3) * 0.3, Math.sin(a) * r], rotate: [0, 0, 0.18] }));
  }
  const crate = merge(
    place(box(1, 0.7, 0.8), { at: [0, 1.35, 0], rotate: [0, 0.4, 0] }),
    ...[-0.3, 0, 0.3].map((x) => place(box(0.08, 0.74, 0.84), { at: [x, 1.35, 0], rotate: [0, 0.4, 0] })),
  );
  return [
    { paint: "ground", mesh: lathe(hillProfile, 96) },
    { paint: "accent", mesh: crate },
    { paint: "ink", mesh: merge(...rain) },
  ];
}

function basaltBeam(): Part[] {
  const columns: Mesh[] = [];
  for (let i = 0; i < 19; i++) {
    const ring = i === 0 ? 0 : i < 7 ? 1 : 2;
    const a = ring === 1 ? (i - 1) * (Math.PI / 3) : (i - 7) * (Math.PI / 6);
    const r = ring * 0.62;
    const h = 2.6 - ring * 0.7 + ((i * 37) % 5) * 0.12;
    columns.push(place(cylinder(0.33, 0.33, h, 6), { at: [Math.cos(a) * r, h / 2, Math.sin(a) * r] }));
  }
  return [
    { paint: "ink", mesh: merge(...columns) },
    { paint: "accent", mesh: place(box(4.2, 0.22, 0.3), { at: [0, 1.95, 0.1], rotate: [0, 0.5, 0.08] }) },
  ];
}

function quill(length: number): Mesh {
  const outline: Array<[number, number]> = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    outline.push([t * length - length / 2, Math.sin(t * Math.PI) * 0.22 * (1 - t * 0.6)]);
  }
  for (let i = 11; i >= 1; i--) {
    const t = i / 12;
    outline.push([t * length - length / 2, -Math.sin(t * Math.PI) * 0.12 * (1 - t * 0.6)]);
  }
  return extrude(outline.reverse(), 0.18);
}

function quillstack(): Part[] {
  const inked: Mesh[] = [];
  const accented: Mesh[] = [];
  for (let i = 0; i < 9; i++) {
    const mesh = place(quill(2.6 - i * 0.15), { at: [0, i * 0.2, 0], rotate: [0, i * 0.35, 0] });
    (i % 3 === 2 ? accented : inked).push(mesh);
  }
  return [
    { paint: "ink", mesh: merge(...inked) },
    { paint: "accent", mesh: merge(...accented) },
  ];
}

function leaf(length: number, width: number): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const x = Math.cos(a) * length;
    const z = Math.sin(a) * width * (1 - Math.cos(a) * 0.35);
    points.push([x, z]);
  }
  return points;
}

function neemNectar(): Part[] {
  const tiers = [0, 1, 2, 3].map((i) =>
    place(extrude(leaf(2.1 - i * 0.42, 1.1 - i * 0.22), 0.28), { at: [i * 0.15, i * 0.28, 0], rotate: [0, 0.5, 0] }),
  );
  return [
    { paint: "ground", mesh: merge(tiers[0], tiers[2]) },
    { paint: "ink", mesh: merge(tiers[1], tiers[3]) },
    { paint: "accent", mesh: place(box(2.6, 0.04, 0.05), { at: [0.2, 1.15, 0], rotate: [0, 0.5, 0] }) },
  ];
}

function reelhouse(): Part[] {
  const upright = (mesh: Mesh, at: [number, number, number]): Mesh =>
    place(mesh, { at, rotate: [Math.PI / 2, 0, 0] });
  const holes: Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    holes.push(upright(cylinder(0.32, 0.32, 0.36, 32), [Math.cos(a) * 0.85, 1.65 + Math.sin(a) * 0.85, 0]));
  }
  return [
    { paint: "ink", mesh: merge(upright(cylinder(1.5, 1.5, 0.3, 96), [0, 1.65, 0]), upright(torus(1.5, 0.08, 96, 12), [0, 1.65, 0])) },
    { paint: "ground", mesh: merge(...holes, upright(cylinder(0.2, 0.2, 0.4, 32), [0, 1.65, 0])) },
    { paint: "accent", mesh: place(box(1.8, 0.04, 0.5), { at: [1.1, 0.05, 0.4], rotate: [0, -0.4, 0] }) },
  ];
}

function tiffinTheory(): Part[] {
  const tiers: Mesh[] = [];
  const bands: Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const y = 0.3 + i * 0.58;
    tiers.push(place(cylinder(0.95, 0.95, 0.5, 64), { at: [0, y, 0] }));
    bands.push(place(torus(0.96, 0.06, 64, 10), { at: [0, y + 0.08, 0] }));
  }
  bands.push(place(torus(0.35, 0.06, 32, 10), { at: [0, 2.65, 0], rotate: [Math.PI / 2, 0, 0] }));
  return [
    { paint: "ink", mesh: merge(...tiers) },
    { paint: "accent", mesh: merge(...bands) },
  ];
}

function staticBloom(): Part[] {
  const petals: Mesh[] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    petals.push(
      place(sphere(1, 24, 12), {
        at: [Math.cos(a) * 0.95, 0.75 + (i % 2) * 0.2, Math.sin(a) * 0.95],
        rotate: [0, -a, 0.55],
        scale: [0.95, 0.16, 0.42],
      }),
    );
  }
  return [
    { paint: "accent", mesh: merge(...petals) },
    { paint: "ink", mesh: place(sphere(0.42, 32, 16), { at: [0, 0.95, 0] }) },
  ];
}

const forms: Record<string, () => Part[]> = {
  ledgerwick,
  "monsoon-crate": monsoonCrate,
  "basalt-beam": basaltBeam,
  quillstack,
  "neem-nectar": neemNectar,
  reelhouse,
  "tiffin-theory": tiffinTheory,
  "static-bloom": staticBloom,
};

const emblemHeights: Record<string, number> = {
  ledgerwick: 3.2,
  "monsoon-crate": 2.45,
  "basalt-beam": 3.4,
  quillstack: 2.6,
  "neem-nectar": 2.1,
  reelhouse: 3.7,
  "tiffin-theory": 3.4,
  "static-bloom": 2.2,
};

export function buildIsland(world: Project): Island {
  const body: Part[] = [{ paint: "ground", mesh: rockBase(2.5, 0.08) }, ...forms[world.slug]()];
  return { body, emblem: emblemFlag(), emblemHeight: emblemHeights[world.slug] };
}
