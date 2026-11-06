import { api, failure } from '../lib/api.js';
import { el } from '../lib/dom.js';
import { openDialog } from '../lib/dialog.js';
import { handleAccessFailure, staffPage } from '../lib/chrome.js';
import {
  createMessageBox,
  FieldSet,
  handOffMessage,
  takeHandOffMessage,
  withPending,
} from '../lib/forms.js';
import { navigate, type RouteContext } from '../lib/router.js';
import {
  button,
  columns,
  combobox,
  dataTable,
  definitionList,
  listItem,
  namedList,
  quietButton,
  spinbutton,
  textbox,
} from '../lib/views.js';
import { formatInstant, MESSAGES } from '../../shared/copy.js';
import {
  centimetresFromMetres,
  formatDate,
  formatMeasurement,
  formatMoney,
} from '../../shared/format.js';
import type { BerthBooking, BerthResult, Marina, PowerSlot, YachtProfile } from '../lib/types.js';

const REFRESH_MS = 10_000;

function measurement(value: number): string {
  return formatMeasurement(centimetresFromMetres(value.toFixed(2)));
}

export async function berthsScreen(host: HTMLElement, context: RouteContext): Promise<void> {
  const workspaceSlug = context.params.ws;
  const page = await staffPage(host, workspaceSlug, 'Berths');
  if (page === null) return;
  const [yachtsResult, marinasResult] = await Promise.all([
    api.get<{ yachts: readonly YachtProfile[] }>(`/api/w/${workspaceSlug}/yachts`),
    api.get<{ marinas: readonly Marina[] }>(`/api/w/${workspaceSlug}/marinas`),
  ]);
  if (!yachtsResult.ok || !marinasResult.ok) return;
  const yachts = [...yachtsResult.data.yachts].sort((left, right) => (left.name < right.name ? -1 : 1));
  const marinas = marinasResult.data.marinas;
  const fields = new FieldSet();
  const messages = createMessageBox();

  const yacht = combobox(
    'Yacht',
    yachts.map((entry) => ({ value: entry.slug, label: entry.name })),
    yachts[0]?.slug,
  );
  const marina = combobox(
    'Marina',
    marinas.map((entry) => ({ value: entry.id, label: entry.name })),
  );
  const baseMarinaOf = (slug: string): string => {
    const found = yachts.find((entry) => entry.slug === slug);
    return found?.base === 'lavrio' ? 'lavrio-marina' : 'split-marina';
  };
  marina.value = baseMarinaOf(yacht.value);
  yacht.addEventListener('change', () => {
    marina.value = baseMarinaOf(yacht.value);
  });
  const marinaToday = (): string =>
    marinas.find((entry) => entry.id === marina.value)?.today ?? marinas[0].today;
  const arrivalDate = textbox('Arrival date', marinaToday());
  const nights = spinbutton('Nights', 1, 1, 14);
  const search = button('Search berths');
  const results = namedList('Berths', 'No berths yet.');

  const run = async (): Promise<void> => {
    fields.clearErrors();
    const query = new URLSearchParams({
      yachtSlug: yacht.value,
      arrivalDate: arrivalDate.value,
      nights: nights.value,
    });
    const result = await api.get<{ berths: readonly BerthResult[] }>(
      `/api/w/${workspaceSlug}/marinas/${marina.value}/berths?${query.toString()}`,
    );
    if (!result.ok) {
      const body = failure(result);
      if (body.errors !== undefined) fields.showErrors(body.errors)?.focus();
      else if (!handleAccessFailure(result, messages)) messages.show(MESSAGES.unexpected, 'problem');
      results.setItems([]);
      return;
    }
    results.setItems(
      result.data.berths.map((berth) => {
        const bookable = berth.fits && berth.available;
        const bookButton = button(`Book berth ${berth.code}`);
        if (bookable) {
          bookButton.addEventListener('click', () =>
            openBookBerth({
              opener: bookButton,
              workspaceSlug,
              marinaId: marina.value,
              yachtSlug: yacht.value,
              yachtName: yachts.find((entry) => entry.slug === yacht.value)?.name ?? '',
              arrivalDate: arrivalDate.value,
              nights: Number(nights.value),
              berth,
              messages,
            }),
          );
        }
        return listItem(
          el(
            'div',
            { class: 'berth-card' },
            el('h3', { class: 'card-heading' }, `Berth ${berth.code}`),
            el('p', { class: 'card-figure' }, `Length ${measurement(berth.lengthM)}`),
            el('p', { class: 'card-figure' }, `Width ${measurement(berth.widthM)}`),
            el('p', { class: 'card-figure' }, `Depth ${measurement(berth.depthM)}`),
            el('p', { class: 'card-line' }, berth.fits ? 'Fits' : "Doesn't fit"),
            el('p', { class: 'card-line' }, berth.available ? 'Available' : 'Booked'),
            el(
              'p',
              { class: 'card-figure' },
              berth.nights
                .map((night) => `${formatDate(night.date)} ${formatMoney(night.feeMinor, berth.currency)}`)
                .join(' · '),
            ),
            el('p', { class: 'card-figure' }, `Total ${formatMoney(berth.totalMinor, berth.currency)}`),
            bookable ? bookButton : null,
          ),
        );
      }),
    );
  };
  search.addEventListener('click', () => void run());

  page.main.append(
    messages.node,
    columns(
      [
        el(
          'form',
          { class: 'search-form', novalidate: true, onsubmit: (event: Event) => event.preventDefault() },
          fields.problems,
          fields.field('yachtSlug', 'Yacht', yacht),
          fields.field('marinaId', 'Marina', marina),
          fields.field('arrivalDate', 'Arrival date', arrivalDate),
          fields.field('nights', 'Nights', nights),
          search,
        ),
      ],
      [results.section],
    ),
  );
  await run();
}

