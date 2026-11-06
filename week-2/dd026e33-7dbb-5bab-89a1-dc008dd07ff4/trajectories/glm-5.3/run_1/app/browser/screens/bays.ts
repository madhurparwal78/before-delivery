/**
 * Bays — the concierge's home. Floor plan, searchable Cars table and the
 * Register car dialog. Search lives in the address.
 */
import { api, ApiFailure, NoAnswer } from '../api.ts';
import { state, replaceHistory } from '../state.ts';
import { announce, h, patchText, reconcile } from '../ui.ts';
import { openDialog } from '../dialog.ts';
import { buildFloorPlan, type BayData } from '../components/floorplan.ts';
import { carsFound, registerCarPending, registeredCopy } from '../../shared/copy.ts';
import { distanceUnitLabel, pressureUnitLabel } from '../../shared/units.ts';
import type { Screen } from './screen.ts';
import { navigate } from '../app.ts';

interface CarData {
  id: string;
  name: string;
  status: string;
  bay: { id: string; code: string } | null;
  owner: { name: string };
}

export function renderBays(main: HTMLElement): Screen {
  let searchTimer: number | null = null;
  let searchSequence = 0;
  let lastAnnouncedQuery: string | null = state.route.query.get('q') ?? '';
  let destroyed = false;

  const tableBody = h('tbody');
  const carsTable = h('table', { class: 'sheet', 'aria-label': 'Cars' },
    h('thead', null, h('tr', null,
      h('th', { text: 'Car' }), h('th', { text: 'Owner' }),
      h('th', { text: 'Status' }), h('th', { text: 'Bay' }))),
    tableBody,
  );
  const updateRegion = h('p', { class: 'status-region', role: 'status', 'data-region': 'bay-updates' });
  const search = h('input', {
    type: 'search',
    'aria-label': 'Search cars',
    value: state.route.query.get('q') ?? '',
  });
  const planArea = h('div');

  const rowFor = (car: CarData): HTMLElement => {
    const link = h('a', { href: `/cars/${car.id}`, text: car.name });
    link.addEventListener('click', (event) => {
      event.preventDefault();
      void navigate(`/cars/${car.id}`);
    });
    return h('tr', null,
      h('td', null, link),
      h('td', { text: car.owner.name }),
      h('td', { 'data-cell': 'status', text: statusLabel(car.status) }),
      h('td', { 'data-cell': 'bay', text: car.bay?.code ?? '—' }));
  };

  const patchRow = (row: HTMLElement, car: CarData): void => {
    patchText(row.querySelector('[data-cell="status"]') as HTMLElement, statusLabel(car.status));
    patchText(row.querySelector('[data-cell="bay"]') as HTMLElement, car.bay?.code ?? '—');
  };

  const runSearch = async (query: string): Promise<void> => {
    const sequence = ++searchSequence;
    try {
      const response = (await api.get(`/api/cars?q=${encodeURIComponent(query)}`)) as { cars: CarData[]; total: number };
      if (sequence !== searchSequence) return;
      reconcile(tableBody, response.cars, (car) => car.id, rowFor, patchRow);
      if (query === search.value.trim()) {
        const search2 = query;
        replaceHistory('/bays', new URLSearchParams(search2 ? { q: search2 } : {}));
        if (lastAnnouncedQuery !== search2) {
          lastAnnouncedQuery = search2;
          announce(updateRegion, carsFound(response.total));
        }
      }
    } catch (err) {
      if (err instanceof NoAnswer || err instanceof ApiFailure) {
        // keep the table as it is; a later search will refresh it
      }
    }
  };

  search.addEventListener('input', () => {
    if (searchTimer !== null) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      void runSearch(search.value.trim());
    }, 300);
  });

  const registerButton = h('button', {
    text: 'Register car',
    onclick: (event: Event) => openRegisterDialog(event.currentTarget as HTMLElement, updateRegion),
  });

  const render = async (): Promise<void> => {
    main.replaceChildren(
      h('h1', { text: 'Bays' }),
      updateRegion,
      h('div', { class: 'grid12' },
        h('div', { class: 'panel', style: 'grid-column: span 8 / span 8;' },
          h('h2', { text: 'Floor plan' }),
          planArea),
        h('div', { class: 'panel', style: 'grid-column: span 4 / span 4;' },
          h('div', { class: 'row-flex', style: 'justify-content:space-between;' },
            h('h2', { text: 'Cars' }),
            registerButton),
          search,
          carsTable)),
    );
    const [bays, cars] = await Promise.all([
      api.get('/api/bays') as Promise<{ bays: BayData[] }>,
      api.get(`/api/cars?q=${encodeURIComponent(search.value.trim())}`) as Promise<{ cars: CarData[]; total: number }>,
    ]);
    if (destroyed) return;
    const fresh = buildFloorPlan({
      bays: bays.bays,
      picker: false,
      onActivate: (bay) => {
        if (bay.car) void navigate(`/cars/${bay.car.id}`);
      },
    });
    planArea.replaceChildren(fresh.root);
    reconcile(tableBody, cars.cars, (car) => car.id, rowFor, patchRow);
    // first load: no announcement
  };

  return {
    render,
    destroy() {
      destroyed = true;
      if (searchTimer !== null) window.clearTimeout(searchTimer);
    },
  };
}

