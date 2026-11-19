// What the three renderers write: one name, the sent filters and one block per sheet.
import type { Rect } from '../../shared/chart/types.ts';
import type { Filter, ParameterValue, QueryResult, SheetShape } from '../../shared/model.ts';

export interface SheetBlock {
  name: string;
  sheet: SheetShape;
  result: QueryResult;
  /** The sheet's place on the dashboard stage, or null when the sheet is the whole export. */
  frame: Rect | null;
}

export interface ExportDocument {
  name: string;
  /** A dashboard export holds one block per sheet, named; a sheet export holds one. */
  dashboard: boolean;
  filters: Filter[];
  /** The parameter values the views ran with: the workbook's, overridden by the request's. */
  parameters: Record<string, ParameterValue>;
  blocks: SheetBlock[];
}
