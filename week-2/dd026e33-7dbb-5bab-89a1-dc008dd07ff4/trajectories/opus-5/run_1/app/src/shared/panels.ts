export type PanelId =
  | 'front_valance'
  | 'bonnet'
  | 'front_wing_l'
  | 'front_wing_r'
  | 'door_l'
  | 'door_r'
  | 'sill_l'
  | 'sill_r'
  | 'roof'
  | 'rear_quarter_l'
  | 'rear_quarter_r'
  | 'boot_lid';

export interface PanelDefinition {
  readonly id: PanelId;
  readonly name: string;
  readonly order: number;
}

/** The 12 panels, in front-to-rear order. */
export const PANELS: readonly PanelDefinition[] = [
  { id: 'front_valance', name: 'Front valance', order: 1 },
  { id: 'bonnet', name: 'Bonnet', order: 2 },
  { id: 'front_wing_l', name: 'Front wing L', order: 3 },
  { id: 'front_wing_r', name: 'Front wing R', order: 4 },
  { id: 'door_l', name: 'Door L', order: 5 },
  { id: 'door_r', name: 'Door R', order: 6 },
  { id: 'sill_l', name: 'Sill L', order: 7 },
  { id: 'sill_r', name: 'Sill R', order: 8 },
  { id: 'roof', name: 'Roof', order: 9 },
  { id: 'rear_quarter_l', name: 'Rear quarter L', order: 10 },
  { id: 'rear_quarter_r', name: 'Rear quarter R', order: 11 },
  { id: 'boot_lid', name: 'Boot lid', order: 12 },
];

export const DEFAULT_PANEL: PanelId = 'bonnet';

const BY_ID = new Map<string, PanelDefinition>(PANELS.map((panel) => [panel.id, panel]));

export function isPanelId(value: string): value is PanelId {
  return BY_ID.has(value);
}

export function panelName(id: PanelId): string {
  const panel = BY_ID.get(id);
  return panel ? panel.name : id;
}
