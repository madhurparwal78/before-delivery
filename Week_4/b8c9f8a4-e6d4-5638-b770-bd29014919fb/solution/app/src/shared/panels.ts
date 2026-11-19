// The thirteen panels, in walkround order, with their car-space frames.
// Car space: metres, y up, the nose towards -z, the offside towards +x.

export type Substrate = 'steel' | 'aluminium' | 'plastic';
export type Vec3 = readonly [number, number, number];

export interface Panel {
  readonly id: string;
  readonly label: string;
  readonly substrate: Substrate;
  /** origin, U and V of the panel's frame; a point is origin + u*U + v*V. */
  readonly origin: Vec3;
  readonly u: Vec3;
  readonly v: Vec3;
  /** Where the camera rests to look at this panel: azimuth in degrees, elevation in degrees. */
  readonly azimuth: number;
  readonly elevation: number;
}

export const PANELS: readonly Panel[] = [
  { id: 'bonnet', label: 'Bonnet', substrate: 'aluminium',
    origin: [-0.75, 0.85, -2.0], u: [1.5, 0, 0], v: [0, 0.1, 1.2], azimuth: 0, elevation: 28 },
  { id: 'os-front-wing', label: 'Offside front wing', substrate: 'steel',
    origin: [0.85, 0.45, -2.0], u: [0, 0, 1.0], v: [0, 0.4, 0], azimuth: 55, elevation: 22 },
  { id: 'os-door', label: 'Offside door', substrate: 'steel',
    origin: [0.85, 0.4, -1.0], u: [0, 0, 1.2], v: [0, 0.5, 0], azimuth: 90, elevation: 20 },
  { id: 'os-sill', label: 'Offside sill', substrate: 'steel',
    origin: [0.85, 0.2, -1.0], u: [0, 0, 2.0], v: [0, 0.2, 0], azimuth: 96, elevation: 18 },
  { id: 'os-rear-quarter', label: 'Offside rear quarter', substrate: 'steel',
    origin: [0.85, 0.4, 0.2], u: [0, 0, 1.8], v: [0, 0.5, 0], azimuth: 125, elevation: 22 },
  { id: 'boot-lid', label: 'Boot lid', substrate: 'aluminium',
    origin: [0.7, 0.9, 1.4], u: [-1.4, 0, 0], v: [0, -0.1, 0.6], azimuth: 180, elevation: 28 },
  { id: 'rear-bumper', label: 'Rear bumper', substrate: 'plastic',
    origin: [0.85, 0.3, 2.1], u: [-1.7, 0, 0], v: [0, 0.3, 0], azimuth: 186, elevation: 18 },
  { id: 'ns-rear-quarter', label: 'Nearside rear quarter', substrate: 'steel',
    origin: [-0.85, 0.4, 2.0], u: [0, 0, -1.8], v: [0, 0.5, 0], azimuth: 235, elevation: 22 },
  { id: 'ns-sill', label: 'Nearside sill', substrate: 'steel',
    origin: [-0.85, 0.2, 1.0], u: [0, 0, -2.0], v: [0, 0.2, 0], azimuth: 264, elevation: 18 },
  { id: 'ns-door', label: 'Nearside door', substrate: 'steel',
    origin: [-0.85, 0.4, 0.2], u: [0, 0, -1.2], v: [0, 0.5, 0], azimuth: 270, elevation: 20 },
  { id: 'ns-front-wing', label: 'Nearside front wing', substrate: 'steel',
    origin: [-0.85, 0.45, -1.0], u: [0, 0, -1.0], v: [0, 0.4, 0], azimuth: 305, elevation: 22 },
  { id: 'front-bumper', label: 'Front bumper', substrate: 'plastic',
    origin: [-0.85, 0.3, -2.1], u: [1.7, 0, 0], v: [0, 0.3, 0], azimuth: 354, elevation: 18 },
  { id: 'roof', label: 'Roof', substrate: 'steel',
    origin: [-0.6, 1.3, -0.5], u: [1.2, 0, 0], v: [0, 0, 1.4], azimuth: 40, elevation: 42 },
];

const byId = new Map(PANELS.map((panel) => [panel.id, panel]));

export function panel(id: string): Panel | undefined {
  return byId.get(id);
}

/** The panel with this id. Ids come from the fixed table above, so an unknown one is a mistake. */
export function panelOf(id: string): Panel {
  const found = byId.get(id);
  if (!found) throw new Error(`unknown panel: ${id}`);
  return found;
}

export function panelOrder(id: string): number {
  return PANELS.findIndex((item) => item.id === id);
}

export function isGaugeable(id: string): boolean {
  const found = byId.get(id);
  return !!found && found.substrate !== 'plastic';
}

/** A finding's world point: origin + u*U + v*V. */
export function worldPoint(panelId: string, u: number, v: number): Vec3 {
  const found = panelOf(panelId);
  return [
    found.origin[0] + u * found.u[0] + v * found.v[0],
    found.origin[1] + u * found.u[1] + v * found.v[1],
    found.origin[2] + u * found.u[2] + v * found.v[2],
  ];
}

/** The four frame corners, in order. */
export function frameCorners(item: Panel): Vec3[] {
  const add = (...points: Vec3[]): Vec3 => [
    points.reduce((total, p) => total + p[0], 0),
    points.reduce((total, p) => total + p[1], 0),
    points.reduce((total, p) => total + p[2], 0),
  ];
  return [
    item.origin,
    add(item.origin, item.u),
    add(item.origin, item.u, item.v),
    add(item.origin, item.v),
  ];
}