function openBookBerth(options: {
  readonly opener: HTMLButtonElement;
  readonly workspaceSlug: string;
  readonly marinaId: string;
  readonly yachtSlug: string;
  readonly yachtName: string;
  readonly arrivalDate: string;
  readonly nights: number;
  readonly berth: BerthResult;
  readonly messages: ReturnType<typeof createMessageBox>;
}): void {
  openDialog({
    name: 'Book berth',
    kind: 'sheet',
    opener: options.opener,
    build: (handle) => {
      const nightsTable = dataTable('Nights', ['Date', 'Fee'], 'No nights yet.');
      nightsTable.setRows(
        options.berth.nights.map((night) => [
          formatDate(night.date),
          formatMoney(night.feeMinor, options.berth.currency),
        ]),
      );
      const confirm = button('Book berth');
      const cancel = quietButton('Cancel');
      const dialogMessage = createMessageBox();
      cancel.addEventListener('click', () => handle.close());
      confirm.addEventListener('click', () => {
        void withPending(confirm, 'Booking berth', async () => {
          const result = await api.post<{ booking: BerthBooking }>(
            `/api/w/${options.workspaceSlug}/berth-bookings`,
            {
              yachtSlug: options.yachtSlug,
              marinaId: options.marinaId,
              berthCode: options.berth.code,
              arrivalDate: options.arrivalDate,
              nights: options.nights,
            },
          );
          if (result.ok) {
            handle.close();
            handOffMessage(MESSAGES.berthBooked(options.berth.code, formatDate(options.arrivalDate)));
            navigate(`/w/${options.workspaceSlug}/berth-bookings/${result.data.booking.id}`);
            return;
          }
          const body = failure(result);
          if (body.error === 'does_not_fit') {
            dialogMessage.show(
              MESSAGES.berthDoesNotFit(options.yachtName, options.berth.code),
              'problem',
            );
          } else if (body.error === 'berth_taken') {
            dialogMessage.show(MESSAGES.berthTaken(options.berth.code), 'problem');
          } else if (body.errors !== undefined) {
            dialogMessage.show(Object.values(body.errors)[0], 'problem');
          } else if (!handleAccessFailure(result, dialogMessage)) {
            dialogMessage.show(MESSAGES.unexpected, 'problem');
          }
          confirm.focus();
        });
      });
      return {
        body: [nightsTable.section, dialogMessage.node, el('div', { class: 'dialog-actions' }, confirm, cancel)],
        first: () => confirm,
      };
    },
  });
}

