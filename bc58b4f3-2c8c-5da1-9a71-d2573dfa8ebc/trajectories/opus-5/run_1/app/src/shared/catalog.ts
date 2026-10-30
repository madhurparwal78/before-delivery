/** Seeded reference data the agency works from: languages, client organisations, settings. */

export interface CatalogEntry {
  code: string;
  name: string;
}

export const LANGUAGES: CatalogEntry[] = [
  { code: 'asl', name: 'ASL' },
  { code: 'es', name: 'Spanish' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'so', name: 'Somali' },
  { code: 'ar', name: 'Arabic' },
];

export const ORGANISATIONS: CatalogEntry[] = [
  { code: 'RVH', name: 'Riverbend Valley Hospital' },
  { code: 'CPSD', name: 'Cedar Prairie School District' },
  { code: 'LFC', name: 'Lakeview Family Clinic' },
];

export const SETTINGS: CatalogEntry[] = [
  { code: 'hospital', name: 'Hospital' },
  { code: 'clinic', name: 'Clinic' },
  { code: 'school', name: 'School district' },
];

export function nameOf(entries: readonly CatalogEntry[], code: string): string {
  return entries.find((entry) => entry.code === code)?.name ?? code;
}
