export type Substrate = 'steel' | 'aluminium' | 'plastic';

export type Vec3 = readonly [number, number, number];

export interface PanelFrame {
  readonly origin: Vec3;
  readonly u: Vec3;
  readonly v: Vec3;
}

export interface PanelDefinition {
  readonly id: string;
  readonly label: string;
  readonly substrate: Substrate;
  readonly frame: PanelFrame;
  /** Position of the panel's rectangle on the top-down diagram, in diagram units. */
  readonly diagram: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}

/** The thirteen panels every car has, in walkround order. */
export const PANELS: readonly PanelDefinition[] = [
  {
    id: 'bonnet',
    label: 'Bonnet',
    substrate: 'aluminium',
    frame: { origin: [-0.75, 0.85, -2.0], u: [1.5, 0, 0], v: [0, 0.1, 1.2] },
    diagram: { x: 30, y: 36, w: 60, h: 46 },
  },
  {
    id: 'os-front-wing',
    label: 'Offside front wing',
    substrate: 'steel',
    frame: { origin: [0.85, 0.45, -2.0], u: [0, 0, 1.0], v: [0, 0.4, 0] },
    diagram: { x: 94, y: 36, w: 26, h: 46 },
  },
  {
    id: 'os-door',
    label: 'Offside door',
    substrate: 'steel',
    frame: { origin: [0.85, 0.4, -1.0], u: [0, 0, 1.2], v: [0, 0.5, 0] },
    diagram: { x: 94, y: 86, w: 26, h: 54 },
  },
  {
    id: 'os-sill',
    label: 'Offside sill',
    substrate: 'steel',
    frame: { origin: [0.85, 0.2, -1.0], u: [0, 0, 2.0], v: [0, 0.2, 0] },
    diagram: { x: 124, y: 86, w: 14, h: 92 },
  },
  {
    id: 'os-rear-quarter',
    label: 'Offside rear quarter',
    substrate: 'steel',
    frame: { origin: [0.85, 0.4, 0.2], u: [0, 0, 1.8], v: [0, 0.5, 0] },
    diagram: { x: 94, y: 144, w: 26, h: 62 },
  },
  {
    id: 'boot-lid',
    label: 'Boot lid',
    substrate: 'aluminium',
    frame: { origin: [0.7, 0.9, 1.4], u: [-1.4, 0, 0], v: [0, -0.1, 0.6] },
    diagram: { x: 30, y: 210, w: 60, h: 40 },
  },
  {
    id: 'rear-bumper',
    label: 'Rear bumper',
    substrate: 'plastic',
    frame: { origin: [0.85, 0.3, 2.1], u: [-1.7, 0, 0], v: [0, 0.3, 0] },
    diagram: { x: 24, y: 254, w: 72, h: 22 },
  },
  {
    id: 'ns-rear-quarter',
    label: 'Nearside rear quarter',
    substrate: 'steel',
    frame: { origin: [-0.85, 0.4, 2.0], u: [0, 0, -1.8], v: [0, 0.5, 0] },
    diagram: { x: 0, y: 144, w: 26, h: 62 },
  },
  {
    id: 'ns-sill',
    label: 'Nearside sill',
    substrate: 'steel',
    frame: { origin: [-0.85, 0.2, 1.0], u: [0, 0, -2.0], v: [0, 0.2, 0] },
    diagram: { x: -18, y: 86, w: 14, h: 92 },
  },
  {
    id: 'ns-door',
    label: 'Nearside door',
    substrate: 'steel',
    frame: { origin: [-0.85, 0.4, 0.2], u: [0, 0, -1.2], v: [0, 0.5, 0] },
    diagram: { x: 0, y: 86, w: 26, h: 54 },
  },
  {
    id: 'ns-front-wing',
    label: 'Nearside front wing',
    substrate: 'steel',
    frame: { origin: [-0.85, 0.45, -1.0], u: [0, 0, -1.0], v: [0, 0.4, 0] },
    diagram: { x: 0, y: 36, w: 26, h: 46 },
  },
  {
    id: 'front-bumper',
    label: 'Front bumper',
    substrate: 'plastic',
    frame: { origin: [-0.85, 0.3, -2.1], u: [1.7, 0, 0], v: [0, 0.3, 0] },
    diagram: { x: 24, y: 10, w: 72, h: 22 },
  },
  {
    id: 'roof',
    label: 'Roof',
    substrate: 'steel',
    frame: { origin: [-0.6, 1.3, -0.5], u: [1.2, 0, 0], v: [0, 0, 1.4] },
    diagram: { x: 34, y: 112, w: 52, h: 70 },
  },
];

export const PANEL_IDS: readonly string[] = PANELS.map((p) => p.id);

const BY_ID = new Map(PANELS.map((p) => [p.id, p] as const));

export const panelById = (id: string): PanelDefinition | undefined => BY_ID.get(id);

export const panelOrder = (id: string): number => PANEL_IDS.indexOf(id);

export const isGaugeable = (panel: PanelDefinition): boolean => panel.substrate !== 'plastic';

/** A finding's world point: origin + u*U + v*V. */
export const worldPoint = (panel: PanelDefinition, u: number, v: number): Vec3 => {
  const { origin, u: U, v: V } = panel.frame;
  return [origin[0] + u * U[0] + v * V[0], origin[1] + u * U[1] + v * V[1], origin[2] + u * U[2] + v * V[2]];
};

/** The four corners of a panel's frame, in order. */
export const frameCorners = (panel: PanelDefinition): readonly Vec3[] => [
  worldPoint(panel, 0, 0),
  worldPoint(panel, 1, 0),
  worldPoint(panel, 1, 1),
  worldPoint(panel, 0, 1),
];

export const DIAGRAM_VIEWBOX = { x: -24, y: 4, width: 150, height: 278 } as const;
