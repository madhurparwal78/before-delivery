import { ApiRequest, errorText } from './api.js';
import { el, status, dollarsToCents, centsToDollars } from './ui.js';
import type { Stay, Night } from './types.js';
import { formatMoney } from './types.js';
import { setNotice, refreshDeskData, renderTimeline, renderToday } from './desk.js';
import { renderFolioBody } from './folio.js';

export function openNewStayDialog(roomId?: string, date?: string): void {
  const dialog = el('div', { class: 'dialog overlay-full', role: 'dialog', 'aria-label': 'New stay' });

  const guestName = el('input', { type: 'text', 'aria-label': 'Guest name' }) as HTMLInputElement;
  const guestEmail = el('input', { type: 'text', 'aria-label': 'Guest email' }) as HTMLInputElement;
  const guestPhone = el('input', { type: 'text', 'aria-label': 'Guest phone' }) as HTMLInputElement;
  const arrival = el('input', { type: 'text', 'aria-label': 'Arrival', value: date ?? '' }) as HTMLInputElement;
  const departure = el('input', { type: 'text', 'aria-label': 'Departure' }) as HTMLInputElement;
  const guests = el('input', { type: 'number', 'aria-label': 'Guests', min: '1', max: '6', value: '1' }) as HTMLInputElement;
  const roomSelect = el('select', { 'aria-label': 'Room' }) as HTMLSelectElement;
  const planSelect = el('select', { 'aria-label': 'Rate plan' }) as HTMLSelectElement;

  const nightlyWrap = el('div', {});
  const stayTotal = status('—');
  stayTotal.setAttribute('role', 'status');
  stayTotal.id = 'new-stay-total';
  const errorsWrap = el('div', { class: 'alert-errors', role: 'alert', 'aria-label': 'Form errors' });
  errorsWrap.style.display = 'none';

  const fields: Array<{ label: string; input: HTMLInputElement | HTMLSelectElement }> = [
    { label: 'Guest name', input: guestName },
    { label: 'Guest email', input: guestEmail },
    { label: 'Guest phone', input: guestPhone },
    { label: 'Arrival', input: arrival },
    { label: 'Departure', input: departure },
    { label: 'Guests', input: guests },
    { label: 'Room', input: roomSelect },
    { label: 'Rate plan', input: planSelect }
  ];
  const fieldErrors: Record<string, HTMLElement> = {};
  const form = el('form', {}, ...fields.map(f => {
    const err = el('span', { class: 'field-error' });
    fieldErrors[f.label] = err;
    return el('div', { class: 'form-row' }, el('label', { text: f.label }), f.input, err);
  }));
  form.addEventListener('submit', ev => ev.preventDefault());

  let quoteTimer: number | null = null;
  let quoteSeq = 0;
  const refreshQuote = () => {
    if (quoteTimer !== null) window.clearTimeout(quoteTimer);
    quoteTimer = window.setTimeout(async () => {
      const seq = ++quoteSeq;
      const body = {
        arrival: arrival.value, departure: departure.value,
        guests: Number(guests.value) || 0,
        roomId: roomSelect.value, ratePlanId: planSelect.value
      };
      const res = await ApiRequest.post('/api/stays/quote', body);
      if (seq !== quoteSeq) return;
      if (res.status === 200) {
        renderNightly(nightlyWrap, res.data.nightly as Night[]);
        stayTotal.textContent = formatMoney(res.data.totalCents);
      } else {
        nightlyWrap.replaceChildren();
        stayTotal.textContent = '—';
      }
    }, 120);
  };
  for (const f of [arrival, departure, guests, roomSelect, planSelect]) {
    f.addEventListener('input', refreshQuote);
    f.addEventListener('change', refreshQuote);
  }

  void (async () => {
    const tl = await ApiRequest.get(`/api/timeline?from=${new Date().toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}`);
    roomSelect.append(el('option', { value: '', text: 'Choose' }));
    if (tl.status === 200) {
      for (const room of tl.data.rooms) {
        roomSelect.append(el('option', { value: room.id, text: room.number }));
      }
    }
    if (roomId) roomSelect.value = roomId;
    const plansRes = await ApiRequest.get('/api/rate-plans');
    planSelect.append(el('option', { value: '', text: 'Choose' }));
    if (plansRes.status === 200) {
      for (const plan of plansRes.data.ratePlans) {
        planSelect.append(el('option', { value: plan.id, text: plan.name }));
      }
    }
    refreshQuote();
  })();

  let pending = false;
  const opener = document.activeElement as HTMLElement | null;
  const createBtn = el('button', { text: 'Create stay', class: 'primary' }) as HTMLButtonElement;
  const close = () => {
    dialog.remove();
    if (opener && document.contains(opener)) opener.focus();
  };
  createBtn.addEventListener('click', async () => {
    if (pending) return;
    pending = true;
    createBtn.setAttribute('aria-busy', 'true');
    setNotice('Creating stay…');
    errorsWrap.style.display = 'none';
    errorsWrap.replaceChildren();
    const body = {
      guest: { name: guestName.value, email: guestEmail.value, phone: guestPhone.value },
      arrival: arrival.value, departure: departure.value,
      guests: Number(guests.value) || 0,
      roomId: roomSelect.value, ratePlanId: planSelect.value
    };
    const key = 'create-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const res = await ApiRequest.post('/api/stays', body, { idempotencyKey: key });
    pending = false;
    createBtn.removeAttribute('aria-busy');
    if (res.status === 201) {
      const stay = res.data as Stay;
      setNotice(`Stay created for ${stay.guest.name} in room ${stay.nightly[0]?.roomNumber ?? ''}.`);
      close();
      await refreshDeskData();
      renderTimeline();
      renderToday();
    } else if (res.status === 422) {
      const errors = res.data.errors as Record<string, string>;
      for (const [field, message] of Object.entries(errors)) {
        const label = field.startsWith('guest.') ? `Guest ${field.split('.')[1]}` : field.charAt(0).toUpperCase() + field.slice(1);
        const link = el('a', { href: '#', text: `${label}: ${message}` });
        const targetField = field === 'guest.name' ? guestName :
          field === 'guest.email' ? guestEmail :
          field === 'guest.phone' ? guestPhone :
          field === 'arrival' ? arrival :
          field === 'departure' ? departure :
          field === 'guests' ? guests :
          field === 'roomId' ? roomSelect : planSelect;
        link.addEventListener('click', ev => {
          ev.preventDefault();
          targetField.focus();
        });
        const errNode = fieldErrors[label];
        if (errNode) errNode.textContent = message;
        errorsWrap.append(link);
      }
      errorsWrap.style.display = 'block';
    } else {
      setNotice(errorText(res.data) ?? 'Create failed.');
    }
  });

  const closeBtn = el('button', { text: 'Close' }) as HTMLButtonElement;
  closeBtn.addEventListener('click', close);

  dialog.append(
    el('h2', { text: 'New stay' }),
    errorsWrap,
    form,
    el('h3', { text: 'Nightly breakdown' }),
    nightlyWrap,
    el('p', {}, el('b', { text: 'Stay total ' }), stayTotal),
    el('div', {}, createBtn, closeBtn)
  );
  dialog.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { ev.stopPropagation(); close(); }
    if (ev.key === 'Tab') trapTab(ev, dialog);
  });
  document.body.append(dialog);
  guestName.focus();
}

