import { q, q1 } from '../db.js';
import type { FilterSpec, ParameterDoc, QueryResult, SetDoc, SheetSpec } from '../../shared/types.js';
import { loadSource, type LoadedSource } from './source.js';
import { runQuery, type QueryInput, type QueryOutput } from './query.js';
import type { SessionUser } from '../http.js';

export interface SheetRecord {
  id: string;
  workbook_id: string;
  name: string;
  spec: SheetSpec;
  version: number;
  owner_id: string | null;
  copy_of: string | null;
}

export interface WorkbookRecord {
  id: string;
  project_id: string;
  source_id: string;
  name: string;
  state: 'draft' | 'published';
  version: number;
  certified_by: string | null;
}

export interface SheetBundle {
  sheet: SheetRecord;
  workbook: WorkbookRecord;
  calcs: { id: string; name: string; formula: string }[];
  parameters: ParameterDoc[];
  sets: SetDoc[];
  source: LoadedSource;
}

export async function loadSheetRecord(sheetId: string): Promise<SheetRecord | null> {
  return q1<SheetRecord>(
    'SELECT id, workbook_id, name, spec, version, owner_id, copy_of FROM sheets WHERE id = $1',
    [sheetId],
  );
}

export async function loadWorkbookRecord(workbookId: string): Promise<WorkbookRecord | null> {
  return q1<WorkbookRecord>(
    'SELECT id, project_id, source_id, name, state, version, certified_by FROM workbooks WHERE id = $1',
    [workbookId],
  );
}

export async function loadParameters(workbookId: string): Promise<ParameterDoc[]> {
  const rows = await q<{ id: string; name: string; type: ParameterDoc['type']; value: unknown; values_list: string[] }>(
    'SELECT id, name, type, value, values_list FROM parameters WHERE workbook_id = $1 ORDER BY ord',
    [workbookId],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, type: r.type, value: r.value, values: r.values_list }));
}

export async function loadSets(workbookId: string): Promise<SetDoc[]> {
  const rows = await q<{ id: string; name: string; field: string; members: unknown[] | null; top: SetDoc['top'] }>(
    'SELECT id, name, field, members, top FROM sets WHERE workbook_id = $1 ORDER BY ord',
    [workbookId],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, field: r.field, members: r.members, top: r.top }));
}

export async function loadSheetBundle(sheetId: string): Promise<SheetBundle | null> {
  const sheet = await loadSheetRecord(sheetId);
  if (sheet === null) return null;
  const workbook = await loadWorkbookRecord(sheet.workbook_id);
  if (workbook === null) return null;
  const source = await loadSource(workbook.source_id);
  if (source === null) return null;
  const calcs = await q<{ id: string; name: string; formula: string }>(
    'SELECT id, name, formula FROM calculations WHERE sheet_id = $1 ORDER BY ord',
    [sheetId],
  );
  return {
    sheet,
    workbook,
    calcs,
    parameters: await loadParameters(sheet.workbook_id),
    sets: await loadSets(sheet.workbook_id),
    source,
  };
}

export interface QueryRequestBody {
  filters: FilterSpec[];
  parameters: Record<string, unknown>;
  sets: Record<string, unknown[]>;
  highlight?: { field: string; values: unknown[] } | null;
}

export function queryInputFor(bundle: SheetBundle, user: SessionUser | null, body: QueryRequestBody): QueryInput {
  return {
    source: bundle.source,
    sheet: bundle.sheet.spec,
    calcs: bundle.calcs.map((c) => ({ name: c.name, formula: c.formula })),
    parameters: bundle.parameters,
    paramOverrides: body.parameters,
    sets: bundle.sets,
    setOverrides: body.sets,
    username: user === null ? null : user.username,
    extraFilters: body.filters,
    highlight: body.highlight ?? null,
  };
}

export function toQueryResult(output: QueryOutput, gen: number): QueryResult {
  return {
    gen,
    chart: output.chart,
    columns: [
      ...output.dims.map((d) => ({ name: d.caption, role: 'dimension' as const })),
      ...output.measures.map((m) => ({ name: m.caption, role: 'measure' as const })),
    ],
    rows: output.marks.map((mark) => [...mark.dims, ...mark.measures] as (string | number | boolean | null)[]),
    total: output.total as (string | number | null)[] | null,
    reference_lines: output.referenceLines,
    trend: output.trend,
    notices: output.notices,
  };
}

export function runSheetQuery(
  bundle: SheetBundle,
  user: SessionUser | null,
  body: QueryRequestBody,
): QueryOutput {
  return runQuery(queryInputFor(bundle, user, body));
}
