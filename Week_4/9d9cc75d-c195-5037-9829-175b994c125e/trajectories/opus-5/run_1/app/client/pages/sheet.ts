import { type ApiErrorBody, get, send } from '../api.js';
import { clear, el, isPhone } from '../dom.js';
import { session } from '../session.js';
import { navigate } from '../shell.js';
import { checkFormula } from '../../shared/check.js';
import { isLodFormula } from '../../shared/formula.js';
import type {
  ChartType,
  FilterSpec,
  ParameterDoc,
  SetDoc,
  SheetSpec,
  SourceDoc,
  SourceField,
} from '../../shared/types.js';
import { buildControls } from '../view/controls.js';
import { buildExportControls } from '../view/exports.js';
import { openCalculationDialog } from '../view/calcdialog.js';
import { openFilterDialog } from '../view/filterdialog.js';
import { openAlertDialog, openReferenceLineDialog, openSetDialog, openTableCalcDialog } from '../view/sheetdialogs.js';
import {
  newPillFor,
  pillField as pillFieldName,
  renderShelf,
  SHELF_LABEL,
  setShelfPills,
  shelfPills,
  type PillContext,
  type ShelfName,
} from '../view/pills.js';
import { wireRegions } from '../view/regions.js';
import { SheetBlock } from '../view/sheetblock.js';
import { openDialog } from '../ui/dialog.js';
import { openMenu } from '../ui/menu.js';

const QUERY_ORDER = [
  'Row-level security',
  'Data source filter',
  'Context filter',
  'AT expressions',
  'Dimension filter and top N',
  'PLUS and MINUS',
  'Aggregation',
  'Measure filter',
  'Table calculation',
  'Table calculation filter',
  'Totals and reference lines',
];

const CHART_OPTIONS: { value: ChartType; label: string }[] = [
  { value: 'automatic', label: 'Automatic' },
  { value: 'bar', label: 'Bar' },
  { value: 'line', label: 'Line' },
  { value: 'scatter', label: 'Scatter' },
  { value: 'text_table', label: 'Text table' },
  { value: 'heat_map', label: 'Heat map' },
];

interface SheetDoc extends SheetSpec {
  id: string;
  workbook: string;
  version: number;
  owner: string | null;
  source: string;
  calculations: { id: string; name: string; formula: string }[];
}

interface WorkbookDoc {
  id: string;
  name: string;
  project: string;
  source: string;
  state: string;
  version: number;
  parameters: ParameterDoc[];
  sets: SetDoc[];
}

interface DragState {
  field: string;
  fromShelf: ShelfName | null;
  index: number;
  startX: number;
  startY: number;
  active: boolean;
}

