import { addDays, PlainDate } from '../shared/dates';
import { notices, pendingTexts } from '../shared/notices';
import { call, newIdempotencyKey } from './api';
import { loadDesk, state } from './app';
import { fieldNote, formErrors, FormError, nightlyBreakdown, stayTotal } from './components';
import { DialogHandle, openDialogFor } from './dialog';
import { button, el, labelled, select, textbox } from './dom';
import { regionNames, setMessage } from './regions';
import { Quote, Stay } from './types';

const QUOTE_DELAY_MS = 300;

const labels: Record<string, string> = {
  'guest.name': 'Guest name',
  'guest.email': 'Guest email',
  arrival: 'Arrival',
  departure: 'Departure',
  guests: 'Guests',
  roomId: 'Room',
  ratePlanId: 'Rate plan',
  idempotencyKey: 'Guest name',
};

export interface NewStaySeed {
  roomId: string | null;
  arrival: PlainDate | null;
}

export function openNewStay(
  opener: HTMLElement | null,
  seed: NewStaySeed,
  restoreFocus?: () => void,
): DialogHandle {
  const rooms = state.timeline ? state.timeline.rooms : [];
  const plans = state.ratePlans;
  const arrival = seed.arrival ?? (state.desk ? state.desk.hotel.businessDate : '');

  const guestName = textbox('Guest name');
  const guestEmail = textbox('Guest email');
  const guestPhone = textbox('Guest phone');
  const arrivalField = textbox('Arrival', arrival);
  const departureField = textbox('Departure', arrival === '' ? '' : addDays(arrival, 1));
  const guestsField = el('input', {
    type: 'number',
    min: '1',
    max: '6',
    value: '1',
    'aria-label': 'Guests',
  });
  const roomField = select(
    'Room',
    [
      ...(seed.roomId === null ? [{ value: '', label: 'Choose' }] : []),
      ...rooms.map((room) => ({ value: room.id, label: room.number })),
    ],
    seed.roomId ?? '',
  );
  const planField = select(
    'Rate plan',
    [{ value: '', label: 'Choose' }, ...plans.map((plan) => ({ value: plan.id, label: plan.name }))],
    '',
  );

  /** One key for repeated presses of the same form, so a double press yields one stay. */
  let idempotencyKey = newIdempotencyKey();
  const breakdownHost = el('div', { class: 'breakdown' });
  const errorHost = el('div');
  const notes = new Map<string, HTMLElement>();
  const create = button('Create stay', () => void send());
  let quoteTimer = 0;

  function fieldFor(name: string): HTMLElement {
    switch (name) {
      case 'guest.name':
        return guestName;
      case 'guest.email':
        return guestEmail;
      case 'arrival':
        return arrivalField;
      case 'departure':
        return departureField;
      case 'guests':
        return guestsField;
      case 'roomId':
        return roomField;
      default:
        return planField;
    }
  }

  function showErrors(fieldErrors: Record<string, string> | null): void {
    for (const note of notes.values()) note.remove();
    notes.clear();
    while (errorHost.firstChild) errorHost.removeChild(errorHost.firstChild);
    if (!fieldErrors) return;
    const list: FormError[] = [];
    for (const [field, message] of Object.entries(fieldErrors)) {
      const label = labels[field] ?? field;
      const target = fieldFor(field);
      const note = fieldNote(message);
      notes.set(field, note);
      if (target.parentElement) target.parentElement.append(note);
      list.push({ field, label, message, focus: () => target.focus() });
    }
    const alert = formErrors(list);
    if (alert) errorHost.append(alert);
  }

  async function refreshQuote(): Promise<void> {
    const body = {
      arrival: arrivalField.value.trim(),
      departure: departureField.value.trim(),
      guests: Number.parseInt(guestsField.value, 10),
      roomId: roomField.value,
      ratePlanId: planField.value,
    };
    const result = await call<Quote>('/api/stays/quote', { method: 'POST', body });
    while (breakdownHost.firstChild) breakdownHost.removeChild(breakdownHost.firstChild);
    if (result.data) {
      breakdownHost.append(nightlyBreakdown(result.data.nightly), stayTotal(result.data.totalCents));
      return;
    }
    breakdownHost.append(nightlyBreakdown([]), stayTotal(0));
  }

  function scheduleQuote(): void {
    window.clearTimeout(quoteTimer);
    quoteTimer = window.setTimeout(() => void refreshQuote(), QUOTE_DELAY_MS);
  }

  const freshKey = (): void => {
    idempotencyKey = newIdempotencyKey();
  };
  for (const field of [arrivalField, departureField, guestsField]) {
    field.addEventListener('input', scheduleQuote);
    field.addEventListener('input', freshKey);
  }
  for (const field of [guestName, guestEmail, guestPhone]) {
    field.addEventListener('input', freshKey);
  }
  for (const field of [roomField, planField]) {
    field.addEventListener('change', scheduleQuote);
    field.addEventListener('change', freshKey);
  }

  async function send(): Promise<void> {
    if (create.getAttribute('aria-busy') === 'true') return;
    create.setAttribute('aria-busy', 'true');
    setMessage(regionNames.deskNotices, pendingTexts.createStay);
    const result = await call<Stay>('/api/stays', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: {
        guest: {
          name: guestName.value.trim(),
          email: guestEmail.value.trim(),
          phone: guestPhone.value.trim(),
        },
        arrival: arrivalField.value.trim(),
        departure: departureField.value.trim(),
        guests: Number.parseInt(guestsField.value, 10),
        roomId: roomField.value,
        ratePlanId: planField.value,
      },
    });
    create.removeAttribute('aria-busy');
    if (result.data) {
      const stay = result.data;
      const roomNumber = stay.segments.length > 0 ? stay.segments[0].roomNumber : '';
      const created = notices.stayCreated(stay.guest.name, roomNumber);
      setMessage(
        regionNames.deskNotices,
        stay.checkinLinkState === 'not_sent'
          ? `${created} The check-in link could not be sent. The mail service is unavailable.`
          : created,
      );
      handle.close();
      await loadDesk();
      return;
    }
    if (result.fieldErrors) {
      showErrors(result.fieldErrors);
      setMessage(regionNames.deskNotices, '');
      return;
    }
    setMessage(regionNames.deskNotices, result.error ?? 'Not found.');
  }

  const handle = openDialogFor({
    name: 'New stay',
    opener,
    restoreFocus,
    className: 'panel wide',
    build: (dialog) => [
      el('h2', { text: 'New stay' }),
      errorHost,
      el('div', { class: 'formgrid' }, [
        labelled('Guest name', guestName),
        labelled('Guest email', guestEmail),
        labelled('Guest phone', guestPhone),
        labelled('Arrival', arrivalField),
        labelled('Departure', departureField),
        labelled('Guests', guestsField),
        labelled('Room', roomField),
        labelled('Rate plan', planField),
      ]),
      breakdownHost,
      el('div', { class: 'actions' }, [create, button('Close', () => dialog.close())]),
    ],
  });
  void refreshQuote();
  return handle;
}
