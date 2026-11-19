// What the sheet page reads from the server and how it turns source fields, calculations and sets into field-list entries.
import { api } from '../../api/client.ts';
import type { CalculationDef, FormulaCheck, SetDef, SheetShape, Source } from '../../../shared/model.ts';
import type { FieldEntry } from './model.ts';

/** `GET /api/sheets/<id>`: the sheet shape with its id, the version its saves send as `If-Match`, and its calculations. */
export interface SheetRecord extends SheetShape {
  id: string;
  version: number;
  /** a personal copy, which only its owner can open */
  copy: boolean;
  calculations: CalculationDef[];
}

/** The sheet shape alone, as `PUT /api/sheets/<id>` takes it. */
export function shapeOf(record: SheetRecord): SheetShape {
  return {
    name: record.name,
    rows: record.rows,
    columns: record.columns,
    color: record.color,
    size: record.size,
    label: record.label,
    detail: record.detail,
    filters: record.filters,
    chart: record.chart,
    totals: record.totals,
    reference_lines: record.reference_lines,
    trend: record.trend,
    sort: record.sort,
  };
}

/** The source's visible fields; a hidden field leaves the field list. */
export function sourceEntries(source: Source): FieldEntry[] {
  return source.fields
    .filter((field) => !field.hidden)
    .map((field) => ({ key: `field:${field.id}`, name: field.name, kind: field.kind, type: field.type, lod: false }));
}

/** A set is a dimension whose members show as In and Out. */
export function setEntry(set: SetDef): FieldEntry {
  return { key: `set:${set.id}`, name: set.name, kind: 'dimension', type: 'text', lod: false };
}

/**
 * A calculation's kind comes from its formula check: an aggregate or a number is a measure, anything else a dimension.
 * A level-of-detail expression (the whole formula in braces) lands on a shelf with AVG.
 */
export async function calculationEntry(sheetId: string, calculation: CalculationDef): Promise<FieldEntry> {
  const check = await api.post<FormulaCheck>('/api/formula/check', { sheet: sheetId, formula: calculation.formula });
  const measure = check.valid && (check.aggregate || check.type === 'number');
  const text = calculation.formula.trim();
  return {
    key: `calc:${calculation.id}`,
    name: calculation.name,
    kind: measure ? 'measure' : 'dimension',
    type: check.valid ? check.type : 'text',
    lod: text.startsWith('{') && text.endsWith('}'),
  };
}
