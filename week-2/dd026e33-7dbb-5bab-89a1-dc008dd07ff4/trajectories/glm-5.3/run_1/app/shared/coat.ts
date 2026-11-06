/** Paint stages in their published order. */
export const STAGE_NAMES = [
  'Intake',
  'Stripped',
  'Epoxy primer',
  'Guide coat',
  '2K primer',
  'Base',
  'Clear',
  'Cut and polish',
] as const;
export type StageName = (typeof STAGE_NAMES)[number];

export interface PanelDef {
  id: string;
  name: string;
  order: number;
}

export const PANELS: PanelDef[] = [
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

export const PANEL_IDS = PANELS.map((panel) => panel.id);

export type Band = 'thin' | 'factory' | 'refinished' | 'filler_suspected';

export function bandOf(um: number): Band {
  if (um < 80) return 'thin';
  if (um <= 180) return 'factory';
  if (um <= 300) return 'refinished';
  return 'filler_suspected';
}

export const BAND_LABELS: Record<Band, string> = {
  thin: 'Thin',
  factory: 'Factory',
  refinished: 'Refinished',
  filler_suspected: 'Filler suspected',
};

export interface Layer {
  stage_index: number;
  um: number;
}

/**
 * Derive a panel's layer stack from its film-build values across the logged
 * stages (in stage order). The stage name for a layer index is resolved by
 * the caller from the job's logged stages. The browser only draws these.
 */
export function deriveLayers(values: (number | null)[]): Layer[] {
  const stack: Layer[] = [];
  let previous: number | null = null;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value === null) {
      continue;
    }
    if (value < 20) {
      stack.length = 0;
      previous = value;
      continue;
    }
    if (previous === null) {
      stack.push({ stage_index: i, um: value });
      previous = value;
      continue;
    }
    if (value > previous) {
      stack.push({ stage_index: i, um: value - previous });
      previous = value;
    } else if (value < previous) {
      let thin = previous - value;
      while (thin > 0 && stack.length > 0) {
        const top = stack[stack.length - 1];
        if (top.um > thin) {
          top.um -= thin;
          thin = 0;
        } else {
          thin -= top.um;
          stack.pop();
        }
      }
      previous = value;
    }
    // equal value: nothing changes
  }
  return stack;
}

/**
 * Film build at stage index k: the latest reading at k, else the latest
 * earlier value, else null if the panel has never been read.
 */
export function filmBuildAt(values: (number | null)[], k: number): number | null {
  for (let i = k; i >= 0; i--) {
    const value = values[i];
    if (value !== null) return value;
  }
  return null;
}
