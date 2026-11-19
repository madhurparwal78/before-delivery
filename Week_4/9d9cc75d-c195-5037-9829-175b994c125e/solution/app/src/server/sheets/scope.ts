// Everything a sheet's pills and formulas may name, loaded for one request: the source's dataset at its current
// snapshot, the workbook's parameters and sets, and the sheet's calculations with display formulas.
import type { ParameterDef, ParameterType, ParameterValue, SetDef, SheetShape } from '../../shared/model.ts';
import type { Queryable } from '../db/database.ts';
import type { Dataset, SheetScope } from '../engine/contract.ts';
import { buildDataset, toDisplayFormula } from '../engine/index.ts';
import type { App } from '../http/app.ts';
import { loadSourceModel } from '../sources/load.ts';
import type { SourceModel } from '../sources/model.ts';
import type { WorkbookRow } from '../workbooks/store.ts';
import { mapSet, mapShape, refMaps } from './refs.ts';
import type { RefMap } from './refs.ts';
import { calculationsOf } from './store.ts';
import type { CalculationRow, SheetRow } from './store.ts';

export interface Maps {
  stored: RefMap;
  display: RefMap;
}

interface WorkbookScope {
  model: SourceModel;
  dataset: Dataset;
  parameters: ParameterDef[];
  /** with field names */
  sets: SetDef[];
  /** fields and sets; parameters */
  maps: Maps;
}

export interface LoadedSheet extends WorkbookScope {
  scope: SheetScope;
  /** fields, calculations and sets; parameters */
  maps: Maps;
  /** the sheet shape with current names */
  shape: SheetShape;
}

interface ParameterRow {
  id: string;
  name: string;
  type: ParameterType;
  value: ParameterValue;
  values: string[];
}

interface SetRow {
  id: string;
  name: string;
  field: string;
  members: SetDef['members'] | null;
  top: SetDef['top'] | null;
}

function parametersOf(q: Queryable, workbookId: string): Promise<ParameterDef[]> {
  return q.rows<ParameterRow>(
    `SELECT id, name, type, value, "values" FROM parameters WHERE workbook_id = $1 ORDER BY seq`,
    [workbookId],
  );
}

/** Sets as stored (field references by id). */
async function storedSetsOf(q: Queryable, workbookId: string): Promise<SetDef[]> {
  const rows = await q.rows<SetRow>(`SELECT id, name, field, members, top FROM sets WHERE workbook_id = $1 ORDER BY seq`, [
    workbookId,
  ]);
  return rows.map((row) => {
    const set: SetDef = { id: row.id, name: row.name, field: row.field };
    if (row.members !== null) set.members = row.members;
    if (row.top !== null) set.top = row.top;
    return set;
  });
}

export async function workbookScope(app: App, workbook: WorkbookRow): Promise<WorkbookScope> {
  const model = await loadSourceModel(app, workbook.source_id);
  const dataset = buildDataset(model);
  const [parameters, storedSets] = await Promise.all([
    parametersOf(app.db, workbook.id),
    storedSetsOf(app.db, workbook.id),
  ]);
  const maps = refMaps([...dataset.fields, ...storedSets], parameters);
  return { model, dataset, parameters, sets: storedSets.map((s) => mapSet(s, maps.display)), maps };
}

/** The workbook scope plus a sheet's calculations (stored formulas) and its stored shape. */
function withSheet(ws: WorkbookScope, calculations: readonly CalculationRow[], stored: SheetShape): LoadedSheet {
  const maps = refMaps([...ws.dataset.fields, ...calculations, ...ws.sets], ws.parameters);
  const naming: SheetScope = {
    dataset: ws.dataset,
    calculations: calculations.map(({ id, name, formula }) => ({ id, name, formula })),
    parameters: ws.parameters,
    sets: ws.sets,
  };
  const scope: SheetScope = {
    ...naming,
    calculations: naming.calculations.map((c) => ({ ...c, formula: toDisplayFormula(c.formula, naming) })),
  };
  return { ...ws, scope, maps, shape: mapShape(stored, maps.display) };
}

export async function sheetScope(app: App, workbook: WorkbookRow, sheet: SheetRow): Promise<LoadedSheet> {
  const [ws, calculations] = await Promise.all([workbookScope(app, workbook), calculationsOf(app.db, sheet.id)]);
  return withSheet(ws, calculations, sheet.shape);
}
