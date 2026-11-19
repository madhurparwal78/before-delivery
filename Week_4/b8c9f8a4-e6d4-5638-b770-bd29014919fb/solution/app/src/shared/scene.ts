// The faceted car, drawn in light. One description of the shape, read by both renderers: the
// Three.js scene builds its geometry from it and the drawn still projects the same facets.
//
// The body is lofted along stations from nose to tail, so the thirteen panel frames lie flush on
// a surface that reads as one car from any resting azimuth.

import { PANELS, frameCorners, type Panel, type Vec3 } from './panels.js';

export interface Facet {
  /** Three or more points, in order around the face. */
  readonly points: Vec3[];
  readonly colour: readonly [number, number, number];
  /** The panel this facet belongs to, when it is one of the thirteen. */
  readonly panelId?: string;
  /** Light added over the body, 0 to 1: the scene multiplies it, the still draws it as opacity. */
  readonly glow?: number;
  /** Which skin wins where facets share a plane: 0 the shell, 1 the panels, 2 the trim on them. */
  readonly layer?: 1 | 2;
  /** How much of the ground a shadow facet darkens, 0 to 1. */
  readonly opacity?: number;
  /** Where the drawn still orders this facet, when it paints as one part with its neighbours. */
  readonly paintAt?: Vec3;
}

