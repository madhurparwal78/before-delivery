// What selecting a mark on a dashboard does: the source sheet's actions run in the published order and their effects
// are collected here, so the page only has to send the queries and draw the result.
import type { ActionType, Cell, DashboardAction, Filter, ParameterDef, ParameterValue, QueryResult, SheetShape } from '../../../shared/model.ts';
import { planView } from '../../../shared/chart/plan.ts';
import type { MarkInfo } from '../../chart/props.ts';

/** The order actions run in; within one type they run alphabetically by name. */
const RUN_ORDER: readonly ActionType[] = ['set_parameter', 'change_set', 'filter', 'highlight'];

export const ACTION_WORDS: Record<ActionType, string> = {
  set_parameter: 'Set parameter',
  change_set: 'Change set',
  filter: 'Filter',
  highlight: 'Highlight',
};

export interface Highlight {
  field: string;
  value: Cell;
}

export interface Selection {
  /** the sheet whose mark was selected */
  source: string;
  /** the mark's dimension values, joined by `, ` */
  member: string;
  /** `{n}. {type}: {name}` per action run */
  log: string[];
  hasFilter: boolean;
  hasHighlight: boolean;
  parameters: Record<string, ParameterValue>;
  /** a change set action makes the mark's member the set's only member */
  sets: Record<string, Cell[]>;
  /** filters to add to the query of each target sheet */
  filters: Record<string, Filter[]>;
  highlights: Record<string, Highlight[]>;
  /** every sheet an action targets, once, in the order the actions ran */
  targets: string[];
}

function dimensionFilter(field: string, value: Cell): Filter {
  return { field, step: 'dimension', values: [value], n: null, by: null, min: null, max: null, agg: null, table_calc: null };
}

function parameterValue(parameter: ParameterDef | undefined, value: Cell): ParameterValue | null {
  if (value === null || typeof value === 'boolean') return null;
  if (parameter?.type === 'number') {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return String(value);
}

function runs(actions: readonly DashboardAction[], source: string): DashboardAction[] {
  return actions
    .filter((action) => action.source === source)
    .sort((a, b) => RUN_ORDER.indexOf(a.type) - RUN_ORDER.indexOf(b.type) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function planSelection(
  actions: readonly DashboardAction[],
  source: string,
  mark: MarkInfo,
  parameters: readonly ParameterDef[],
): Selection {
  const selection: Selection = {
    source,
    member: mark.dims.join(', '),
    log: [],
    hasFilter: false,
    hasHighlight: false,
    parameters: {},
    sets: {},
    filters: {},
    highlights: {},
    targets: [],
  };
  for (const action of runs(actions, source)) {
    const at = mark.dimensions.indexOf(action.field);
    const value = mark.values[at];
    if (at < 0 || value === undefined) continue;
    if (action.type === 'set_parameter' && action.parameter) {
      const next = parameterValue(
        parameters.find((parameter) => parameter.name === action.parameter),
        value,
      );
      if (next === null) continue;
      selection.parameters[action.parameter] = next;
    } else if (action.type === 'change_set' && action.set) {
      selection.sets[action.set] = [value];
    }
    for (const target of action.targets) {
      if (action.type === 'filter') (selection.filters[target] ??= []).push(dimensionFilter(action.field, value));
      if (action.type === 'highlight') (selection.highlights[target] ??= []).push({ field: action.field, value });
      if (!selection.targets.includes(target)) selection.targets.push(target);
    }
    selection.hasFilter ||= action.type === 'filter';
    selection.hasHighlight ||= action.type === 'highlight';
    selection.log.push(`${selection.log.length + 1}. ${ACTION_WORDS[action.type]}: ${action.name}`);
  }
  return selection;
}

/** The sentence announced once every affected sheet has applied its newest answer. */
export function selectionCopy(selection: Selection | null, sheets: number): string {
  if (!selection) return `Selection cleared: ${sheets} sheets updated`;
  const verb = selection.hasFilter ? 'Filtered to' : selection.hasHighlight ? 'Highlighted' : 'Selected';
  return `${verb} ${selection.member}: ${sheets} sheets updated`;
}

/** The marks of a result that match every highlight, by `data-mark` id; null when the sheet has none to show. */
export function highlightedMarks(
  sheet: SheetShape,
  result: QueryResult,
  highlights: readonly Highlight[],
): { matching: Set<string>; dimmed: Set<string> } | null {
  const plan = planView(sheet, result);
  if (!plan || highlights.length === 0) return null;
  const matching = new Set<string>();
  const dimmed = new Set<string>();
  for (const mark of plan.marks) {
    const hit = highlights.every((highlight) => {
      const at = plan.twin.dimensions.indexOf(highlight.field);
      return at >= 0 && mark.values[at] === highlight.value;
    });
    (hit ? matching : dimmed).add(mark.id);
  }
  return { matching, dimmed };
}
