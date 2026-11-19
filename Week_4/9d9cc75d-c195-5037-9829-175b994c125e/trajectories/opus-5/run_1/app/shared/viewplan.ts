import {
  automaticChart,
  chartRefusal,
  isMeasurePill,
  measureCaption,
  type DrawnChart,
  type ShelfClass,
  type ViewShape,
} from './chart.js';
import type {
  DateLevel,
  DimensionPill,
  FieldKind,
  FieldType,
  MeasurePill,
  Pill,
  SheetSpec,
} from './types.js';

export interface FieldInfo {
  name: string;
  type: FieldType;
  kind: FieldKind;
  continuous: boolean;
}

export type DimShelf = 'rows' | 'columns' | 'detail' | 'color';

export interface PlanDim {
  field: string;
  level: DateLevel | null;
  shelf: DimShelf;
  index: number;
  caption: string;
}

export interface PlanMeasure {
  pill: MeasurePill;
  shelf: string;
  caption: string;
  isShare: boolean;
}

export interface ViewPlan {
  dims: PlanDim[];
  measures: PlanMeasure[];
  primary: number;
  shape: ViewShape;
  chart: DrawnChart;
  refusal: string | null;
  sortOrder: number[];
}

export function normalizeDim(pill: DimensionPill): { field: string; level: DateLevel | null } {
  return typeof pill === 'string' ? { field: pill, level: null } : { field: pill.field, level: pill.level };
}

function classify(pills: Pill[], fields: (name: string) => FieldInfo | undefined): ShelfClass {
  if (pills.length === 0) return 'empty';
  if (pills.some(isMeasurePill)) return 'M';
  for (const p of pills) {
    const f = fields(normalizeDim(p as DimensionPill).field);
    if (f !== undefined && f.type === 'date' && f.continuous) return 'T';
  }
  return 'D';
}

function secondMeasure(pills: Pill[]): string | null {
  const measures = pills.filter(isMeasurePill);
  return measures.length > 1 ? measures[1].field : null;
}

/** The axis measure: the Color measure on a heat map, else the Rows measure, else the Columns measure. */
export function pickPrimary(measures: PlanMeasure[], chart: DrawnChart): number {
  if (measures.length === 0) return -1;
  const find = (shelf: string): number => measures.findIndex((m) => m.shelf === shelf);
  if (chart === 'heat_map' && find('color') >= 0) return find('color');
  if (find('rows') >= 0) return find('rows');
  if (find('columns') >= 0) return find('columns');
  return 0;
}

export function viewPlan(sheet: SheetSpec, fields: (name: string) => FieldInfo | undefined): ViewPlan {
  const pillsFor = (shelf: string): Pill[] => {
    switch (shelf) {
      case 'rows':
        return sheet.rows;
      case 'columns':
        return sheet.columns;
      case 'detail':
        return sheet.detail;
      case 'color':
        return sheet.color === null ? [] : [sheet.color];
      case 'size':
        return sheet.size === null ? [] : [sheet.size];
      default:
        return sheet.label;
    }
  };

  const dims: PlanDim[] = [];
  for (const shelf of ['rows', 'columns', 'detail', 'color'] as DimShelf[]) {
    pillsFor(shelf)
      .filter((p) => !isMeasurePill(p))
      .forEach((p, index) => {
        const { field, level } = normalizeDim(p as DimensionPill);
        const info = fields(field);
        dims.push({
          field,
          level: info?.type === 'date' ? level ?? 'month' : null,
          shelf,
          index,
          caption: field,
        });
      });
  }

  const measures: PlanMeasure[] = [];
  for (const shelf of ['rows', 'columns', 'color', 'size', 'label', 'detail']) {
    pillsFor(shelf)
      .filter(isMeasurePill)
      .forEach((pill) => {
        measures.push({
          pill,
          shelf,
          caption: measureCaption(pill),
          isShare: pill.table_calc !== null && pill.table_calc.kind === 'share',
        });
      });
  }

  const shape: ViewShape = {
    rows: classify(sheet.rows, fields),
    columns: classify(sheet.columns, fields),
    colorIsMeasure: sheet.color !== null && isMeasurePill(sheet.color),
    colorPresent: sheet.color !== null,
    sizePresent: sheet.size !== null,
    sizeIsMeasure: sheet.size !== null && isMeasurePill(sheet.size),
    rowMeasures: sheet.rows.filter(isMeasurePill).length,
    columnMeasures: sheet.columns.filter(isMeasurePill).length,
    secondAxisMeasure: secondMeasure(sheet.rows) ?? secondMeasure(sheet.columns),
  };

  const refusal = chartRefusal(sheet.chart, shape);
  const chart: DrawnChart = sheet.chart === 'automatic' ? automaticChart(shape) : (sheet.chart as DrawnChart);

  const primary = pickPrimary(measures, chart);

  const priority: Record<DimShelf, number> = { rows: 0, columns: 1, color: 2, detail: 3 };
  const sortOrder = dims
    .map((d, i) => ({ d, i }))
    .sort((a, b) => {
      const pa = priority[a.d.shelf];
      const pb = priority[b.d.shelf];
      return pa !== pb ? pa - pb : a.d.index - b.d.index;
    })
    .map((e) => e.i);

  return { dims, measures, primary, shape, chart, refusal, sortOrder };
}
