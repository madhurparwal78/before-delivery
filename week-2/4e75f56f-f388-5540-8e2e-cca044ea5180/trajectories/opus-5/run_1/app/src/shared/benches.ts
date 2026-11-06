export type Tier = 'bench' | 'atelier';

export const SEATS_TOTAL = 24;
export const ATELIER_CAP = 10;

export const BENCH_ROWS = ['A', 'B', 'C', 'D'] as const;
export const BENCH_NUMBERS = [1, 2, 3, 4, 5, 6] as const;

export const BENCH_LABELS: readonly string[] = BENCH_ROWS.flatMap((row) =>
  BENCH_NUMBERS.map((number) => `${row}${number}`),
);

const labelSet = new Set(BENCH_LABELS);

export function isBenchLabel(value: unknown): value is string {
  return typeof value === 'string' && labelSet.has(value);
}

export function benchRow(label: string): string {
  return label.slice(0, 1);
}

export function benchNumber(label: string): number {
  return Number.parseInt(label.slice(1), 10);
}

export function tierOfBench(label: string): Tier {
  const row = benchRow(label);
  return row === 'A' || row === 'B' ? 'atelier' : 'bench';
}

export function tierName(tier: Tier): string {
  return tier === 'atelier' ? 'Atelier' : 'Bench';
}
