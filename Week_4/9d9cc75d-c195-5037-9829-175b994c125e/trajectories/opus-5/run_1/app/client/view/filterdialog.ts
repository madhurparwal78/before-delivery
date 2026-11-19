import { send } from '../api.js';
import { clear, el } from '../dom.js';
import { displayValue } from '../../shared/display.js';
import { measureCaption } from '../../shared/chart.js';
import type { Agg, FilterSpec, MeasurePill, ParameterDoc, TableCalcSpec } from '../../shared/types.js';
import type { PlanMeasure } from '../../shared/viewplan.js';
import { focusFirst, openDialog } from '../ui/dialog.js';

export interface FilterDialogOptions {
  field: string;
  isMeasure: boolean;
  sheetId: string;
  opener: HTMLElement;
  existing: FilterSpec | null;
  measures: PlanMeasure[];
  parameters: ParameterDoc[];
  filters: FilterSpec[];
  parameterValues: Record<string, unknown>;
  onApply: (filter: FilterSpec) => void;
  onCancel?: () => void;
}

const CALC_OPTIONS: { value: string; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'run_total', label: 'Running total' },
  { value: 'prev_diff', label: 'Difference from previous' },
  { value: 'share', label: 'Percent of total' },
  { value: 'rank', label: 'Rank' },
];

const USING_OPTIONS: { value: TableCalcSpec['using']; label: string }[] = [
  { value: 'table_across', label: 'Table across' },
  { value: 'table_down', label: 'Table down' },
  { value: 'pane_down', label: 'Pane down' },
  { value: 'chosen', label: 'Chosen fields' },
];

