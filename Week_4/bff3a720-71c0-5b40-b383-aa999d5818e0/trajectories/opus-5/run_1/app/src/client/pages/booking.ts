import { announce, setAlert, withPending } from '../announce.js';
import { api, newIdempotencyKey } from '../api.js';
import { copy, seats as seatWord, stars as starWord } from '../copy.js';
import { clear, focus, h } from '../dom.js';
import { money } from '../../shared/format.js';
import { dateLabel, timeLabel } from '../../shared/zoned.js';
import { connectLive } from '../live.js';
import { runMotion } from '../motion.js';
import { navigate, onLeave, type RouteContext } from '../router.js';
import { mainRegion } from '../shell.js';
import { currentMember, setServerNow } from '../state.js';
import { openDialog } from '../components/dialog.js';
import type { Booking, Message, Presence, RatingView } from '../types.js';

export function renderBooking(ctx: RouteContext): void {
  const bookingId = ctx.params.id as string;
  const main = mainRegion();
  clear(main);
  main.appendChild(h('p', { class: 'loading', text: 'Working' }));
  void mount(bookingId, main);
}

async function mount(bookingId: string, main: HTMLElement): Promise<void> {
  const member = currentMember();
  const first = await api<Booking>('GET', `/api/bookings/${bookingId}`);
  if (!first.ok || !member) {
    clear(main);
    main.append(
      h('h1', { text: copy.notFoundHeading }),
      h('a', { href: '/search', text: 'Back to search' }),
    );
    return;
  }
  let booking = first.data;
  setServerNow(booking.server_now);
  const isPassenger = member.id === booking.passenger.id;
  const other = isPassenger ? booking.driver : booking.passenger;

  const statusBox = h('div', { class: 'booking-status' });
  const actionBox = h('div', { class: 'booking-actions' });
  const requestBox = h('div', { class: 'your-request-box' });
  const updateBox = h('div', { class: 'ride-update-box' });
  const threadBox = h('div', { class: 'thread' });
  const ratingBox = h('div', { class: 'rating-box' });

  const heading = h('h1', {
    class: 'booking-heading',
    text: isPassenger
      ? `Your seat: ${booking.boarding} to ${booking.alighting}, ${dateLabel(
          booking.boarding_time,
        )}`
      : `${booking.passenger.display_name}: ${booking.boarding} to ${booking.alighting}, ${dateLabel(
          booking.boarding_time,
        )}`,
  });

  const paintStatus = () => {
    clear(statusBox);
    statusBox.append(
      h('p', {
        class: 'status-line',
        text: `${booking.state}, ${seatWord(booking.seats)}, ${money(booking.price_cents)}`,
      }),
      h('p', { class: 'status-span', text: `${booking.segment_km} km` }),
    );
  };

  const paintRequest = () => {
    clear(requestBox);
    if (booking.state === 'requested') {
      requestBox.appendChild(
        h(
          'div',
          { role: 'region', 'aria-label': 'Your request', class: 'your-request' },
          h('p', {
            text: copy.waitingForDriver(
              booking.driver.display_name,
              timeLabel(booking.expires_at ?? booking.server_now),
              dateLabel(booking.expires_at ?? booking.server_now),
              booking.expires_in_seconds ?? 0,
            ),
          }),
        ),
      );
      return;
    }
    if (booking.state === 'expired' && booking.booking_mode === 'request') {
      requestBox.appendChild(
        h(
          'div',
          { role: 'region', 'aria-label': 'Your request', class: 'your-request' },
          h('h2', { text: copy.requestExpiredHeading }),
          h('p', { text: copy.requestExpiredBody(booking.price_cents) }),
        ),
      );
    }
  };

  const paintUpdate = () => {
    clear(updateBox);
    if (!isPassenger) return;
    let text: string | null = null;
    if (booking.ride_state === 'cancelled') {
      text = copy.rideCancelledForPassenger(
        booking.driver.display_name,
        booking.price_cents,
      );
    } else if (booking.ride_previous_departure) {
      const oldTime = timeLabel(booking.ride_previous_departure);
      const newTime = timeLabel(booking.ride_departure);
      text = booking.free_cancel_until
        ? copy.timeChangeFree(
            oldTime,
            newTime,
            timeLabel(booking.free_cancel_until),
            dateLabel(booking.free_cancel_until),
          )
        : copy.timeChange(oldTime, newTime);
    }
    if (!text) return;
    updateBox.appendChild(
      h(
        'div',
        { role: 'region', 'aria-label': 'Ride update', class: 'ride-update' },
        h('p', { text }),
      ),
    );
  };

  const paintActions = () => {
    clear(actionBox);
    if (!isPassenger) return;
    const slot = h('div', { class: 'alert-slot' });
    if (booking.state === 'requested') {
      const withdraw = h('button', {
        type: 'button',
        class: 'secondary',
        text: 'Withdraw request',
      });
      withdraw.addEventListener('click', () => {
        void (async () => {
          const result = await withPending(withdraw, () =>
            api<Booking>('POST', `/api/bookings/${bookingId}/withdraw`),
          );
          if (!result) return;
          if (!result.ok) {
            setAlert(slot, result.failure.message);
            return;
          }
          booking = result.data;
          announce(copy.requestWithdrawn(booking.price_cents));
          await refresh();
        })();
      });
      actionBox.append(withdraw, slot);
      return;
    }
    if (booking.state !== 'confirmed') return;
    const cancel = h('button', {
      type: 'button',
      class: 'secondary',
      text: 'Cancel my seat',
    });
    cancel.addEventListener('click', () => openCancelDialog(cancel));
    actionBox.append(cancel, slot);
  };

  const openCancelDialog = (opener: HTMLButtonElement) => {
    openDialog({
      name: 'Cancel this booking',
      opener,
      build: ({ close }) => {
        const quoteLine = h('p', { class: 'quote', text: 'Working' });
        const slot = h('div', { class: 'alert-slot' });
        const confirm = h('button', { type: 'button', class: 'action', text: 'Cancel booking' });
        confirm.addEventListener('click', () => {
          void (async () => {
            const result = await withPending(confirm, () =>
              api<{ booking: Booking; refund_cents: number; kept_cents: number }>(
                'POST',
                `/api/bookings/${bookingId}/cancel`,
                { idempotencyKey: newIdempotencyKey() },
              ),
            );
            if (!result) return;
            if (!result.ok) {
              setAlert(slot, result.failure.message);
              return;
            }
            close();
            navigate('/wallet');
          })();
        });
        const keep = h('button', {
          type: 'button',
          class: 'secondary',
          text: 'Keep booking',
          onclick: () => close(),
        });
        void (async () => {
          const fresh = await api<Booking>('GET', `/api/bookings/${bookingId}`);
          if (!fresh.ok || !fresh.data.cancel_quote) {
            quoteLine.textContent = '';
            return;
          }
          const quote = fresh.data.cancel_quote;
          quoteLine.textContent =
            quote.reason === 'free_window'
              ? copy.quoteFree(fresh.data.price_cents)
              : copy.quoteTier(
                  quote.refund_cents,
                  fresh.data.price_cents,
                  quote.percent,
                  quote.hours_before,
                );
        })();
        return [quoteLine, confirm, keep, slot];
      },
    });
  };

  let messages: Message[] = [];
  const log = h('div', {
    role: 'log',
    'aria-label': `Messages with ${other.display_name}`,
    class: 'message-log',
  });
  const presenceLine = h('p', { class: 'presence' });
  const composer = h('textarea', {
    'aria-label': `Message ${other.display_name}`,
    class: 'field composer',
    rows: '3',
  });
  const sendSlot = h('div', { class: 'alert-slot' });
  const send = h('button', { type: 'button', class: 'secondary', text: 'Send' });

  const paintMessages = () => {
    clear(log);
    for (const message of messages) {
      const who =
        message.author_id === member.id ? 'You' : other.display_name;
      log.appendChild(
        h('p', {
          'data-id': message.id,
          class: 'message',
          text: `${timeLabel(message.sent_at)} ${who}: ${message.body}`,
        }),
      );
    }
    log.scrollTop = log.scrollHeight;
  };

  const paintPresence = (presence: Presence) => {
    presenceLine.textContent = presence.online
      ? copy.presenceOnline(other.display_name)
      : presence.last_seen_at
        ? copy.presenceSeen(other.display_name, timeLabel(presence.last_seen_at))
        : copy.presenceNever(other.display_name);
  };

  const loadMessages = async () => {
    const result = await api<{ messages: Message[]; presence: Presence }>(
      'GET',
      `/api/bookings/${bookingId}/messages`,
    );
    if (!result.ok) return;
    messages = result.data.messages;
    paintMessages();
    paintPresence(result.data.presence);
  };

  const submitMessage = async () => {
    const body = composer.value;
    if (body.trim().length === 0) return;
    const result = await withPending(send, () =>
      api<Message>('POST', `/api/bookings/${bookingId}/messages`, { body: { body } }),
    );
    if (!result) return;
    if (!result.ok) {
      setAlert(sendSlot, result.failure.message);
      return;
    }
    setAlert(sendSlot, null);
    composer.value = '';
    await loadMessages();
  };

  composer.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submitMessage();
    }
  });
  send.addEventListener('click', () => void submitMessage());

  threadBox.append(presenceLine, log, composer, send, sendSlot);

  let rating: RatingView | null = null;
  const paintRating = () => {
    clear(ratingBox);
    if (!rating) return;
    const region = h('div', { role: 'region', 'aria-label': 'Rating', class: 'rating' });
    if (rating.state === 'not_open') {
      region.appendChild(h('p', { text: copy.ratingNotOpen }));
      ratingBox.appendChild(region);
      return;
    }
    if (rating.state === 'closed') {
      region.appendChild(h('p', { text: copy.ratingClosedEmpty }));
      ratingBox.appendChild(region);
      return;
    }
    if (rating.state === 'revealed') {
      const mine = rating.mine;
      const theirs = rating.theirs;
      const line = mine && theirs
        ? copy.ratingRevealBoth(mine.stars, other.display_name, theirs.stars)
        : mine
          ? copy.ratingRevealMine(mine.stars, other.display_name)
          : theirs
            ? copy.ratingRevealTheirs(other.display_name, theirs.stars)
            : copy.ratingClosedEmpty;
      const reveal = h('p', { class: 'reveal', text: line });
      region.appendChild(reveal);
      ratingBox.appendChild(region);
      runMotion(reveal, 'rating-reveal');
      return;
    }
    if (rating.state === 'waiting' && rating.mine) {
      region.appendChild(h('p', { text: copy.ratingWaiting }));
      ratingBox.appendChild(region);
      return;
    }

    const group = h('div', {
      role: 'radiogroup',
      'aria-label': `Rating for ${other.display_name}`,
      class: 'stars',
    });
    let chosen = 0;
    const radios: HTMLElement[] = [];
    for (let value = 1; value <= 5; value += 1) {
      const radio = h('div', {
        role: 'radio',
        'aria-label': starWord(value),
        'aria-checked': 'false',
        tabindex: value === 1 ? '0' : '-1',
        class: 'star',
        text: '\u2605',
      });
      const choose = () => {
        chosen = value;
        radios.forEach((item, index) => {
          item.setAttribute('aria-checked', index + 1 === value ? 'true' : 'false');
          item.setAttribute('tabindex', index + 1 === value ? '0' : '-1');
        });
        radio.focus();
      };
      radio.addEventListener('click', choose);
      radio.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault();
          (radios[Math.min(4, value)] as HTMLElement).click();
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault();
          (radios[Math.max(0, value - 2)] as HTMLElement).click();
        } else if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          choose();
        }
      });
      radios.push(radio);
      group.appendChild(radio);
    }
    const comment = h('textarea', {
      'aria-label': 'Comment',
      class: 'field',
      rows: '2',
      maxlength: '280',
    });
    const slot = h('div', { class: 'alert-slot' });
    const submit = h('button', { type: 'button', class: 'action', text: 'Submit rating' });
    submit.addEventListener('click', () => {
      void (async () => {
        const result = await withPending(submit, () =>
          api<RatingView>('POST', `/api/bookings/${bookingId}/rating`, {
            body: { stars: chosen, comment: comment.value },
          }),
        );
        if (!result) return;
        if (!result.ok) {
          setAlert(slot, result.failure.message);
          return;
        }
        rating = result.data;
        paintRating();
        announce(
          rating.state === 'revealed' ? revealLine(rating) : copy.ratingWaiting,
        );
      })();
    });
    region.append(
      group,
      h('span', { class: 'label', text: 'Comment' }),
      comment,
      submit,
      slot,
    );
    ratingBox.appendChild(region);
  };

  const revealLine = (view: RatingView): string => {
    if (view.mine && view.theirs) {
      return copy.ratingRevealBoth(view.mine.stars, other.display_name, view.theirs.stars);
    }
    if (view.mine) return copy.ratingRevealMine(view.mine.stars, other.display_name);
    if (view.theirs) return copy.ratingRevealTheirs(other.display_name, view.theirs.stars);
    return copy.ratingClosedEmpty;
  };

  const loadRating = async () => {
    const result = await api<RatingView>('GET', `/api/bookings/${bookingId}/rating`);
    if (!result.ok) return;
    const before = rating?.state;
    rating = result.data;
    paintRating();
    if (before && before !== 'revealed' && rating.state === 'revealed') {
      announce(revealLine(rating));
    }
  };

  const refresh = async () => {
    const result = await api<Booking>('GET', `/api/bookings/${bookingId}`);
    if (!result.ok) return;
    const before = booking.state;
    booking = result.data;
    setServerNow(booking.server_now);
    if (isPassenger && before !== booking.state) {
      if (booking.state === 'confirmed' && before === 'requested') {
        announce(copy.requestAccepted(booking.driver.display_name));
      } else if (booking.state === 'declined') {
        announce(copy.requestDeclined(booking.driver.display_name, booking.price_cents));
      } else if (booking.state === 'expired' && before === 'requested') {
        announce(copy.requestExpiredHeading);
      }
    }
    paintStatus();
    paintRequest();
    paintUpdate();
    paintActions();
    await loadRating();
  };

  clear(main);
  main.append(heading, statusBox, requestBox, updateBox, actionBox, threadBox, ratingBox);
  paintStatus();
  paintRequest();
  paintUpdate();
  paintActions();
  focus(heading);
  await loadMessages();
  await loadRating();

  const connection = connectLive({
    thread: bookingId,
    onHello: () => {
      void loadMessages();
      void refresh();
    },
    onEvent: (type, data) => {
      if (type === 'message') {
        const payload = data as { message: Message };
        if (payload.message.author_id !== member.id) {
          announce(copy.newMessage(other.display_name));
        }
        void loadMessages();
        return;
      }
      if (type === 'presence') {
        const payload = data as unknown as Presence;
        if (payload.member_id !== member.id) paintPresence(payload);
        return;
      }
      if (type === 'rating') {
        void loadRating();
        return;
      }
      if (type === 'clock') {
        setServerNow((data as { server_now: string }).server_now);
      }
      void refresh();
    },
  });
  onLeave(() => connection.close());

  const minute = window.setInterval(() => void refresh(), 60_000);
  onLeave(() => window.clearInterval(minute));
}
