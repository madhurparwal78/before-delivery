/**
 * Care round — overdue cars first; a round-entry dialog that keeps its values
 * across re-reads and idempotency on Save entry.
 */
import { api, ApiFailure, KeyHolder, NoAnswer, randomKey } from '../api.ts';
import { state, isStaff } from '../state.ts';
import { announce, h, patchText, reconcile } from '../ui.ts';
import { openDialog } from '../dialog.ts';
import { Reread } from '../reread.ts';
import { registerReread, markInterrupted, clearInterrupted } from '../app.ts';
import { pressureDisplay, pressureUnitLabel } from '../../shared/units.ts';
import { NO_ANSWER_COPY, carNotStoredRoundCopy, roundEntryMessage } from '../../shared/copy.ts';
import type { Screen } from './screen.ts';

interface RoundCar {
  car: { id: string; name: string };
  bay_code: string;
  startup: { status: string; next_due: string | null; scheduled: boolean };
  last_entry: {
    battery_v: string | null;
    tyres_bar: { fl: string; fr: string; rl: string; rr: string } | null;
    flags: string[];
  } | null;
}

export function renderRound(main: HTMLElement): Screen {
  const reread = new Reread(async () => {
    const cars = await fetchRound();
    if (cars) patch(cars);
  }, 15_000);
  const heading = h('h1', { text: 'Care round', tabindex: '-1' });
  const region = h('p', { class: 'status-region', role: 'status', 'data-region': 'round-updates' });
  const container = h('div');

  const entryDialogFor = (car: RoundCar, opener: HTMLElement): void => {
    const holder = new KeyHolder(randomKey);
    const pressureUnit = state.units.pressure;
    openDialog({
      name: `Round entry: ${car.car.name}`,
      opener,
      fallback: heading,
      build: (dialog, close) => {
        const summary = h('div');
        const started = h('input', { type: 'checkbox', 'data-field': 'started' });
        const battery = h('input', { type: 'text', inputmode: 'decimal', class: 'mono', 'data-field': 'battery_v' });
        const fl = h('input', { type: 'text', inputmode: 'decimal', class: 'mono', 'data-field': 'tyres-fl' });
        const fr = h('input', { type: 'text', inputmode: 'decimal', class: 'mono', 'data-field': 'tyres-fr' });
        const rl = h('input', { type: 'text', inputmode: 'decimal', class: 'mono', 'data-field': 'tyres-rl' });
        const rr = h('input', { type: 'text', inputmode: 'decimal', class: 'mono', 'data-field': 'tyres-rr' });
        const note = h('input', { type: 'text', 'data-field': 'note' });
        const save = h('button', { class: 'primary', text: 'Save entry' });
        const cancel = h('button', { text: 'Cancel', onclick: () => { holder.discard(); close('cancel'); } });

        const body = (): { started: boolean; battery_v: string | null; tyres: { unit: string; fl: string; fr: string; rl: string; rr: string } | null } => {
          const someTyre = [fl, fr, rl, rr].some((input) => input.value.trim() !== '');
          const allTyres = [fl, fr, rl, rr].every((input) => input.value.trim() !== '');
          return {
            started: started.checked,
            battery_v: battery.value.trim() === '' ? null : battery.value.trim(),
            tyres: someTyre
              ? { unit: pressureUnit, fl: allTyres ? fl.value : '', fr: allTyres ? fr.value : '', rl: allTyres ? rl.value : '', rr: allTyres ? rr.value : '' }
              : null,
          };
        };

        save.addEventListener('click', async () => {
          summary.replaceChildren();
          announce(region, 'Saving round entry...');
          const payload = body();
          try {
            const response = (await api.postWithKey(`/api/cars/${car.car.id}/care-entries`, payload, holder.current())) as {
              entry: { flags: string[]; started: boolean };
              startup: { next_due: string | null };
              message: string;
            };
            holder.discard();
            clearInterrupted(holder.peek() ?? '');
            announce(region, response.message);
            close('submit');
            const cars = await fetchRound();
            if (cars) patch(cars);
          } catch (err) {
            if (err instanceof NoAnswer) {
              announce(region, NO_ANSWER_COPY.roundEntry);
              return;
            }
            if (err instanceof ApiFailure) {
              const code = err.detail.code;
              if (code === 'session_expired') {
                markInterrupted(holder.peek() ?? '', async () => {
                  announce(region, 'Saving round entry...');
                  // resends with the same key and body once signed in again
                  const response = (await api.postWithKey(`/api/cars/${car.car.id}/care-entries`, payload, holder.current())) as { message: string };
                  holder.discard();
                  announce(region, response.message);
                  close('submit');
                  const cars = await fetchRound();
                  if (cars) patch(cars);
                });
                return;
              }
              if (code === 'car_not_stored') {
                holder.discard();
                announce(region, carNotStoredRoundCopy());
                close('removed-opener');
                return;
              }
              if (code === 'idempotency_conflict') {
                announce(region, 'This was already sent with different values. Close this form and check the latest record.');
                return;
              }
              if (err.detail.fields) {
                summary.replaceChildren(fieldSummary(err.detail.fields, dialog));
                return;
              }
              announce(region, code ?? 'Saving failed.');
            }
          }
        });

        dialog.append(
          h('h2', { text: `Round entry: ${car.car.name}` }),
          summary,
          h('div', { class: 'field' }, h('label', { class: 'inline' }, started, ' Started the engine')),
          h('div', { class: 'field' }, h('label', { text: 'Battery voltage (V)' }), battery),
          h('div', { class: 'row' },
            h('div', { class: 'field' }, h('label', { text: `Front left tyre (${pressureUnitLabel(pressureUnit)})` }), fl),
            h('div', { class: 'field' }, h('label', { text: `Front right tyre (${pressureUnitLabel(pressureUnit)})` }), fr)),
          h('div', { class: 'row' },
            h('div', { class: 'field' }, h('label', { text: `Rear left tyre (${pressureUnitLabel(pressureUnit)})` }), rl),
            h('div', { class: 'field' }, h('label', { text: `Rear right tyre (${pressureUnitLabel(pressureUnit)})` }), rr)),
          h('div', { class: 'field' }, h('label', { text: 'Note' }), note),
          h('div', { class: 'actions' }, save, cancel),
        );
      },
    });
  };

  const rowFor = (car: RoundCar): HTMLElement => {
    const logButton = h('button', { text: `Log round entry for ${car.car.name}` });
    logButton.addEventListener('click', () => entryDialogFor(car, logButton));
    return h('li', { class: 'card' },
      h('div', { class: 'row-flex', style: 'justify-content:space-between;' },
        h('div', null,
          h('p', { class: 'mt0', text: `${car.car.name}` }),
          h('p', { class: 'small mb0 muted', 'data-cell': 'bay', text: `Bay ${car.bay_code}` })),
        logButton),
      h('p', { 'data-cell': 'startup', text: startupLabel(car) }),
      h('p', { 'data-cell': 'last', text: lastEntryLine(car) }),
      h('p', { 'data-cell': 'flags', text: car.last_entry?.flags.length ? `Flagged: ${car.last_entry.flags.join(', ')}` : '' }));
  };

  const patchRow = (row: HTMLElement, car: RoundCar): void => {
    patchText(row.querySelector('[data-cell="bay"]') as HTMLElement, `Bay ${car.bay_code}`);
    patchText(row.querySelector('[data-cell="startup"]') as HTMLElement, startupLabel(car));
    patchText(row.querySelector('[data-cell="last"]') as HTMLElement, lastEntryLine(car));
    patchText(row.querySelector('[data-cell="flags"]') as HTMLElement, car.last_entry?.flags.length ? `Flagged: ${car.last_entry.flags.join(', ')}` : '');
  };

  const list = h('ul', { 'aria-label': 'Care round', class: 'cards' });
  const tableBody = h('tbody');
  const table = h('table', { class: 'sheet hidden', 'aria-label': 'Care round' },
    h('thead', null, h('tr', null,
      h('th', { text: 'Car' }), h('th', { text: 'Bay' }), h('th', { text: 'Start-up' }),
      h('th', { text: 'Last entry' }), h('th', { text: '' }))),
    tableBody);
  const tableRowFor = (car: RoundCar): HTMLElement => {
    const logButton = h('button', { text: `Log round entry for ${car.car.name}` });
    logButton.addEventListener('click', () => entryDialogFor(car, logButton));
    return h('tr', null,
      h('td', { text: car.car.name }),
      h('td', { 'data-cell': 'bay', text: car.bay_code }),
      h('td', { 'data-cell': 'startup', text: startupLabel(car) }),
      h('td', { 'data-cell': 'last', text: lastEntryLine(car) }),
      h('td', null, logButton));
  };
  const patchTableRow = (row: HTMLElement, car: RoundCar): void => {
    patchText(row.querySelector('[data-cell="bay"]') as HTMLElement, car.bay_code);
    patchText(row.querySelector('[data-cell="startup"]') as HTMLElement, startupLabel(car));
    patchText(row.querySelector('[data-cell="last"]') as HTMLElement, lastEntryLine(car));
  };

  const applyLayout = (): void => {
    const wide = window.innerWidth >= 768;
    list.classList.toggle('hidden', wide);
    table.classList.toggle('hidden', !wide);
  };

  const render = async (): Promise<void> => {
    applyLayout();
    window.addEventListener('resize', applyLayout);
    main.replaceChildren(heading, region, list, table);
    const cars = await fetchRound();
    if (!cars) return;
    patch(cars);
    registerReread(reread);
    reread.start();
  };

  const patch = (cars: RoundCar[]): void => {
    reconcile(list, cars, (car) => car.car.id, rowFor, patchRow);
    reconcile(tableBody, cars, (car) => car.car.id, tableRowFor, patchTableRow);
  };

  return {
    render,
    destroy() {
      reread.stop();
      window.removeEventListener('resize', applyLayout);
    },
  };
}

function startupLabel(car: RoundCar): string {
  if (car.startup.status === 'overdue') return 'Start-up overdue';
  if (car.startup.status === 'not_scheduled') return 'No start-up schedule';
  return `Next start-up due ${car.startup.next_due ?? ''}`;
}

function lastEntryLine(car: RoundCar): string {
  const entry = car.last_entry;
  if (!entry) return 'No entry yet';
  const parts: string[] = [];
  if (entry.battery_v) parts.push(`${entry.battery_v} V`);
  if (entry.tyres_bar) parts.push(pressureDisplay(entry.tyres_bar.fl, state.units.pressure));
  if (entry.flags.length > 0) parts.push(`Flagged: ${entry.flags.join(', ')}`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

async function fetchRound(): Promise<RoundCar[] | null> {
  try {
    const response = (await api.get('/api/care-round')) as { cars: RoundCar[] };
    return response.cars;
  } catch {
    return null;
  }
}

function fieldSummary(fields: Record<string, string>, scope: HTMLElement): HTMLElement {
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

export { roundEntryMessage, isStaff };
