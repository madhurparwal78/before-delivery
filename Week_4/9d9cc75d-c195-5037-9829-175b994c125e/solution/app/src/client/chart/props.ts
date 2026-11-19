// The chart package's public props, fixed by the lead so the sheet page, the dashboard page and the home page can be written
// in parallel with the chart. The chart author implements them in `client/chart/` and may add optional props.
import type { Cell, QueryResult, SheetShape } from '../../shared/model.ts';

/** What a selection reports: one mark of the view. */
export interface MarkInfo {
  /** `data-mark` */
  id: string;
  index: number;
  /** the dimension values as displayed, in the view's dimension order (`QueryResult.columns` with role dimension) */
  dims: string[];
  /** the dimension names, same order as `dims` */
  dimensions: string[];
  /** the raw dimension values */
  values: Cell[];
  /** the tooltip text, `Region: East; Sales: 435` */
  tooltip: string;
}

export interface ChartViewProps {
  /** the sheet's name: the SVG's accessible name and the data table's `{name} table` */
  sheetName: string;
  sheet: SheetShape;
  /** the last good result; the page keeps it while a refusal shows */
  result: QueryResult;
  /** below 768 px: bars at least 44 thick, 44 x 44 tap areas, tapping a mark selects it and calls `onTap` */
  touch: boolean;
  /** the dashboard stage and phones: tighter margins and no axis titles */
  compact?: boolean;
  /** a requested height in px (a dashboard object); omitted, the chart chooses the height its marks need */
  height?: number;
  /** marks drawn dimmed by a highlight action (`data-dim="true"`), by `data-mark` id; null for none */
  dimmed?: ReadonlySet<string> | null;
  /** Enter, click or tap on a mark; Escape or a click on empty plot space reports null. The chart keeps `aria-pressed` itself. */
  onSelect?: (mark: MarkInfo | null) => void;
  /** a tap on a phone, after `onSelect`: the page opens `dialog "Mark details"` (see `MarkDetails`) */
  onTap?: (mark: MarkInfo) => void;
}

export interface DataTableProps {
  sheetName: string;
  result: QueryResult;
  /** `data-mark` ids whose twin rows carry `data-highlight="true"`; null for none */
  highlighted?: ReadonlySet<string> | null;
}

export interface MarkDetailsProps {
  /** the tapped mark; the sheet opens while this is non-null */
  mark: MarkInfo | null;
  /** closing returns focus to the mark that was tapped */
  onClose: () => void;
}