export async function berthBookingScreen(host: HTMLElement, context: RouteContext): Promise<void> {
  const workspaceSlug = context.params.ws;
  const result = await api.get<{ booking: BerthBooking }>(
    `/api/w/${workspaceSlug}/berth-bookings/${context.params.bookingId}`,
  );
  if (!result.ok) {
    const { notFoundScreen } = await import('./feedbackPages.js');
    await notFoundScreen(host);
    return;
  }
  const booking = result.data.booking;
  const marinas = await api.get<{ marinas: readonly Marina[] }>(`/api/w/${workspaceSlug}/marinas`);
  const marinaName =
    marinas.ok
      ? (marinas.data.marinas.find((entry) => entry.id === booking.marinaId)?.name ?? booking.marinaId)
      : booking.marinaId;
  const page = await staffPage(host, workspaceSlug, `Berth ${booking.berthCode}, ${marinaName}`);
  if (page === null) return;
  const messages = createMessageBox();
  takeHandOffMessage(messages);
  const nights = dataTable('Nights', ['Date', 'Rate per metre', 'Fee'], 'No nights yet.');
  nights.setRows(
    booking.nights.map((night) => [
      formatDate(night.date),
      formatMoney(night.ratePerMetreMinor, booking.currency),
      formatMoney(night.feeMinor, booking.currency),
    ]),
  );
  page.main.append(
    messages.node,
    definitionList([
      ['Yacht', booking.yachtSlug],
      ['Arrival', formatDate(booking.arrivalDate)],
      ['Departure', formatDate(booking.departureDate)],
      ['Total', formatMoney(booking.totalMinor, booking.currency)],
      ['Booked by', booking.bookedBy],
      ['Booked at', formatInstant(booking.bookedAt)],
    ]),
    nights.section,
  );
}

