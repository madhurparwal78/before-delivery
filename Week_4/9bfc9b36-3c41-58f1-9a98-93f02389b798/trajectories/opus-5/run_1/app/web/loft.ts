import { call, ApiError, currentAccount } from './api';
import {
  announce, areaPair, chip, clear, el, instantText, lengthPair, money, poster, refuse, showDialog,
  table, type Column,
} from './ui';
import {
  EMPTY_COPY, SAIL_ACCOUNT_CHIPS, SAIL_ACCOUNT_LINES, STATUS_CHIP_LABELS, SUCCESS,
  supersededBannerCopy, PENDING_COPY,
} from '../src/shared/copy';
import { go } from './navigate';
import type { Drawing, Panel } from './nesting';

/** The loft, the boat page, the drawing overview and the Measure, Draw and Confirm steps. */

export interface Boat {
  readonly code: string;
  readonly name: string;
  readonly class_name: string;
  readonly owner: { email: string; display_name: string };
  readonly notes?: string;
  readonly revision?: number;
  readonly foretriangle: { area_mm2: number; area_m2: string; area_ft2: string; basis: string } | null;
  readonly dimensions: readonly Dimension[];
}

export interface Dimension {
  readonly key: string;
  readonly value_mm: number | null;
  readonly value_in: string | null;
  readonly status: 'measured' | 'remeasure';
  readonly remeasure_due: string | null;
  readonly measurements: readonly {
    id: string;
    value_mm: number;
    value_in: string;
    measured_on: string;
    source: string;
    photo: { size: number; sha256: string } | null;
  }[];
}

interface Page<T> {
  readonly items: readonly T[];
  readonly next_cursor: string | null;
  readonly total: number;
}

export interface Account {
  readonly id: string;
  readonly email: string;
  readonly display_name: string;
  readonly role: string;
}

const DIMENSION_KEYS = ['I', 'J', 'P', 'E', 'LL', 'LP'] as const;
const STATUS_OPTIONS = [
  'All', 'Measuring', 'Remeasure', 'Drawn', 'Nested', 'Cutting', 'Cut', 'Pending store', 'Issued',
] as const;

function statusChip(status: string): HTMLElement {
  const label = (STATUS_CHIP_LABELS as Record<string, string>)[status] ?? status;
  return chip(label, status === 'remeasure' || status === 'pending_store');
}

async function ownerOptions(): Promise<{ value: string; label: string }[]> {
  const page = await call<Page<Account>>('/api/accounts?limit=50');
  return page.items
    .filter((item) => item.role === 'yacht-owner')
    .map((item) => ({ value: item.email, label: item.display_name }));
}

async function loftHandOptions(): Promise<{ value: string; label: string }[]> {
  const page = await call<Page<Account>>('/api/accounts?limit=50');
  return page.items
    .filter((item) => item.role === 'loft-hand')
    .map((item) => ({ value: item.email, label: item.display_name }));
}

async function clothOptions(): Promise<{ value: string; label: string }[]> {
  const page = await call<Page<{ code: string; name: string }>>('/api/cloths?limit=50');
  return page.items.map((item) => ({ value: item.code, label: `${item.code} · ${item.name}` }));
}

async function boatOptions(): Promise<{ value: string; label: string }[]> {
  const page = await call<Page<Boat>>('/api/boats?limit=50');
  return page.items.map((item) => ({ value: item.code, label: `${item.code} · ${item.name}` }));
}

/* ------------------------------------------------------------------ loft */

