import { weekdayOrder } from '../../shared/calendar.js';
import { formatMoney } from '../../shared/format.js';
import { AbandonedError, ApiError, NetworkError, networkCopy, get, post, put } from '../api.js';
import { openDialog } from '../components/dialog.js';
import { el, fieldError, labelled, on, replace, setFieldError } from '../dom.js';
import type { Screen, ScreenContext } from '../screen.js';

type Rate = {
  effectiveFrom: string;
  effectiveAt: string;
  status: 'past' | 'current' | 'scheduled';
  offPeakHourlyCents?: number;
  peakHourlyCents?: number;
  shelfDayCents?: number;
};

type Station = {
  id: string;
  name: string;
  kind: 'hourly' | 'shelf';
  capacity: number | null;
  currentRate: Rate;
  rates: Rate[];
};

type PeakWindow = { days: string[]; start: string; end: string };

type Kitchen = {
  peakWindows: PeakWindow[];
  requiredDocuments: string[];
  rulesVersion: number;
};

const statusWords: Record<Rate['status'], string> = {
  past: 'Past',
  current: 'Current',
  scheduled: 'Scheduled',
};

function instantLabel(instant: string): string {
  return `${instant.slice(0, 10)} ${instant.slice(11, 16)}`;
}

export function settingsScreen(context: ScreenContext): Screen {
  let destroyed = false;
  let stations: Station[] = [];
  let rulesVersion = 0;
  let windows: PeakWindow[] = [];
  let required: string[] = [];
  let refreshTimer: number | null = null;

  const stationsTable = el('table', { 'aria-label': 'Stations' });
  const versionsTable = el('table', { 'aria-label': 'Rate versions' });
  const windowsGroup = el('div', { role: 'group', 'aria-label': 'Peak windows' });
  const insuranceBox = el('input', { type: 'checkbox' });
  insuranceBox.setAttribute('aria-label', 'Insurance certificate required');
  const cardBox = el('input', { type: 'checkbox' });
  cardBox.setAttribute('aria-label', 'Food-handler card required');
  const saveRequirements = el('button', { type: 'button', text: 'Save requirements' });

  const element = el('div', { class: 'settings-screen' }, [
    stationsTable,
    versionsTable,
    windowsGroup,
    el('div', { class: 'requirements' }, [
      labelled('Insurance certificate required', insuranceBox),
      labelled('Food-handler card required', cardBox),
      saveRequirements,
    ]),
  ]);

  async function loadStations(): Promise<void> {
    try {
      const result = await get<{ stations: Station[] }>('/api/stations');
      if (destroyed) return;
      stations = result.body.stations;
      drawStations();
    } catch (error) {
      if (error instanceof AbandonedError) return;
      if (error instanceof NetworkError) context.showAlert(networkCopy);
    }
  }

  async function loadKitchen(): Promise<void> {
    try {
      const result = await get<Kitchen>('/api/kitchen');
      if (destroyed) return;
      applyKitchen(result.body);
    } catch {
      // The next save reloads it.
    }
  }

  function applyKitchen(kitchen: Kitchen): void {
    rulesVersion = kitchen.rulesVersion;
    windows = kitchen.peakWindows.map((window) => ({ ...window, days: [...window.days] }));
    required = [...kitchen.requiredDocuments];
    insuranceBox.checked = required.includes('insurance_certificate');
    cardBox.checked = required.includes('food_handler_card');
    drawWindows();
  }

  function drawStations(): void {
    const focused = (document.activeElement as HTMLElement | null)?.getAttribute('aria-label');
    replace(stationsTable, [
      el('thead', {}, el('tr', {}, [
        el('th', { text: 'Station' }),
        el('th', { text: 'Kind' }),
        el('th', { text: 'Current rate' }),
        el('th', { text: 'Actions' }),
      ])),
      el(
        'tbody',
        {},
        stations.map((station) => {
          const button = el('button', {
            type: 'button',
            text: 'Edit rates',
            'aria-label': `Edit rates for ${station.name}`,
          });
          on(button, 'click', () => openRates(station, button));
          return el('tr', {}, [
            el('td', { text: station.name }),
            el('td', { text: station.kind }),
            el('td', { text: rateText(station, station.currentRate) }),
            el('td', {}, button),
          ]);
        }),
      ),
    ]);
    replace(versionsTable, [
      el('thead', {}, el('tr', {}, [
        el('th', { text: 'Station' }),
        el('th', { text: 'Effective from' }),
        el('th', { text: 'Standard hourly' }),
        el('th', { text: 'Peak hourly' }),
        el('th', { text: 'Shelf-day' }),
        el('th', { text: 'Status' }),
      ])),
      el(
        'tbody',
        {},
        stations.flatMap((station) =>
          station.rates.map((rate) =>
            el('tr', {}, [
              el('td', { text: station.name }),
              el('td', { text: instantLabel(rate.effectiveAt) }),
              el('td', {
                text: rate.offPeakHourlyCents === undefined ? '' : formatMoney(rate.offPeakHourlyCents),
              }),
              el('td', {
                text: rate.peakHourlyCents === undefined ? '' : formatMoney(rate.peakHourlyCents),
              }),
              el('td', {
                text: rate.shelfDayCents === undefined ? '' : formatMoney(rate.shelfDayCents),
              }),
              el('td', { text: statusWords[rate.status] }),
            ]),
          ),
        ),
      ),
    ]);
    if (focused) {
      element.querySelector<HTMLElement>(`[aria-label="${CSS.escape(focused)}"]`)?.focus();
    }
  }

  function rateText(station: Station, rate: Rate): string {
    return station.kind === 'shelf'
      ? formatMoney(rate.shelfDayCents ?? 0)
      : `${formatMoney(rate.offPeakHourlyCents ?? 0)} / ${formatMoney(rate.peakHourlyCents ?? 0)}`;
  }

  function openRates(station: Station, opener: HTMLElement): void {
    const standard = el('input', { type: 'text' });
    const peak = el('input', { type: 'text' });
    const shelfDay = el('input', { type: 'text' });
    const effective = el('input', { type: 'text' });
    const errors = {
      offPeakHourlyCents: fieldError(),
      peakHourlyCents: fieldError(),
      shelfDayCents: fieldError(),
      effectiveFrom: fieldError(),
    };
    const saveButton = el('button', { type: 'button', text: 'Save rates' });
    const closeButton = el('button', { type: 'button', text: 'Close' });

    const fields =
      station.kind === 'shelf'
        ? [labelled('Shelf-day rate', shelfDay, errors.shelfDayCents)]
        : [
            labelled('Standard hourly rate', standard, errors.offPeakHourlyCents),
            labelled('Peak hourly rate', peak, errors.peakHourlyCents),
          ];

    const handle = openDialog({
      label: 'Station rates',
      opener,
      content: [
        ...fields,
        labelled('Effective from', effective, errors.effectiveFrom),
        el('div', { class: 'dialog-actions' }, [saveButton, closeButton]),
      ],
    });

    on(closeButton, 'click', () => handle.close());
    on(saveButton, 'click', () => {
      void (async () => {
        for (const holder of Object.values(errors)) {
          holder.hidden = true;
          holder.textContent = '';
        }
        const body: Record<string, unknown> = {
          effectiveFrom: effective.value.trim().replace(' ', 'T'),
        };
        if (station.kind === 'shelf') {
          body['shelfDayCents'] = dollarsToCents(shelfDay.value);
        } else {
          body['offPeakHourlyCents'] = dollarsToCents(standard.value);
          body['peakHourlyCents'] = dollarsToCents(peak.value);
        }
        saveButton.setAttribute('disabled', '');
        saveButton.setAttribute('aria-busy', 'true');
        context.announce('Saving\u2026');
        try {
          const result = await post<{ station: Station }>(
            `/api/stations/${station.id}/rates`,
            body,
          );
          stations = stations.map((candidate) =>
            candidate.id === result.body.station.id ? result.body.station : candidate,
          );
          const created = result.body.station.rates.at(-1)!;
          context.announce(
            `New rates for ${station.name} start ${instantLabel(created.effectiveAt)}.`,
          );
          handle.close();
          drawStations();
        } catch (error) {
          saveButton.removeAttribute('disabled');
          saveButton.removeAttribute('aria-busy');
          if (error instanceof AbandonedError) return;
          if (error instanceof ApiError) {
            const fields422 = error.fieldErrors();
            const controls: Record<string, HTMLElement> = {
              offPeakHourlyCents: standard,
              peakHourlyCents: peak,
              shelfDayCents: shelfDay,
              effectiveFrom: effective,
            };
            for (const [key, holder] of Object.entries(errors)) {
              const message = fields422[key];
              if (message) setFieldError(controls[key]!, holder, message);
            }
            context.showAlert(
              error.status === 422 ? error.firstFieldMessage() ?? error.copy : error.copy,
            );
          } else if (error instanceof NetworkError) {
            context.showAlert(networkCopy);
          }
        }
      })();
    });
  }

  function dollarsToCents(text: string): number {
    const value = Number.parseFloat(text.replace(/[^0-9.]/g, ''));
    return Number.isFinite(value) ? Math.round(value * 100) : 0;
  }

  function drawWindows(): void {
    const rows = windows.map((window, index) => {
      const dayBoxes = weekdayOrder.map((day) => {
        const box = el('input', { type: 'checkbox' });
        box.checked = window.days.includes(day);
        box.setAttribute('aria-label', `${day} window ${index + 1}`);
        on(box, 'change', () => {
          window.days = box.checked
            ? [...window.days, day]
            : window.days.filter((candidate) => candidate !== day);
        });
        return el('label', {}, [box, document.createTextNode(day)]);
      });
      const start = el('input', { type: 'text', value: window.start });
      start.setAttribute('aria-label', `Start window ${index + 1}`);
      on(start, 'input', () => {
        window.start = start.value.trim();
      });
      const end = el('input', { type: 'text', value: window.end });
      end.setAttribute('aria-label', `End window ${index + 1}`);
      on(end, 'input', () => {
        window.end = end.value.trim();
      });
      const remove = el('button', {
        type: 'button',
        text: 'Remove',
        'aria-label': `Remove window ${index + 1}`,
      });
      on(remove, 'click', () => {
        windows = windows.filter((candidate) => candidate !== window);
        drawWindows();
      });
      return el('div', { class: 'peak-row' }, [...dayBoxes, start, end, remove]);
    });
    const addButton = el('button', { type: 'button', text: 'Add peak window' });
    on(addButton, 'click', () => {
      windows = [...windows, { days: [], start: '', end: '' }];
      drawWindows();
    });
    const saveButton = el('button', { type: 'button', text: 'Save peak windows' });
    const errorHolder = fieldError();
    on(saveButton, 'click', () => {
      void (async () => {
        errorHolder.hidden = true;
        saveButton.setAttribute('disabled', '');
        saveButton.setAttribute('aria-busy', 'true');
        context.announce('Saving\u2026');
        try {
          const result = await put<Kitchen>('/api/kitchen/peak-windows', {
            windows,
            rulesVersion,
          });
          applyKitchen(result.body);
          context.announce('Peak windows saved. They apply to bookings confirmed from now on.');
        } catch (error) {
          if (error instanceof ApiError) {
            const current = error.body['current'] as Kitchen | undefined;
            if (current) applyKitchen(current);
            const message = error.fieldErrors()['windows'];
            context.showAlert(message ?? error.copy);
          } else if (error instanceof NetworkError) {
            context.showAlert(networkCopy);
          }
        } finally {
          saveButton.removeAttribute('disabled');
          saveButton.removeAttribute('aria-busy');
        }
      })();
    });
    replace(windowsGroup, [...rows, addButton, saveButton, errorHolder]);
  }

  on(saveRequirements, 'click', () => {
    void (async () => {
      const chosen: string[] = [];
      if (insuranceBox.checked) chosen.push('insurance_certificate');
      if (cardBox.checked) chosen.push('food_handler_card');
      saveRequirements.setAttribute('disabled', '');
      saveRequirements.setAttribute('aria-busy', 'true');
      context.announce('Saving\u2026');
      try {
        const result = await put<Kitchen>('/api/kitchen/document-requirements', {
          required: chosen,
          rulesVersion,
        });
        applyKitchen(result.body);
        context.announce('Document requirements saved.');
      } catch (error) {
        if (error instanceof ApiError) {
          const current = error.body['current'] as Kitchen | undefined;
          if (current) applyKitchen(current);
          context.showAlert(error.copy);
        } else if (error instanceof NetworkError) {
          context.showAlert(networkCopy);
        }
      } finally {
        saveRequirements.removeAttribute('disabled');
        saveRequirements.removeAttribute('aria-busy');
      }
    })();
  });

  void loadStations();
  void loadKitchen();
  refreshTimer = window.setInterval(() => void loadStations(), 12000);
  context.setHourBank(null);

  return {
    element,
    destroy: () => {
      destroyed = true;
      if (refreshTimer !== null) window.clearInterval(refreshTimer);
    },
  };
}
