import { formatMoney } from '../../shared/money.js';
import { apiGet, apiSend, ApiFailure, newIdempotencyKey } from '../api.js';
import {
  billableDaysLabel,
  COPY,
  freeForDatesLabel,
  hireTotalAnnouncement,
  unitTakenText,
} from '../copy.js';
import { clear, el } from '../dom.js';
import { mountServiceNotice } from '../notice.js';
import { rollTotal } from '../strip.js';
import {
  createDateControls,
  createHireTotalStatus,
  createPriceFetcher,
  dateQuery,
  readDateSelection,
  returnDateOf,
  writeDateSelection,
} from '../renter.js';
import { categoryNav } from './catalogue.js';
import type { Booking, KitDetailView, KitView, PriceQuote } from '../../shared/types.js';


const STATUS_LABELS = { free: 'Free', booked: 'Booked', repair: 'In repair' } as const;

export async function renderKitSheet(root: HTMLElement, kitId: string): Promise<void> {
  clear(root);
  let selection = readDateSelection();
  let announced = '';
  let shownCents = 0;

  const page = el('div', { class: 'page page-kit' });
  root.append(page);
  mountServiceNotice(page);

  const [kit, catalogue] = await Promise.all([
    apiGet<KitDetailView>(`/api/kits/${encodeURIComponent(kitId)}`),
    apiGet<{ kits: KitView[] }>('/api/kits'),
  ]);
  const categories = [...new Set(catalogue.kits.map((candidate) => candidate.category))];

  const numerals = el('p', { class: 'numerals' }, [formatMoney(kit.dayRateCents)]);
  const count = el('p', { class: 'billable-count' });
  const free = el('p', { class: 'free-count' });
  shownCents = kit.dayRateCents;

  const status = createHireTotalStatus();
  status.hidden = selection.pickupDate === null;
  const tablesHost = el('div', { class: 'unit-tables' });
  const alertHost = el('div', { class: 'alert-host' });
  const nameField = el('input', { type: 'text', id: 'renter-name', class: 'text-field' });
  const emailField = el('input', { type: 'text', id: 'renter-email', class: 'text-field' });
  const holdButton = el('button', { type: 'submit', class: 'button button-primary' }, [
    'Hold this kit',
  ]);
  const holdError = el('p', { class: 'field-error' });

  const picks = new Map<string, string | null>();
  for (const component of kit.components) picks.set(component.classId, null);

  const renderTables = (detail: KitDetailView): void => {
    clear(tablesHost);
    for (const component of detail.components) {
      const groupName = `pick-${component.classId}`;
      const units = detail.units.filter((unit) => unit.classId === component.classId);
      const anyId = `${groupName}-any`;
      const anyRadio = el('input', {
        type: 'radio',
        name: groupName,
        id: anyId,
        value: '',
        checked: picks.get(component.classId) === null,
      });
      anyRadio.addEventListener('change', () => {
        if (anyRadio.checked) picks.set(component.classId, null);
      });

      const rows = units.map((unit) => {
        const label = unit.status === null
          ? unit.location === 'repair'
            ? STATUS_LABELS.repair
            : STATUS_LABELS.free
          : STATUS_LABELS[unit.status];
        const unavailable = label !== STATUS_LABELS.free;
        const radioId = `${groupName}-${unit.serial}`;
        const radio = el('input', {
          type: 'radio',
          name: groupName,
          id: radioId,
          value: unit.serial,
          disabled: unavailable,
          checked: picks.get(component.classId) === unit.serial,
        });
        radio.addEventListener('change', () => {
          if (radio.checked) picks.set(component.classId, unit.serial);
        });
        return el('tr', { class: unavailable ? 'unit-row unit-row-greyed' : 'unit-row' }, [
          el('td', {}, [unit.serial]),
          el('td', {}, [label]),
          el('td', {}, [
            el('label', { class: 'pick-label', for: radioId }, [
              radio,
              el('span', { class: 'visually-hidden' }, [unit.serial]),
            ]),
          ]),
        ]);
      });

      tablesHost.append(
        el('div', { class: 'unit-class' }, [
          el('label', { class: 'pick-any', for: anyId }, [
            anyRadio,
            el('span', {}, [`Any free ${component.name}`]),
          ]),
          el('table', { class: 'unit-table' }, [
            el('caption', {}, [`${component.name} units`]),
            el('thead', {}, [
              el('tr', {}, [
                el('th', { scope: 'col' }, ['Serial']),
                el('th', { scope: 'col' }, ['Status']),
                el('th', { scope: 'col' }, ['Pick']),
              ]),
            ]),
            el('tbody', {}, rows),
          ]),
        ]),
      );
    }
  };

  const refreshDetail = async (quote: PriceQuote | null): Promise<void> => {
    const rangeQuery = dateQuery(selection);
    const detail = await apiGet<KitDetailView>(
      `/api/kits/${encodeURIComponent(kit.id)}${rangeQuery}`,
    );
    if (rangeQuery !== dateQuery(selection)) return;
    renderTables(detail);
    free.textContent =
      detail.freeForDates === null ? '' : freeForDatesLabel(detail.freeForDates);
    const price = detail.price;
    if (price === null) {
      rollTotal(numerals, detail.dayRateCents, detail.dayRateCents, formatMoney, () => { count.textContent = ''; });
      count.textContent = '';
      shownCents = detail.dayRateCents;
    } else {
      const from = shownCents;
      shownCents = price.hirePriceCents;
      rollTotal(numerals, from, price.hirePriceCents, formatMoney, () => {
        count.textContent = billableDaysLabel(price.billableDays);
        const announcement = hireTotalAnnouncement(price.hirePriceCents, price.billableDays);
        if (announcement === announced) return;
        announced = announcement;
        status.textContent = announcement;
      });
    }
    if (quote !== null) controls.strip.setDays(quote.days);
    holdButton.disabled = selection.pickupDate === null;
  };

  const fetcher = createPriceFetcher(
    kit.id,
    (quote) => { controls.error.textContent = ''; void refreshDetail(quote); },
    () => {
      controls.error.textContent = '';
      status.textContent = '';
      controls.strip.setDays([]);
      void refreshDetail(null);
    },
    (message) => { controls.error.textContent = message; status.textContent = message; announced = ''; },
  );

  const controls = createDateControls({
    initial: selection,
    onChange: (next) => {
      selection = next;
      status.hidden = selection.pickupDate === null;
      writeDateSelection(selection);
      fetcher.request(selection);
    },
  });

  const showUnitTaken = (serial: string | null, nextFreeSerial: string | null): void => {
    clear(alertHost);
    const action =
      nextFreeSerial === null
        ? el('button', { type: 'button', class: 'button' }, ['Choose new dates'])
        : el('button', { type: 'button', class: 'button' }, [`Book ${nextFreeSerial} instead`]);
    action.addEventListener('click', () => {
      if (nextFreeSerial === null) {
        controls.strip.slider.focus();
        return;
      }
      selectSerial(nextFreeSerial);
      void submitHold();
    });
    alertHost.append(
      el('div', { role: 'alert', class: 'unit-taken' }, [
        el('h2', { class: 'alert-heading' }, [COPY.unitTakenHeading]),
        el('p', {}, [unitTakenText(serial)]),
        action,
      ]),
    );
    action.focus();
  };

  const selectSerial = (serial: string): void => {
    const radio = tablesHost.querySelector<HTMLInputElement>(`input[value="${serial}"]`);
    if (radio === null) return;
    radio.checked = true;
    radio.dispatchEvent(new Event('change'));
  };

  const submitHold = async (): Promise<void> => {
    const returnDate = returnDateOf(selection);
    if (selection.pickupDate === null || returnDate === null) return;
    holdError.textContent = '';
    holdButton.disabled = true;
    const original = holdButton.textContent;
    holdButton.textContent = COPY.holdPending;
    const units: Record<string, string> = {};
    for (const [classId, serial] of picks) if (serial !== null) units[classId] = serial;
    try {
      const created = await apiSend<{ booking: Booking; renterKey: string }>(
        'POST',
        '/api/bookings',
        {
          kitId: kit.id,
          pickupDate: selection.pickupDate,
          returnDate,
          renter: { name: nameField.value, email: emailField.value },
          units,
        },
        { 'Idempotency-Key': newIdempotencyKey() },
      );
      window.location.assign(
        `/bookings/${created.booking.ref}?key=${encodeURIComponent(created.renterKey)}`,
      );
    } catch (error) {
      holdButton.disabled = false;
      holdButton.textContent = original ?? 'Hold this kit';
      if (!(error instanceof ApiFailure)) throw error;
      if (error.code === 'unit_taken') {
        showUnitTaken(
          error.body.error.serial ?? null,
          error.body.error.nextFreeSerial ?? null,
        );
        void refreshDetail(null);
        return;
      }
      holdError.textContent = error.controlMessage();
      status.textContent = error.controlMessage();
    }
  };

  const form = el('form', { class: 'hold-form' }, [
    el('label', { class: 'field', for: 'renter-name' }, [
      el('span', { class: 'field-label' }, ['Your name']),
      nameField,
    ]),
    el('label', { class: 'field', for: 'renter-email' }, [
      el('span', { class: 'field-label' }, ['Email']),
      emailField,
    ]),
    holdError,
    holdButton,
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitHold();
  });

  page.append(
    categoryNav(categories, '/'),
    el('div', { class: 'kit-main' }, [
      el('div', { class: 'sheet sheet-poster' }, [
        el('div', { class: 'sheet-band' }, [
          el('h1', { class: 'kit-name' }, [kit.name]),
          el('div', { class: 'sheet-figures' }, [numerals, count]),
          free,
        ]),
        controls.element,
        status,
        tablesHost,
        alertHost,
        form,
      ]),
    ]),
  );

  renderTables(kit);
  holdButton.disabled = selection.pickupDate === null;
  fetcher.request(selection);
}