export async function renderLoft(root: HTMLElement, query: URLSearchParams): Promise<void> {
  clear(root);
  root.append(el('h1', { text: 'Loft', tabindex: '-1' }));

  const status = query.get('status') ?? 'All';
  const filter = el('select', { 'aria-label': 'Status' });
  for (const option of STATUS_OPTIONS) {
    filter.append(el('option', { value: option, text: option, selected: option === status }));
  }
  filter.addEventListener('change', () => {
    const next = new URLSearchParams(location.search);
    if (filter.value === 'All') next.delete('status');
    else next.set('status', filter.value);
    go(`/loft${next.toString() === '' ? '' : `?${next.toString()}`}`);
  });

  const newBoat = el('button', { type: 'button', text: 'New boat' });
  newBoat.addEventListener('click', () => void openNewBoat(newBoat));
  const newDrawing = el('button', { class: 'action', type: 'button', text: 'New drawing' });
  newDrawing.addEventListener('click', () => void openNewDrawing(newDrawing));
  root.append(el('div', { class: 'row' }, [filter, newBoat, newDrawing]));

  const boats = await call<Page<Boat>>('/api/boats?limit=50');
  const boatColumns: Column<Boat>[] = [
    { header: 'Boat', cell: (row) => el('a', { href: `/boats/${row.code}`, text: row.code }) },
    { header: 'Name', cell: (row) => row.name },
    { header: 'Class', cell: (row) => row.class_name },
    { header: 'Owner', cell: (row) => row.owner.display_name },
    { header: 'Foretriangle', cell: (row) => (row.foretriangle === null ? '' : areaPair(row.foretriangle.area_mm2)) },
  ];
  root.append(el('div', { class: 'panelcard' }, [table('Boats', boatColumns, boats.items)]));

  const statusKey = status === 'All' ? '' : status.toLowerCase().replace(' ', '_');
  const drawings = await call<Page<Drawing>>(
    `/api/drawings?limit=50${statusKey === '' ? '' : `&status=${statusKey}`}`,
  );
  const drawingColumns: Column<Drawing>[] = [
    { header: 'Drawing', cell: (row) => el('a', { href: `/drawings/${row.code}`, text: row.code }) },
    { header: 'Boat', cell: (row) => row.boat_name },
    { header: 'Sail', cell: (row) => (row.sail === 'mainsail' ? 'Mainsail' : 'Headsail') },
    { header: 'Cloth', cell: (row) => row.cloth_code },
    { header: 'Lot', cell: (row) => row.lot ?? '' },
    { header: 'Status', cell: (row) => statusChip(row.status) },
  ];
  root.append(el('div', { class: 'panelcard' }, [table('Sail drawings', drawingColumns, drawings.items)]));
}

async function openNewBoat(opener: HTMLElement): Promise<void> {
  const owners = await ownerOptions();
  showDialog(
    {
      title: 'New boat',
      submit: 'Create boat',
      fields: [
        { name: 'name', label: 'Boat name' },
        { name: 'class_name', label: 'Class' },
        { name: 'notes', label: 'Notes' },
        { name: 'owner_email', label: 'Owner', options: owners },
      ],
      onSubmit: async (values) => {
        announce(PENDING_COPY.save);
        const boat = await call<Boat>('/api/boats', {
          method: 'POST',
          body: {
            name: values['name'],
            class_name: values['class_name'],
            notes: values['notes'],
            owner_email: values['owner_email'],
          },
        });
        announce(SUCCESS.saved);
        go(`/boats/${boat.code}`);
      },
    },
    opener,
  );
}

async function openNewDrawing(opener: HTMLElement): Promise<void> {
  const [boats, cloths] = await Promise.all([boatOptions(), clothOptions()]);
  showDialog(
    {
      title: 'New drawing',
      submit: 'Create drawing',
      fields: [
        { name: 'boat_code', label: 'Boat', options: boats },
        { name: 'sail', label: 'Sail', options: [
          { value: 'mainsail', label: 'Mainsail' },
          { value: 'headsail', label: 'Headsail' },
        ] },
        { name: 'cloth_code', label: 'Cloth', options: cloths },
      ],
      onSubmit: async (values) => {
        announce(PENDING_COPY.save);
        const drawing = await call<Drawing>('/api/drawings', {
          method: 'POST',
          body: { boat_code: values['boat_code'], sail: values['sail'], cloth_code: values['cloth_code'] },
        });
        announce(SUCCESS.saved);
        go(`/drawings/${drawing.code}/${drawing.step}`);
      },
    },
    opener,
  );
}

/* ------------------------------------------------------------------ boat */

