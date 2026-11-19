export type MeasureId = 'climate' | 'water' | 'fossilEnergy' | 'landUse' | 'freshwaterToxicity' | 'microfibres';
export type StageId = 'materials' | 'making' | 'transport' | 'use' | 'endOfLife';
type RowKind = 'material' | 'grid' | 'mode' | 'use' | 'endOfLife';
export type ModeId = 'sea' | 'road' | 'rail' | 'air';
export type CountryId = 'PT' | 'TR' | 'VN' | 'EG' | 'IN' | 'BD';

export const MEASURES: MeasureId[] = [
  'climate',
  'water',
  'fossilEnergy',
  'landUse',
  'freshwaterToxicity',
  'microfibres',
];

export const STAGES: StageId[] = ['materials', 'making', 'transport', 'use', 'endOfLife'];

export const MEASURE_UNITS: Record<MeasureId, string> = {
  climate: 'kg CO\u2082e',
  water: 'L',
  fossilEnergy: 'MJ',
  landUse: 'points',
  freshwaterToxicity: 'CTUe',
  microfibres: 'mg',
};

/** The library's own column for each measure. */
export const MEASURE_COLUMNS: Record<MeasureId, keyof FactorRow> = {
  climate: 'climate',
  water: 'water',
  fossilEnergy: 'fossil',
  landUse: 'land',
  freshwaterToxicity: 'toxicity',
  microfibres: 'microfibres',
};

export interface FactorRow {
  id: string;
  kind: RowKind;
  makingMjPerKg?: string | null;
  climate: string;
  water: string;
  fossil: string;
  land: string;
  toxicity: string;
  microfibres: string;
}

const MODES: ModeId[] = ['sea', 'road', 'rail', 'air'];
export const COUNTRIES: CountryId[] = ['PT', 'TR', 'VN', 'EG', 'IN', 'BD'];

export function isMeasure(value: unknown): value is MeasureId {
  return typeof value === 'string' && (MEASURES as string[]).includes(value);
}

export function isStage(value: unknown): value is StageId {
  return typeof value === 'string' && (STAGES as string[]).includes(value);
}

export function isMode(value: unknown): value is ModeId {
  return typeof value === 'string' && (MODES as string[]).includes(value);
}

export function isCountry(value: unknown): value is CountryId {
  return typeof value === 'string' && (COUNTRIES as string[]).includes(value);
}

/** The twelve material ids and names the app holds for the `Add material` search. */
export const MATERIALS: { id: string; name: string }[] = [
  { id: 'organic-cotton', name: 'Organic cotton' },
  { id: 'cotton', name: 'Cotton' },
  { id: 'recycled-cotton', name: 'Recycled cotton' },
  { id: 'linen', name: 'Linen' },
  { id: 'wool', name: 'Wool' },
  { id: 'recycled-wool', name: 'Recycled wool' },
  { id: 'polyester', name: 'Polyester' },
  { id: 'recycled-polyester', name: 'Recycled polyester' },
  { id: 'viscose', name: 'Viscose' },
  { id: 'lyocell', name: 'Lyocell' },
  { id: 'nylon', name: 'Nylon' },
  { id: 'elastane', name: 'Elastane' },
];

const MATERIAL_NAMES = new Map(MATERIALS.map((material) => [material.id, material.name]));

export function materialName(id: string): string {
  return MATERIAL_NAMES.get(id) ?? id;
}

export function isMaterial(value: unknown): value is string {
  return typeof value === 'string' && MATERIAL_NAMES.has(value);
}

/** The unit a popover line prints after the measure's own unit. */
export function rowUnit(measure: MeasureId, kind: RowKind): string {
  const base = MEASURE_UNITS[measure];
  if (kind === 'material' || kind === 'endOfLife') return `${base} per kg`;
  if (kind === 'grid') return `${base} per MJ`;
  if (kind === 'mode') return `${base} per tonne-km`;
  return `${base} per wash`;
}
