import { request } from '../api';
import { el, focusElement, setText } from '../dom';
import { RECEIPT_MS, Refreshes } from '../refresh';
import { announce, heading, navigate, type Screen, type ScreenContext } from '../shell';
import * as copy from '../copy';
import { formatDateLabel, formatDuration, isoDate, isoTime } from '../../shared/format';
import type { Booking } from '../../shared/types';

export async function mountReceipt(ctx: ScreenContext): Promise<Screen> {
  const bookingId = ctx.params.id ?? '';
  const refreshes = new Refreshes();

  const first = await request<Booking>('GET', `/api/bookings/${bookingId}`);
  if (first.kind !== 'ok') {
    if (first.kind === 'error' && first.status === 401) return { unmount: () => undefined };
    if (ctx.user?.role === 'owner') {
      ctx.root.append(el('p', { text: copy.missingRecord, className: 'outcome-copy' }));
      announce(copy.missingRecord);
      return { unmount: () => undefined };
    }
    navigate('/board', { replace: true });
    return { unmount: () => undefined };
  }

  const level1 = heading('Booking receipt');
  const card = el('article', { className: 'ticket-card receipt-card' });
  const lines = new Map<string, HTMLElement>();
  for (const label of ['Station', 'Shelf', 'Date', 'Starts', 'Ends', 'Hours debited', 'Status', 'Booking reference']) {
    const line = el('p', { className: 'receipt-line' });
    lines.set(label, line);
    card.append(line);
  }
  const emailLines = el('div', { className: 'email-lines' });
  card.append(emailLines);
  ctx.root.append(level1, card);
  focusElement(level1);

  const emailStates = new Map<string, string>();

  const draw = (booking: Booking): void => {
    const set = (label: string, value: string): void => {
      const line = lines.get(label);
      if (line !== undefined) setText(line, `${label}: ${value}`);
    };
    set('Station', booking.stationName);
    set('Shelf', booking.shelfName ?? 'None');
    set('Date', formatDateLabel(isoDate(booking.start)));
    set('Starts', isoTime(booking.start));
    set('Ends', isoTime(booking.end));
    set('Hours debited', formatDuration(booking.debitedMinutes ?? 0));
    set('Status', copy.ticketStatus(booking, 0, false));
    set('Booking reference', booking.id);

    emailLines.textContent = '';
    for (const email of booking.emails) {
      const text = copy.receiptEmailLine(email);
      emailLines.append(
        el('p', { text, className: text.endsWith('Queued') ? 'email-line queued-mark' : 'email-line' }),
      );
      const previous = emailStates.get(email.kind);
      if (previous !== undefined && previous !== text && email.status === 'sent') {
        announce(copy.receiptEmailAnnouncement(email.kind));
      }
      emailStates.set(email.kind, text);
    }
  };

  draw(first.body);

  refreshes.every(RECEIPT_MS, () => {
    void (async () => {
      const result = await request<Booking>('GET', `/api/bookings/${bookingId}`);
      if (result.kind === 'ok') draw(result.body);
    })();
  });

  return {
    unmount: () => {
      refreshes.stop();
    },
  };
}
