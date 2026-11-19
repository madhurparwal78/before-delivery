export type SeatFacts = {
  offCentreDeg: number;
  stageDistanceM: number;
};

type SectionSpec = {
  code: 'ST' | 'CI' | 'BA';
  name: string;
  rows: string[];
  baseDistanceM: number;
  rowStepM: number;
};

const SECTIONS: SectionSpec[] = [
  { code: 'ST', name: 'Stalls', rows: 'ABCDEFGHIJKLMNOP'.split(''), baseDistanceM: 4.0, rowStepM: 1.15 },
  { code: 'CI', name: 'Circle', rows: 'ABCDEFGH'.split(''), baseDistanceM: 22.0, rowStepM: 0.9 },
  { code: 'BA', name: 'Balcony', rows: 'ABCDEF'.split(''), baseDistanceM: 31.0, rowStepM: 1.0 },
];

export const SECTION_ORDER: Array<'ST' | 'CI' | 'BA'> = ['ST', 'CI', 'BA'];

export function sectionName(code: 'ST' | 'CI' | 'BA'): string {
  const spec = SECTIONS.find((s) => s.code === code);
  if (!spec) throw new Error(`unknown section ${code}`);
  return spec.name;
}

export function sectionRows(code: 'ST' | 'CI' | 'BA'): string[] {
  return SECTIONS.find((s) => s.code === code)!.rows;
}

export function isSeatId(id: string): boolean {
  return /^(ST|CI|BA)-[A-P]-([1-9]|[12][0-9]|30)$/.test(id);
}

export function isRowId(id: string): boolean {
  return /^(ST|CI|BA)-[A-P]$/.test(id);
}

export function seatLabel(id: string): string {
  const parts = id.split('-');
  const section = sectionName(parts[0] as 'ST' | 'CI' | 'BA');
  return `${section} row ${parts[1]} seat ${parts[2]}`;
}



export function seatFacts(id: string): SeatFacts {
  const parts = id.split('-');
  const spec = SECTIONS.find((s) => s.code === parts[0]);
  if (!spec) throw new Error(`unknown seat ${id}`);
  const rowIndex = spec.rows.indexOf(parts[1]);
  const seatNumber = Number(parts[2]);
  const distance = Math.round((spec.baseDistanceM + rowIndex * spec.rowStepM) * 10) / 10;
  const angle = angleFor(seatNumber);
  return { offCentreDeg: angle, stageDistanceM: Math.min(distance, 38.0) };
}

function angleFor(seatNumber: number): number {
  const centre = 15.5;
  const scale = 90 / 14.5;
  const raw = (seatNumber - centre) * scale;
  return Math.round(raw);
}

export function allSeatIds(): string[] {
  const ids: string[] = [];
  for (const section of SECTIONS) {
    for (const row of section.rows) {
      for (let seat = 1; seat <= 30; seat += 1) {
        ids.push(`${section.code}-${row}-${seat}`);
      }
    }
  }
  return ids;
}

export function seatOrder(id: string): number {
  const parts = id.split('-');
  const sectionIndex = SECTION_ORDER.indexOf(parts[0] as 'ST' | 'CI' | 'BA');
  const rowIndex = sectionRows(parts[0] as 'ST' | 'CI' | 'BA').indexOf(parts[1]);
  return sectionIndex * 10000 + rowIndex * 100 + Number(parts[2]);
}

export function compareSeatIds(a: string, b: string): number {
  return seatOrder(a) - seatOrder(b);
}

export function rowIdOf(seatId: string): string {
  const parts = seatId.split('-');
  return `${parts[0]}-${parts[1]}`;
}



export function seatIdsForRow(rowId: string): string[] {
  return Array.from({ length: 30 }, (_, i) => `${rowId}-${i + 1}`);
}
