/** Panel frames duplicated for the client: same numbers as the server module. */
export type PanelId =
  | 'bonnet' | 'os-front-wing' | 'os-door' | 'os-sill' | 'os-rear-quarter'
  | 'boot-lid' | 'rear-bumper' | 'ns-rear-quarter' | 'ns-sill' | 'ns-door'
  | 'ns-front-wing' | 'front-bumper' | 'roof';

export interface PanelSpec { id: PanelId; label: string; substrate: 'steel' | 'aluminium' | 'plastic'; }

export const PANELS: PanelSpec[] = [
  { id: 'bonnet', label: 'Bonnet', substrate: 'aluminium' },
  { id: 'os-front-wing', label: 'Offside front wing', substrate: 'steel' },
  { id: 'os-door', label: 'Offside door', substrate: 'steel' },
  { id: 'os-sill', label: 'Offside sill', substrate: 'steel' },
  { id: 'os-rear-quarter', label: 'Offside rear quarter', substrate: 'steel' },
  { id: 'boot-lid', label: 'Boot lid', substrate: 'aluminium' },
  { id: 'rear-bumper', label: 'Rear bumper', substrate: 'plastic' },
  { id: 'ns-rear-quarter', label: 'Nearside rear quarter', substrate: 'steel' },
  { id: 'ns-sill', label: 'Nearside sill', substrate: 'steel' },
  { id: 'ns-door', label: 'Nearside door', substrate: 'steel' },
  { id: 'ns-front-wing', label: 'Nearside front wing', substrate: 'steel' },
  { id: 'front-bumper', label: 'Front bumper', substrate: 'plastic' },
  { id: 'roof', label: 'Roof', substrate: 'steel' },
];

export const PANEL_BY_ID: Record<PanelId, PanelSpec> = Object.fromEntries(PANELS.map(p => [p.id, p])) as Record<PanelId, PanelSpec>;

export interface PanelFrame { origin: [number, number, number]; U: [number, number, number]; V: [number, number, number]; }

export const PANEL_FRAMES: Record<PanelId, PanelFrame> = {
  'bonnet': { origin: [-0.75, 0.85, -2.00], U: [1.5, 0, 0], V: [0, 0.1, 1.2] },
  'os-front-wing': { origin: [0.85, 0.45, -2.00], U: [0, 0, 1.0], V: [0, 0.4, 0] },
  'os-door': { origin: [0.85, 0.40, -1.00], U: [0, 0, 1.2], V: [0, 0.5, 0] },
  'os-sill': { origin: [0.85, 0.20, -1.00], U: [0, 0, 2.0], V: [0, 0.2, 0] },
  'os-rear-quarter': { origin: [0.85, 0.40, 0.20], U: [0, 0, 1.8], V: [0, 0.5, 0] },
  'boot-lid': { origin: [0.70, 0.90, 1.40], U: [-1.4, 0, 0], V: [0, -0.1, 0.6] },
  'rear-bumper': { origin: [0.85, 0.30, 2.10], U: [-1.7, 0, 0], V: [0, 0.3, 0] },
  'ns-rear-quarter': { origin: [-0.85, 0.40, 2.00], U: [0, 0, -1.8], V: [0, 0.5, 0] },
  'ns-sill': { origin: [-0.85, 0.20, 1.00], U: [0, 0, -2.0], V: [0, 0.2, 0] },
  'ns-door': { origin: [-0.85, 0.40, 0.20], U: [0, 0, -1.2], V: [0, 0.5, 0] },
  'ns-front-wing': { origin: [-0.85, 0.45, -1.00], U: [0, 0, -1.0], V: [0, 0.4, 0] },
  'front-bumper': { origin: [-0.85, 0.30, -2.10], U: [1.7, 0, 0], V: [0, 0.3, 0] },
  'roof': { origin: [-0.60, 1.30, -0.50], U: [1.2, 0, 0], V: [0, 0, 1.4] },
};

export function panelPoint(panelId: PanelId, u: number, v: number): [number, number, number] {
  const f = PANEL_FRAMES[panelId];
  return [
    f.origin[0] + u * f.U[0] + v * f.V[0],
    f.origin[1] + u * f.U[1] + v * f.V[1],
    f.origin[2] + u * f.U[2] + v * f.V[2],
  ];
}

export function maskedRegistration(registration: string): string {
  return registration.split('').map((c, i) => (i < 2 ? c : '*')).join('');
}

export const SEVERITIES = ['cosmetic', 'moderate', 'serious'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Top-down diagram rectangles for the panel diagram, in a viewBox coordinate space. */
export function diagramRects(size = 420): { id: PanelId; x: number; y: number; w: number; h: number }[] {
  const bounds = { minX: -2.3, maxX: 2.3, minZ: -2.6, maxZ: 2.8 };
  const scale = size / (bounds.maxX - bounds.minX);
  const px = (x: number) => (x - bounds.minX) * scale + 10;
  const py = (z: number) => (z - bounds.minZ) * scale + 10;
  return PANELS.map(p => {
    const f = PANEL_FRAMES[p.id];
    const xs = [f.origin[0], f.origin[0] + f.U[0], f.origin[0] + f.U[0] + f.V[0], f.origin[0] + f.V[0]].map(v => px(v));
    const zs = [f.origin[2], f.origin[2] + f.U[2], f.origin[2] + f.U[2] + f.V[2], f.origin[2] + f.V[2]].map(v => py(v));
    return { id: p.id, x: Math.min(...xs), y: Math.min(...zs), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...zs) - Math.min(...zs) };
  });
}
