import { h, clear } from '../lib/els.js';
import { router } from '../lib/router.js';
import { store } from '../lib/store.js';
import { api, ApiFail } from '../lib/api.js';
import { announce } from '../lib/announce.js';
import { openDialog } from '../lib/dialog.js';
import { money, hhmm, shortDate } from '../lib/fmt.js';
import { live } from '../lib/live.js';
import type { Booking, Message, Presence, RatingState } from '../lib/types.js';

export async function bookingPage(bookingId: string): Promise<HTMLElement> {
  const me = store.me;
  let booking: Booking;
  try {
    booking = await api<Booking>('GET', `/api/bookings/${bookingId}`);
  } catch {
    return h('div', null, h('h1', null, 'We could not find that page'), h('p', null, h('a', { href: '/search' }, 'Back to search')));
  }
  const isPassenger = booking.passenger?.id === me?.id;
  const other = isPassenger ? booking.driver : booking.passenger;

  const root = h('article', { class: 'booking-page' });
  const heading = h('h1', null, isPassenger
    ? `Your seat: ${booking.boarding} to ${booking.alighting}, ${shortDate(booking.boarding_time)}`
    : `${booking.passenger.display_name}: ${booking.boarding} to ${booking.alighting}, ${shortDate(booking.boarding_time)}`);

  const statusLine = h('p', { class: 'status' }, `Status: ${booking.state.replace(/_/g, ' ')}`);
  const requestPanel = h('div');
  const updateRegion = h('div');
  const actions = h('div', { class: 'booking-actions' });
  const messagesRegion = h('section', { class: 'section-2' });
  const ratingRegion = h('section', { class: 'section-2' });

  // ---------- request panel ----------

  const renderRequestPanel = (): void => {
    clear(requestPanel);
    if (booking.state !== 'requested' && booking.state !== 'expired' && booking.state !== 'declined') return;
    const panel = h('div', { role: 'region', 'aria-label': 'Your request' });
    if (booking.state === 'requested') {
      const s = booking.expires_in_seconds ?? 0;
      const hh = Math.floor(s / 3600);
      const mm = Math.floor((s % 3600) / 60);
      panel.append(h('p', null, `Waiting for ${booking.driver.display_name} to answer. This request expires at ${hhmm(booking.expires_at ?? '')} on ${shortDate(booking.expires_at ?? '')} (${hh > 0 ? `${hh} h ${mm} min` : `${mm} min`} left).`));
      const withdrawBtn = h('button', { type: 'button', class: 'btn', onClick: async () => {
        withdrawBtn.textContent = 'Working';
        try {
          booking = await api<Booking>('POST', `/api/bookings/${booking.id}/withdraw`, {});
          announce(`Request withdrawn. ${money(booking.price_cents)} is back in your wallet.`);
          renderAll();
        } catch (e) {
          if (e instanceof ApiFail) announce(e.body.message);
          withdrawBtn.textContent = 'Withdraw request';
        }
      } }, 'Withdraw request');
      panel.append(withdrawBtn);
    } else if (booking.state === 'expired') {
      panel.append(h('h3', null, 'This request expired'), h('p', null, `${money(booking.price_cents)} is back in your wallet.`));
    } else if (booking.state === 'declined') {
      panel.append(h('p', null, `Request declined by ${booking.driver.display_name}. ${money(booking.price_cents)} is back in your wallet.`));
    }
    requestPanel.append(panel);
  };

  window.setInterval(async () => {
    if (booking.state === 'requested') {
      try {
        const res = await api<Booking>('GET', `/api/bookings/${booking.id}`);
        booking = res;
        renderRequestPanel();
      } catch { /* gone */ }
    }
  }, 60_000);

  // ---------- cancel ----------

  const openCancelDialog = async (): Promise<void> => {
    let quote = booking.cancel_quote;
    if (!quote) {
      try {
        const fresh = await api<Booking>('GET', `/api/bookings/${booking.id}`);
        booking = fresh;
        quote = fresh.cancel_quote;
      } catch { /* keep */ }
    }
    const quoteText = quote
      ? quote.reason === 'free_window'
        ? `Cancelling now refunds ${money(booking.price_cents)} of ${money(booking.price_cents)} (100%, free after the driver's time change).`
        : `Cancelling now refunds ${money(quote.refund_cents)} of ${money(booking.price_cents)} (${quote.percent}%, ${quote.hours_before} hours before departure).`
      : 'Cancelling now refunds nothing.';
    const alertTarget = h('div');
    const confirmBtn = h('button', {
      type: 'button', class: 'btn primary', 'data-autofocus': true,
      onClick: async () => {
        confirmBtn.textContent = 'Working';
        try {
          await api('POST', `/api/bookings/${booking.id}/cancel`, {}, { idempotencyKey: idemKey() });
          announce('Your seat is cancelled.');
          dialog.close();
          router.go('/wallet');
          window.setTimeout(() => { (document.querySelector('main h1') as HTMLElement | null)?.focus(); }, 60);
        } catch (e) {
          if (e instanceof ApiFail) { alertTarget.append(h('div', { role: 'alert', class: 'alert' }, e.body.message)); confirmBtn.textContent = 'Cancel booking'; }
        }
      },
    }, 'Cancel booking');
    const dialog = openDialog({ label: 'Cancel this booking' }, [
      h('p', null, quoteText),
      confirmBtn,
      h('button', { type: 'button', class: 'btn', onClick: () => dialog.close() }, 'Keep booking'),
      alertTarget,
    ]);
  };

  const renderActions = (): void => {
    clear(actions);
    if (isPassenger && booking.state === 'confirmed') {
      actions.append(h('button', { type: 'button', class: 'btn', onClick: () => void openCancelDialog() }, 'Cancel my seat'));
    }
  };

  // ---------- messages ----------

  const renderMessages = async (): Promise<void> => {
    clear(messagesRegion);
    if (!['requested', 'confirmed', 'completed', 'rated', 'held', 'expired', 'declined', 'withdrawn'].includes(booking.state)) return;
    if (booking.state === 'held') return;
    let data: { messages: Message[]; presence: Presence } | null = null;
    try {
      data = await api<{ messages: Message[]; presence: Presence }>('GET', `/api/bookings/${booking.id}/messages`);
    } catch { return; }

    const log = h('div', { role: 'log', 'aria-label': `Messages with ${other.display_name}`, class: 'messages' });
    for (const m of data.messages) {
      log.append(h('div', { 'data-id': m.id }, `${m.author_id === me?.id ? 'You' : other.display_name}: ${m.body}`));
    }
    log.scrollTop = log.scrollHeight;

    const presenceLine = h('p', { class: 'presence' }, presenceText(data.presence));
    const input = h('textarea', { class: 'field', 'aria-label': `Message ${other.display_name}`, rows: '3' }) as HTMLTextAreaElement;
    const send = h('button', {
      type: 'button', class: 'btn primary', onClick: async () => {
        const text = input.value.trim();
        if (text.length === 0) return;
        send.textContent = 'Working';
        try {
          await api('POST', `/api/bookings/${booking.id}/messages`, { body: text });
          input.value = '';
          const fresh = await api<{ messages: Message[]; presence: Presence }>('GET', `/api/bookings/${booking.id}/messages`);
          clear(log);
          for (const m of fresh.messages) {
            log.append(h('div', { 'data-id': m.id }, `${m.author_id === me?.id ? 'You' : other.display_name}: ${m.body}`));
          }
          log.scrollTop = log.scrollHeight;
        } catch (e) {
          if (e instanceof ApiFail) {
            input.value = text;
            announce(e.body.message);
          }
        } finally {
          send.textContent = 'Send';
        }
      },
    }, 'Send');
    input.addEventListener('keydown', (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Enter' && !ke.shiftKey) {
        ke.preventDefault();
        send.click();
      }
    });

    messagesRegion.append(
      h('h2', null, 'Messages'),
      presenceLine,
      log,
      h('div', { class: 'message-compose' }, input, send),
    );
  };

  const presenceText = (p: Presence): string => {
    if (p.member_id === me?.id) return 'You are online';
    if (p.online) return `${other.display_name} is online`;
    if (p.last_seen_at) return `${other.display_name} was online at ${hhmm(p.last_seen_at)}`;
    return `${other.display_name} has not opened this thread yet`;
  };

  // ---------- rating ----------

  const renderRating = async (): Promise<void> => {
    clear(ratingRegion);
    let rating: RatingState;
    try {
      rating = await api<RatingState>('GET', `/api/bookings/${booking.id}/rating`);
    } catch { return; }
    const region = h('div', { role: 'region', 'aria-label': 'Rating' });
    ratingRegion.append(h('h2', null, 'Rating'), region);

    if (rating.state === 'not_open') {
      region.append(h('p', null, 'You can rate this trip once it arrives.'));
      return;
    }
    if (rating.state === 'waiting') {
      region.append(h('p', null, 'Waiting for both ratings'));
      if (rating.mine) region.append(h('p', { class: 'muted' }, `You gave ${rating.mine.stars} ${rating.mine.stars === 1 ? 'star' : 'stars'}.`));
      return;
    }
    if (rating.state === 'revealed') {
      const parts: string[] = [];
      if (rating.mine) parts.push(`you gave ${rating.mine.stars} ${rating.mine.stars === 1 ? 'star' : 'stars'}`);
      else parts.push('You did not rate');
      if (rating.theirs) parts.push(`${other.display_name} gave you ${rating.theirs.stars} ${rating.theirs.stars === 1 ? 'star' : 'stars'}`);
      else parts.push(`${other.display_name} did not rate`);
      region.append(h('p', { 'data-motion': 'rating-reveal', 'data-motion-ms': '420', 'data-state': 'running' }, `Ratings revealed: ${parts.join(', ')}.`));
      if (rating.mine?.comment) region.append(h('p', { class: 'muted' }, rating.mine.comment));
      if (rating.theirs?.comment) region.append(h('p', { class: 'muted' }, rating.theirs.comment));
      return;
    }
    if (rating.state === 'closed') {
      region.append(h('p', null, 'The rating window closed without ratings.'));
      return;
    }

    // open: submit form
    let stars = 0;
    const radios: HTMLInputElement[] = [];
    const radioGroup = h('div', { role: 'radiogroup', 'aria-label': `Rating for ${other.display_name}`, class: 'rating-stars' });
    for (let s = 1; s <= 5; s++) {
      const radio = h('input', { type: 'radio', name: `stars-${booking.id}`, value: String(s), onChange: () => { stars = s; } }) as HTMLInputElement;
      radios.push(radio);
      radioGroup.append(h('label', null, radio, `${s === 1 ? '1 star' : `${s} stars`}`));
    }
    radios[0]?.addEventListener('keydown', (e: Event) => {
      const ke = e as KeyboardEvent;
      let idx = radios.findIndex(r => r.checked);
      if (ke.key === 'ArrowRight' || ke.key === 'ArrowUp') { ke.preventDefault(); idx = Math.min(4, idx + 1); radios[idx].checked = true; stars = idx + 1; }
      if (ke.key === 'ArrowLeft' || ke.key === 'ArrowDown') { ke.preventDefault(); idx = Math.max(0, idx - 1); radios[idx].checked = true; stars = idx + 1; }
    });
    const comment = h('input', { type: 'text', class: 'field', 'aria-label': 'Comment', maxlength: '280' }) as HTMLInputElement;
    const submit = h('button', {
      type: 'button', class: 'btn primary', onClick: async () => {
        if (stars === 0) return;
        submit.textContent = 'Working';
        try {
          await api('POST', `/api/bookings/${booking.id}/rating`, { stars, comment: comment.value });
          announce('Waiting for both ratings');
          await renderRating();
        } catch (e) {
          if (e instanceof ApiFail) announce(e.body.message);
          submit.textContent = 'Submit rating';
        }
      },
    }, 'Submit rating');
    region.append(radioGroup, h('div', null, comment), submit);
  };

  const renderAll = (): void => {
    statusLine.textContent = `Status: ${booking.state.replace(/_/g, ' ')}`;
    renderRequestPanel();
    renderActions();
    void renderMessages();
    void renderRating();
  };

  live.setHandlers({
    onBooking: (b: Booking): void => {
      if (b.id !== booking.id) return;
      booking = b;
      renderAll();
    },
    onMessage: (bid: string, message: Message): void => {
      if (bid !== booking.id) return;
      const log = messagesRegion.querySelector('.messages');
      if (log) {
        log.append(h('div', { 'data-id': message.id }, `${message.author_id === me?.id ? 'You' : other.display_name}: ${message.body}`));
        log.scrollTop = log.scrollHeight;
      }
      if (message.author_id !== me?.id) announce(`New message from ${other.display_name}`);
    },
    onPresence: (bid: string, p: Presence): void => {
      if (bid !== booking.id) return;
      const line = messagesRegion.querySelector('.presence');
      if (line) line.textContent = presenceText(p);
    },
    onRating: (bid: string, state: string): void => {
      if (bid !== booking.id) return;
      if (state === 'revealed') {
        announce(`Ratings revealed.`);
      }
      void renderRating();
    },
    onHello: (): void => { void refresh(); },
  });
  live.subscribe(booking.ride_id, booking.id);

  const refresh = async (): Promise<void> => {
    try {
      booking = await api<Booking>('GET', `/api/bookings/${booking.id}`);
      renderAll();
    } catch { /* gone */ }
  };

  root.append(heading, statusLine, requestPanel, updateRegion, actions, messagesRegion, ratingRegion);
  renderAll();
  window.setTimeout(() => heading.focus(), 60);
  return root;
}

let idemCounter = 0;
function idemKey(): string {
  idemCounter += 1;
  return `web-${Date.now().toString(36)}-${idemCounter}`;
}