export function renderNightly(wrap: HTMLElement, nightly: Night[]): void {
  const table = el('table', { class: 'data', 'aria-label': 'Nightly breakdown' });
  table.append(el('thead', {}, el('tr', {},
    el('th', { text: 'Date' }), el('th', { text: 'Room' }), el('th', { class: 'num', text: 'Tax' }),
    el('th', { class: 'num', text: 'City tax' }), el('th', { class: 'num', text: 'Night total' }))));
  const tbody = el('tbody');
  for (const night of nightly) {
    tbody.append(el('tr', {},
      el('td', { text: night.date }), el('td', { text: night.roomNumber }),
      el('td', { class: 'num', text: formatMoney(night.taxCents) }),
      el('td', { class: 'num', text: formatMoney(night.cityTaxCents) }),
      el('td', { class: 'num', text: formatMoney(night.totalCents) })));
  }
  table.append(tbody);
  wrap.replaceChildren(table);
}

export function trapTab(ev: KeyboardEvent, container: HTMLElement): void {
  if (ev.key !== 'Tab') return;
  const focusables = Array.from(container.querySelectorAll<HTMLElement>('button, input, select, a[href], [tabindex]'))
    .filter(f => f.offsetParent !== null || f === document.activeElement);
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (ev.shiftKey && document.activeElement === first) {
    ev.preventDefault();
    last.focus();
  } else if (!ev.shiftKey && document.activeElement === last) {
    ev.preventDefault();
    first.focus();
  } else if (!container.contains(document.activeElement)) {
    ev.preventDefault();
    first.focus();
  }
}

export { dollarsToCents, centsToDollars };
export function formStatus(): HTMLElement {
  const node = status('');
  node.setAttribute('role', 'status');
  return node;
}
export { errorText };
export type { Stay };
export { renderFolioBody };
