import { type ApiErrorBody, get, send } from '../api.js';
import { clear, el, isPhone } from '../dom.js';
import { onEvent } from '../events.js';
import { extractStateText, type ExtractStateLike } from '../format.js';
import { session } from '../session.js';
import { displayValue } from '../../shared/display.js';
import { dashboardObjects, STAGE_HEIGHT, STAGE_WIDTH } from '../../shared/dashboard.js';
import type {
  DashboardAction,
  DashboardDoc,
  FilterSpec,
  ParameterDoc,
  SetDoc,
  SheetSpec,
  SourceField,
} from '../../shared/types.js';
import { buildControls } from '../view/controls.js';
import { buildExportControls } from '../view/exports.js';
import { openFilterDialog } from '../view/filterdialog.js';
import { wireRegions } from '../view/regions.js';
import { SheetBlock } from '../view/sheetblock.js';
import type { MarkInfo } from '../view/chart.js';
import { focusFirst, openDialog } from '../ui/dialog.js';

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
  version: number;
  parameters: ParameterDoc[];
  sets: SetDoc[];
}

const TYPE_WORDS: Record<DashboardAction['type'], string> = {
  set_parameter: 'Set parameter',
  change_set: 'Change set',
  filter: 'Filter',
  highlight: 'Highlight',
};

const TYPE_ORDER: DashboardAction['type'][] = ['set_parameter', 'change_set', 'filter', 'highlight'];

