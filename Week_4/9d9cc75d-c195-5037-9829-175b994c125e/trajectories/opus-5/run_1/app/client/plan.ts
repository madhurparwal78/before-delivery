import type { DrawnChart } from '../shared/chart.js';
import type { SheetSpec, SourceField } from '../shared/types.js';
import { type FieldInfo, pickPrimary, type PlanDim, type PlanMeasure, viewPlan } from '../shared/viewplan.js';

export interface ChartPlanFull {
  dims: PlanDim[];
  measures: PlanMeasure[];
  primary: number;
  chart: DrawnChart;
  refusal: string | null;
}

export function fieldInfos(fields: SourceField[] | null): FieldInfo[] {
  return (fields ?? []).map((f) => ({ name: f.name, type: f.type, kind: f.kind, continuous: f.continuous }));
}

/** The view plan as the server computed it: the drawn chart comes back with the query answer. */
export function planFor(spec: SheetSpec, fields: FieldInfo[], chart: DrawnChart | null): ChartPlanFull {
  const plan = viewPlan(spec, (name) => fields.find((f) => f.name === name));
  const drawn = chart ?? plan.chart;
  return {
    dims: plan.dims,
    measures: plan.measures,
    primary: pickPrimary(plan.measures, drawn),
    chart: drawn,
    refusal: plan.refusal,
  };
}
