import { api, state, el, clear, longDateFromKey, durationText } from '../lib.js';
import { announce } from '../live.js';
import { readKitchen, buildHeader, removeHeader, startClockText } from '../header.js';

// Booking receipt: a printable order-ticket card for one booking, with email
// delivery lines that update in place.

interface BookingJson {
  id: string; stationId: string; stationName: string; shelfId: string | null; shelfName: string | null;
  start: string; end: string; status: string; debitedMinutes: number | null;
  emails: Array<{ kind: string; status: string; sentAt: string | null }>;
}

let zone = 'UTC';

export function renderReceipt(app: HTMLElement, url: URL, bookingId: string): () => void {
  const timers: number[] = [];
  let destroyed = false;
  void url;

  const boot = async () => {
    const kitchen = await readKitchen();
    if (!kitchen || destroyed) return;
    zone = kitchen.timeZone;
    removeHeader();
    buildHeader({ role: state.me!.role, displayName: state.me!.displayName });
    const stopClock = startClockText({ clockText: document.querySelector('.clock-text') as HTMLElement, menuButton: null, menuPanel: null }, zone);

    const wrap = el('div', { class: 'receipt-wrap' });
    app.append(el('h1', { class: 'screen-heading' }, 'Booking receipt'), wrap);
    let emailStates: Map<string, string> = new Map();
    let drawn = false;

    const load = async () => {
      const r = await api('GET', `/api/bookings/${bookingId}`);
      if (destroyed) return;
      if (r.status !== 200 || !r.ok) {
        if (!drawn) {
          clear(wrap);
          wrap.append(el('p', { class: 'missing-record' }, "That record isn't available."));
          announce("That record isn't available.");
        }
        return;
      }
      if (r.sentUnder !== state.sessionId) return;
      const booking = r.ok as BookingJson;
      draw(booking);
      drawn = true;
    };

    const draw = (booking: BookingJson) => {
      clear(wrap);
      const card = el('article', { class: 'ticket-card receipt-card' });
      card.append(row('Station', booking.stationName));
      card.append(row('Shelf', booking.shelfName ?? 'None'));
      card.append(row('Date', longDateFromKey(dateKeyOf(booking.start), zone)));
      card.append(row('Starts', timeOf(booking.start)));
      card.append(row('Ends', timeOf(booking.end)));
      card.append(row('Hours debited', durationText(booking.debitedMinutes ?? 0)));
      card.append(row('Status', statusLabel(booking.status)));
      card.append(row('Booking reference', booking.id));
      for (const email of booking.emails) {
        const label = email.kind === 'booking_confirmed' ? 'Confirmation email' : 'Move email';
        const key = `${booking.id}:${email.kind}`;
        const previous = emailStates.get(key);
        const text = email.status === 'sent' && email.sentAt
          ? `${label}: Sent ${longDateFromKey(dateKeyOf(email.sentAt), zone)} ${timeOf(email.sentAt)}`
          : `${label}: Queued`;
        if (previous === 'queued' && email.status === 'sent') {
          announce(`${label} sent.`);
        }
        emailStates.set(key, email.status);
        card.append(rowText(label === 'Confirmation email' ? 'Confirmation email' : 'Move email', text));
      }
      wrap.appendChild(card);
    };

    await load();
    timers.push(window.setInterval(() => { void load(); }, 10_000));
    return () => {
      destroyed = true;
      stopClock();
      for (const t of timers) clearInterval(t);
      removeHeader();
    };
  };

  let cleanupFn: (() => void) | null = null;
  void boot().then((fn) => { cleanupFn = fn ?? null; });
  return () => {
    destroyed = true;
    cleanupFn?.();
  };
}

function row(label: string, value: string): HTMLElement {
  return el('p', { class: 'receipt-row' }, el('span', { class: 'receipt-label' }, `${label}: `), value);
}

function rowText(label: string, text: string): HTMLElement {
  const p = el('p', { class: 'receipt-email-line' });
  p.textContent = text;
  void label;
  return p;
}

function statusLabel(status: string): string {
  if (status === 'held') return 'Held';
  if (status === 'confirmed') return 'Confirmed';
  if (status === 'checked_in') return 'Checked in';
  if (status === 'completed') return 'Completed';
  if (status === 'cancelled') return 'Cancelled';
  if (status === 'no_show') return 'No-show';
  return status;
}

function dateKeyOf(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).replace(/\//g, '-');
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}
