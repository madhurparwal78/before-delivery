// Turns an export job into its file: runs the target's sheets for the requesting user, with the sent filters and
// parameters and without any hidden field, then writes the document in the job's format.
import type { ParameterDef, ParameterValue, Pill, QueryRequest, SheetShape } from '../../shared/model.ts';
import type { Rect } from '../../shared/chart/types.ts';
import { runQuery } from '../engine/index.ts';
import type { App, AuthUser } from '../http/app.ts';
import { queryInput } from '../sheets/query.ts';
import { sheetScope } from '../sheets/scope.ts';
import { pillField } from '../sheets/shape.ts';
import type { SheetAccess } from '../sheets/store.ts';
import { renderCsv } from './csv.ts';
import type { ExportDocument, SheetBlock } from './document.ts';
import type { JobRow } from './jobs.ts';
import { renderPdf } from './pdf.ts';
import { renderPng } from './png.ts';

/** The sheet without the pills that use a hidden field. */
function withoutHidden(sheet: SheetShape, hidden: ReadonlySet<string>): SheetShape {
  const shown = (pill: Pill): boolean => !hidden.has(pillField(pill));
  return {
    ...sheet,
    rows: sheet.rows.filter(shown),
    columns: sheet.columns.filter(shown),
    color: sheet.color && shown(sheet.color) ? sheet.color : null,
    size: sheet.size && shown(sheet.size) ? sheet.size : null,
    label: sheet.label.filter(shown),
    detail: sheet.detail.filter(shown),
  };
}

export interface RanSheet {
  block: SheetBlock;
  hidden: ReadonlySet<string>;
  /** the workbook's parameters with the request's values laid over them */
  parameters: Record<string, ParameterValue>;
}

const valuesOf = (defs: readonly ParameterDef[]): Record<string, ParameterValue> =>
  Object.fromEntries(defs.map((def) => [def.name, def.value]));

/** One sheet for `user`: their rows, the request's filters and parameters, no hidden field. A refused view cannot be exported. */
export async function runSheetBlock(app: App, user: AuthUser, access: SheetAccess, request: QueryRequest, frame: Rect | null): Promise<RanSheet> {
  const loaded = await sheetScope(app, access.workbook, access.sheet);
  const hidden = new Set(loaded.dataset.fields.filter((field) => field.hidden).map((field) => field.name));
  const sheet = withoutHidden(loaded.shape, hidden);
  const outcome = await runQuery(queryInput(app, user, loaded, sheet, request));
  if (!outcome.ok) throw new Error(outcome.message);
  return {
    block: { name: sheet.name, sheet, result: { gen: 0, ...outcome.result }, frame },
    hidden,
    parameters: { ...valuesOf(loaded.parameters), ...request.parameters },
  };
}

export async function renderFile(document: ExportDocument, kind: JobRow['kind'], fontDir: string): Promise<Buffer> {
  if (kind === 'csv') return renderCsv(document);
  return kind === 'pdf' ? renderPdf(document, fontDir) : renderPng(document, fontDir);
}
