import { announce, setAlert, setFieldErrors, withPending } from '../announce.js';
import { api, newIdempotencyKey } from '../api.js';
import { averageLine, copy, noticeKindWords, seats as seatWord } from '../copy.js';
import { clear, focus, h } from '../dom.js';
import { money } from '../../shared/format.js';
import { dateLabel, timeLabel } from '../../shared/zoned.js';
import { connectLive } from '../live.js';
import { runMotion, settledMotion } from '../motion.js';
import { plate } from '../plates.js';
import { navigate, onLeave, type RouteContext } from '../router.js';
import { mainRegion } from '../shell.js';
import { currentMember, setServerNow } from '../state.js';
import { takeShutter } from '../transition.js';
import { openDialog } from '../components/dialog.js';
import { legSpan, type LegSpanHandle, type LegSpanState } from '../components/legspan.js';
import { seatEndMessage, stepper } from '../components/stepper.js';
import type { Booking, Notice, Ride } from '../types.js';

export function renderRide(ctx: RouteContext): void {
  const rideId = ctx.params.id as string;
  const main = mainRegion();
  clear(main);
  main.appendChild(h('p', { class: 'loading', text: 'Working' }));
  void mount(rideId, main);
}

interface PageState {
  ride: Ride;
  myBooking: Booking | null;
  driverBookings: Booking[];
  notices: Notice[];
}

async function loadState(rideId: string): Promise<PageState | null> {
  const rideResult = await api<Ride>('GET', `/api/rides/${rideId}`);
  if (!rideResult.ok) return null;
  const ride = rideResult.data;
  setServerNow(ride.server_now);
  const member = currentMember();
  const state: PageState = { ride, myBooking: null, driverBookings: [], notices: [] };
  if (!member) return state;

  if (member.id === ride.driver.id) {
    const [bookings, notices] = await Promise.all([
      api<{ bookings: Booking[] }>('GET', `/api/rides/${rideId}/bookings`),
      api<{ notices: Notice[] }>('GET', `/api/rides/${rideId}/notices`),
    ]);
    if (bookings.ok) state.driverBookings = bookings.data.bookings;
    if (notices.ok) state.notices = notices.data.notices;
    return state;
  }

  const [upcoming, past] = await Promise.all([
    api<{ bookings: Booking[] }>('GET', '/api/me/bookings?tab=upcoming'),
    api<{ bookings: Booking[] }>('GET', '/api/me/bookings?tab=past'),
  ]);
  const mine = [
    ...(upcoming.ok ? upcoming.data.bookings : []),
    ...(past.ok ? past.data.bookings : []),
  ].filter((booking) => booking.ride_id === rideId);
  state.myBooking = mine[0] ?? null;
  return state;
}

