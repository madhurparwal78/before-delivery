import { roundHalfUp } from '../../shared/numbers.js';
import type { ClientOrg, Mission, PlanPreview, Position, SurveyOrder } from '../../shared/types.js';
import { lengthToSi, lengthUnitLabel, speedToSi, speedUnitLabel, vertexUnitWord } from '../../shared/units.js';
import { ApiFailure, isCurrent, request } from '../api.js';
import type { Mounted, ScreenFactory } from '../app.js';
import { createChartRegion } from '../components/chartRegion.js';
import { button, clear, el, setText } from '../dom.js';
import type { Shell } from '../shell.js';

const COMMIT_DELAY_MS = 600;
const PREVIEW_DELAY_MS = 250;
const HISTORY_LIMIT = 20;

/** The six plan settings mirrored in the address, each holding the value as typed. */
const MIRRORED = ['depth', 'ratio', 'overlap', 'azimuth', 'speed', 'order'] as const;
type Mirrored = (typeof MIRRORED)[number];

interface HistoryStep {
  field: Mirrored | 'area' | 'fence' | 'name' | 'date' | 'client';
  label: string;
  before: string;
  after: string;
}

export const newMissionScreen: ScreenFactory = (shell, context): Mounted => {
  const preview = el('div', {
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Plan preview',
    class: 'live-region',
  });
  const formStatus = el('div', {
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Form status',
    class: 'live-region',
  });
  shell.registerRegion('Plan preview', preview);
  shell.registerRegion('Form status', formStatus);

  const summary = el('div', { role: 'alert', tabindex: '-1', class: 'error-summary' });
  summary.hidden = true;

  const units = shell.units;
  const lengthUnit = lengthUnitLabel(units);

  const name = textField('Mission name', 'mission-name');
  const client = el('select', { id: 'mission-client' });
  const date = textField('Survey date', 'mission-date');
  const area = areaField('Survey area vertices', 'survey-area');
  const fence = areaField('Geofence corners', 'geofence');
  const depth = numberField('Planned depth', 'planned-depth', lengthUnit, '0.1');
  const ratio = numberField('Swath ratio', 'swath-ratio', '× depth', '0.1');
  const overlap = numberField('Overlap', 'overlap', '%', '1');
  const azimuth = numberField('Line azimuth', 'azimuth', '°', '1');
  const speed = numberField('Planned speed', 'speed', speedUnitLabel(units), '0.1');
  const order = el('select', { id: 'survey-order' }, [
    el('option', { value: 'special' }, ['Special Order']),
    el('option', { value: '1a' }, ['Order 1a']),
  ]);

  const create = button('Create mission', { class: 'primary' });
  const chartRegion = createChartRegion({ lens: false });

  const fieldErrors = new Map<string, HTMLElement>();

  function textField(label: string, id: string): HTMLInputElement {
    return el('input', { type: 'text', id, 'data-label': label });
  }

  function numberField(
    label: string,
    id: string,
    unit: string,
    step: string,
  ): HTMLInputElement {
    return el('input', { type: 'number', id, step, 'data-label': label, 'data-unit': unit });
  }

  function areaField(label: string, id: string): HTMLTextAreaElement {
    return el('textarea', { id, rows: '5', 'data-label': label });
  }

  function labelled(
    control: HTMLElement,
    label: string,
    key: string,
    extras: HTMLElement[] = [],
  ): HTMLElement {
    const error = el('p', { class: 'field-error' });
    fieldErrors.set(key, error);
    const unit = control.getAttribute('data-unit');
    return el('div', { class: 'field' }, [
      el('label', { for: control.id }, [label]),
      control,
      unit ? el('span', { class: 'unit' }, [unit]) : null,
      ...extras,
      error,
    ]);
  }

  /** The vertex format help popover stays inside the viewport and traps no focus. */
  function vertexHelp(target: HTMLTextAreaElement): HTMLElement {
    const helpButton = button('Vertex format help', { class: 'help-button' });
    const popover = el('div', {
      role: 'dialog',
      'aria-label': 'Vertex format',
      class: 'popover',
    }, [
      el('p', {}, [
        `One vertex per line as easting, northing in ${vertexUnitWord(units)}, for example 5000, 8000. Enter starts a new line; Ctrl+Enter creates the mission.`,
      ]),
    ]);
    popover.hidden = true;

    const place = (): void => {
      const rect = helpButton.getBoundingClientRect();
      popover.style.position = 'fixed';
      popover.style.zIndex = '400';
      popover.hidden = false;
      const width = Math.min(320, window.innerWidth - 16);
      popover.style.width = `${width}px`;
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
      popover.style.left = `${left}px`;
      const height = popover.offsetHeight || 120;
      const below = rect.bottom + 8;
      popover.style.top = `${below + height > window.innerHeight ? Math.max(8, rect.top - height - 8) : below}px`;
    };

    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || popover.hidden) return;
      event.preventDefault();
      close();
    };
    const close = (): void => {
      popover.hidden = true;
      document.removeEventListener('keydown', onKey, true);
      helpButton.focus();
    };

    helpButton.addEventListener('click', () => {
      if (popover.hidden) {
        place();
        document.addEventListener('keydown', onKey, true);
      } else {
        close();
      }
    });
    document.addEventListener('click', (event) => {
      if (popover.hidden) return;
      if (!popover.contains(event.target as Node) && event.target !== helpButton) {
        popover.hidden = true;
      }
    });
    void target;
    return el('span', { class: 'help-wrap' }, [helpButton, popover]);
  }

  const form = el('form', { 'aria-label': 'New mission', class: 'planner-form', novalidate: true }, [
    el('h1', {}, ['New mission']),
    summary,
    labelled(name, 'Mission name', 'name'),
    el('div', { class: 'field' }, [
      el('label', { for: 'mission-client' }, ['Client']),
      client,
      fieldError('client_org_id'),
    ]),
    labelled(date, 'Survey date', 'survey_date'),
    labelled(area, 'Survey area vertices', 'survey_area', [vertexHelp(area)]),
    labelled(fence, 'Geofence corners', 'geofence', [vertexHelp(fence)]),
    labelled(depth, 'Planned depth', 'planned_depth_m'),
    labelled(ratio, 'Swath ratio', 'swath_ratio'),
    labelled(overlap, 'Overlap', 'overlap_pct'),
    labelled(azimuth, 'Line azimuth', 'line_azimuth_deg'),
    labelled(speed, 'Planned speed', 'planned_speed_mps'),
    el('div', { class: 'field' }, [
      el('label', { for: 'survey-order' }, ['Survey order']),
      order,
      fieldError('survey_order'),
    ]),
    create,
    preview,
    formStatus,
  ]);

  function fieldError(key: string): HTMLElement {
    const error = el('p', { class: 'field-error' });
    fieldErrors.set(key, error);
    return error;
  }

  const node = el('section', { class: 'planner' }, [form, chartRegion.node]);

  // ---- address mirror ----

  const CONTROL_FOR: Record<Mirrored, HTMLInputElement | HTMLSelectElement> = {
    depth,
    ratio,
    overlap,
    azimuth,
    speed,
    order,
  };

  function readAddress(): void {
    for (const key of MIRRORED) {
      const value = context.query.get(key);
      if (value === null) continue;
      CONTROL_FOR[key].value = value;
    }
  }

  function writeAddress(): void {
    const params = new URLSearchParams(window.location.search);
    for (const key of MIRRORED) {
      const value = CONTROL_FOR[key].value;
      if (value === '') params.delete(key);
      else params.set(key, value);
    }
    const next = `/missions/new${params.toString() ? `?${params.toString()}` : ''}`;
    window.history.replaceState(null, '', next);
  }

  // ---- plan preview, latest wins ----

  let previewSequence = 0;
  let latestSequence = 0;
  let previewTimer: number | null = null;

  function parseVertices(text: string): Position[] | null {
    const rows = text
      .split('\n')
      .map((row) => row.trim())
      .filter((row) => row.length > 0);
    const points: Position[] = [];
    for (const row of rows) {
      const parts = row.split(',').map((part) => part.trim());
      if (parts.length !== 2) return null;
      const easting = Number(parts[0]);
      const northing = Number(parts[1]);
      if (!Number.isFinite(easting) || !Number.isFinite(northing)) return null;
      points.push({
        easting: lengthToSi(easting, units),
        northing: lengthToSi(northing, units),
      });
    }
    return points.length > 0 ? points : null;
  }

  function planBody(): Record<string, unknown> | null {
    const vertices = parseVertices(area.value);
    if (!vertices) return null;
    const body: Record<string, unknown> = {
      survey_area: vertices,
      survey_order: order.value as SurveyOrder,
    };
    if (depth.value !== '') body.planned_depth_m = lengthToSi(Number(depth.value), units);
    if (ratio.value !== '') body.swath_ratio = Number(ratio.value);
    if (overlap.value !== '') body.overlap_pct = Number(overlap.value);
    if (azimuth.value !== '') body.line_azimuth_deg = Number(azimuth.value);
    if (speed.value !== '') body.planned_speed_mps = speedToSi(Number(speed.value), units);
    return body;
  }

  function schedulePreview(): void {
    if (previewTimer !== null) window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => void runPreview(), PREVIEW_DELAY_MS);
  }

  async function runPreview(): Promise<void> {
    const body = planBody();
    previewSequence += 1;
    const sequence = previewSequence;
    if (!body) {
      latestSequence = sequence;
      setText(preview, 'Fix the highlighted fields to see the plan');
      return;
    }
    setText(preview, 'Updating plan');
    const at = shell.generation;
    try {
      const result = await request<PlanPreview>('/api/plan-preview', { method: 'POST', body });
      // A response to earlier input is discarded, even when it arrives last.
      if (sequence < latestSequence || !isCurrent(at)) return;
      latestSequence = sequence;
      clearFieldErrors();
      setText(
        preview,
        `${result.line_count} lines · ${result.crossline_count} cross · ${roundHalfUp(result.estimated_duration_s / 60)} min`,
      );
      paintChartPreview(body, result);
    } catch (error) {
      if (sequence < latestSequence || !isCurrent(at)) return;
      latestSequence = sequence;
      setText(preview, 'Fix the highlighted fields to see the plan');
      if (error instanceof ApiFailure && error.body.errors) showFieldErrors(error.body.errors);
    }
  }

  function paintChartPreview(body: Record<string, unknown>, result: PlanPreview): void {
    const vertices = body.survey_area as Position[];
    const fenceVertices = parseVertices(fence.value) ?? vertices;
    chartRegion.setData({
      mission: {
        survey_area: vertices,
        geofence: fenceVertices,
        swath_ratio: Number(body.swath_ratio ?? 4),
        line_azimuth_deg: Number(body.line_azimuth_deg ?? 0),
        planned_speed_mps: Number(body.planned_speed_mps ?? 2),
      } as Mission,
      lines: [],
      tracks: [],
      holidays: [],
      coverage: null,
      vessels: [],
    });
    void result;
  }

  function clearFieldErrors(): void {
    for (const error of fieldErrors.values()) setText(error, '');
  }

  function showFieldErrors(errors: Record<string, string>): void {
    clearFieldErrors();
    for (const [field, message] of Object.entries(errors)) {
      const target = fieldErrors.get(field);
      if (target) setText(target, message);
    }
  }

  // ---- committed-edit history ----

  const past: HistoryStep[] = [];
  const future: HistoryStep[] = [];
  const committed = new Map<string, string>();

  function controlFor(field: HistoryStep['field']): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
    switch (field) {
      case 'area':
        return area;
      case 'fence':
        return fence;
      case 'name':
        return name;
      case 'date':
        return date;
      case 'client':
        return client;
      default:
        return CONTROL_FOR[field];
    }
  }

  function commit(field: HistoryStep['field'], label: string): void {
    const control = controlFor(field);
    const before = committed.get(field) ?? '';
    const after = control.value;
    if (before === after) return;
    committed.set(field, after);
    past.push({ field, label, before, after });
    if (past.length > HISTORY_LIMIT) past.shift();
    future.length = 0;
    writeAddress();
    schedulePreview();
  }

  function applyStep(step: HistoryStep, value: string, word: 'Undid' | 'Redid'): void {
    const control = controlFor(step.field);
    control.value = value;
    committed.set(step.field, value);
    control.focus();
    writeAddress();
    void runPreview();
    setText(formStatus, `${word} ${step.label}: ${value === '' ? 'empty' : value}`);
  }

  function undo(): void {
    const step = past.pop();
    if (!step) {
      setText(formStatus, 'Nothing to undo');
      return;
    }
    future.push(step);
    applyStep(step, step.before, 'Undid');
  }

  function redo(): void {
    const step = future.pop();
    if (!step) {
      setText(formStatus, 'Nothing to redo');
      return;
    }
    past.push(step);
    applyStep(step, step.after, 'Redid');
  }

  const FIELDS: [HistoryStep['field'], HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, string][] = [
    ['name', name, 'Mission name'],
    ['client', client, 'Client'],
    ['date', date, 'Survey date'],
    ['area', area, 'Survey area vertices'],
    ['fence', fence, 'Geofence corners'],
    ['depth', depth, 'Planned depth'],
    ['ratio', ratio, 'Swath ratio'],
    ['overlap', overlap, 'Overlap'],
    ['azimuth', azimuth, 'Line azimuth'],
    ['speed', speed, 'Planned speed'],
    ['order', order, 'Survey order'],
  ];

  for (const [field, control, label] of FIELDS) {
    let keyTimer: number | null = null;
    control.addEventListener('input', () => {
      if (keyTimer !== null) window.clearTimeout(keyTimer);
      keyTimer = window.setTimeout(() => commit(field, label), COMMIT_DELAY_MS);
      schedulePreview();
    });
    control.addEventListener('change', () => commit(field, label));
    control.addEventListener('blur', () => {
      if (keyTimer !== null) window.clearTimeout(keyTimer);
      commit(field, label);
    });
  }

  form.addEventListener('keydown', (event) => {
    const meta = event.ctrlKey || event.metaKey;
    if (meta && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (meta && event.key === 'Enter') {
      event.preventDefault();
      void submit();
    }
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit();
  });
  create.addEventListener('click', (event) => {
    event.preventDefault();
    void submit();
  });

  async function submit(): Promise<void> {
    summary.hidden = true;
    setText(formStatus, 'Creating mission');
    const vertices = parseVertices(area.value) ?? [];
    const fenceVertices = parseVertices(fence.value) ?? [];
    const body: Record<string, unknown> = {
      name: name.value,
      client_org_id: client.value,
      survey_date: date.value,
      survey_area: vertices,
      geofence: fenceVertices,
      survey_order: order.value,
    };
    if (depth.value !== '') body.planned_depth_m = lengthToSi(Number(depth.value), units);
    if (ratio.value !== '') body.swath_ratio = Number(ratio.value);
    if (overlap.value !== '') body.overlap_pct = Number(overlap.value);
    if (azimuth.value !== '') body.line_azimuth_deg = Number(azimuth.value);
    if (speed.value !== '') body.planned_speed_mps = speedToSi(Number(speed.value), units);

    const at = shell.generation;
    try {
      const mission = await request<Mission>('/api/missions', {
        method: 'POST',
        body,
        headers: { 'idempotency-key': `mission-${Date.now()}-${Math.random().toString(36).slice(2)}` },
      });
      if (!isCurrent(at)) return;
      setText(formStatus, '');
      shell.navigate(`/missions/${mission.id}/plan`);
    } catch (error) {
      if (!isCurrent(at)) return;
      setText(formStatus, '');
      if (error instanceof ApiFailure && error.body.errors) {
        showErrorSummary(error.body.errors);
        return;
      }
      showErrorSummary({ name: error instanceof ApiFailure ? error.message : 'Could not create the mission' });
    }
  }

  function showErrorSummary(errors: Record<string, string>): void {
    showFieldErrors(errors);
    clear(summary);
    summary.append(el('h2', {}, ['Fix these before creating the mission']));
    const list = el('ul', {});
    for (const [field, message] of Object.entries(errors)) {
      const link = el('a', { href: `#${field}` }, [message]);
      link.addEventListener('click', (event) => {
        event.preventDefault();
        const control = controlForKey(field);
        control?.focus();
      });
      list.append(el('li', {}, [link]));
    }
    summary.append(list);
    summary.hidden = false;
    summary.focus();
  }

  function controlForKey(field: string): HTMLElement | null {
    const map: Record<string, HTMLElement> = {
      name,
      client_org_id: client,
      survey_date: date,
      survey_area: area,
      geofence: fence,
      planned_depth_m: depth,
      swath_ratio: ratio,
      overlap_pct: overlap,
      line_azimuth_deg: azimuth,
      planned_speed_mps: speed,
      survey_order: order,
    };
    return map[field] ?? null;
  }

  // Enter inside the vertex fields starts a new line rather than submitting.
  for (const field of [area, fence]) {
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) event.stopPropagation();
    });
  }

  const at = shell.generation;
  void request<ClientOrg[]>('/api/client-orgs')
    .then((orgs) => {
      if (!isCurrent(at)) return;
      client.replaceChildren(
        ...orgs.map((org) => el('option', { value: org.id }, [org.name])),
      );
      committed.set('client', client.value);
    })
    .catch(() => undefined);

  readAddress();
  for (const [field, control] of FIELDS) committed.set(field, control.value);
  void runPreview();

  return {
    node,
    dispose: () => {
      if (previewTimer !== null) window.clearTimeout(previewTimer);
      shell.unregisterRegion('Plan preview');
      shell.unregisterRegion('Form status');
    },
  };
};

export type { Shell };
