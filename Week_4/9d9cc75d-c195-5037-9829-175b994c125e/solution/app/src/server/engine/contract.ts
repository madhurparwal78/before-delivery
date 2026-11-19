// The engine's contract with the server. The engine is pure TypeScript: no database, HTTP or storage. The server loads
// a source's snapshot rows into a `SourceModel` (`sources/model.ts`), builds a `Dataset` once per snapshot
// (`buildDataset` caches it), and passes it with the sheet, its calculations, the workbook's parameters and sets.
//
// Names: pills, filters, sets, security and formulas all name fields by their current names. Calculations are stored
// with ids (`toStoredFormula`) and shown with current names (`toDisplayFormula`), so a rename carries into formulas.
import type {
  CalculationDef,
  Cell,
  ParameterDef,
  QueryRequest,
  QueryResult,
  SetDef,
  SheetShape,
  FieldKind,
  ValueType,
} from '../../shared/model.ts';

export interface DatasetField {
  id: string;
  name: string;
  type: ValueType;
  kind: FieldKind;
  continuous: boolean;
  hidden: boolean;
  /** one value per joined row */
  values: Cell[];
  /** the sort key per row when it differs from the value (a bin sorts by its start), else null */
  order: Cell[] | null;
  /** for a right-table field: the right row joined to each row, -1 when unmatched; else null */
  rightRows: Int32Array | null;
}

/** The joined rows of a source, column by column. Build it with `buildDataset`. */
export interface Dataset {
  /** the source's row count: the first (left) table's rows */
  rowCount: number;
  fields: DatasetField[];
  byName: ReadonlyMap<string, DatasetField>;
}

/** Everything a sheet's formulas and pills may name. `calculations` are the sheet's, with display formulas. */
export interface SheetScope {
  dataset: Dataset;
  calculations: CalculationDef[];
  parameters: ParameterDef[];
  sets: SetDef[];
}

/** Property names match `Config`, so the server can pass its config object. */
export interface FormulaLimits {
  formulaMaxChars: number;
  formulaMaxDepth: number;
}

export interface QueryLimits extends FormulaLimits {
  markMax: number;
  queryWorkMax: number;
  queryBudgetMs: number;
}

/**
 * Row-level security for the requesting user: `field` is the security field's name and `allowed` the user's values
 * (`[]` when the user has no entry, which shows no rows). A null security value is shown to nobody. Pass `null` when
 * the source is not secured.
 */
export interface Security {
  field: string;
  allowed: Cell[];
}

export interface QueryInput extends SheetScope {
  sheet: SheetShape;
  /** request filters add to the sheet's; parameter values and set members override the workbook's */
  request: QueryRequest;
  security: Security | null;
  limits: QueryLimits;
}

/** A refused view is `ok: false` with the View notice copy: the route answers 422 `view_refused` with `message`. */
export type QueryOutcome = { ok: true; result: Omit<QueryResult, 'gen'> } | { ok: false; message: string };

/** A calculation about to be saved; `id` is null for a new one. */
export interface CalculationDraft {
  id: string | null;
  name: string;
  formula: string;
}

/** Field errors for a calculation save (422 `errors`); empty when the save may go ahead. */
export interface CalculationErrors {
  name?: string;
  formula?: string;
}