export async function renderBoat(root: HTMLElement, code: string): Promise<void> {
  const boat = await call<Boat>(`/api/boats/${code}`);
  clear(root);
  const heading = el('h1', { text: `${boat.code} · ${boat.name}`, tabindex: '-1' });
  root.append(heading);
  root.append(el('p', { class: 'quiet', text: `${boat.class_name} · ${boat.owner.display_name}` }));

  if (boat.foretriangle !== null) {
    root.append(
      el('div', { class: 'poster-field' }, [
        poster(areaPair(boat.foretriangle.area_mm2), boat.foretriangle.basis),
      ]),
    );
  }

  const record = el('button', { class: 'action', type: 'button', text: 'Record measurement' });
  record.addEventListener('click', () => void openRecordMeasurement(root, boat, DIMENSION_KEYS, record));
  const edit = el('button', { type: 'button', text: 'Edit boat' });
  edit.addEventListener('click', () => void openEditBoat(root, boat, edit));
  root.append(el('div', { class: 'row' }, [record, edit]));

  const columns: Column<Dimension>[] = [
    { header: 'Dimension', cell: (row) => row.key },
    { header: 'Figure', cell: (row) => (row.value_mm === null ? '' : lengthPair(row.value_mm)) },
    {
      header: 'Status',
      cell: (row) => {
        const wrap = el('span');
        wrap.append(chip(STATUS_CHIP_LABELS[row.status === 'measured' ? 'measured' : 'remeasure'], row.status === 'remeasure'));
        if (row.remeasure_due !== null) wrap.append(document.createTextNode(` Remeasure by ${row.remeasure_due}`));
        return wrap;
      },
    },
    {
      header: 'Tape photo',
      cell: (row) => {
        const last = row.measurements[row.measurements.length - 1];
        if (last === undefined) return '';
        if (last.photo === null) {
          const add = el('button', { type: 'button', text: 'Attach photo' });
          add.addEventListener('click', () => void openPhoto(root, boat, last.id, add));
          return add;
        }
        return el('img', { src: `/api/measurements/${last.id}/photo`, alt: `Tape photo of ${row.key}`, width: '120' });
      },
    },
  ];
  root.append(el('div', { class: 'panelcard' }, [table('Rig dimensions', columns, boat.dimensions)]));
}

async function openRecordMeasurement(
  root: HTMLElement,
  boat: Boat,
  keys: readonly string[],
  opener: HTMLElement,
): Promise<void> {
  showDialog(
    {
      title: 'Record measurement',
      submit: 'Save measurement',
      fields: [
        { name: 'dimension', label: 'Dimension', options: keys.map((key) => ({ value: key, label: key })) },
        { name: 'value_mm', label: 'Measured length (mm)' },
        { name: 'measured_on', label: 'Measured on', type: 'date' },
        { name: 'photo', label: 'Tape photo', type: 'file', accept: 'image/jpeg,image/png' },
      ],
      onSubmit: async (values, files) => {
        announce(PENDING_COPY.save);
        const updated = await call<Boat>(`/api/boats/${boat.code}/measurements`, {
          method: 'POST',
          body: {
            dimension: values['dimension'],
            value_mm: Number(values['value_mm']),
            measured_on: values['measured_on'],
          },
        });
        const dimension = updated.dimensions.find((item) => item.key === values['dimension']);
        const file = files['photo'];
        if (file && dimension) {
          const last = dimension.measurements[dimension.measurements.length - 1];
          if (last) {
            await call(`/api/measurements/${last.id}/photo`, {
              method: 'PUT',
              raw: file,
              contentType: file.type,
            });
          }
        }
        announce(
          dimension && dimension.remeasure_due !== null
            ? SUCCESS.measurementSavedRemeasure(dimension.key, dimension.remeasure_due)
            : SUCCESS.measurementSaved,
        );
        await renderBoat(root, boat.code);
      },
    },
    opener,
  );
}

async function openPhoto(root: HTMLElement, boat: Boat, measurementId: string, opener: HTMLElement): Promise<void> {
  showDialog(
    {
      title: 'Record measurement',
      submit: 'Save measurement',
      fields: [{ name: 'photo', label: 'Tape photo', type: 'file', accept: 'image/jpeg,image/png' }],
      onSubmit: async (_values, files) => {
        const file = files['photo'];
        if (!file) return;
        await call(`/api/measurements/${measurementId}/photo`, {
          method: 'PUT',
          raw: file,
          contentType: file.type,
        });
        announce(SUCCESS.saved);
        await renderBoat(root, boat.code);
      },
    },
    opener,
  );
}