export async function dashboardPage(host: HTMLElement, params: Record<string, string>): Promise<void> {
  document.body.dataset.field = 'dashboard';
  const res = await get<DashboardDoc & ApiErrorBody>(`/api/dashboards/${params.id}`);
  if (res.status !== 200) {
    host.append(el('h1', { class: 'empty-headline', text: res.status === 403 ? 'You do not have access to this.' : 'Not found.' }));
    return;
  }
  const dashboard = res.data;
  const workbookRes = await get<WorkbookDoc & ApiErrorBody>(`/api/workbooks/${dashboard.workbook}`);
  if (workbookRes.status !== 200) {
    host.append(el('h1', { class: 'empty-headline', text: 'Not found.' }));
    return;
  }
  const workbook = workbookRes.data;
  const role = session.me?.projects.find((p) => p.id === workbook.project)?.role ?? null;

  let fields: SourceField[] | null = null;
  if (role === 'creator' || role === 'explorer') {
    const sourceRes = await get<{ fields: SourceField[] } & ApiErrorBody>(`/api/sources/${workbook.source}`);
    if (sourceRes.status === 200) fields = sourceRes.data.fields;
  }

  const sheetDocs = new Map<string, SheetDoc>();
  for (const object of dashboard.objects) {
    const sheetRes = await get<SheetDoc & ApiErrorBody>(`/api/sheets/${object.sheet}`);
    if (sheetRes.status === 200) sheetDocs.set(object.sheet, sheetRes.data);
  }

  const parameters = workbook.parameters;
  const paramValues: Record<string, unknown> = {};
  const setOverrides: Record<string, unknown[]> = {};
  const extraFilters: FilterSpec[] = [];
  const hidden = new Set<string>();
  const actionFilters = new Map<string, FilterSpec[]>();
  const highlights = new Map<string, { field: string; values: unknown[] }>();

  const announcements = el('p', { role: 'status', 'aria-live': 'polite', 'aria-label': 'View announcements', class: 'status' });
  const notice = el('p', { role: 'status', 'aria-live': 'polite', 'aria-label': 'View notice', class: 'status' });
  const extractState = el('p', { role: 'status', 'aria-live': 'polite', 'aria-label': 'Extract state', class: 'status' });
  const actionLog = el('ol', { class: 'action-log', 'aria-label': 'Action log' });
  actionLog.setAttribute('role', 'log');
  const objectsList = el('ul', { class: 'objects-list', 'aria-label': 'Dashboard objects' });
  objectsList.setAttribute('role', 'list');

  const blocks = new Map<string, SheetBlock>();
  const stage = el('div', { class: 'dash-stage' });
  const stageWrap = el('div', { class: 'dash-stage-wrap' }, [stage]);

  const specOf = (sheetId: string): SheetSpec => {
    const doc = sheetDocs.get(sheetId);
    if (doc === undefined) {
      return {
        name: '',
        rows: [],
        columns: [],
        color: null,
        size: null,
        label: [],
        detail: [],
        filters: [],
        chart: 'automatic',
        totals: false,
        reference_lines: [],
        trend: false,
        sort: {},
      };
    }
    return doc;
  };

  const bodyFor = (sheetId: string): { filters: FilterSpec[]; parameters: Record<string, unknown>; sets: Record<string, unknown[]> } => ({
    filters: [...extraFilters, ...(actionFilters.get(sheetId) ?? [])],
    parameters: paramValues,
    sets: setOverrides,
  });

  const runSheet = async (sheetId: string): Promise<boolean> => {
    const block = blocks.get(sheetId);
    if (block === undefined) return false;
    const gen = block.nextGen();
    return block.run(gen, bodyFor(sheetId));
  };

  for (const object of dashboard.objects) {
    const doc = sheetDocs.get(object.sheet);
    const name = doc?.name ?? object.name;
    const block = new SheetBlock({
      sheetId: object.sheet,
      name,
      regionLabel: name,
      spec: () => specOf(object.sheet),
      fields: () => fields,
      height: isPhone() ? (dashboard.phone_heights[object.sheet] ?? 320) - 80 : object.h - 90,
      onNotice: (text) => {
        if (text !== null) notice.textContent = text;
      },
      onSelect: (mark) => {
        void onSelect(object.sheet, mark);
      },
    });
    block.root.dataset.x = String(object.x);
    block.root.dataset.y = String(object.y);
    block.root.dataset.w = String(object.w);
    block.root.dataset.h = String(object.h);
    blocks.set(object.sheet, block);
  }

  const layoutStage = (): void => {
    clear(stage);
    const phone = isPhone();
    stage.classList.toggle('phone', phone);
    if (phone) {
      for (const sheetId of dashboard.phone_order) {
        const block = blocks.get(sheetId);
        if (block === undefined || hidden.has(sheetId)) continue;
        block.root.style.position = 'static';
        block.root.style.width = '100%';
        block.root.style.height = `${dashboard.phone_heights[sheetId] ?? 320}px`;
        stage.append(block.root);
      }
      stageWrap.style.height = '';
      stage.style.transform = '';
      stage.style.width = '';
      stage.style.height = '';
      return;
    }
    for (const object of dashboard.objects.filter((item) => !hidden.has(item.sheet))) {
      const block = blocks.get(object.sheet);
      if (block === undefined) continue;
      stage.append(block.root);
    }
    stage.style.width = `${STAGE_WIDTH}px`;
    stage.style.height = `${STAGE_HEIGHT}px`;
    const available = stageWrap.clientWidth || host.clientWidth || STAGE_WIDTH;
    const scale = Math.min(1, available / STAGE_WIDTH);
    stage.style.transform = `scale(${scale})`;
    stage.style.transformOrigin = 'top left';
    stageWrap.style.height = `${STAGE_HEIGHT * scale}px`;
  };

  const drawObjects = (): void => {
    clear(objectsList);
    for (const object of dashboard.objects) {
      const doc = sheetDocs.get(object.sheet);
      const name = doc?.name ?? object.name;
      const isHidden = hidden.has(object.sheet);
      const button = el('button', {
        type: 'button',
        class: 'pill-button small',
        text: isHidden ? `Show ${name}` : `Hide ${name}`,
      });
      button.addEventListener('click', () => {
        if (hidden.has(object.sheet)) hidden.delete(object.sheet);
        else hidden.add(object.sheet);
        announcements.textContent = hidden.has(object.sheet) ? `${name} hidden.` : `${name} shown.`;
        drawObjects();
        layoutStage();
        reflow();
        document.querySelectorAll<HTMLElement>('.objects-list button').forEach((item) => {
          if (item.textContent === `Show ${name}` || item.textContent === `Hide ${name}`) item.focus();
        });
      });
      objectsList.append(el('li', {}, [button]));
    }
  };

  /** Hiding an object reflows the tiled layout, so the sizing rule is asked for the visible set. */
  const reflow = (): void => {
    if (isPhone()) return;
    const names = new Map(dashboard.objects.map((object) => [object.sheet, sheetDocs.get(object.sheet)?.name ?? object.name]));
    const objects = dashboardObjects(dashboard.layout, dashboard.floating, names, hidden);
    for (const object of objects) {
      const block = blocks.get(object.sheet);
      if (block === undefined) continue;
      block.root.dataset.x = String(object.x);
      block.root.dataset.y = String(object.y);
      block.root.dataset.w = String(object.w);
      block.root.dataset.h = String(object.h);
      block.root.style.position = 'absolute';
      block.root.style.left = `${object.x}px`;
      block.root.style.top = `${object.y}px`;
      block.root.style.width = `${object.w}px`;
      block.root.style.height = `${object.h}px`;
    }
    for (const sheetId of hidden) blocks.get(sheetId)?.root.remove();
  };

  let logEntries = 0;
  const logAction = (action: DashboardAction): void => {
    logEntries += 1;
    actionLog.append(el('li', { text: `${logEntries}. ${TYPE_WORDS[action.type]}: ${action.name}` }));
  };

  const clearLog = (): void => {
    logEntries = 0;
    clear(actionLog);
  };

  const sortedActions = (sourceSheet: string): DashboardAction[] =>
    [...dashboard.actions.filter((action) => action.source === sourceSheet)].sort((a, b) => {
      const typeDiff = TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type);
      return typeDiff !== 0 ? typeDiff : a.name.localeCompare(b.name);
    });

  const savedSetMembers = new Map<string, unknown[] | null>();

  async function onSelect(sourceSheet: string, mark: MarkInfo | null): Promise<void> {
    const actions = sortedActions(sourceSheet);
    const targets = new Set<string>();
    clearLog();
    if (mark === null) {
      actionFilters.clear();
      highlights.clear();
      for (const [name, members] of savedSetMembers) {
        if (members === null) delete setOverrides[name];
        else setOverrides[name] = members;
      }
      savedSetMembers.clear();
      for (const action of actions) for (const target of action.targets) targets.add(target);
      for (const target of targets) blocks.get(target)?.setHighlight(null);
      const answers = await Promise.all([...targets].map((target) => runSheet(target)));
      announcements.textContent = `Selection cleared: ${answers.filter((ok) => ok).length} sheets updated`;
      return;
    }
    const member = mark.dims.map((value) => displayValue(value)).join(', ');
    let anyFilter = false;
    let anyHighlight = false;
    for (const action of actions) {
      const values = mark.dims.length > 0 ? [mark.dims[fieldIndexOf(sourceSheet, action.field)]] : [];
      logAction(action);
      if (action.type === 'set_parameter' && action.parameter !== null) {
        paramValues[action.parameter] = values[0] ?? null;
        for (const target of action.targets) targets.add(target);
      }
      if (action.type === 'change_set' && action.set !== null) {
        if (!savedSetMembers.has(action.set)) {
          savedSetMembers.set(action.set, setOverrides[action.set] ?? null);
        }
        setOverrides[action.set] = values;
        for (const target of action.targets) targets.add(target);
      }
      if (action.type === 'filter') {
        anyFilter = true;
        for (const target of action.targets) {
          actionFilters.set(target, [{ field: action.field, step: 'dimension', values }]);
          targets.add(target);
        }
      }
      if (action.type === 'highlight') {
        anyHighlight = true;
        for (const target of action.targets) {
          highlights.set(target, { field: action.field, values });
          targets.add(target);
        }
      }
    }
    for (const target of targets) {
      const block = blocks.get(target);
      if (block === undefined) continue;
      block.setHighlight(highlights.get(target) ?? null);
    }
    const answers = await Promise.all([...targets].map((target) => runSheet(target)));
    const updated = answers.filter((ok) => ok).length;
    announcements.textContent = anyFilter
      ? `Filtered to ${member}: ${updated} sheets updated`
      : anyHighlight
        ? `Highlighted ${member}: ${updated} sheets updated`
        : `Selected ${member}: ${updated} sheets updated`;
  }

  function fieldIndexOf(sheetId: string, field: string): number {
    const block = blocks.get(sheetId);
    const dims = block?.plan?.dims ?? [];
    const index = dims.findIndex((dim) => dim.field === field);
    return index < 0 ? 0 : index;
  }

  const controls = buildControls({
    parameters: () => parameters,
    values: () => paramValues,
    onParameter: (name, value) => {
      paramValues[name] = value;
      announcements.textContent = `${name} set to ${String(value)}.`;
      void Promise.all([...blocks.keys()].map((sheetId) => runSheet(sheetId)));
    },
    filters: () => extraFilters,
    openFilter: (filter, opener) => {
      openFilterDialog({
        field: filter.field,
        isMeasure: filter.step === 'measure' || filter.step === 'table_calc',
        sheetId: dashboard.objects[0]?.sheet ?? '',
        opener,
        existing: filter,
        measures: [],
        parameters,
        filters: extraFilters,
        parameterValues: paramValues,
        onApply: (applied) => {
          const index = extraFilters.findIndex((f) => f.field === applied.field);
          if (index >= 0) extraFilters.splice(index, 1, applied);
          else extraFilters.push(applied);
          controls.redraw();
          void Promise.all([...blocks.keys()].map((sheetId) => runSheet(sheetId)));
        },
      });
    },
  });

  const exportControls = buildExportControls({
    dashboard: dashboard.id,
    filters: () => extraFilters,
    parameters: () => paramValues,
  });

  const addAction = el('button', { type: 'button', class: 'pill-button', text: 'Add action' });
  addAction.addEventListener('click', () => {
    const nameInput = el('input', { type: 'text', id: 'action-name', class: 'input', value: 'Action' });
    const typeSelect = el('select', { id: 'action-type', class: 'input' }, [
      el('option', { value: 'filter', text: 'Filter' }),
      el('option', { value: 'highlight', text: 'Highlight' }),
      el('option', { value: 'set_parameter', text: 'Set parameter' }),
      el('option', { value: 'change_set', text: 'Change set' }),
    ]);
    const sourceSelect = el('select', { id: 'action-source', class: 'input' },
      dashboard.objects.map((object) =>
        el('option', { value: object.sheet, text: sheetDocs.get(object.sheet)?.name ?? object.name }),
      ),
    );
    const boxes: { box: HTMLInputElement; id: string }[] = [];
    const targetsHost = el('div', { class: 'member-list' });
    for (const object of dashboard.objects) {
      const box = el('input', { type: 'checkbox', id: `action-target-${object.sheet}` });
      boxes.push({ box, id: object.sheet });
      targetsHost.append(
        el('div', { class: 'row' }, [
          box,
          el('label', { for: `action-target-${object.sheet}`, text: sheetDocs.get(object.sheet)?.name ?? object.name }),
        ]),
      );
    }
    const fieldSelect = el('select', { id: 'action-field', class: 'input' },
      (fields ?? []).filter((f) => f.kind === 'dimension').map((f) => el('option', { value: f.name, text: f.name })),
    );
    const parameterSelect = el('select', { id: 'action-parameter', class: 'input' }, [
      el('option', { value: '', text: 'None' }),
      ...parameters.map((p) => el('option', { value: p.name, text: p.name })),
    ]);
    const setSelect = el('select', { id: 'action-set', class: 'input' }, [
      el('option', { value: '', text: 'None' }),
      ...workbook.sets.map((s) => el('option', { value: s.name, text: s.name })),
    ]);
    const error = el('p', { class: 'field-error' });
    const save = el('button', { type: 'button', class: 'pill-button primary', text: 'Save action' });
    const dialog = openDialog({ name: 'Action', opener: addAction });
    dialog.body.append(
      el('label', { for: 'action-name', text: 'Action name' }),
      nameInput,
      el('label', { for: 'action-type', text: 'Action type' }),
      typeSelect,
      el('label', { for: 'action-source', text: 'Source sheet' }),
      sourceSelect,
      targetsHost,
      el('label', { for: 'action-field', text: 'Field' }),
      fieldSelect,
      el('label', { for: 'action-parameter', text: 'Parameter' }),
      parameterSelect,
      el('label', { for: 'action-set', text: 'Set' }),
      setSelect,
      error,
      save,
    );
    save.addEventListener('click', () => {
      void (async () => {
        const action: DashboardAction = {
          name: nameInput.value,
          type: typeSelect.value as DashboardAction['type'],
          source: sourceSelect.value,
          targets: boxes.filter((entry) => entry.box.checked).map((entry) => entry.id),
          field: fieldSelect.value,
          parameter: parameterSelect.value === '' ? null : parameterSelect.value,
          set: setSelect.value === '' ? null : setSelect.value,
        };
        const updated = await send<DashboardDoc & ApiErrorBody>(
          'PUT',
          `/api/dashboards/${dashboard.id}`,
          {
            name: dashboard.name,
            layout: dashboard.layout,
            floating: dashboard.floating,
            phone_order: dashboard.phone_order,
            phone_heights: dashboard.phone_heights,
            actions: [...dashboard.actions, action],
          },
          { 'if-match': String(workbook.version) },
        );
        if (updated.status === 200) {
          dashboard.actions = updated.data.actions;
          workbook.version += 1;
          announcements.textContent = `Saved ${action.name}.`;
          dialog.close();
          return;
        }
        const errors = updated.data.errors;
        error.textContent =
          errors !== undefined && !Array.isArray(errors) ? errors.actions ?? 'Name is required.' : 'Name is required.';
      })();
    });
    focusFirst(dialog);
  });

  const filtersButton = el('button', { type: 'button', class: 'pill-button', text: 'Filters' });
  filtersButton.addEventListener('click', () => {
    const dialog = openDialog({ name: 'Filters', opener: filtersButton, bottomSheet: true });
    dialog.body.append(controls.root);
    const close = el('button', { type: 'button', class: 'pill-button', text: 'Close' });
    close.addEventListener('click', () => dialog.close());
    dialog.body.append(close);
  });

  host.append(
    el('div', { class: 'dashboard-page' }, [
      el('h1', { text: dashboard.name }),
      notice,
      announcements,
      el('div', { class: 'dash-head' }, [
        objectsList,
        isPhone() ? filtersButton : controls.root,
        extractState,
        exportControls,
        role === 'creator' ? addAction : null,
        actionLog,
      ]),
      stageWrap,
    ]),
  );

  drawObjects();
  layoutStage();
  reflow();
  wireRegions(host, () => [controls.root, ...dashboard.objects.map((object) => blocks.get(object.sheet)?.root).filter((node): node is HTMLElement => node !== undefined)]);

  const extractRes = await get<ExtractStateLike>(`/api/sources/${workbook.source}/extract`);
  if (extractRes.status === 200) extractState.textContent = extractStateText(extractRes.data);
  onEvent('extract', (event) => {
    if (event.source !== workbook.source) return;
    extractState.textContent = extractStateText(event);
  });

  window.addEventListener('resize', () => {
    layoutStage();
    reflow();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    for (const [sheetId, block] of blocks) {
      if (block.chartView.selected !== null) {
        block.chartView.clearSelection();
        void onSelect(sheetId, null);
        return;
      }
    }
  });

  await Promise.all([...blocks.keys()].map((sheetId) => runSheet(sheetId)));
}
