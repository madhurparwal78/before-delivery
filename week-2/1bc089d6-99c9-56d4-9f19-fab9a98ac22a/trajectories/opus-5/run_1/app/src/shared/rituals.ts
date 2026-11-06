export interface CatalogueRitual {
  readonly id: string;
  readonly title: string;
  readonly defaultMinutes: number;
}

/** The fixed ritual catalogue. Its default minutes add up to exactly 60. */
export const RITUAL_CATALOGUE: readonly CatalogueRitual[] = [
  { id: 'dim-lamps', title: 'Dim the lamps', defaultMinutes: 10 },
  { id: 'warm-shower', title: 'Warm shower', defaultMinutes: 15 },
  { id: 'paper-not-pixels', title: 'Paper, not pixels', defaultMinutes: 15 },
  { id: 'tomorrow-list', title: 'Tomorrow list', defaultMinutes: 5 },
  { id: 'slow-stretch', title: 'Slow stretch', defaultMinutes: 10 },
  { id: 'breathe', title: 'Breathe', defaultMinutes: 5 },
];

export const MAX_HOUR_MINUTES = 60;
export const MIN_RITUAL_MINUTES = 5;
export const MAX_RITUAL_MINUTES = 30;
export const RITUAL_MINUTE_STEP = 5;
export const MAX_NOTE_CHARACTERS = 280;

const byId = new Map(RITUAL_CATALOGUE.map((ritual) => [ritual.id, ritual]));

export function findRitual(id: string): CatalogueRitual | undefined {
  return byId.get(id);
}