export function openFilterDialog(options: FilterDialogOptions): void {
  const dialog = openDialog({
    name: `Filter ${options.field}`,
    opener: options.opener,
    onClose: () => undefined,
  });

  if (options.isMeasure) {
    const atLeast = el('input', { type: 'number', id: 'filter-at-least', class: 'input', step: 'any' });
    const atMost = el('input', { type: 'number', id: 'filter-at-most', class: 'input', step: 'any' });
    if (options.existing?.min != null) atLeast.value = String(options.existing.min);
    if (options.existing?.max != null) atMost.value = String(options.existing.max);
    const calculation = el('select', { id: 'filter-calculation', class: 'input' },
      CALC_OPTIONS.map((option) => el('option', { value: option.value, text: option.label })),
    );
    const using = el('select', { id: 'filter-using', class: 'input' },
      USING_OPTIONS.map((option) => el('option', { value: option.value, text: option.label })),
    );
    if (options.existing?.table_calc != null) {
      calculation.value = options.existing.table_calc.kind;
      using.value = options.existing.table_calc.using;
    }
    const apply = el('button', { type: 'button', class: 'pill-button primary', text: 'Apply' });
    dialog.body.append(
      el('label', { for: 'filter-at-least', text: 'At least' }),
      atLeast,
      el('label', { for: 'filter-at-most', text: 'At most' }),
      atMost,
      el('label', { for: 'filter-calculation', text: 'Calculation' }),
      calculation,
      el('label', { for: 'filter-using', text: 'Compute using' }),
      using,
      apply,
    );
    apply.addEventListener('click', () => {
      const kind = calculation.value;
      const filter: FilterSpec = {
        field: options.field,
        step: kind === 'none' ? 'measure' : 'table_calc',
        agg: (options.existing?.agg ?? 'SUM') as Agg,
        min: atLeast.value === '' ? null : Number(atLeast.value),
        max: atMost.value === '' ? null : Number(atMost.value),
        table_calc:
          kind === 'none'
            ? null
            : { kind: kind as TableCalcSpec['kind'], using: using.value as TableCalcSpec['using'], fields: [] },
        values: [],
      };
      dialog.close(null);
      options.onApply(filter);
    });
    focusFirst(dialog);
    return;
  }

  const membersRadio = el('input', { type: 'radio', name: 'filter-mode', id: 'filter-members' });
  const topRadio = el('input', { type: 'radio', name: 'filter-mode', id: 'filter-top' });
  const membersHost = el('div', { class: 'member-list' });
  const topCount = el('input', { type: 'number', id: 'filter-top-n', class: 'input', value: '1', min: '1', step: '1' });
  const useParameter = el('select', { id: 'filter-parameter', class: 'input' }, [
    el('option', { value: '', text: 'None' }),
    ...options.parameters.filter((p) => p.type === 'number').map((p) => el('option', { value: p.name, text: p.name })),
  ]);
  const bySelect = el('select', { id: 'filter-by', class: 'input' },
    options.measures.map((m) => el('option', { value: JSON.stringify(m.pill), text: measureCaption(m.pill) })),
  );
  const sourceBox = el('input', { type: 'checkbox', id: 'filter-source' });
  const contextBox = el('input', { type: 'checkbox', id: 'filter-context' });
  const apply = el('button', { type: 'button', class: 'pill-button primary', text: 'Apply' });

  const existing = options.existing;
  if (existing !== null) {
    if (existing.step === 'top') {
      topRadio.checked = true;
      if (typeof existing.n === 'number') topCount.value = String(existing.n);
      if (typeof existing.n === 'string' && existing.n.startsWith('@')) useParameter.value = existing.n.slice(1);
    } else {
      membersRadio.checked = true;
    }
    if (existing.step === 'source') sourceBox.checked = true;
    if (existing.step === 'context') contextBox.checked = true;
  } else {
    membersRadio.checked = true;
  }

  dialog.body.append(
    el('div', { class: 'row' }, [membersRadio, el('label', { for: 'filter-members', text: 'Members' })]),
    membersHost,
    el('div', { class: 'row' }, [topRadio, el('label', { for: 'filter-top', text: 'Top N' })]),
    el('label', { for: 'filter-top-n', text: 'Top N' }),
    topCount,
    el('label', { for: 'filter-parameter', text: 'Use parameter' }),
    useParameter,
    el('label', { for: 'filter-by', text: 'By' }),
    bySelect,
    el('div', { class: 'row' }, [sourceBox, el('label', { for: 'filter-source', text: 'Data source filter' })]),
    el('div', { class: 'row' }, [contextBox, el('label', { for: 'filter-context', text: 'Context filter' })]),
    apply,
  );

  const boxes: { box: HTMLInputElement; value: unknown }[] = [];
  void (async () => {
    const step = existing?.step ?? 'dimension';
    const res = await send<{ members: unknown[] }>('POST', `/api/sheets/${options.sheetId}/members`, {
      field: options.field,
      step,
      filters: options.filters.filter((f) => f.field !== options.field),
      parameters: options.parameterValues,
    });
    clear(membersHost);
    if (res.status !== 200) return;
    for (const member of res.data.members) {
      const label = displayValue(member as string | number | boolean | null);
      const box = el('input', { type: 'checkbox', id: `filter-member-${label}` });
      if (existing?.values?.some((v) => displayValue(v as string | number | boolean | null) === label) === true) {
        box.checked = true;
      }
      boxes.push({ box, value: member });
      membersHost.append(el('div', { class: 'row' }, [box, el('label', { for: `filter-member-${label}`, text: label })]));
    }
  })();

  apply.addEventListener('click', () => {
    const step: FilterSpec['step'] = topRadio.checked
      ? 'top'
      : sourceBox.checked
        ? 'source'
        : contextBox.checked
          ? 'context'
          : 'dimension';
    const by = bySelect.value === '' ? null : (JSON.parse(bySelect.value) as MeasurePill);
    const filter: FilterSpec = {
      field: options.field,
      step,
      values: topRadio.checked ? [] : boxes.filter((entry) => entry.box.checked).map((entry) => entry.value),
      n: topRadio.checked ? (useParameter.value === '' ? Number(topCount.value) : `@${useParameter.value}`) : null,
      by: topRadio.checked ? by : null,
      min: null,
      max: null,
      agg: null,
      table_calc: null,
    };
    dialog.close(null);
    options.onApply(filter);
  });

  dialog.root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') options.onCancel?.();
  });

  focusFirst(dialog);
}