export async function shorePowerScreen(
  host: HTMLElement,
  context: RouteContext,
): Promise<(() => void) | void> {
  const workspaceSlug = context.params.ws;
  const page = await staffPage(host, workspaceSlug, 'Shore power');
  if (page === null) return;
  const [yachtsResult, marinasResult] = await Promise.all([
    api.get<{ yachts: readonly YachtProfile[] }>(`/api/w/${workspaceSlug}/yachts`),
    api.get<{ marinas: readonly Marina[] }>(`/api/w/${workspaceSlug}/marinas`),
  ]);
  if (!yachtsResult.ok || !marinasResult.ok) return;
  const yachts = [...yachtsResult.data.yachts].sort((left, right) => (left.name < right.name ? -1 : 1));
  const marinas = marinasResult.data.marinas;
  const messages = createMessageBox();
  const fields = new FieldSet();

  const yacht = combobox(
    'Yacht',
    yachts.map((entry) => ({ value: entry.slug, label: entry.name })),
    yachts[0]?.slug,
  );
  const marina = combobox(
    'Marina',
    marinas.map((entry) => ({ value: entry.id, label: entry.name })),
    'split-marina',
  );
  const pontoonOptions = (): { value: string; label: string }[] => {
    const found = marinas.find((entry) => entry.id === marina.value);
    return (found?.pontoons ?? []).map((pontoon) => ({ value: pontoon.code, label: pontoon.code }));
  };
  let pontoon = combobox('Pontoon', pontoonOptions(), pontoonOptions()[0]?.value);
  const pontoonField = el('div', {}, pontoon);
  const marinaToday = (): string =>
    marinas.find((entry) => entry.id === marina.value)?.today ?? marinas[0].today;
  const date = textbox('Date', marinaToday());
  const slots = namedList('Slots', 'No slots yet.');

  const load = async (): Promise<void> => {
    const result = await api.get<{ limitKw: number; base: string; slots: readonly PowerSlot[] }>(
      `/api/w/${workspaceSlug}/marinas/${marina.value}/pontoons/${pontoon.value}/slots?date=${date.value}`,
    );
    if (!result.ok) {
      const body = failure(result);
      if (body.errors !== undefined) fields.showErrors(body.errors)?.focus();
      slots.setItems([]);
      return;
    }
    const base = result.data.base as 'split' | 'lavrio';
    slots.setItems(
      result.data.slots.map((slot) => {
        const startTime = formatInstant(slot.startsAt, base).split(', ')[1].slice(0, 5);
        const endTime = formatInstant(slot.endsAt, base).split(', ')[1].slice(0, 5);
        const bookButton = button(`Book ${startTime} slot`);
        bookButton.disabled = slot.status !== 'open';
        bookButton.addEventListener('click', () => {
          void withPending(bookButton, 'Booking slot', async () => {
            const booked = await api.post(`/api/w/${workspaceSlug}/shore-power-bookings`, {
              yachtSlug: yacht.value,
              marinaId: marina.value,
              pontoonCode: pontoon.value,
              slotStart: slot.startsAt,
            });
            if (booked.ok) {
              messages.show(MESSAGES.slotBooked(formatInstant(slot.startsAt, base)));
            } else {
              const body = failure(booked);
              if (body.error === 'slot_taken') {
                messages.show(
                  MESSAGES.slotTaken(String(body.takenBy), formatInstant(String(body.takenAt))),
                  'problem',
                );
              } else if (body.error === 'slot_past') {
                messages.show(MESSAGES.slotPast, 'problem');
              } else if (body.error === 'already_booked') {
                messages.show(MESSAGES.slotAlreadyYours, 'problem');
              } else if (!handleAccessFailure(booked, messages)) {
                messages.show(MESSAGES.unexpected, 'problem');
              }
            }
            await load();
          });
        });
        return listItem(
          el(
            'div',
            { class: 'slot-card' },
            el('p', { class: 'card-figure' }, `${startTime}–${endTime}`),
            el(
              'p',
              { class: 'card-line' },
              slot.status === 'open' ? 'Open' : slot.status === 'full' ? 'Full' : 'Past',
            ),
            el('p', { class: 'card-figure' }, `${slot.bookedKw} of ${result.data.limitKw} kW`),
            bookButton,
          ),
        );
      }),
    );
  };

  marina.addEventListener('change', () => {
    pontoon = combobox('Pontoon', pontoonOptions(), pontoonOptions()[0]?.value);
    pontoonField.replaceChildren(pontoon);
    pontoon.addEventListener('change', () => void load());
    date.value = marinaToday();
    void load();
  });
  pontoon.addEventListener('change', () => void load());
  date.addEventListener('change', () => void load());
  yacht.addEventListener('change', () => void load());

  page.main.append(
    messages.node,
    columns(
      [
        el(
          'form',
          { class: 'search-form', novalidate: true, onsubmit: (event: Event) => event.preventDefault() },
          fields.problems,
          fields.field('yachtSlug', 'Yacht', yacht),
          fields.field('marinaId', 'Marina', marina),
          fields.field('pontoonCode', 'Pontoon', pontoonField),
          fields.field('date', 'Date', date),
        ),
      ],
      [slots.section],
    ),
  );
  await load();
  const timer = window.setInterval(() => void load(), REFRESH_MS);
  return () => window.clearInterval(timer);
}
