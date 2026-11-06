/* New mission planner: keyboard-first form with live preview, address mirror, undo/redo. */
import { Position } from './app.js';
import { apiFetch, ApiError } from './api.js';
import { h, clear, byId, openModal, focusSafe, debounce } from './dom.js';
import { store } from './state.js';
import { toMetricLength, toMetricSpeed } from './app.js';

interface PlanSettings {
  depth: string;
  ratio: string;
  overlap: string;
  azimuth: string;
  speed: string;
  order: 'special' | '1a';
}

const FIELD_LABELS: Record<string, string> = {
  depth: 'Planned depth',
  ratio: 'Swath ratio',
  overlap: 'Overlap',
  azimuth: 'Line azimuth',
  speed: 'Planned speed',
  order: 'Survey order',
  name: 'Mission name',
  date: 'Survey date',
  area: 'Survey area vertices',
  fence: 'Geofence corners',
  client: 'Client',
};

export function plannerDefaults(): PlanSettings {
  return { depth: '10', ratio: '4', overlap: '20', azimuth: '0', speed: '2.0', order: '1a' };
}

export function parseAddressSettings(): PlanSettings {
  const p = new URLSearchParams(location.search);
  const d = plannerDefaults();
  return {
    depth: p.get('depth') ?? d.depth,
    ratio: p.get('ratio') ?? d.ratio,
    overlap: p.get('overlap') ?? d.overlap,
    azimuth: p.get('azimuth') ?? d.azimuth,
    speed: p.get('speed') ?? d.speed,
    order: p.get('order') === 'special' ? 'special' : p.get('order') === '1a' ? '1a' : d.order,
  };
}

export function mirrorSettingsToAddress(s: PlanSettings): void {
  const p = new URLSearchParams();
  p.set('depth', s.depth);
  p.set('ratio', s.ratio);
  p.set('overlap', s.overlap);
  p.set('azimuth', s.azimuth);
  p.set('speed', s.speed);
  p.set('order', s.order === 'special' ? 'special' : '1a');
  const target = `${location.pathname}?${p.toString()}`;
  if (target !== location.pathname + location.search) {
    window.history.replaceState({}, '', target);
  }
}

