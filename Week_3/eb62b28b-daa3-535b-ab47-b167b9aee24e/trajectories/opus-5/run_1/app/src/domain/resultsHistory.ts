import { MARKERS_BY_ID } from '../shared/catalog';
import { flagLabel } from '../shared/copy';
import { TimeZoneId, localDate } from '../shared/time';

export interface HistoryResult {
  marker: string;
  collectedAt: string;
  value: string;
  flag: string;
  range: { low: string; high: string; optimalLow: string; optimalHigh: string };
  note: string | null;
}

const HEADER = [
  'Collected date',
  'Marker',
  'Value',
  'Unit',
  'Flag',
  'Range in force',
  'Specialist note',
];

const FORMULA_STARTS = ['=', '+', '-', '@', '\t', '\r'];

function cell(value: string): string {
  const guarded = FORMULA_STARTS.some((start) => value.startsWith(start)) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function rangeInForceText(range: HistoryResult['range']): string {
  return `${range.low}–${range.high} (optimal ${range.optimalLow}–${range.optimalHigh})`;
}

/** The member's results history file, oldest draw first then catalog order. */
export function resultsHistoryCsv(results: HistoryResult[], zone: TimeZoneId): string {
  const lines = [HEADER.map(cell).join(',')];
  for (const result of results) {
    const marker = MARKERS_BY_ID.get(result.marker);
    if (!marker) continue;
    lines.push(
      [
        localDate(new Date(result.collectedAt), zone),
        marker.name,
        result.value,
        marker.unit,
        flagLabel[result.flag] ?? result.flag,
        rangeInForceText(result.range),
        result.note ?? '',
      ]
        .map(cell)
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}