const KEY: Vec3 = normalise([-0.42, 0.76, -0.5]);
const ROAD = 0.0;

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalise(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

export function centroid(points: Vec3[]): Vec3 {
  const total = points.reduce<Vec3>((sum, p) => [sum[0] + p[0], sum[1] + p[1], sum[2] + p[2]], [0, 0, 0]);
  return [total[0] / points.length, total[1] / points.length, total[2] / points.length];
}

function normalOf(points: Vec3[]): Vec3 {
  return normalise(cross(subtract(points[1], points[0]), subtract(points[2], points[0])));
}

/** The facet's normal, turned to face away from the middle of the car. */
export function outwardNormal(points: Vec3[]): Vec3 {
  const normal = normalOf(points);
  const middle = centroid(points);
  const away = normal[0] * middle[0] + normal[1] * (middle[1] - 0.6) + normal[2] * middle[2];
  return away < 0 ? [-normal[0], -normal[1], -normal[2]] : normal;
}

function mix(a: readonly number[], b: readonly number[], t: number): [number, number, number] {
  const k = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

function scaled(colour: readonly number[], by: number): [number, number, number] {
  return [colour[0] * by, colour[1] * by, colour[2] * by];
}

const PERIWINKLE = [0.561, 0.651, 0.961] as const;
const INDIGO = [0.169, 0.133, 0.447] as const;
const MAGENTA = [0.541, 0.247, 0.522] as const;
const FAR_BLUE = [0.102, 0.184, 0.753] as const;
const BASE = [0.055, 0.012, 0.224] as const;
const SHUT_LINE = [0.035, 0.012, 0.13] as const;

/**
 * Flat shading along the brief's ramp: a face turned to the sky takes the periwinkle, a face turned
 * away falls through the indigo, the offside leans to the saturated blue and the nearside to the
 * magenta, and everything dissolves into the indigo base towards the road.
 */
function shade(points: Vec3[], tint: number): [number, number, number] {
  const middle = centroid(points);
  const normal = outwardNormal(points);
  const key = Math.max(0, normal[0] * KEY[0] + normal[1] * KEY[1] + normal[2] * KEY[2]);
  const sky = Math.max(0, normal[1]);
  let colour = mix(INDIGO, PERIWINKLE, 0.1 + 0.62 * sky + 0.42 * key);
  colour = mix(colour, FAR_BLUE, Math.max(0, normal[0]) * 0.62);
  colour = mix(colour, MAGENTA, Math.max(0, -normal[0]) * 0.46);
  // Light runs along the flanks, so a long side reads as a surface rather than one flat slab.
  const along = 0.95 + 0.07 * Math.cos((middle[2] + 0.4) * 1.5);
  const dissolve = 0.4 + 0.6 * Math.max(0, Math.min(1, (middle[1] - 0.12) / 0.5));
  return mix(BASE, scaled(colour, tint * along), dissolve);
}

function facet(points: Vec3[], options: { panelId?: string; tint?: number } = {}): Facet {
  const colour = shade(points, options.tint ?? 1);
  return options.panelId ? { points, colour, panelId: options.panelId, layer: 1 } : { points, colour };
}

/** Glass: deep indigo, catching the periwinkle only where it faces the sky. */
function glass(points: Vec3[]): Facet {
  const normal = outwardNormal(points);
  return { points, colour: mix([0.05, 0.035, 0.2], [0.27, 0.32, 0.68], Math.max(0, normal[1]) * 0.8) };
}

function trim(points: Vec3[], colour: readonly [number, number, number], paintAt?: Vec3): Facet {
  return paintAt ? { points, colour, layer: 2, paintAt } : { points, colour, layer: 2 };
}

/** The body's cross section at a station along the car. */
interface Station {
  z: number;
  /** Half width of the shell, and of the top surface above it. */
  side: number;
  roof: number;
  /** Heights: the bottom of the sill, the shoulder, and the top (bonnet, roof or boot). */
  low: number;
  mid: number;
  top: number;
}

// The stations follow the published frames, so each panel lies on the shell: the sides at 0.85 m,
// the bonnet rising to the screen, the roof at 1.30 m, the boot falling to the tail.
const STATIONS: Station[] = [
  { z: -2.1, side: 0.85, roof: 0.72, low: 0.24, mid: 0.62, top: 0.74 },
  { z: -2.0, side: 0.85, roof: 0.76, low: 0.2, mid: 0.82, top: 0.85 },
  { z: -1.4, side: 0.85, roof: 0.79, low: 0.17, mid: 0.87, top: 0.9 },
  { z: -0.8, side: 0.85, roof: 0.8, low: 0.15, mid: 0.92, top: 0.95 },
  { z: -0.5, side: 0.85, roof: 0.6, low: 0.15, mid: 0.92, top: 1.3 },
  { z: 0.2, side: 0.85, roof: 0.6, low: 0.15, mid: 0.92, top: 1.3 },
  { z: 0.9, side: 0.85, roof: 0.6, low: 0.15, mid: 0.92, top: 1.3 },
  { z: 1.4, side: 0.85, roof: 0.74, low: 0.16, mid: 0.88, top: 0.9 },
  { z: 2.0, side: 0.85, roof: 0.74, low: 0.2, mid: 0.76, top: 0.8 },
  { z: 2.1, side: 0.85, roof: 0.7, low: 0.24, mid: 0.6, top: 0.72 },
];

/** A wheel in its arch, on the plane just proud of the side: every facet takes its own light. */
function wheel(side: number, z: number): Facet[] {
  const centreY = 0.34;
  const steps = 18;
  const plane = (lift: number): number => side * (0.85 + lift);
  const at = (angle: number, from: number, lift: number): Vec3 =>
    [plane(lift), centreY + from * Math.sin(angle), z + from * Math.cos(angle)];
  const turn = (step: number): number => (step / steps) * Math.PI * 2;
  // Light falls from above and from the front of the car, whichever side the wheel is on.
  const lit = (angle: number): number => 0.5 + 0.5 * Math.sin(angle + 0.5);

  const hub: Vec3 = [side * 0.85, centreY, z];
  const made: Facet[] = [];
  // The arch is cut off level with the sill, so it reads as an opening in the side.
  made.push(trim(
    Array.from({ length: steps }, (_, step) => {
      const point = at(turn(step), 0.41, 0.002);
      return [point[0], Math.max(0.16, point[1]), point[2]] as Vec3;
    }),
    SHUT_LINE,
    hub,
  ));
  for (let step = 0; step < steps; step += 1) {
    const a = turn(step);
    const b = turn(step + 1);
    made.push(trim(
      [at(a, 0.21, 0.004), at(a, 0.35, 0.004), at(b, 0.35, 0.004), at(b, 0.21, 0.004)],
      mix([0.02, 0.012, 0.075], [0.15, 0.13, 0.33], lit((a + b) / 2)),
      hub,
    ));
    // The rim is cut into spokes: every other wedge is lit metal, the rest the dark behind it.
    made.push(trim(
      [at(a, 0.06, 0.006), at(a, 0.21, 0.006), at(b, 0.21, 0.006), at(b, 0.06, 0.006)],
      step % 3 === 0
        ? [0.04, 0.025, 0.13]
        : mix(INDIGO, PERIWINKLE, 0.25 + 0.65 * lit((a + b) / 2)),
      hub,
    ));
  }
  made.push(trim(
    Array.from({ length: steps }, (_, step) => at(turn(step), 0.06, 0.008)),
    mix(INDIGO, PERIWINKLE, 0.8),
    hub,
  ));
  return made;
}

/** A thin strip along a frame edge, lying on the panel's own plane. */
function strip(a: Vec3, b: Vec3, across: Vec3, half: number): Vec3[] {
  const off = (point: Vec3, by: number): Vec3 =>
    [point[0] + across[0] * by, point[1] + across[1] * by, point[2] + across[2] * by];
  return [off(a, -half), off(b, -half), off(b, half), off(a, half)];
}

/** Shut lines round every panel, so the skin reads as separate pressed panels of one car. */
function shutLines(panel: Panel): Facet[] {
  const corners = frameCorners(panel);
  const normal = normalOf(corners);
  return corners.map((a, index) => {
    const b = corners[(index + 1) % 4];
    const across = normalise(cross(normal, normalise(subtract(b, a))));
    return trim(strip(a, b, across, 0.009), SHUT_LINE);
  });
}

/** The details that make the shell a car: pillars, screen light, handles, crease, lamps, grille. */
function details(): Facet[] {
  const made: Facet[] = [];
  const crease = mix(INDIGO, PERIWINKLE, 0.72);
  const pillar = [0.08, 0.05, 0.27] as const;
  for (const side of [1, -1]) {
    // the shoulder crease, running the length of the car above the handles
    made.push(trim(strip([side * 0.85, 0.665, -2.0], [side * 0.85, 0.665, 2.0], [0, 1, 0], 0.012), crease));
    // the door handle
    made.push(trim([
      [side * 0.85, 0.74, -0.2], [side * 0.85, 0.74, -0.02],
      [side * 0.85, 0.785, -0.02], [side * 0.85, 0.785, -0.2],
    ], mix(INDIGO, PERIWINKLE, 0.92)));
    // the B pillar and the roof rail, which turn the glass into windows
    made.push(trim([
      [side * 0.8105, 0.98, 0.14], [side * 0.8105, 0.98, 0.22],
      [side * 0.6197, 1.27, 0.22], [side * 0.6197, 1.27, 0.14],
    ], pillar));
    made.push(trim([
      [side * 0.6, 1.3, -0.5], [side * 0.6, 1.3, 0.9],
      [side * 0.6395, 1.24, 0.9], [side * 0.6395, 1.24, -0.5],
    ], mix(INDIGO, PERIWINKLE, 0.5)));
    // lamps: the only warm light on the body at rest, kept small so the fault stays the brightest
    made.push(trim([
      [side * 0.42, 0.64, -2.1], [side * 0.8, 0.64, -2.1],
      [side * 0.78, 0.72, -2.1], [side * 0.44, 0.72, -2.1],
    ], [0.74, 0.74, 0.8]));
    made.push(trim([
      [side * 0.78, 0.62, 2.1], [side * 0.36, 0.62, 2.1],
      [side * 0.36, 0.7, 2.1], [side * 0.76, 0.7, 2.1],
    ], [0.52, 0.12, 0.26]));
  }
  // the grille between the headlamps
  made.push(trim([[-0.38, 0.64, -2.1], [0.38, 0.64, -2.1], [0.38, 0.72, -2.1], [-0.38, 0.72, -2.1]], SHUT_LINE));
  // a band of sky across the windscreen and the rear screen
  made.push(trim([[-0.56, 1.1, -0.67], [0.2, 1.1, -0.67], [0.34, 1.26, -0.53], [-0.28, 1.26, -0.53]], mix(INDIGO, PERIWINKLE, 0.4)));
  made.push(trim([[-0.2, 1.08, 1.17], [0.5, 1.08, 1.17], [0.42, 1.26, 0.96], [-0.1, 1.26, 0.96]], mix(INDIGO, PERIWINKLE, 0.3)));
  return made;
}

/** The body as flat facets in car space. Its shadow on the road is `groundShadow`. */
export function bodyFacets(): Facet[] {
  const made: Facet[] = [];

  for (let index = 0; index + 1 < STATIONS.length; index += 1) {
    const a = STATIONS[index];
    const b = STATIONS[index + 1];
    const between = (a.z + b.z) / 2;
    const cabin = between > -0.8 && between < 1.4;
    const roof = between > -0.5 && between < 0.9;
    for (const side of [1, -1]) {
      // lower body, from the road line to the sill top
      made.push(facet([
        [side * a.side, a.low, a.z],
        [side * b.side, b.low, b.z],
        [side * b.side, 0.42, b.z],
        [side * a.side, 0.42, a.z],
      ], { tint: 0.72 }));
      // the painted side, sill top to the shoulder
      made.push(facet([
        [side * a.side, 0.42, a.z],
        [side * b.side, 0.42, b.z],
        [side * b.side, b.mid, b.z],
        [side * a.side, a.mid, a.z],
      ]));
      // the glasshouse, or the shoulder rolling onto the bonnet and the boot
      const above: Vec3[] = [
        [side * a.side, a.mid, a.z],
        [side * b.side, b.mid, b.z],
        [side * b.roof, b.top, b.z],
        [side * a.roof, a.top, a.z],
      ];
      made.push(cabin ? glass(above) : facet(above));
    }
    // the top surface: bonnet, screens, roof or boot lid
    const top: Vec3[] = [
      [-a.roof, a.top, a.z],
      [a.roof, a.top, a.z],
      [b.roof, b.top, b.z],
      [-b.roof, b.top, b.z],
    ];
    made.push(cabin && !roof ? glass(top) : facet(top));
  }

  // nose and tail faces
  const nose = STATIONS[0];
  const tail = STATIONS[STATIONS.length - 1];
  made.push(facet([
    [-nose.side, nose.low, nose.z], [nose.side, nose.low, nose.z],
    [nose.roof, nose.top, nose.z], [-nose.roof, nose.top, nose.z],
  ], { tint: 0.8 }));
  made.push(facet([
    [tail.side, tail.low, tail.z], [-tail.side, tail.low, tail.z],
    [-tail.roof, tail.top, tail.z], [tail.roof, tail.top, tail.z],
  ], { tint: 0.8 }));

  // the thirteen panels sit on the body exactly where their frames say
  for (const panel of PANELS) {
    made.push(facet(frameCorners(panel), { panelId: panel.id }));
    made.push(...shutLines(panel));
  }
  made.push(...details());

  for (const side of [1, -1]) {
    made.push(...wheel(side, -1.42));
    made.push(...wheel(side, 1.42));
  }

  return made;
}

/** The car's shadow on the road: nested outlines, so its edge softens without any blur. */
export function groundShadow(): Facet[] {
  const colour = [0.012, 0.004, 0.05] as const;
  return Array.from({ length: 16 }, (_, step) => 0.36 - step * 0.022).map((grow) => {
    const halfWidth = 0.85 + grow;
    const halfLength = 2.1 + grow;
    const corner = 0.25 + grow * 0.6;
    const points: Vec3[] = [];
    for (const [sx, sz, from] of [[1, 1, 0], [-1, 1, 1], [-1, -1, 2], [1, -1, 3]]) {
      for (let step = 0; step <= 4; step += 1) {
        const angle = (from + step / 4) * (Math.PI / 2);
        points.push([
          sx * (halfWidth - corner) + Math.cos(angle) * corner,
          ROAD,
          sz * (halfLength - corner) + Math.sin(angle) * corner,
        ]);
      }
    }
    return { points, colour, opacity: 0.09 };
  });
}

const RIM_COLOUR: readonly [number, number, number] = [1, 0.95, 0.86];

/**
 * The light on the rim, as bands either side of each frame edge: a bright core on the edge itself,
 * then two fainter bands spilling out over the body and in across the panel's face, so the edge
 * reads as light on the planes rather than a drawn outline. Distances are multiples of the rim's
 * thickness, measured from the edge.
 */
const RIM_BANDS: readonly { readonly from: number; readonly to: number; readonly glow: number }[] = [
  { from: -0.5, to: 0.5, glow: 1 },
  ...[0.62, 0.4, 0.22, 0.09].flatMap((glow, step) => [
    { from: 0.5 + step * 0.25, to: 0.75 + step * 0.25, glow },
    { from: -0.75 - step * 0.25, to: -0.5 - step * 0.25, glow },
  ]),
];

/** The light on a panel's four frame edges, as quads that can be lit on their own. */
export function panelRim(lit: Panel, thickness = 0.08): Facet[] {
  const corners = frameCorners(lit);
  const normal = normalOf(corners);
  const lift: Vec3 = [normal[0] * 0.03, normal[1] * 0.03, normal[2] * 0.03];
  const made: Facet[] = [];
  for (let index = 0; index < 4; index += 1) {
    const a = corners[index];
    const b = corners[(index + 1) % 4];
    const along = normalise(subtract(b, a));
    const across = normalise(cross(normal, along));
    const at = (point: Vec3, span: number): Vec3 => [
      point[0] + across[0] * span * thickness + lift[0],
      point[1] + across[1] * span * thickness + lift[1],
      point[2] + across[2] * span * thickness + lift[2],
    ];
    for (const band of RIM_BANDS) {
      made.push({
        points: [at(a, band.from), at(b, band.from), at(b, band.to), at(a, band.to)],
        colour: RIM_COLOUR,
        glow: band.glow,
        panelId: lit.id,
      });
    }
  }
  return made;
}