export function renderNewMission(root: HTMLElement): void {
  clear(root);
  const units = store.units;
  const settings = parseAddressSettings();

  interface UndoStep { field: string; before: string; after: string }
  const undoStack: UndoStep[] = [];
  const redoStack: UndoStep[] = [];

  const previewEl = h('div', { id: 'plan-preview', role: 'status', 'aria-live': 'polite', 'aria-label': 'Plan preview', class: 'banner mono' });
  const formStatusEl = h('div', { id: 'form-status', role: 'status', 'aria-live': 'polite', 'aria-label': 'Form status', class: 'banner' });
  const errorSummary = h('div', { class: 'error-summary hidden', role: 'alert', tabindex: '-1' },
    h('h2', {}, 'Fix these before creating the mission'));
  const errorLinks = h('ul', {});
  errorSummary.append(errorLinks);

  const name = h('input', { type: 'text', id: 'nm-name', 'aria-label': 'Mission name', maxlength: '80' }) as HTMLInputElement;
  const date = h('input', { type: 'text', id: 'nm-date', 'aria-label': 'Survey date', placeholder: 'YYYY-MM-DD' }) as HTMLInputElement;
  const areaText = h('textarea', { id: 'nm-area', 'aria-label': 'Survey area vertices', rows: '4', spellcheck: 'false' }) as HTMLTextAreaElement;
  const fenceText = h('textarea', { id: 'nm-fence', 'aria-label': 'Geofence corners', rows: '4', spellcheck: 'false' }) as HTMLTextAreaElement;

  const clientSelect = h('select', { id: 'nm-client', 'aria-label': 'Client' }) as HTMLSelectElement;
  const orderSelect = h('select', { id: 'nm-order', 'aria-label': 'Survey order' }) as HTMLSelectElement;
  orderSelect.append(
    h('option', { value: 'special' }, 'Special Order'),
    h('option', { value: '1a' }, 'Order 1a'),
  );
  orderSelect.value = settings.order;

  const unitLabel = units === 'metric' ? 'm' : 'ft';
  const speedUnit = units === 'metric' ? 'm/s' : 'kn';

  const num = (id: string, label: string, value: string, unit: string, min?: string, max?: string): { wrap: HTMLElement; input: HTMLInputElement } => {
    const input = h('input', { type: 'number', id, 'aria-label': label, value, step: 'any', ...(min ? { min } : {}), ...(max ? { max } : {}) }) as HTMLInputElement;
    const err = h('p', { class: 'field-error mono', id: `${id}-err` });
    const wrap = h('div', { class: 'field' },
      h('label', { for: id }, label),
      h('span', { class: 'field-row' }, input, h('span', { class: 'unit' }, unit)),
      err);
    return { wrap, input };
  };

  const depth = num('nm-depth', 'Planned depth', settings.depth, unitLabel, '1', '200');
  const ratio = num('nm-ratio', 'Swath ratio', settings.ratio, '× depth', '1', '8');
  const overlap = num('nm-overlap', 'Overlap', settings.overlap, '%', '0', '50');
  const azimuth = num('nm-azimuth', 'Line azimuth', settings.azimuth, '°', '0', '179');
  const speed = num('nm-speed', 'Planned speed', settings.speed, speedUnit, '0.5', '4');

  // Vertex format help
  const helpText = units === 'metric'
    ? 'One vertex per line as easting, northing in metres, for example 5000, 8000. Enter starts a new line; Ctrl+Enter creates the mission.'
    : 'One vertex per line as easting, northing in feet, for example 16404, 26246. Enter starts a new line; Ctrl+Enter creates the mission.';
  const openHelp = (anchor: HTMLElement, which: 'area' | 'fence'): void => {
    const pop = h('div', { class: 'popover', role: 'dialog', 'aria-label': 'Vertex format' },
      h('p', {}, which === 'area'
        ? (units === 'metric'
          ? 'One vertex per line as easting, northing in metres, for example 5000, 8000. Enter starts a new line; Ctrl+Enter creates the mission.'
          : 'One vertex per line as easting, northing in feet, for example 16404, 26246. Enter starts a new line; Ctrl+Enter creates the mission.')
        : (units === 'metric'
          ? 'One vertex per line as easting, northing in metres, for example 5000, 8000. Enter starts a new line; Ctrl+Enter creates the mission.'
          : 'One vertex per line as easting, northing in feet, for example 16404, 26246. Enter starts a new line; Ctrl+Enter creates the mission.')),
    );
    const rect = anchor.getBoundingClientRect();
    pop.style.position = 'fixed';
    pop.style.left = `${Math.max(8, Math.min(window.innerWidth - 340, rect.left))}px`;
    pop.style.top = `${Math.max(8, rect.bottom + 6)}px`;
    if (rect.bottom + 220 > window.innerHeight) {
      pop.style.top = `${Math.max(8, rect.top - 210)}px`;
    }
    pop.style.zIndex = '999';
    document.body.append(pop);
    const close = (): void => { pop.remove(); document.removeEventListener('pointerdown', outside, true); focusSafe(anchor); };
    const outside = (e: PointerEvent): void => { if (!pop.contains(e.target as Node)) close(); };
    setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); document.removeEventListener('keydown', onKey, true); close(); }
    };
    document.addEventListener('keydown', onKey, true);
  };

  const areaHelp = h('button', { type: 'button', class: 'btn subtle help-btn', 'aria-label': 'Vertex format help' }, 'Vertex format help');
  areaHelp.addEventListener('click', () => openHelp(areaHelp, 'area'));
  const fenceHelp = h('button', { type: 'button', class: 'btn subtle help-btn', 'aria-label': 'Vertex format help' }, 'Vertex format help');
  fenceHelp.addEventListener('click', () => openHelp(fenceHelp, 'fence'));

  const parseVertices = (text: string): Position[] | null => {
    const out: Position[] = [];
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      const m = /^(-?[\d.]+)\s*,\s*(-?[\d.]+)$/.exec(t);
      if (!m) return null;
      out.push({ easting: toMetricLength(Number(m[1]), units), northing: toMetricLength(Number(m[2]), units) });
    }
    return out;
  };

  const settingsNow = (): PlanSettings => ({
    depth: depth.input.value || plannerDefaults().depth,
    ratio: ratio.input.value || plannerDefaults().ratio,
    overlap: overlap.input.value !== '' ? overlap.input.value : plannerDefaults().overlap,
    azimuth: azimuth.input.value || plannerDefaults().azimuth,
    speed: speed.input.value || plannerDefaults().speed,
    order: orderSelect.value as 'special' | '1a',
  });

  let previewSeq = 0;
  const runPreview = async (): Promise<void> => {
    const area = parseVertices(areaText.value);
    const s = settingsNow();
    mirrorSettingsToAddress(s);
    if (!area || area.length < 3) {
      previewEl.textContent = 'Fix the highlighted fields to see the plan';
      return;
    }
    const body = {
      survey_area: area,
      planned_depth_m: toMetricLength(Number(s.depth), units),
      swath_ratio: Number(s.ratio),
      overlap_pct: Number(s.overlap),
      line_azimuth_deg: Number(s.azimuth),
      planned_speed_mps: toMetricSpeed(Number(s.speed), units),
      survey_order: s.order,
    };
    // Invalid numbers: show the invalid copy without a request
    if ([body.planned_depth_m, body.swath_ratio, body.overlap_pct, body.line_azimuth_deg, body.planned_speed_mps].some(v => !Number.isFinite(v))) {
      previewEl.textContent = 'Fix the highlighted fields to see the plan';
      return;
    }
    const seq = ++previewSeq;
    previewEl.textContent = 'Updating plan';
    try {
      const r = await apiFetch<{ line_count: number; crossline_count: number; estimated_duration_s: number }>('POST', '/api/plan-preview', body);
      if (seq !== previewSeq) return; // a newer edit superseded this response
      const minutes = Math.round(r.estimated_duration_s / 60);
      previewEl.textContent = `${r.line_count} lines · ${r.crossline_count} cross · ${minutes} min`;
    } catch (e) {
      if (seq !== previewSeq) return;
      previewEl.textContent = 'Fix the highlighted fields to see the plan';
    }
  };

  const debouncedPreview = debounce(() => { void runPreview(); }, 250);

  const commitStep = (field: string, before: string, after: string): void => {
    undoStack.push({ field, before, after });
    if (undoStack.length > 20) undoStack.shift();
    redoStack.length = 0;
    mirrorSettingsToAddress(settingsNow());
    void runPreview();
  };

  const bindCommit = (input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, field: string): void => {
    let before: string | null = null;
    input.addEventListener('focus', () => { before = input.value; });
    input.addEventListener('blur', () => {
      if (before !== null && input.value !== before) commitStep(field, before, input.value);
      before = null;
    });
    let timer: ReturnType<typeof setTimeout> | null = null;
    input.addEventListener('input', () => {
      debouncedPreview();
      if (timer) clearTimeout(timer);
      const b = before ?? input.value;
      timer = setTimeout(() => {
        if (input.value !== b) {
          commitStep(field, b, input.value);
          before = input.value;
        }
      }, 600);
    });
  };

  bindCommit(depth.input, 'depth');
  bindCommit(ratio.input, 'ratio');
  bindCommit(overlap.input, 'overlap');
  bindCommit(azimuth.input, 'azimuth');
  bindCommit(speed.input, 'speed');
  bindCommit(orderSelect, 'order');

  const fieldByName = (field: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement => {
    switch (field) {
      case 'depth': return depth.input;
      case 'ratio': return ratio.input;
      case 'overlap': return overlap.input;
      case 'azimuth': return azimuth.input;
      case 'speed': return speed.input;
      case 'order': return orderSelect;
      default: return name;
    }
  };

  const doUndo = (): void => {
    const step = undoStack.pop();
    if (!step) { formStatusEl.textContent = 'Nothing to undo'; return; }
    const f = fieldByName(step.field);
    f.value = step.before;
    redoStack.push(step);
    formStatusEl.textContent = `Undid ${FIELD_LABELS[step.field] ?? step.field}: ${step.before === '' ? 'empty' : step.before}`;
    mirrorSettingsToAddress(settingsNow());
    void runPreview();
    focusSafe(f);
  };

  const doRedo = (): void => {
    const step = redoStack.pop();
    if (!step) { formStatusEl.textContent = 'Nothing to redo'; return; }
    const f = fieldByName(step.field);
    f.value = step.after;
    undoStack.push(step);
    formStatusEl.textContent = `Redid ${FIELD_LABELS[step.field] ?? step.field}: ${step.after === '' ? 'empty' : step.after}`;
    mirrorSettingsToAddress(settingsNow());
    void runPreview();
    focusSafe(f);
  };

  const createMission = async (): Promise<void> => {
    formStatusEl.textContent = 'Creating mission';
    errorSummary.classList.add('hidden');
    clear(errorLinks);
    const area = parseVertices(areaText.value);
    const fence = parseVertices(fenceText.value);
    const s = settingsNow();
    try {
      const resp = await apiFetch<{ id: string }>('POST', '/api/missions', {
        name: name.value,
        client_org_id: clientSelect.value,
        survey_date: date.value,
        survey_area: area ?? [],
        geofence: fence ?? [],
        planned_depth_m: toMetricLength(Number(s.depth), units),
        swath_ratio: Number(s.ratio),
        overlap_pct: Number(s.overlap),
        line_azimuth_deg: Number(s.azimuth),
        planned_speed_mps: toMetricSpeed(Number(s.speed), units),
        survey_order: s.order,
      });
      window.location.href = `/missions/${resp.id}/plan`;
    } catch (err) {
      const e2 = err as ApiError;
      const errors = (e2.body?.errors ?? {}) as Record<string, string>;
      const map: Record<string, string> = {
        name: 'Mission name', survey_date: 'Survey date',
        survey_area: 'Survey area vertices', geofence: 'Geofence corners',
        planned_depth_m: 'Planned depth', swath_ratio: 'Swath ratio',
        overlap_pct: 'Overlap', line_azimuth_deg: 'Line azimuth',
        planned_speed_mps: 'Planned speed', survey_order: 'Survey order',
      };
      for (const [k, msg] of Object.entries(errors)) {
        const label = map[k] ?? k;
        errorLinks.append(h('li', {}, h('a', {
          href: '#',
          onclick: (ev: Event) => {
            ev.preventDefault();
            const target = k === 'name' ? name : k === 'survey_date' ? date
              : k === 'survey_area' ? areaText : k === 'geofence' ? fenceText
                : k === 'planned_depth_m' ? depth.input : k === 'swath_ratio' ? ratio.input
                  : k === 'overlap_pct' ? overlap.input : k === 'line_azimuth_deg' ? azimuth.input
                    : k === 'planned_speed_mps' ? speed.input : k === 'survey_order' ? orderSelect : name;
            focusSafe(target);
          },
        }, `${label}: ${msg}`)));
        // field-level messages
        const errTarget = k === 'planned_depth_m' ? depth : k === 'swath_ratio' ? ratio
          : k === 'overlap_pct' ? overlap : k === 'line_azimuth_deg' ? azimuth
            : k === 'planned_speed_mps' ? speed : null;
        if (errTarget) {
          const p = errTarget.wrap.querySelector('.field-error') as HTMLElement;
          p.textContent = msg;
        }
      }
      errorSummary.classList.remove('hidden');
      formStatusEl.textContent = '';
      focusSafe(errorSummary);
    }
  };

  const form = h('form', { id: 'new-mission-form', 'aria-label': 'New mission', class: 'planner-form', novalidate: true },
    h('h1', {}, 'New mission'),
    errorSummary,
    h('div', { class: 'field' }, h('label', { for: 'nm-name' }, 'Mission name'), name),
    h('div', { class: 'field' }, h('label', { for: 'nm-client' }, 'Client'), clientSelect),
    h('div', { class: 'field' }, h('label', { for: 'nm-date' }, 'Survey date'), date),
    h('div', { class: 'field' },
      h('label', { for: 'nm-area' }, 'Survey area vertices'),
      areaText,
      areaHelp,
      h('p', { class: 'field-error mono', id: 'nm-area-err' })),
    h('div', { class: 'field' },
      h('label', { for: 'nm-fence' }, 'Geofence corners'),
      fenceText,
      fenceHelp,
      h('p', { class: 'field-error mono', id: 'nm-fence-err' })),
    depth.wrap, ratio.wrap, overlap.wrap, azimuth.wrap, speed.wrap,
    h('div', { class: 'field' }, h('label', { for: 'nm-order' }, 'Survey order'), orderSelect),
    h('button', { type: 'submit', class: 'btn primary' }, 'Create mission'),
    formStatusEl,
  );

  form.addEventListener('submit', (e) => { e.preventDefault(); void createMission(); });
  form.addEventListener('keydown', (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
    else if (mod && e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); doRedo(); }
    else if (mod && e.key === 'Enter') { e.preventDefault(); void createMission(); }
  });
  [areaText, fenceText].forEach(t => {
    t.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
        // default textarea behaviour starts a new line
        return;
      }
    });
  });
  [name, date, areaText, fenceText].forEach(inp => {
    let before: string | null = null;
    inp.addEventListener('focus', () => { before = inp.value; });
    inp.addEventListener('blur', () => { before = null; });
    inp.addEventListener('input', () => {
      debouncedPreview();
      if (!areaText.value.trim()) previewEl.textContent = 'Fix the highlighted fields to see the plan';
    });
  });

  const previewCard = h('aside', { class: 'planner-preview', 'aria-label': 'Plan preview card' },
    h('h2', { class: 'region-heading' }, 'Plan preview'),
    previewEl,
  );

  // Load client orgs
  void apiFetch<{ id: string; name: string }[]>('GET', '/api/client-orgs').then(orgs => {
    if (!clientSelect.isConnected) return;
    clear(clientSelect);
    for (const o of orgs) clientSelect.append(h('option', { value: o.id }, o.name));
  }).catch(() => undefined);

  root.append(h('div', { class: 'planner-grid' }, form, previewCard));
  void runPreview();
  name.focus();
}
