import { CALC_WORDS } from './chart.js';
import { displayNumber, displayShare, displayValue } from './display.js';
import type { QueryResult } from './types.js';

export interface TwinModel {
  header: string[];
  rows: { cells: string[]; values: (string | number | boolean | null)[] }[];
  extra: { label: string; cells: string[] }[];
}

export function isShareColumn(name: string): boolean {
  return name.startsWith(`${CALC_WORDS.share} of `);
}

export function cellText(value: string | number | boolean | null, isShare: boolean): string {
  if (typeof value === 'string' && value === 'n/a') return 'n/a';
  if (typeof value === 'number') return isShare ? displayShare(value) : displayNumber(value);
  return displayValue(value);
}

export function trendText(slope: number, intercept: number): string {
  const sign = intercept < 0 ? '-' : '+';
  return `y = ${displayNumber(slope)}x ${sign} ${displayNumber(Math.abs(intercept))}`;
}

export function twinModel(result: QueryResult, primaryMeasure: number): TwinModel {
  const dimensionCount = result.columns.filter((c) => c.role === 'dimension').length;
  const shares = result.columns.map((c) => c.role === 'measure' && isShareColumn(c.name));
  const header = result.columns.map((c) => c.name);
  const rows = result.rows.map((row) => ({
    values: row,
    cells: row.map((v, i) => cellText(v, shares[i])),
  }));
  const extra: { label: string; cells: string[] }[] = [];
  if (result.total !== null) {
    extra.push({
      label: 'Grand total',
      cells: [
        ...result.columns.slice(1, dimensionCount).map(() => ''),
        ...result.columns.slice(dimensionCount).map((_, i) => {
          const v = result.total === null ? null : result.total[dimensionCount + i];
          return v === 'n/a' ? 'n/a' : cellText(v as string | number | boolean | null, shares[dimensionCount + i]);
        }),
      ],
    });
  }
  for (const line of result.reference_lines) {
    const cells = [
      ...result.columns.slice(1, dimensionCount).map(() => ''),
      ...result.columns.slice(dimensionCount).map((_, i) =>
        i === primaryMeasure && line.value !== null ? displayNumber(line.value) : '',
      ),
    ];
    extra.push({ label: line.type, cells });
  }
  if (result.trend !== null) {
    const cells = [
      ...result.columns.slice(1, dimensionCount).map(() => ''),
      ...result.columns.slice(dimensionCount).map((_, i) =>
        i === Math.max(primaryMeasure, 0) ? trendText(result.trend!.slope, result.trend!.intercept) : '',
      ),
    ];
    extra.push({ label: 'Trend', cells });
  }
  return { header, rows, extra };
}