async function openEditBoat(root: HTMLElement, boat: Boat, opener: HTMLElement): Promise<void> {
  showDialog(
    {
      title: 'Edit boat',
      submit: 'Save boat',
      fields: [
        { name: 'name', label: 'Boat name', value: boat.name },
        { name: 'class_name', label: 'Class', value: boat.class_name },
        { name: 'notes', label: 'Notes', value: boat.notes ?? '' },
      ],
      onSubmit: async (values) => {
        announce(PENDING_COPY.save);
        await call<Boat>(`/api/boats/${boat.code}`, {
          method: 'PATCH',
          ifMatch: boat.revision ?? 1,
          body: { name: values['name'], class_name: values['class_name'], notes: values['notes'] },
        });
        announce(SUCCESS.saved);
        await renderBoat(root, boat.code);
      },
    },
    opener,
  );
}

/* ------------------------------------------------------------------ steps */

const STEP_LABELS: Record<string, string> = {
  measure: 'Measure',
  draw: 'Draw',
  nest: 'Nest',
  confirm: 'Confirm',
};
const STEP_ORDER = ['measure', 'draw', 'nest', 'confirm'] as const;

export function stepRail(drawing: Drawing, here: string | null): HTMLElement {
  const reached = STEP_ORDER.indexOf(drawing.step as (typeof STEP_ORDER)[number]);
  const nav = el('nav', { class: 'rail', 'aria-label': 'Sail steps' });
  STEP_ORDER.forEach((step, index) => {
    const label = STEP_LABELS[step] as string;
    const reachable = index <= (reached === -1 ? 3 : reached);
    if (reachable) {
      const link = el('a', { href: `/drawings/${drawing.code}/${step}`, text: label });
      if (step === here) link.setAttribute('aria-current', 'step');
      nav.append(link);
    } else {
      const span = el('span', { text: label });
      if (step === here) span.setAttribute('aria-current', 'step');
      nav.append(span);
    }
  });
  const marker = el('div', { class: 'rail-marker' });
  nav.append(marker);
  const position = here === null ? 0 : STEP_ORDER.indexOf(here as (typeof STEP_ORDER)[number]);
  marker.style.width = '25%';
  marker.style.left = '0';
  marker.style.transform = `translateX(${Math.max(0, position) * 100}%)`;
  return nav;
}

export async function renderMeasureStep(root: HTMLElement, code: string): Promise<void> {
  const drawing = await call<Drawing>(`/api/drawings/${code}`);
  const boat = await call<Boat>(`/api/boats/${drawing.boat_code}`);
  clear(root);
  root.append(stepRail(drawing, 'measure'));
  const sheet = el('div', { class: 'sheet step' });
  sheet.append(el('h1', { text: `Measure ${drawing.code}`, tabindex: '-1' }));
  const used = drawing.sail === 'mainsail' ? ['P', 'E'] : ['LP', 'LL'];
  const rows = boat.dimensions.filter((dimension) => used.includes(dimension.key));
  const columns: Column<Dimension>[] = [
    { header: 'Dimension', cell: (row) => row.key },
    { header: 'Figure', cell: (row) => (row.value_mm === null ? '' : lengthPair(row.value_mm)) },
    {
      header: 'Status',
      cell: (row) => {
        const wrap = el('span');
        wrap.append(chip(row.status === 'measured' ? STATUS_CHIP_LABELS.measured : STATUS_CHIP_LABELS.remeasure, row.status === 'remeasure'));
        if (row.remeasure_due !== null) wrap.append(document.createTextNode(` Remeasure by ${row.remeasure_due}`));
        return wrap;
      },
    },
  ];
  const record = el('button', { class: 'action', type: 'button', text: 'Record measurement' });
  record.addEventListener('click', () =>
    void openRecordMeasurement(root, boat, used, record).then(() => undefined),
  );
  sheet.append(el('div', { class: 'row' }, [record]));
  sheet.append(el('div', { class: 'panelcard' }, [table('Used dimensions', columns, rows)]));
  root.append(sheet);
}