async function mount(rideId: string, main: HTMLElement): Promise<void> {
  const state = await loadState(rideId);
  if (!state) {
    clear(main);
    main.appendChild(h('h1', { text: copy.notFoundHeading }));
    main.appendChild(h('a', { href: '/search', text: 'Back to search' }));
    return;
  }

  const member = currentMember();
  const isDriver = member !== null && member.id === state.ride.driver.id;
  let span: LegSpanHandle | null = null;
  let chosenSeats = 1;
  let spanState: LegSpanState | null = null;
  const previousBookingStates = new Map<string, string>();
  for (const booking of state.driverBookings) previousBookingStates.set(booking.id, booking.state);

  const liveBanner = h('div', { class: 'outage', hidden: true, text: copy.livePaused });
  const headingText = `${state.ride.stops[0]?.city} to ${
    state.ride.stops[state.ride.stops.length - 1]?.city
  }, ${dateLabel(state.ride.departure)}`;
  const heading = h('h1', { class: 'ride-heading', text: headingText });

  const bookBar = h('div', {
    role: 'region',
    'aria-label': 'Book bar',
    class: 'book-bar',
  });
  const yourBookingBox = h('div', { class: 'your-booking-box' });
  const yourRequestBox = h('div', { class: 'your-request-box' });
  const rideUpdateBox = h('div', { class: 'ride-update-box' });
  const driverBox = h('div', { class: 'driver-panels' });
  const spanBox = h('div', { class: 'span-area' });

  const bigPlate = plate({
    seed: state.ride.id,
    leg: `${state.ride.stops[0]?.city} to ${state.ride.stops[state.ride.stops.length - 1]?.city}`,
    ratio: 1.45,
    className: 'ride-plate',
  });

  const paintStops = (): HTMLElement => {
    const list = h('ul', { 'aria-label': 'Stops', class: 'stops' });
    for (const stop of state.ride.stops) {
      list.appendChild(
        h('li', { class: 'stop-row' }, h('span', { text: `${timeLabel(stop.time)} ${stop.city}` })),
      );
    }
    return list;
  };

  const driverCard = (): HTMLElement =>
    h(
      'div',
      { class: 'driver-card' },
      state.ride.driver.photo_url
        ? h('img', {
            src: state.ride.driver.photo_url,
            alt: `${state.ride.driver.display_name}, profile photo`,
            class: 'driver-photo',
          })
        : null,
      h('p', { class: 'driver-name', text: state.ride.driver.display_name }),
      h('p', {
        class: 'driver-rating',
        text: averageLine(state.ride.driver.rating.average, state.ride.driver.rating.count),
      }),
      state.ride.vehicle
        ? h('p', {
            class: 'driver-car',
            text: `${state.ride.vehicle.make_model}, ${state.ride.vehicle.colour}, ${seatWord(
              state.ride.vehicle.seats,
            )}`,
          })
        : null,
    );

  const spanInitial = (): { boardingIdx: number; alightingIdx: number } => {
    const from = ctx_from();
    const to = ctx_to();
    const boarding = state.ride.stops.findIndex((stop) => stop.city === from);
    const alighting = state.ride.stops.findIndex((stop) => stop.city === to);
    if (boarding >= 0 && alighting > boarding) {
      return { boardingIdx: boarding, alightingIdx: alighting };
    }
    return { boardingIdx: 0, alightingIdx: state.ride.stops.length - 1 };
  };

  function ctx_from(): string | null {
    return new URL(window.location.href).searchParams.get('from');
  }
  function ctx_to(): string | null {
    return new URL(window.location.href).searchParams.get('to');
  }

  const seatStepper = stepper({
    label: 'Seats',
    min: 1,
    max: 4,
    step: 1,
    pageStep: 2,
    value: 1,
    endMessage: seatEndMessage,
    onChange: (value) => {
      chosenSeats = value;
      span?.setSeats();
    },
  });

  const bookAlert = h('div', { class: 'alert-slot' });

  const isLiveBooking = (booking: Booking): boolean =>
    booking.state === 'held' ||
    booking.state === 'requested' ||
    booking.state === 'confirmed' ||
    booking.state === 'completed' ||
    booking.state === 'rated';

  const barPrice = h('p', { class: 'bar-price' });
  const seatsField = h(
    'div',
    { class: 'field-box' },
    h('span', { class: 'label', text: 'Seats' }),
    seatStepper.element,
  );
  const book = h('button', { type: 'button', class: 'action book', text: 'Book' });
  book.addEventListener('click', () => {
    if (!currentMember()) {
      navigate(`/sign-in?next=${encodeURIComponent(`/rides/${rideId}`)}`);
      return;
    }
    void startBooking(book);
  });

  /** The bar is built once and then only its figures and state change. */
  const paintBookBar = () => {
    if (bookBar.childElementCount === 0) {
      bookBar.appendChild(barPrice);
      if (!isDriver) bookBar.append(seatsField, book, bookAlert);
    }
    if (!spanState) return;
    barPrice.textContent = money(spanState.totalCents);
    if (isDriver) return;
    book.textContent = state.ride.booking_mode === 'instant' ? 'Book' : 'Request to book';
    const holdsOne = state.myBooking !== null && isLiveBooking(state.myBooking);
    seatsField.hidden = holdsOne;
    book.hidden = holdsOne;
    book.disabled = spanState.freeSeats < chosenSeats;
  };

  const startBooking = async (button: HTMLButtonElement) => {
    if (!spanState) return;
    const key = newIdempotencyKey();
    const body = {
      boarding: state.ride.stops[spanState.boardingIdx]?.city,
      alighting: state.ride.stops[spanState.alightingIdx]?.city,
      seats: chosenSeats,
      ride_version: state.ride.version,
    };
    const result = await withPending(button, () =>
      api<Booking>('POST', `/api/rides/${rideId}/bookings`, { body, idempotencyKey: key }),
    );
    if (!result) return;
    if (!result.ok) {
      setAlert(bookAlert, result.failure.message);
      if (result.failure.error === 'seat_taken') {
        await refresh();
        span?.clearSelection();
      }
      return;
    }
    setAlert(bookAlert, null);
    state.myBooking = result.data;
    if (state.ride.booking_mode === 'instant') openConfirmDialog(button, result.data);
    else {
      paintRequest();
      announce(requestWaitingCopy(result.data));
    }
  };

  const requestWaitingCopy = (booking: Booking): string =>
    copy.waitingForDriver(
      state.ride.driver.display_name,
      timeLabel(booking.expires_at ?? booking.server_now),
      dateLabel(booking.expires_at ?? booking.server_now),
      booking.expires_in_seconds ?? 0,
    );

  const openConfirmDialog = (opener: HTMLElement, held: Booking) => {
    const slot = h('div', { class: 'alert-slot' });
    openDialog({
      name: 'Confirm your seat',
      opener,
      build: ({ close }) => {
        const confirm = h('button', {
          type: 'button',
          class: 'action',
          text: 'Confirm and pay',
        });
        confirm.addEventListener('click', () => {
          void (async () => {
            const result = await withPending(confirm, () =>
              api<Booking>('POST', `/api/bookings/${held.id}/confirm`, {
                idempotencyKey: newIdempotencyKey(),
              }),
            );
            if (!result) return;
            if (!result.ok) {
              setAlert(slot, result.failure.message);
              return;
            }
            state.myBooking = result.data;
            close();
            span?.confirmSeats();
            paintYourBooking(true);
            announce(
              copy.seatBooked(
                result.data.boarding,
                result.data.alighting,
                dateLabel(result.data.boarding_time),
                result.data.price_cents,
              ),
            );
            await refresh();
          })();
        });
        const release = h('button', {
          type: 'button',
          class: 'secondary',
          text: 'Release seat',
        });
        release.addEventListener('click', () => {
          void (async () => {
            await api<Booking>('POST', `/api/bookings/${held.id}/release`);
            state.myBooking = null;
            close();
            await refresh();
          })();
        });
        return [
          h('p', {
            text: `${held.boarding} to ${held.alighting}, ${seatWord(held.seats)}, ${money(
              held.price_cents,
            )}.`,
          }),
          confirm,
          release,
          slot,
        ];
      },
      onClose: () => undefined,
    });
  };

  const paintYourBooking = (focusHeading: boolean) => {
    clear(yourBookingBox);
    const booking = state.myBooking;
    if (!booking || booking.state !== 'confirmed') return;
    const region = h(
      'div',
      { role: 'region', 'aria-label': 'Your booking', class: 'your-booking' },
      h('h2', { class: 'booked-heading', text: 'Seat booked' }),
      h('a', { href: `/bookings/${booking.id}`, text: 'Open your booking' }),
    );
    yourBookingBox.appendChild(region);
    if (focusHeading) focus(region.querySelector('h2'));
  };

  const paintRequest = () => {
    clear(yourRequestBox);
    const booking = state.myBooking;
    if (!booking) return;
    const region = h('div', {
      role: 'region',
      'aria-label': 'Your request',
      class: 'your-request',
    });
    if (booking.state === 'requested') {
      region.appendChild(h('p', { text: requestWaitingCopy(booking) }));
    } else if (booking.state === 'expired' && booking.booking_mode === 'request') {
      region.append(
        h('h2', { text: copy.requestExpiredHeading }),
        h('p', { text: copy.requestExpiredBody(booking.price_cents) }),
      );
    } else if (booking.state === 'declined') {
      region.appendChild(
        h('p', {
          text: copy.requestDeclined(state.ride.driver.display_name, booking.price_cents),
        }),
      );
    } else if (booking.state === 'withdrawn') {
      region.appendChild(h('p', { text: copy.requestWithdrawn(booking.price_cents) }));
    } else {
      return;
    }
    yourRequestBox.appendChild(region);
  };

  const paintRideUpdate = () => {
    clear(rideUpdateBox);
    const booking = state.myBooking;
    if (!booking) return;
    let text: string | null = null;
    if (state.ride.state === 'cancelled') {
      text = copy.rideCancelledForPassenger(
        state.ride.driver.display_name,
        booking.price_cents,
      );
    } else if (state.ride.previous_departure) {
      const oldTime = timeLabel(state.ride.previous_departure);
      const newTime = timeLabel(state.ride.departure);
      text = state.ride.free_cancel_until
        ? copy.timeChangeFree(
            oldTime,
            newTime,
            timeLabel(state.ride.free_cancel_until),
            dateLabel(state.ride.free_cancel_until),
          )
        : copy.timeChange(oldTime, newTime);
    }
    if (!text) return;
    rideUpdateBox.appendChild(
      h(
        'div',
        { role: 'region', 'aria-label': 'Ride update', class: 'ride-update' },
        h('p', { text }),
      ),
    );
  };

  const paintDriver = () => {
    clear(driverBox);
    if (!isDriver) return;
    const requestsRegion = h('div', {
      role: 'region',
      'aria-label': 'Requests',
      class: 'requests',
    });
    requestsRegion.appendChild(h('h2', { class: 'panel-heading', text: 'Requests' }));
    const pending = state.driverBookings.filter((booking) => booking.state === 'requested');
    for (const booking of pending) {
      const row = h('div', { class: 'request-row', 'data-id': booking.id });
      const slot = h('div', { class: 'alert-slot' });
      const decide = (action: 'accept' | 'decline', control: HTMLButtonElement) => {
        void (async () => {
          const result = await withPending(control, () =>
            api<Booking>('POST', `/api/bookings/${booking.id}/${action}`),
          );
          if (!result) return;
          if (!result.ok) {
            setAlert(slot, result.failure.message);
            return;
          }
          await refresh();
          const next = driverBox.querySelector<HTMLElement>('.request-row button');
          focus(next ?? driverBox.querySelector<HTMLElement>('.panel-heading'));
        })();
      };
      const accept = h('button', {
        type: 'button',
        class: 'action',
        text: `Accept ${booking.passenger.display_name}`,
      });
      accept.addEventListener('click', () => decide('accept', accept));
      const decline = h('button', {
        type: 'button',
        class: 'secondary',
        text: `Decline ${booking.passenger.display_name}`,
      });
      decline.addEventListener('click', () => decide('decline', decline));
      row.append(
        h('p', {
          text: `${booking.passenger.display_name}: ${booking.boarding} to ${booking.alighting}, ${seatWord(
            booking.seats,
          )}`,
        }),
        accept,
        decline,
        slot,
      );
      requestsRegion.appendChild(row);
    }

    const passengers = h('ul', { 'aria-label': 'Passengers', class: 'passenger-list' });
    for (const booking of state.driverBookings.filter(
      (candidate) =>
        candidate.state === 'confirmed' ||
        candidate.state === 'completed' ||
        candidate.state === 'rated',
    )) {
      passengers.appendChild(
        h(
          'li',
          { 'data-id': booking.id },
          h('a', {
            href: `/bookings/${booking.id}`,
            text: `${booking.passenger.display_name}, ${booking.boarding} to ${booking.alighting}, ${seatWord(
              booking.seats,
            )}, ${money(booking.price_cents)}`,
          }),
        ),
      );
    }

    const noticeList = h('ul', { 'aria-label': 'Passenger notices', class: 'notice-list' });
    for (const notice of state.notices) {
      noticeList.appendChild(
        h('li', {
          'data-id': `${notice.passenger_id}-${notice.kind}`,
          text: copy.noticeLine(
            notice.name,
            noticeKindWords(notice.kind),
            notice.status === 'sent' && notice.sent_at ? timeLabel(notice.sent_at) : null,
          ),
        }),
      );
    }

    driverBox.append(requestsRegion, passengers, noticeList, driverActions());
  };

  const driverActions = (): HTMLElement => {
    const box = h('div', { class: 'driver-actions' });
    const outage = h('div', { class: 'outage', hidden: true });

    const changeDeparture = h('button', {
      type: 'button',
      class: 'secondary',
      text: 'Change departure',
    });
    changeDeparture.addEventListener('click', () => {
      openDialog({
        name: 'Change departure',
        opener: changeDeparture,
        build: ({ close }) => {
          const field = h('input', {
            type: 'text',
            'aria-label': 'New departure time',
            class: 'field',
          });
          field.value = timeLabel(state.ride.departure);
          const slot = h('div', { class: 'alert-slot' });
          const fieldErrors = h('div', { 'data-field-error': 'departure', class: 'field-error' });
          const save = h('button', { type: 'button', class: 'action', text: 'Save new time' });
          save.addEventListener('click', () => {
            void (async () => {
              const result = await withPending(save, () =>
                api<{ ride: Ride; notices: Notice[] }>('PATCH', `/api/rides/${rideId}`, {
                  body: { departure: field.value },
                  ifMatch: state.ride.version,
                }),
              );
              if (!result) return;
              if (!result.ok) {
                setAlert(slot, result.failure.message);
                setFieldErrors(slot.parentElement as HTMLElement, result.failure.fields);
                return;
              }
              close();
              state.ride = result.data.ride;
              state.notices = result.data.notices;
              const queued = result.data.notices.some((notice) => notice.status === 'queued');
              if (queued) {
                outage.hidden = false;
                outage.setAttribute('role', 'alert');
                outage.textContent = copy.emailsQueued;
                announce(copy.emailsQueued);
              } else {
                outage.hidden = true;
                announce(copy.departureSaved(result.data.notices.length));
              }
              await refresh();
            })();
          });
          return [
            h('span', { class: 'label', text: 'New departure time' }),
            field,
            fieldErrors,
            save,
            slot,
          ];
        },
      });
    });

    const changeSeats = h('button', { type: 'button', class: 'secondary', text: 'Change seats' });
    changeSeats.addEventListener('click', () => {
      openDialog({
        name: 'Change seats',
        opener: changeSeats,
        build: ({ close }) => {
          const slot = h('div', { class: 'alert-slot' });
          const seatControl = stepper({
            label: 'Seats',
            min: 1,
            max: 4,
            step: 1,
            pageStep: 2,
            value: state.ride.seats,
            endMessage: seatEndMessage,
          });
          const save = h('button', { type: 'button', class: 'action', text: 'Save seats' });
          save.addEventListener('click', () => {
            void (async () => {
              const result = await withPending(save, () =>
                api<{ ride: Ride; notices: Notice[] }>('PATCH', `/api/rides/${rideId}`, {
                  body: { seats: seatControl.value() },
                  ifMatch: state.ride.version,
                }),
              );
              if (!result) return;
              if (!result.ok) {
                setAlert(slot, result.failure.message);
                return;
              }
              close();
              state.ride = result.data.ride;
              announce(copy.seatsSaved);
              await refresh();
            })();
          });
          return [seatControl.element, save, slot];
        },
      });
    });

    const cancelRide = h('button', { type: 'button', class: 'secondary', text: 'Cancel ride' });
    cancelRide.addEventListener('click', () => {
      openDialog({
        name: 'Cancel this ride',
        opener: cancelRide,
        build: ({ close }) => {
          const slot = h('div', { class: 'alert-slot' });
          const confirm = h('button', {
            type: 'button',
            class: 'action',
            text: 'Cancel ride for everyone',
          });
          confirm.addEventListener('click', () => {
            void (async () => {
              const result = await withPending(confirm, () =>
                api<{ ride: Ride; notices: Notice[] }>('POST', `/api/rides/${rideId}/cancel`, {
                  idempotencyKey: newIdempotencyKey(),
                }),
              );
              if (!result) return;
              if (!result.ok) {
                setAlert(slot, result.failure.message);
                return;
              }
              close();
              state.ride = result.data.ride;
              state.notices = result.data.notices;
              announce(copy.rideCancelled);
              await refresh();
            })();
          });
          const keep = h('button', {
            type: 'button',
            class: 'secondary',
            text: 'Keep ride',
            onclick: () => close(),
          });
          return [
            h('p', { text: 'Every passenger is refunded in full and emailed once.' }),
            confirm,
            keep,
            slot,
          ];
        },
      });
    });

    box.append(changeDeparture, changeSeats, cancelRide, outage);
    return box;
  };

  const buildSpan = () => {
    clear(spanBox);
    span = legSpan({
      ride: state.ride,
      initial: spanInitial(),
      interactive: !isDriver,
      seats: () => chosenSeats,
      onChange: (next) => {
        spanState = next;
        seatStepper.setRange(1, Math.max(1, next.freeSeats));
        paintBookBar();
        if (next.freeSeats < chosenSeats) {
          setAlert(bookAlert, 'This seat was just taken. Choose another span or ride.');
        }
      },
    });
    spanState = span.state();
    seatStepper.setRange(1, Math.max(1, spanState.freeSeats));
    spanBox.append(
      bigPlate,
      h('div', { class: 'span-column' }, span.element, bookBar, yourBookingBox, yourRequestBox),
    );
  };

  const paintAll = () => {
    clear(main);
    main.append(
      liveBanner,
      heading,
      driverCard(),
      paintStops(),
      rideUpdateBox,
      spanBox,
      driverBox,
    );
    buildSpan();
    paintBookBar();
    paintYourBooking(false);
    paintRequest();
    paintRideUpdate();
    paintDriver();
  };

  const refresh = async () => {
    const next = await loadState(rideId);
    if (!next) return;
    announceDriverChanges(next);
    announcePassengerChanges(next);
    state.ride = next.ride;
    state.myBooking = next.myBooking;
    state.driverBookings = next.driverBookings;
    state.notices = next.notices;
    span?.setSeatMap(state.ride.seat_map);
    paintBookBar();
    paintYourBooking(false);
    paintRequest();
    paintRideUpdate();
    paintDriver();
  };

  const announceDriverChanges = (next: PageState) => {
    if (!isDriver) return;
    for (const booking of next.driverBookings) {
      const before = previousBookingStates.get(booking.id);
      previousBookingStates.set(booking.id, booking.state);
      if (before === booking.state) continue;
      if (booking.state === 'requested' && before === undefined) {
        announce(
          copy.driverNewRequest(
            booking.passenger.display_name,
            booking.boarding,
            booking.alighting,
          ),
        );
      } else if (booking.state === 'confirmed') {
        const free = freeForSpan(next.ride, booking);
        announce(
          copy.driverSeatBooked(
            booking.passenger.display_name,
            booking.boarding,
            booking.alighting,
            free,
          ),
        );
      } else if (booking.state === 'cancelled_by_passenger') {
        announce(
          copy.driverCancellation(
            booking.passenger.display_name,
            booking.boarding,
            booking.alighting,
            booking.earned_cents,
          ),
        );
      }
    }
  };

  const announcePassengerChanges = (next: PageState) => {
    if (isDriver) return;
    const before = state.myBooking;
    const after = next.myBooking;
    if (!after || !before || before.state === after.state) return;
    if (after.state === 'confirmed' && before.state === 'requested') {
      announce(copy.requestAccepted(state.ride.driver.display_name));
    } else if (after.state === 'declined') {
      announce(copy.requestDeclined(state.ride.driver.display_name, after.price_cents));
    } else if (after.state === 'expired' && before.state === 'requested') {
      announce(copy.requestExpiredHeading);
    }
  };

  const freeForSpan = (ride: Ride, booking: Booking): number => {
    const boarding = ride.stops.findIndex((stop) => stop.city === booking.boarding);
    const alighting = ride.stops.findIndex((stop) => stop.city === booking.alighting);
    let free = 0;
    for (const entry of ride.seat_map) {
      let open = true;
      for (let leg = boarding; leg < alighting; leg += 1) {
        if (entry.legs[leg] === 'taken') open = false;
      }
      if (open) free += 1;
    }
    return free;
  };

  paintAll();

  if (takeShutter()) {
    runMotion(bigPlate, 'shutter-reveal', 'play', () => focus(heading));
  } else {
    settledMotion(bigPlate, 'shutter-reveal');
    focus(heading);
  }

  const connection = connectLive({
    ride: rideId,
    onHello: () => void refresh(),
    onDropped: (dropped) => {
      liveBanner.hidden = !dropped;
      if (dropped) liveBanner.setAttribute('role', 'alert');
    },
    onEvent: (type, data) => {
      if (type === 'seat') {
        const seatMap = (data as { seat_map: Ride['seat_map'] }).seat_map;
        state.ride.seat_map = seatMap;
        span?.setSeatMap(seatMap);
        return;
      }
      if (type === 'clock') {
        setServerNow((data as { server_now: string }).server_now);
        void refresh();
        return;
      }
      void refresh();
    },
  });
  onLeave(() => connection.close());

  // The request countdown is refetched once a minute, never worked out from the device.
  const minute = window.setInterval(() => void refresh(), 60_000);
  onLeave(() => window.clearInterval(minute));
}
