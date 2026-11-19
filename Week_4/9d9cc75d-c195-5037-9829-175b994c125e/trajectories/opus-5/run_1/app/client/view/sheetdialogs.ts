import { type ApiErrorBody, fieldErrors, send } from '../api.js';
import { clear, el } from '../dom.js';
import { displayValue } from '../../shared/display.js';
import { measureCaption } from '../../shared/chart.js';
import type {
  Agg,
  MeasurePill,
  ParameterDoc,
  ReferenceLineSpec,
  SetDoc,
  SourceField,
  TableCalcSpec,
} from '../../shared/types.js';
import type { PlanDim, PlanMeasure } from '../../shared/viewplan.js';
import { focusFirst, openDialog } from '../ui/dialog.js';

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

export function openTableCalcDialog(options: {
  pill: MeasurePill;
  opener: HTMLElement;
  dims: PlanDim[];
  apply: (spec: TableCalcSpec | null) => void;
}): void {
  const dialog = openDialog({ name: 'Table calculation', opener: options.opener });
  const calculation = el('select', { id: 'tc-calculation', class: 'input' },
    CALC_OPTIONS.map((option) => el('option', { value: option.value, text: option.label })),
  );
  const using = el('select', { id: 'tc-using', class: 'input' },
    USING_OPTIONS.map((option) => el('option', { value: option.value, text: option.label })),
  );
  const chosenHost = el('div', { class: 'member-list' });
  const apply = el('button', { type: 'button', class: 'pill-button primary', text: 'Apply' });
  const existing = options.pill.table_calc;
  if (existing !== null) {
    calculation.value = existing.kind;
    using.value = existing.using;
  }
  const boxes: { box: HTMLInputElement; field: string }[] = [];
  const drawChosen = (): void => {
    clear(chosenHost);
    boxes.length = 0;
    if (using.value !== 'chosen') return;
    for (const dim of options.dims) {
      const box = el('input', { type: 'checkbox', id: `tc-field-${dim.field}` });
      if (existing?.fields.includes(dim.field) === true) box.checked = true;
      boxes.push({ box, field: dim.field });
      chosenHost.append(el('div', { class: 'row' }, [box, el('label', { for: `tc-field-${dim.field}`, text: dim.field })]));
    }
  };
  using.addEventListener('change', drawChosen);
  drawChosen();

  dialog.body.append(
    el('label', { for: 'tc-calculation', text: 'Calculation' }),
    calculation,
    el('label', { for: 'tc-using', text: 'Compute using' }),
    using,
    chosenHost,
    apply,
  );
  apply.addEventListener('click', () => {
    const kind = calculation.value;
    dialog.close();
    options.apply(
      kind === 'none'
        ? null
        : {
            kind: kind as TableCalcSpec['kind'],
            using: using.value as TableCalcSpec['using'],
            fields: boxes.filter((entry) => entry.box.checked).map((entry) => entry.field),
          },
    );
  });
  focusFirst(dialog);
}

export function openReferenceLineDialog(options: {
  opener: HTMLElement;
  parameters: ParameterDoc[];
  save: (line: ReferenceLineSpec) => void;
}): void {
  const dialog = openDialog({ name: 'Reference line', opener: options.opener });
  const lineType = el('select', { id: 'ref-type', class: 'input' }, [
    el('option', { value: 'average', text: 'Average' }),
    el('option', { value: 'median', text: 'Median' }),
    el('option', { value: 'constant', text: 'Constant' }),
  ]);
  const value = el('input', { type: 'number', id: 'ref-value', class: 'input', step: 'any' });
  const parameter = el('select', { id: 'ref-parameter', class: 'input' }, [
    el('option', { value: '', text: 'None' }),
    ...options.parameters.filter((p) => p.type === 'number').map((p) => el('option', { value: p.name, text: p.name })),
  ]);
  const save = el('button', { type: 'button', class: 'pill-button primary', text: 'Save line' });
  dialog.body.append(
    el('label', { for: 'ref-type', text: 'Line type' }),
    lineType,
    el('label', { for: 'ref-value', text: 'Value' }),
    value,
    el('label', { for: 'ref-parameter', text: 'Parameter' }),
    parameter,
    save,
  );
  save.addEventListener('click', () => {
    dialog.close();
    options.save({
      type: lineType.value as ReferenceLineSpec['type'],
      value: value.value === '' ? null : Number(value.value),
      parameter: parameter.value === '' ? null : parameter.value,
    });
  });
  focusFirst(dialog);
}

