import type { Chair, SectionKey, StringCount } from '../../shared/api.js';
import { pad2 } from '../../shared/london.js';

export interface StringSection {
  chairKey: string;
  countKey: SectionKey;
  name: string;
}

export const STRING_SECTIONS: readonly StringSection[] = [
  { chairKey: 'vn1', countKey: 'violin_1', name: 'Violin I' },
  { chairKey: 'vn2', countKey: 'violin_2', name: 'Violin II' },
  { chairKey: 'va', countKey: 'viola', name: 'Viola' },
  { chairKey: 'vc', countKey: 'cello', name: 'Cello' },
  { chairKey: 'cb', countKey: 'bass', name: 'Bass' },
];

export const SECTION_KEYS: readonly SectionKey[] = STRING_SECTIONS.map((section) => section.countKey);

export function stringSectionByChairKey(chairKey: string): StringSection | null {
  return STRING_SECTIONS.find((section) => section.chairKey === chairKey) ?? null;
}

export function stringSectionByCountKey(countKey: SectionKey): StringSection {
  const section = STRING_SECTIONS.find((candidate) => candidate.countKey === countKey);
  if (!section) throw new Error(`unknown section key: ${countKey}`);
  return section;
}

export function chairLabelFor(chairKey: string, chairNumber: number, partName: string): string {
  const section = stringSectionByChairKey(chairKey);
  return section ? `${section.name} \u00b7 chair ${pad2(chairNumber)}` : partName;
}

export function chairOf(row: {
  chair_key: string | null;
  chair_section: string | null;
  chair_number: number | null;
  chair_label: string | null;
}): Chair | null {
  if (row.chair_key === null || row.chair_section === null || row.chair_number === null || row.chair_label === null) {
    return null;
  }
  return {
    key: row.chair_key,
    section: row.chair_section,
    number: row.chair_number,
    label: row.chair_label,
  };
}

export function sectionCount(stringCount: StringCount, countKey: SectionKey): number {
  return stringCount[countKey];
}