export async function renderDrawStep(root: HTMLElement, code: string): Promise<void> {
  const drawing = await call<Drawing>(`/api/drawings/${code}`);
  clear(root);
  root.append(stepRail(drawing, 'draw'));
  const sheet = el('div', { class: 'sheet step' });
  sheet.append(el('h1', { text: `Draw ${drawing.code}`, tabindex: '-1' }));

  const spread = el('div', { class: 'spread' });
  const canvas = el('div', { class: 'canvas', role: 'region', 'aria-label': 'Sail drawing' });
  if (drawing.panels.length === 0) {
    canvas.append(el('p', { class: 'display', text: EMPTY_COPY.draw }));
  } else {
    canvas.append(panelPlan(drawing.panels));
    const list = el('div', { class: 'panellist' });
    for (const panel of drawing.panels) {
      const button = el('button', { type: 'button', text: `Panel ${panel.number}` });
      button.addEventListener('click', () => {
        const detail = sheet.querySelector('[data-panel-detail]');
        if (detail)
          detail.textContent = `Panel ${panel.number} · ${lengthPair(panel.length_mm)} × ${lengthPair(panel.width_mm)} · ${areaPair(panel.area_mm2)}`;
      });
      list.append(button);
    }
    canvas.append(list);
    canvas.append(el('p', { 'data-panel-detail': '' }));
  }
  spread.append(canvas);

  const side = el('div');
  const area = el('div', { class: 'poster-field', role: 'region', 'aria-label': 'Sail area' });
  if (drawing.area !== null) area.append(poster(areaPair(drawing.area.area_mm2), drawing.area.basis));
  else area.append(el('p', { class: 'quiet', text: EMPTY_COPY.draw }));
  side.append(area);
  side.append(el('p', {}, [statusChip(drawing.status)]));
  const draw = el('button', { class: 'action', type: 'button', text: 'Draw sail' });
  draw.addEventListener('click', () => {
    void (async () => {
      announce(PENDING_COPY.save);
      try {
        const drawn = await call<Drawing>(`/api/drawings/${code}/draw`, { method: 'POST' });
        announce(SUCCESS.drawn(drawn.panels.length));
        go(`/drawings/${code}/nest`);
      } catch (cause) {
        if (cause instanceof ApiError) refuse(cause.message);
      }
    })();
  });
  side.append(el('div', { class: 'controls' }, [draw]));
  spread.append(side);
  sheet.append(spread);
  root.append(sheet);
}

function panelPlan(panels: readonly Panel[]): SVGElement {
  const maxX = Math.max(1, ...panels.map((panel) => panel.length_mm));
  const maxY = Math.max(1, ...panels.map((panel) => panel.width_mm));
  const columns = Math.ceil(Math.sqrt(panels.length)) || 1;
  const rows = Math.ceil(panels.length / columns);
  const cellW = maxX + 300;
  const cellH = maxY + 300;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${columns * cellW} ${rows * cellH}`);
  panels.forEach((panel, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('transform', `translate(${column * cellW + 150},${row * cellH + 150})`);
    const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    polygon.setAttribute('points', panel.outline.map(([x, y]) => `${x},${y}`).join(' '));
    polygon.setAttribute('fill', 'none');
    polygon.setAttribute('stroke', '#ffffff');
    polygon.setAttribute('stroke-width', '34');
    polygon.setAttribute('role', 'img');
    polygon.setAttribute('aria-label', `Drawing panel ${panel.number}`);
    group.append(polygon);
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', '80');
    text.setAttribute('y', String(maxY / 2));
    text.setAttribute('fill', '#ffffff');
    text.setAttribute('font-size', '460');
    text.textContent = String(panel.number);
    group.append(text);
    svg.append(group);
  });
  return svg;
}

export { statusChip, ownerOptions, loftHandOptions, areaPair, money, instantText, SAIL_ACCOUNT_LINES, SAIL_ACCOUNT_CHIPS, supersededBannerCopy, currentAccount };