export function statusLabel(status: string): string {
  if (status === 'stored') return 'Stored';
  if (status === 'awaiting_intake') return 'Awaiting intake';
  return 'Released';
}

function openRegisterDialog(opener: HTMLElement, updateRegion: HTMLElement): void {
  openDialog({
    name: 'Register car',
    opener,
    build: (dialog, close) => {
      const summary = h('div', { 'data-summary': 'errors' });
      const owner = h('select', { 'data-field': 'owner_id' });
      const year = h('input', { type: 'number', 'data-field': 'year', class: 'mono' });
      const make = h('input', { type: 'text', 'data-field': 'make' });
      const model = h('input', { type: 'text', 'data-field': 'model' });
      const registration = h('input', { type: 'text', 'data-field': 'registration' });
      const colour = h('input', { type: 'text', 'data-field': 'colour' });
      const length = h('input', { type: 'number', 'data-field': 'length_mm', class: 'mono' });
      const width = h('input', { type: 'number', 'data-field': 'width_mm', class: 'mono' });
      const odometer = h('input', { type: 'text', 'data-field': 'odometer', class: 'mono' });
      const tyre = h('input', { type: 'text', 'data-field': 'tyre_spec', class: 'mono' });
      const startup = h('input', { type: 'checkbox', 'data-field': 'startup_schedule' });
      const register = h('button', { class: 'primary', text: 'Register' });
      register.addEventListener('click', async () => {
        const pendingEl = updateRegion;
        announce(pendingEl, registerCarPending());
        summary.replaceChildren();
        register.disabled = true;
        const payload = {
          owner_id: owner.value,
          year: year.value,
          make: make.value,
          model: model.value,
          registration: registration.value,
          colour: colour.value,
          length_mm: length.value,
          width_mm: width.value,
          odometer: { value: odometer.value, unit: state.units.distance },
          tyre_spec: { value: tyre.value, unit: state.units.pressure },
          startup_schedule: startup.checked,
        };
        try {
          const response = (await api.post('/api/cars', payload)) as { car: { name: string } };
          register.disabled = false;
          announce(pendingEl, registeredCopy(response.car.name));
          close('submit');
        } catch (err) {
          register.disabled = false;
          if (err instanceof ApiFailure) {
            if (err.detail.fields) summary.replaceChildren(buildFieldSummary(err.detail.fields, dialog));
            else announce(pendingEl, err.detail.code ?? 'Saving failed.');
          } else if (err instanceof NoAnswer) {
            announce(pendingEl, 'No answer from the server. Try again.');
          }
        }
      });
      dialog.append(
        h('h2', { text: 'Register car' }),
        summary,
        h('div', { class: 'field' }, h('label', { text: 'Owner' }), owner),
        h('div', { class: 'row' },
          h('div', { class: 'field' }, h('label', { text: 'Year' }), year),
          h('div', { class: 'field' }, h('label', { text: 'Registration' }), registration),
          h('div', { class: 'field' }, h('label', { text: 'Colour' }), colour)),
        h('div', { class: 'row' },
          h('div', { class: 'field' }, h('label', { text: 'Make' }), make),
          h('div', { class: 'field' }, h('label', { text: 'Model' }), model)),
        h('div', { class: 'row' },
          h('div', { class: 'field' }, h('label', { text: 'Length (mm)' }), length),
          h('div', { class: 'field' }, h('label', { text: 'Width (mm)' }), width)),
        h('div', { class: 'row' },
          h('div', { class: 'field' }, h('label', { text: `Odometer (${distanceUnitLabel(state.units.distance)})` }), odometer),
          h('div', { class: 'field' }, h('label', { text: `Tyre pressure (${pressureUnitLabel(state.units.pressure)})` }), tyre)),
        h('div', { class: 'field' }, h('label', { class: 'inline' }, startup, ' Start-up schedule')),
        h('div', { class: 'actions' }, register, h('button', { text: 'Close', onclick: () => close('cancel') })),
      );
      void api.get('/api/owners').then((response) => {
        const data = response as { owners: { id: string; name: string }[] };
        for (const candidate of data.owners) {
          owner.append(h('option', { value: candidate.id, text: candidate.name }));
        }
      });
    },
  });
}

export function buildFieldSummary(fields: Record<string, string>, scope: HTMLElement): HTMLElement {
  const link = (field: string, message: string): HTMLElement =>
    h('a', {
      href: '#',
      text: message,
      onclick: (event: Event) => {
        event.preventDefault();
        const name = field.split('.').pop() ?? field;
        const control = scope.querySelector<HTMLElement>(`[data-field="${name}"]`);
        control?.focus();
      },
    });
  return h('div', { role: 'alert' },
    h('p', { class: 'error-summary', text: 'There is a problem' }),
    h('ul', null, ...Object.entries(fields).map(([field, message]) => h('li', null, link(field, message)))));
}
