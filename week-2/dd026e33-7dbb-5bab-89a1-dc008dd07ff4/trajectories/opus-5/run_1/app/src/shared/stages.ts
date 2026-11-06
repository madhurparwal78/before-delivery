/** The paint stages, in their published order. */
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

export function isStageName(value: string): value is StageName {
  return (STAGE_NAMES as readonly string[]).includes(value);
}

/** Position of a stage in the published order, counting from zero. */
export function stageOrder(name: StageName): number {
  return STAGE_NAMES.indexOf(name);
}

export const INTAKE_STAGE: StageName = 'Intake';