export async function sheetPage(host: HTMLElement, params: Record<string, string>): Promise<void> {
  const sheetRes = await get<SheetDoc & ApiErrorBody>(`/api/sheets/${params.sheetId}`);
  if (sheetRes.status !== 200) {
    host.append(
      el('h1', { class: 'empty-headline', text: sheetRes.status === 403 ? 'You do not have access to this.' : 'Not found.' }),
    );
    return;
  }
  const workbookRes = await get<WorkbookDoc & ApiErrorBody>(`/api/workbooks/${params.id}`);
  if (workbookRes.status !== 200) {
    host.append(el('h1', { class: 'empty-headline', text: 'Not found.' }));
    return;
  }
  const workbook = workbookRes.data;
  const sheet = sheetRes.data;
  const role = session.me?.projects.find((p) => p.id === workbook.project)?.role ?? null;
  const editable = sheet.owner === null ? role === 'creator' : sheet.owner === session.me?.user.id;

  let fields: SourceField[] | null = null;
  let hierarchy: { name: string; fields: string[] } | null = null;
  if (role === 'creator' || role === 'explorer') {
    const sourceRes = await get<SourceDoc & ApiErrorBody>(`/api/sources/${sheet.source}`);
    if (sourceRes.status === 200) {
      fields = sourceRes.data.fields;
      hierarchy = sourceRes.data.hierarchy;
    }
  }

  const spec: SheetSpec = {
    name: sheet.name,
    rows: sheet.rows,
    columns: sheet.columns,
    color: sheet.color,
    size: sheet.size,
    label: sheet.label,
    detail: sheet.detail,
    filters: sheet.filters,
    chart: sheet.chart,
    totals: sheet.totals,
    reference_lines: sheet.reference_lines,
    trend: sheet.trend,
    sort: sheet.sort,
  };
  let version = sheet.owner === null ? workbook.version : sheet.version;
  let calcs = sheet.calculations;
  const parameters = workbook.parameters;
  let sets = workbook.sets;
  const paramValues: Record<string, unknown> = {};
  const extraFilters: FilterSpec[] = [];

  document.body.dataset.field = editable ? 'sheet' : 'published';

  const announcements = el('p', {
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'View announcements',
    class: 'status',
  });
  const notice = el('p', { role: 'status', 'aria-live': 'polite', 'aria-label': 'View notice', class: 'status' });
  const announce = (text: string): void => {
    announcements.textContent = text;
  };

  const checkEnv = (): Parameters<typeof checkFormula>[1] => ({
    fields: (fields ?? []).map((f) => ({ name: f.name, type: f.type, kind: f.kind })),
    calcs: calcs.map((c) => ({ name: c.name, formula: c.formula })),
    parameters: parameters.map((p) => ({ name: p.name, type: p.type })),
    sets: sets.map((s) => ({ name: s.name })),
    maxChars: session.config?.formula_max_chars ?? 2000,
    maxDepth: session.config?.formula_max_depth ?? 16,
  });

  const calcKind = (formula: string): 'dimension' | 'measure' => {
    const check = checkFormula(formula, checkEnv());
    return check.valid && check.type === 'number' ? 'measure' : 'dimension';
  };

  const fieldKind = (name: string): 'dimension' | 'measure' => {
    const field = (fields ?? []).find((f) => f.name === name);
    if (field !== undefined) return field.kind;
    if (sets.some((s) => s.name === name)) return 'dimension';
    const calc = calcs.find((c) => c.name === name);
    return calc === undefined ? 'dimension' : calcKind(calc.formula);
  };

  const fieldType = (name: string): SourceField['type'] | undefined => (fields ?? []).find((f) => f.name === name)?.type;

  const fieldNames = (): string[] => [
    ...(fields ?? []).filter((f) => !f.hidden).map((f) => f.name),
    ...sets.map((s) => s.name),
    ...calcs.map((c) => c.name),
  ];

  let controls: { root: HTMLElement; redraw: () => void } | null = null;

  const block = new SheetBlock({
    sheetId: sheet.id,
    name: spec.name,
    spec: () => spec,
    fields: () => fields,
    onNotice: (text) => {
      notice.textContent = text ?? '';
    },
    onResult: () => controls?.redraw(),
  });

  const refresh = async (announceFiltered = false): Promise<void> => {
    const gen = block.nextGen();
    await block.run(gen, { filters: extraFilters, parameters: paramValues, sets: {} });
    if (announceFiltered) announce(`Filtered: ${block.result?.rows.length ?? 0} marks.`);
  };

  const save = async (): Promise<void> => {
    if (!editable) return;
    const res = await send<{ version: number } & ApiErrorBody>('PUT', `/api/sheets/${sheet.id}`, spec, {
      'if-match': String(version),
    });
    if (res.status === 200) {
      version = res.data.version;
      return;
    }
    if (res.status === 409 && typeof res.data.version === 'number') {
      version = res.data.version;
      const again = await send<{ version: number }>('PUT', `/api/sheets/${sheet.id}`, spec, {
        'if-match': String(version),
      });
      if (again.status === 200) version = again.data.version;
    }
  };

  const commit = (): void => {
    void (async () => {
      await save();
      await refresh();
    })();
  };

  const fieldList = el('ul', { class: 'field-list', 'aria-label': 'Fields' });
  fieldList.setAttribute('role', 'listbox');
  const calcList = el('ul', { class: 'calc-list', 'aria-label': 'Calculations' });
  calcList.setAttribute('role', 'list');
  const newCalcButton = el('button', { type: 'button', class: 'pill-button', text: 'New calculation' });
  const shelfHosts: Partial<Record<ShelfName, HTMLElement>> = {};

  function openFilter(
    field: string,
    isMeasure: boolean,
    existing: FilterSpec | null,
    opener: HTMLElement,
    fromFieldList = false,
  ): void {
    openFilterDialog({
      field,
      isMeasure,
      sheetId: sheet.id,
      opener,
      existing,
      measures: block.plan?.measures ?? [],
      parameters,
      filters: [...spec.filters, ...extraFilters],
      parameterValues: paramValues,
      onApply: (filter) => {
        if (editable) {
          spec.filters = [...spec.filters.filter((f) => f.field !== filter.field), filter];
        } else {
          const index = extraFilters.findIndex((f) => f.field === filter.field);
          if (index >= 0) extraFilters.splice(index, 1, filter);
          else extraFilters.push(filter);
        }
        drawShelves();
        controls?.redraw();
        void (async () => {
          await save();
          await refresh(true);
          const pills = [...document.querySelectorAll<HTMLElement>('button.pill[data-shelf="filters"]')];
          const target = pills.find((pill) => pill.textContent?.startsWith(filter.field) === true) ?? pills[0];
          if (target !== undefined) target.focus();
          else if (fromFieldList) opener.focus();
        })();
      },
      onCancel: () => {
        if (fromFieldList) opener.focus();
      },
    });
  }

  const addToShelf = (field: string, shelf: ShelfName, opener: HTMLElement): void => {
    if (shelf === 'filters') {
      openFilter(field, fieldKind(field) === 'measure', null, opener, true);
      return;
    }
    const calc = calcs.find((c) => c.name === field);
    const pill = newPillFor(field, fieldKind(field), fieldType(field), calc !== undefined && isLodFormula(calc.formula));
    if (shelf === 'color' || shelf === 'size') setShelfPills(spec, shelf, [pill]);
    else setShelfPills(spec, shelf, [...shelfPills(spec, shelf), pill]);
    announce(`Added ${field} to ${SHELF_LABEL[shelf]}.`);
    drawShelves();
    if (opener.isConnected) opener.focus();
    commit();
  };

  const pillContext: PillContext = {
    spec: () => spec,
    editable,
    hierarchy: () => hierarchy,
    fieldType: (name) => fieldType(name),
    announce,
    commit,
    openFilter: (field, isMeasure, existing, opener) => openFilter(field, isMeasure, existing, opener),
    openTableCalc: (pill, opener, apply) => openTableCalcDialog({ pill, opener, dims: block.plan?.dims ?? [], apply }),
    focusFieldList: () => {
      fieldList.querySelector<HTMLElement>('[role="option"]')?.focus();
    },
    redrawShelves: () => drawShelves(),
    focusPill: (shelf, index) => {
      document.querySelector<HTMLElement>(`button.pill[data-shelf="${shelf}"][data-index="${index}"]`)?.focus();
    },
  };

  function drawShelves(): void {
    for (const shelf of Object.keys(shelfHosts) as ShelfName[]) {
      const container = shelfHosts[shelf];
      if (container === undefined) continue;
      clear(container);
      container.append(renderShelf(shelf, pillContext));
    }
  }

  function drawFieldList(): void {
    clear(fieldList);
    const entries = [
      ...(fields ?? []).filter((f) => !f.hidden).map((f) => ({ name: f.name, kind: f.kind })),
      ...sets.map((s) => ({ name: s.name, kind: 'dimension' as const })),
      ...calcs.map((c) => ({ name: c.name, kind: calcKind(c.formula) })),
    ];
    entries.forEach((entry, index) => {
      const option = el('li', {
        role: 'option',
        class: `chip ${entry.kind}`,
        tabindex: index === 0 ? '0' : '-1',
        'aria-selected': 'false',
        text: `${entry.name}, ${entry.kind}`,
      });
      option.dataset.field = entry.name;
      option.addEventListener('keydown', (event) => {
        const options = [...fieldList.querySelectorAll<HTMLElement>('[role="option"]')];
        const position = options.indexOf(option);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const next = event.key === 'ArrowDown' ? Math.min(options.length - 1, position + 1) : Math.max(0, position - 1);
          options.forEach((item) => item.setAttribute('tabindex', '-1'));
          options[next].setAttribute('tabindex', '0');
          options[next].focus();
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          openMenu(option, 'Add to shelf', [
            { label: 'Rows', choose: () => addToShelf(entry.name, 'rows', option) },
            { label: 'Columns', choose: () => addToShelf(entry.name, 'columns', option) },
            { label: 'Color', choose: () => addToShelf(entry.name, 'color', option) },
            { label: 'Size', choose: () => addToShelf(entry.name, 'size', option) },
            { label: 'Label', choose: () => addToShelf(entry.name, 'label', option) },
            { label: 'Detail', choose: () => addToShelf(entry.name, 'detail', option) },
            { label: 'Filters', choose: () => addToShelf(entry.name, 'filters', option) },
          ]);
        }
      });
      fieldList.append(option);
    });

    clear(calcList);
    for (const calc of calcs) {
      const edit = el('button', { type: 'button', class: 'pill-button small', text: `Edit ${calc.name}` });
      edit.addEventListener('click', () => {
        openCalculationDialog({
          sheetId: sheet.id,
          opener: edit,
          calculation: calc,
          fieldNames: fieldNames(),
          queryOrder: QUERY_ORDER,
          onSaved: (saved) => {
            calcs = calcs.map((c) => (c.id === saved.id ? saved : c));
            announce(`Saved ${saved.name}.`);
            drawFieldList();
            drawShelves();
            void refresh();
          },
        });
      });
      calcList.append(el('li', {}, [edit]));
    }
  }

  newCalcButton.addEventListener('click', () => {
    openCalculationDialog({
      sheetId: sheet.id,
      opener: newCalcButton,
      calculation: null,
      fieldNames: fieldNames(),
      queryOrder: QUERY_ORDER,
      onSaved: (saved) => {
        calcs = [...calcs, saved];
        announce(`Saved ${saved.name}.`);
        drawFieldList();
        void refresh();
      },
    });
  });

  const shelfBlock = (shelf: ShelfName): HTMLElement => {
    const container = el('div', { class: 'shelf-host' });
    shelfHosts[shelf] = container;
    return el('div', { class: 'shelf-row' }, [el('span', { class: 'shelf-label', text: SHELF_LABEL[shelf] }), container]);
  };

  const chartSelect = el('select', { id: 'chart-type', class: 'input' },
    CHART_OPTIONS.map((option) => el('option', { value: option.value, text: option.label })),
  );
  chartSelect.value = spec.chart;
  chartSelect.addEventListener('change', () => {
    spec.chart = chartSelect.value as ChartType;
    commit();
  });

  const totalsBox = el('input', { type: 'checkbox', id: 'show-totals' });
  totalsBox.checked = spec.totals;
  totalsBox.addEventListener('change', () => {
    spec.totals = totalsBox.checked;
    commit();
  });

  const trendBox = el('input', { type: 'checkbox', id: 'trend-line' });
  trendBox.checked = spec.trend;
  trendBox.addEventListener('change', () => {
    spec.trend = trendBox.checked;
    commit();
  });

  const refButton = el('button', { type: 'button', class: 'pill-button', text: 'Add reference line' });
  refButton.addEventListener('click', () => {
    openReferenceLineDialog({
      opener: refButton,
      parameters,
      save: (line) => {
        spec.reference_lines = [...spec.reference_lines, line];
        announce(`Saved ${line.type === 'average' ? 'Average' : line.type === 'median' ? 'Median' : 'Constant'}.`);
        commit();
      },
    });
  });

  const setButton = el('button', { type: 'button', class: 'pill-button', text: 'New set' });
  setButton.addEventListener('click', () => {
    openSetDialog({
      opener: setButton,
      workbookId: workbook.id,
      sheetId: sheet.id,
      fields: fields ?? [],
      measures: block.plan?.measures ?? [],
      parameters,
      existing: null,
      saved: (set) => {
        sets = [...sets, set];
        announce(`Saved ${set.name}.`);
        void refresh();
      },
    });
  });

  const alertButton = el('button', { type: 'button', class: 'pill-button', text: 'New alert' });
  alertButton.addEventListener('click', () => {
    openAlertDialog({
      opener: alertButton,
      sheetId: sheet.id,
      measures: block.plan?.measures ?? [],
      fields: fields ?? [],
      saved: (name) => announce(`Saved ${name}.`),
    });
  });

  const copyButton = el('button', { type: 'button', class: 'pill-button', text: 'Copy sheet' });
  copyButton.addEventListener('click', () => {
    void (async () => {
      const res = await send<{ id: string }>('POST', `/api/sheets/${sheet.id}/copy`);
      if (res.status === 201) navigate(`/workbooks/${workbook.id}/sheets/${res.data.id}`);
    })();
  });

  if (!editable) {
    controls = buildControls({
      parameters: () => parameters,
      values: () => paramValues,
      onParameter: (name, value) => {
        paramValues[name] = value;
        announce(`${name} set to ${String(value)}.`);
        void refresh();
      },
      filters: () => [...spec.filters, ...extraFilters],
      openFilter: (filter, opener) =>
        openFilter(filter.field, filter.step === 'measure' || filter.step === 'table_calc', filter, opener),
    });
  }

  const exportControls = buildExportControls({
    sheet: sheet.id,
    filters: () => extraFilters,
    parameters: () => paramValues,
  });

  const regionsList: HTMLElement[] = [];
  if (editable) {
    const fieldsRegion = el('section', { role: 'region', 'aria-label': 'Fields', class: 'fields-region' }, [
      el('h2', { text: 'Fields' }),
      fieldList,
      el('h3', { text: 'Calculations' }),
      calcList,
      newCalcButton,
    ]);
    const shelvesRegion = el('section', { role: 'region', 'aria-label': 'Shelves', class: 'shelves-region' }, [
      el('div', { class: 'shelf-stack' }, [shelfBlock('rows'), shelfBlock('columns'), shelfBlock('filters')]),
      el('div', { class: 'marks-card card' }, [
        el('h2', { text: 'Marks' }),
        el('label', { for: 'chart-type', text: 'Chart type' }),
        chartSelect,
        shelfBlock('color'),
        shelfBlock('size'),
        shelfBlock('label'),
        shelfBlock('detail'),
        el('div', { class: 'row' }, [totalsBox, el('label', { for: 'show-totals', text: 'Show totals' })]),
        el('div', { class: 'row' }, [trendBox, el('label', { for: 'trend-line', text: 'Trend line' })]),
        el('div', { class: 'row' }, [refButton, setButton, alertButton]),
      ]),
    ]);
    host.append(
      el('div', { class: 'sheet-page' }, [
        el('h1', { text: spec.name }),
        notice,
        announcements,
        el('div', { class: 'sheet-layout' }, [
          fieldsRegion,
          shelvesRegion,
          el('div', { class: 'stage' }, [block.viewRegion, block.twinRegion, exportControls]),
        ]),
      ]),
    );
    regionsList.push(fieldsRegion, shelvesRegion, block.viewRegion, block.twinRegion);
    drawFieldList();
    drawShelves();
  } else {
    const controlsRoot = controls?.root ?? el('div');
    const filtersButton = el('button', { type: 'button', class: 'pill-button', text: 'Filters' });
    filtersButton.addEventListener('click', () => {
      const dialog = openDialog({ name: 'Filters', opener: filtersButton, bottomSheet: true });
      dialog.body.append(controlsRoot);
      const close = el('button', { type: 'button', class: 'pill-button', text: 'Close' });
      close.addEventListener('click', () => dialog.close());
      dialog.body.append(close);
    });
    host.append(
      el('div', { class: 'published-view' }, [
        el('h1', { text: spec.name }),
        notice,
        announcements,
        el('div', { class: 'published-layout' }, [
          el('div', { class: 'controls-column' }, [isPhone() ? filtersButton : controlsRoot]),
          el('div', { class: 'stage' }, [
            block.viewRegion,
            block.twinRegion,
            role === 'explorer' ? copyButton : null,
            alertButton,
            exportControls,
          ]),
        ]),
      ]),
    );
    regionsList.push(controlsRoot, block.viewRegion, block.twinRegion);
  }

  wireRegions(host, () => regionsList);

  let dragState: DragState | null = null;
  const shelfListUnder = (x: number, y: number): HTMLElement | null => {
    const element = document.elementFromPoint(x, y);
    return element === null ? null : (element.closest('ul[data-shelf]') as HTMLElement | null);
  };

  host.addEventListener('pointerdown', (event) => {
    const target = event.target as HTMLElement | null;
    if (target === null) return;
    const chip = target.closest('[role="option"][data-field]') as HTMLElement | null;
    if (chip !== null) {
      dragState = {
        field: chip.dataset.field ?? '',
        fromShelf: null,
        index: -1,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
      };
      return;
    }
    if (!editable) return;
    const pill = target.closest('button.pill[data-shelf]') as HTMLElement | null;
    const shelf = pill?.dataset.shelf as ShelfName | undefined;
    if (pill === null || shelf === undefined || shelf === 'filters') return;
    dragState = {
      field: '',
      fromShelf: shelf,
      index: Number(pill.dataset.index ?? '0'),
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
  });

  host.addEventListener('pointermove', (event) => {
    if (dragState === null) return;
    if (!dragState.active) {
      if (Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY) < 4) return;
      dragState.active = true;
    }
    document.querySelectorAll('ul[data-shelf]').forEach((list) => list.removeAttribute('data-drop'));
    shelfListUnder(event.clientX, event.clientY)?.setAttribute('data-drop', 'true');
  });

  host.addEventListener('pointerup', (event) => {
    const state = dragState;
    dragState = null;
    document.querySelectorAll('ul[data-shelf]').forEach((list) => list.removeAttribute('data-drop'));
    if (state === null || !state.active) return;
    const shelf = shelfListUnder(event.clientX, event.clientY)?.dataset.shelf as ShelfName | undefined;
    if (shelf === undefined) return;
    if (state.fromShelf !== null) {
      if (shelf === 'filters') return;
      const pills = [...shelfPills(spec, state.fromShelf)];
      const [moved] = pills.splice(state.index, 1);
      if (moved === undefined) return;
      setShelfPills(spec, state.fromShelf, pills);
      setShelfPills(spec, shelf, shelf === 'color' || shelf === 'size' ? [moved] : [...shelfPills(spec, shelf), moved]);
      announce(`Added ${pillFieldName(moved)} to ${SHELF_LABEL[shelf]}.`);
      drawShelves();
      commit();
      return;
    }
    const option = fieldList.querySelector<HTMLElement>(`[data-field="${state.field}"]`);
    if (option !== null) addToShelf(state.field, shelf, option);
  });

  await refresh();
}
