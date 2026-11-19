// The data table twin: one model that the browser grid, the PDF and the crosstab CSV all write.
import { dataValue, formatCell, formatNumber } from './display.ts';
import type { Cell, MeasurePill, Pill, QueryResult } from './model.ts';

export interface TwinCell {
  /** `data-value`: the raw value rounded to 4 decimals, empty for null */
  value: string;
  /** the display text */
  text: string;
}

export type TwinRowKind = 'mark' | 'total' | 'reference' | 'trend';

export interface TwinRow {
  kind: TwinRowKind;
  /** one rowheader per dimension; for a total, reference or trend row the first holds its label and the rest are empty */
  heads: string[];
  cells: TwinCell[];
  /** index into `QueryResult.rows` for a mark row */
  mark: number | null;
}

export interface Twin {
  dimensions: string[];
  measures: string[];
  rows: TwinRow[];
}

const REFERENCE_LABEL = { average: 'Average', median: 'Median', constant: 'Constant' } as const;

export function isMeasurePill(pill: Pill): pill is MeasurePill {
  return typeof pill === 'object' && 'agg' in pill;
}

/** `thousands: false` is the crosstab CSV, which writes display numbers without separators. */
export function buildTwin(result: QueryResult, options: { thousands?: boolean } = {}): Twin {
  const thousands = options.thousands ?? true;
  const dimensions = result.columns.filter((c) => c.role === 'dimension').map((c) => c.name);
  const measures = result.columns.filter((c) => c.role === 'measure').map((c) => c.name);
  const shares = new Set(result.columns.filter((c) => c.share).map((c) => c.name));
  const dimCount = dimensions.length;
  const cellFor = (value: Cell | 'n/a', caption: string): TwinCell => ({
    value: value === 'n/a' ? '' : dataValue(value),
    text: value === 'n/a' ? 'n/a' : formatCell(value, { share: shares.has(caption), thousands }),
  });
  const rows: TwinRow[] = result.rows.map((row, index) => ({
    kind: 'mark',
    heads: row.slice(0, dimCount).map((v) => formatCell(v, { thousands })),
    cells: row.slice(dimCount).map((v, i) => cellFor(v, measures[i] ?? '')),
    mark: index,
  }));
  const blanks = (label: string): string[] => [label, ...Array.from({ length: Math.max(0, dimCount - 1) }, () => '')];
  if (result.total) {
    rows.push({
      kind: 'total',
      heads: blanks('Grand total'),
      cells: result.total.slice(dimCount).map((v, i) => cellFor(v, measures[i] ?? '')),
      mark: null,
    });
  }
  for (const line of result.reference_lines) {
    const cells = measures.map((caption, i) => (i === 0 ? cellFor(line.value, caption) : { value: '', text: '' }));
    rows.push({ kind: 'reference', heads: blanks(REFERENCE_LABEL[line.type]), cells, mark: null });
  }
  if (result.trend) {
    const { slope, intercept } = result.trend;
    const sign = intercept < 0 ? '-' : '+';
    const text = `y = ${formatNumber(slope, thousands)}x ${sign} ${formatNumber(Math.abs(intercept), thousands)}`;
    const cells = measures.map((_, i) => (i === 0 ? { value: '', text } : { value: '', text: '' }));
    rows.push({ kind: 'trend', heads: blanks('Trend'), cells, mark: null });
  }
  return { dimensions, measures, rows };
}