export function openSetDialog(options: {
  opener: HTMLElement;
  workbookId: string;
  sheetId: string;
  fields: SourceField[];
  measures: PlanMeasure[];
  parameters: ParameterDoc[];
  existing: SetDoc | null;
  saved: (set: SetDoc) => void;
}): void {
  const dialog = openDialog({ name: 'Set', opener: options.opener });
  const nameInput = el('input', { type: 'text', id: 'set-name', class: 'input', value: options.existing?.name ?? '' });
  const fieldSelect = el('select', { id: 'set-field', class: 'input' },
    options.fields.filter((f) => f.kind === 'dimension').map((f) => el('option', { value: f.name, text: f.name })),
  );
  if (options.existing !== null) fieldSelect.value = options.existing.field;
  const chosenRadio = el('input', { type: 'radio', name: 'set-mode', id: 'set-chosen' });
  const topRadio = el('input', { type: 'radio', name: 'set-mode', id: 'set-top' });
  const membersHost = el('div', { class: 'member-list' });
  const topCount = el('input', { type: 'number', id: 'set-top-n', class: 'input', value: '2', min: '1', step: '1' });
  const useParameter = el('select', { id: 'set-parameter', class: 'input' }, [
    el('option', { value: '', text: 'None' }),
    ...options.parameters.filter((p) => p.type === 'number').map((p) => el('option', { value: p.name, text: p.name })),
  ]);
  const bySelect = el('select', { id: 'set-by', class: 'input' },
    options.measures.map((m) => el('option', { value: JSON.stringify(m.pill), text: measureCaption(m.pill) })),
  );
  const error = el('p', { class: 'field-error' });
  const save = el('button', { type: 'button', class: 'pill-button primary', text: 'Save set' });
  if (options.existing?.top != null) {
    topRadio.checked = true;
    if (typeof options.existing.top.n === 'number') topCount.value = String(options.existing.top.n);
    if (typeof options.existing.top.n === 'string') useParameter.value = options.existing.top.n.replace('@', '');
  } else {
    chosenRadio.checked = true;
  }

  const boxes: { box: HTMLInputElement; value: unknown }[] = [];
  const loadMembers = async (): Promise<void> => {
    clear(membersHost);
    boxes.length = 0;
    const res = await send<{ members: unknown[] }>('POST', `/api/sheets/${options.sheetId}/members`, {
      field: fieldSelect.value,
      step: 'dimension',
      filters: [],
      parameters: {},
    });
    if (res.status !== 200) return;
    for (const member of res.data.members) {
      const label = displayValue(member as string | number | boolean | null);
      const box = el('input', { type: 'checkbox', id: `set-member-${label}` });
      if (options.existing?.members?.some((v) => displayValue(v as string | number | boolean | null) === label) === true) {
        box.checked = true;
      }
      boxes.push({ box, value: member });
      membersHost.append(el('div', { class: 'row' }, [box, el('label', { for: `set-member-${label}`, text: label })]));
    }
  };
  fieldSelect.addEventListener('change', () => {
    void loadMembers();
  });
  void loadMembers();

  dialog.body.append(
    el('label', { for: 'set-name', text: 'Set name' }),
    nameInput,
    el('label', { for: 'set-field', text: 'Field' }),
    fieldSelect,
    el('div', { class: 'row' }, [chosenRadio, el('label', { for: 'set-chosen', text: 'Chosen members' })]),
    membersHost,
    el('div', { class: 'row' }, [topRadio, el('label', { for: 'set-top', text: 'Top N' })]),
    el('label', { for: 'set-top-n', text: 'Top N' }),
    topCount,
    el('label', { for: 'set-parameter', text: 'Use parameter' }),
    useParameter,
    el('label', { for: 'set-by', text: 'By' }),
    bySelect,
    error,
    save,
  );

  save.addEventListener('click', () => {
    void (async () => {
      const body: Record<string, unknown> = { name: nameInput.value, field: fieldSelect.value };
      if (topRadio.checked) {
        body.top = {
          n: useParameter.value === '' ? Number(topCount.value) : `@${useParameter.value}`,
          by: bySelect.value === '' ? null : (JSON.parse(bySelect.value) as MeasurePill),
        };
      } else {
        body.members = boxes.filter((entry) => entry.box.checked).map((entry) => entry.value);
      }
      const res =
        options.existing === null
          ? await send<SetDoc & ApiErrorBody>('POST', `/api/workbooks/${options.workbookId}/sets`, body)
          : await send<SetDoc & ApiErrorBody>('PUT', `/api/sets/${options.existing.id}`, body);
      if (res.status === 200 || res.status === 201) {
        dialog.close();
        options.saved(res.data);
        return;
      }
      error.textContent = fieldErrors(res.data).name ?? 'Name is required.';
    })();
  });
  focusFirst(dialog);
}

export function openAlertDialog(options: {
  opener: HTMLElement;
  sheetId: string;
  measures: PlanMeasure[];
  fields: SourceField[];
  saved: (name: string) => void;
}): void {
  const dialog = openDialog({ name: 'Alert', opener: options.opener });
  const nameInput = el('input', { type: 'text', id: 'alert-name', class: 'input', value: 'Total sales' });
  const choices =
    options.measures.length > 0
      ? options.measures.map((m) => ({ pill: m.pill, label: measureCaption(m.pill) }))
      : options.fields
          .filter((f) => f.kind === 'measure')
          .map((f) => ({ pill: { field: f.name, agg: 'SUM' as Agg, table_calc: null }, label: f.name }));
  const measureSelect = el('select', { id: 'alert-measure', class: 'input' },
    choices.map((choice) => el('option', { value: JSON.stringify(choice.pill), text: choice.label })),
  );
  const above = el('input', { type: 'number', id: 'alert-above', class: 'input', step: 'any' });
  const error = el('p', { class: 'field-error' });
  const save = el('button', { type: 'button', class: 'pill-button primary', text: 'Save alert' });
  dialog.body.append(
    el('label', { for: 'alert-name', text: 'Alert name' }),
    nameInput,
    el('label', { for: 'alert-measure', text: 'Measure' }),
    measureSelect,
    el('label', { for: 'alert-above', text: 'Above' }),
    above,
    error,
    save,
  );
  save.addEventListener('click', () => {
    void (async () => {
      const res = await send<{ name: string } & ApiErrorBody>('POST', `/api/sheets/${options.sheetId}/alerts`, {
        name: nameInput.value,
        measure: measureSelect.value === '' ? null : JSON.parse(measureSelect.value),
        above: above.value === '' ? null : Number(above.value),
      });
      if (res.status === 201) {
        dialog.close();
        options.saved(res.data.name);
        return;
      }
      error.textContent = fieldErrors(res.data).above ?? fieldErrors(res.data).name ?? 'Above must be a number.';
    })();
  });
  focusFirst(dialog);
}
