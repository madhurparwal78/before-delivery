// The agent's orders screen: the live order form, the agency's moves with
// their `Priced by` label, and the agency's invoices.

import { el, clear, announce } from './dom.js';
import { get, post, newKey } from './http.js';
import { filterMoves, moveSearch, refreshServices, topStrip, type AppCtx } from './chrome.js';
import {
  clearanceCell, marginMetres, money, feetInchesToMm, metresToMm,
  type Invoice, type Move, type Plan, type User, type Vessel,
} from './domain.js';

export async function renderOrders(container: HTMLElement, user: User, initial: { q: string }): Promise<void> {
  const nowResult = await get<{ now: string }>('/api/port');
  const ctx: AppCtx = {
    user, services: { billing: 'up', storage: 'up', mail: 'up' },
    serviceAnnouncements: el('div', { role: 'status', 'aria-label': 'Service announcements', class: 'live-region' }),
    container, portNow: nowResult.ok ? nowResult.value.now : '',
  };
  const vesselsResult = await get<{ vessels: Vessel[] }>('/api/vessels');
  const vessels = vesselsResult.ok ? vesselsResult.value.vessels : [];

  clear(container);
  container.append(topStrip(ctx, () => { window.location.href = '/login'; }));
  container.append(ctx.serviceAnnouncements);
  void refreshServices(ctx);

  const layout = el('div', { class: 'orders-layout' });
  container.append(layout);

  const left = el('div', { class: 'orders-column' });
  const right = el('div', { class: 'orders-column' });
  layout.append(left, right);

  // ---- the live order form ----
  const orderAnnouncements = el('div', { role: 'status', 'aria-label': 'Order announcements', class: 'live-region' });
  const formErrors = el('div', { role: 'alert', 'aria-label': 'Form errors', class: 'form-errors' });

  const vesselSelect = el('select', { 'aria-label': 'Vessel', class: 'select' }) as HTMLSelectElement;
  vesselSelect.append(el('option', { value: '' }, 'Choose a vessel'));
  for (const vessel of vessels) vesselSelect.append(el('option', { value: vessel.id }, vessel.name));

  const draughtUnits = el('div', { role: 'radiogroup', 'aria-label': 'Draught units', class: 'radiogroup' });
  const metresRadio = el('input', { type: 'radio', name: 'draught-units', id: 'unit-m', value: 'metres', checked: '' }) as HTMLInputElement;
  const feetRadio = el('input', { type: 'radio', name: 'draught-units', id: 'unit-f', value: 'feet' }) as HTMLInputElement;
  draughtUnits.append(el('label', { for: 'unit-m' }, metresRadio, 'Metres'));
  draughtUnits.append(el('label', { for: 'unit-f' }, feetRadio, 'Feet and inches'));

  const draughtMetres = el('input', { type: 'number', step: '0.001', 'aria-label': 'Draught in metres', class: 'text num' }) as HTMLInputElement;
  const draughtFeet = el('input', { type: 'number', step: '1', 'aria-label': 'Draught feet', class: 'text num' }) as HTMLInputElement;
  const draughtInches = el('input', { type: 'number', step: '0.25', 'aria-label': 'Draught inches', class: 'text num' }) as HTMLInputElement;
  const feetWrap = el('div', { class: 'feet-wrap hidden' }, draughtFeet, draughtInches);

  const speed = el('input', { type: 'number', step: '0.5', 'aria-label': 'Speed in knots', class: 'text num' }) as HTMLInputElement;
  const block = el('input', { type: 'number', step: '0.01', 'aria-label': 'Block coefficient', class: 'text num' }) as HTMLInputElement;
  const length = el('input', { type: 'number', step: '1', 'aria-label': 'Length in metres', class: 'text num' }) as HTMLInputElement;
  const gt = el('input', { type: 'number', step: '1', 'aria-label': 'Gross tonnage', class: 'text num' }) as HTMLInputElement;
  const duty = el('input', { type: 'number', step: '30', 'aria-label': 'Duty minutes', class: 'text num' }) as HTMLInputElement;

  const portInfo = await get<{ store_date: string }>('/api/port');
  const storeDate = portInfo.ok ? portInfo.value.store_date : '';
  const boardingDate = el('input', { type: 'text', 'aria-label': 'Boarding date', class: 'text num' }) as HTMLInputElement;
  const boardingTime = el('input', { type: 'text', 'aria-label': 'Boarding time', class: 'text num' }) as HTMLInputElement;

  const clearances = el('section', { role: 'region', 'aria-label': 'Order clearances', class: 'order-clearances' });
  clearances.append(el('div', { class: 'empty' }, 'Choose a vessel to see clearances'));

  let draughtMm = 0;
  function readDraught(): void {
    if (metresRadio.checked) draughtMm = metresToMm(Number(draughtMetres.value || 0));
    else draughtMm = feetInchesToMm(Number(draughtFeet.value || 0), Number(draughtInches.value || 0));
  }
  function paintDraught(): void {
    // Switching units redraws the entered value from the stored millimetres.
    if (metresRadio.checked) {
      draughtMetres.value = (draughtMm / 1000).toFixed(3);
      feetWrap.classList.add('hidden');
      draughtMetres.classList.remove('hidden');
    } else {
      const quarters = Math.round((draughtMm / 25.4) * 4);
      const inches = Math.floor(quarters / 4);
      draughtFeet.value = String(Math.floor(inches / 12));
      draughtInches.value = String(inches % 12 + (quarters % 4) / 4);
      feetWrap.classList.remove('hidden');
      draughtMetres.classList.add('hidden');
    }
  }
  for (const radio of [metresRadio, feetRadio]) {
    radio.addEventListener('change', () => {
      // Switching draught units sends no plan request and changes no clearance.
      paintDraught();
    });
  }
  for (const input of [draughtMetres, draughtFeet, draughtInches]) {
    input.addEventListener('input', () => readDraught());
  }

  vesselSelect.addEventListener('change', () => {
    const vessel = vessels.find((v) => v.id === vesselSelect.value);
    if (!vessel) return;
    // Choosing a vessel prefills the other fields where a default exists.
    draughtMm = vessel.default_draught_mm;
    speed.value = String(vessel.default_speed_kn);
    block.value = String(vessel.block_coefficient);
    length.value = String(vessel.length_m);
    gt.value = String(vessel.gross_tonnage);
    duty.value = '360';
    if (boardingDate.value === '') boardingDate.value = shiftDate(storeDate, 2);
    if (boardingTime.value === '') boardingTime.value = '06:00';
    paintDraught();
    schedulePlan();
  });

  interface FormInputs {
    vessel_id: string;
    draught_mm: number;
    speed_kn: string;
    block_coefficient: string;
    length_m: string;
    gross_tonnage: string;
    duty_minutes: string;
    boarding_date: string;
    boarding_time: string;
  }
  const currentInputs = (): FormInputs => ({
    vessel_id: vesselSelect.value,
    draught_mm: draughtMm,
    speed_kn: speed.value,
    block_coefficient: block.value,
    length_m: length.value,
    gross_tonnage: gt.value,
    duty_minutes: duty.value,
    boarding_date: boardingDate.value,
    boarding_time: boardingTime.value,
  });
  const fingerprint = (inputs: FormInputs): string => JSON.stringify(inputs);

  let planTimer: number | undefined;
  let announcedInputs: string | null = null;
  function schedulePlan(): void {
    window.clearTimeout(planTimer);
    planTimer = window.setTimeout(() => {
      void requestPlan();
    }, 450);
  }
  for (const input of [speed, block, length, gt, duty, boardingDate, boardingTime, draughtMetres, draughtFeet, draughtInches]) {
    input.addEventListener('input', () => {
      readDraught();
      schedulePlan();
    });
  }

  async function requestPlan(): Promise<void> {
    const inputs = currentInputs();
    if (inputs.vessel_id === '') return;
    const fp = fingerprint(inputs);
    const body = {
      vessel_id: inputs.vessel_id,
      boarding_at: `${inputs.boarding_date}T${inputs.boarding_time}`,
      speed_kn: Number(inputs.speed_kn),
      draught_m: inputs.draught_mm / 1000,
      block_coefficient: Number(inputs.block_coefficient),
      gross_tonnage: Number(inputs.gross_tonnage),
      length_m: Number(inputs.length_m),
    };
    const result = await post<Plan>('/api/plan', body);
    // A reply paints only if its inputs are still the form's current inputs.
    if (fingerprint(currentInputs()) !== fp) {
      if (result.ok) return;
    }
    if (!result.ok) {
      if ('noReply' in result && result.noReply) {
        announce(orderAnnouncements, 'Plan unavailable - last values shown');
      } else {
        announce(orderAnnouncements, 'Plan unavailable - last values shown');
      }
      return;
    }
    paintClearances(result.value);
    if (announcedInputs !== fp) {
      announcedInputs = fp;
      const pinch = result.value.waypoints.find((w) => w.id === result.value.pinch.waypoint_id)?.name ?? '';
      const state = result.value.window_state === 'open' ? 'Window open' : 'Window closed';
      announce(orderAnnouncements, `${state}, pinch ${pinch} ${marginMetres(result.value.pinch.margin_mm)} m, estimate $${money(result.value.estimate.total_cents).slice(1)} CAD`);
    }
  }

  function paintClearances(plan: Plan): void {
    clear(clearances);
    for (const wp of plan.waypoints) {
      clearances.append(el('div', { class: 'clearance-row' },
        el('span', { class: 'clearance-name' }, wp.name),
        el('span', { class: `num ${wp.margin_mm < 0 ? 'neg' : 'pos'}` }, `${clearanceCell(wp.clearance_mm)} / ${marginMetres(wp.margin_mm)}`),
      ));
    }
    clearances.append(el('div', { class: 'clearance-state' }, plan.window_state === 'open' ? 'Window open' : 'Window closed'));
    clearances.append(el('div', { class: 'clearance-estimate num' }, `Estimate ${money(plan.estimate.total_cents)} CAD`));
  }

  // ---- place order ----
  const place = el('button', { class: 'primary' }, 'Place order');
  let placeInFlight = false;
  let placeKey: string | null = null;
  place.addEventListener('click', async () => {
    if (placeInFlight) return;
    placeInFlight = true;
    announce(orderAnnouncements, 'Placing order...');
    const key = placeKey ?? newKey();
    placeKey = key;
    const inputs = currentInputs();
    const body: Record<string, unknown> = {
      vessel_id: inputs.vessel_id,
      boarding_at: `${inputs.boarding_date}T${inputs.boarding_time}`,
      speed_kn: Number(inputs.speed_kn),
      duty_minutes: Number(inputs.duty_minutes),
      draught_m: inputs.draught_mm / 1000,
      block_coefficient: Number(inputs.block_coefficient),
      gross_tonnage: Number(inputs.gross_tonnage),
      length_m: Number(inputs.length_m),
    };
    const result = await post<Move>('/api/moves', body, { key });
    placeInFlight = false;
    if (result.ok) {
      placeKey = null;
      announce(orderAnnouncements, `Order ${result.value.ref} placed`);
      clear(formErrors);
      await refreshMoves();
    } else if ('noReply' in result && result.noReply) {
      announce(orderAnnouncements, 'No reply from the server. Showing the last confirmed state.');
    } else if (result.ok === false && 'failure' in result) {
      placeKey = null;
      const failure = result.failure;
      clear(formErrors);
      const errors = failure.errors ?? {};
      const fields = Object.keys(errors);
      for (const field of fields) {
        const label = fieldLabels[field] ?? field;
        formErrors.append(el('div', { class: 'error-row' }, `${label}: ${errors[field]}`));
      }
      if (fields.length > 0) announce(orderAnnouncements, `${fields.length} fields need attention`);
      else announce(orderAnnouncements, 'Plan unavailable - last values shown');
    }
  });

  left.append(
    el('h1', {}, 'Place a pilot order'),
    vesselSelect,
    draughtUnits,
    el('div', { class: 'field-row' }, draughtMetres, feetWrap),
    el('div', { class: 'field-row' }, speed, block),
    el('div', { class: 'field-row' }, length, gt),
    el('div', { class: 'field-row' }, duty),
    el('div', { class: 'field-row' }, boardingDate, boardingTime),
    place,
    orderAnnouncements,
    formErrors,
    clearances,
  );

  // ---- the agency's moves and invoices ----
  const boardAnnouncements = el('div', { role: 'status', 'aria-label': 'Board announcements', class: 'live-region' });
  const moveList = el('div', { class: 'move-list' });
  const search = moveSearch('Search moves', [], () => {}, boardAnnouncements, (q) => {
    writeAddress(q);
  }, initial.q);
  const invoiceList = el('div', { class: 'invoice-list' });

  async function refreshMoves(): Promise<void> {
    const result = await get<{ moves: Move[] }>('/api/moves');
    if (!result.ok) return;
    const moves = result.value.moves;
    const filtered = filterMoves(moves, (search as HTMLInputElement).value);
    clear(moveList);
    for (const move of filtered) {
      const row = el('div', { class: 'move-row' });
      row.append(el('span', { class: `status status-${move.status.replace(/\s+/g, '-')}` }, move.status));
      row.append(el('span', { class: 'num' }, `${move.ref} ${move.vessel.name} ${move.boarding_at.replace('T', ' ')}`));
      const revision = newestRevision(move);
      row.append(el('span', { class: 'priced-by' }, `Priced by ${revision}`));
      row.append(el('button', { class: 'link' }, `Open ${move.ref}`).tap((b) => b.addEventListener('click', () => {
        window.location.href = `/moves/${move.ref}`;
      })));
      moveList.append(row);
    }
    // Rebind the search to the fresh move list.
    (search as HTMLInputElement).replaceWith(search);
    const result2 = await get<{ invoices: Invoice[] }>('/api/invoices');
    clear(invoiceList);
    if (result2.ok) {
      invoiceList.append(el('h2', {}, 'Invoices'));
      for (const invoice of result2.value.invoices) {
        invoiceList.append(el('div', { class: 'invoice-row' },
          el('a', { class: 'link', href: `/invoices/${invoice.id}` }, invoice.id),
          el('span', { class: 'num' }, `${invoice.move_ref} ${invoice.state}`),
          el('span', { class: 'num' }, invoice.number ?? '-'),
          el('span', { class: 'num' }, money(invoice.balance_cents ?? 0)),
        ));
      }
    }
    invoiceList.append(el('a', { class: 'link', href: '/api/exports/moves.csv' }, 'Export moves'));
  }

  search.addEventListener('input', () => {
    void refreshMoves();
  });

  right.append(el('h1', {}, 'Your moves'), search, boardAnnouncements, moveList, invoiceList);
  await refreshMoves();
}

function newestRevision(move: Move): string {
  const newest = move.lines[move.lines.length - 1];
  return newest?.tariff_revision ?? '';
}

const fieldLabels: Record<string, string> = {
  vessel_id: 'Vessel',
  boarding_at: 'Boarding time',
  draught_m: 'Draught',
  draught_ft: 'Draught feet',
  draught_in: 'Draught inches',
  speed_kn: 'Speed in knots',
  block_coefficient: 'Block coefficient',
  length_m: 'Length in metres',
  gross_tonnage: 'Gross tonnage',
  duty_minutes: 'Duty minutes',
};

function shiftDate(date: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

function writeAddress(q: string): void {
  const url = new URL(window.location.href);
  if (q !== '') url.searchParams.set('q', q);
  else url.searchParams.delete('q');
  window.history.replaceState(null, '', url.toString());
}
