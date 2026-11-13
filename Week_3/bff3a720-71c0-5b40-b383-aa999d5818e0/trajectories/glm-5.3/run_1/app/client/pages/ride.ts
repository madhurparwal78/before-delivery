import { h, clear } from '../lib/els.js';
import { router } from '../lib/router.js';
import { store } from '../lib/store.js';
import { api, ApiFail } from '../lib/api.js';
import { announce, motionAttrs, motionMs } from '../lib/announce.js';
import { openDialog } from '../lib/dialog.js';
import { seatsStepper } from '../lib/stepper.js';
import { plate } from '../lib/plates.js';
import { legSpan, type LegSpanHandle } from '../lib/legspan.js';
import { money, hhmm, shortDate, count, timeOn } from '../lib/fmt.js';
import { live } from '../lib/live.js';
import type { Booking, Notice, Ride, SeatRow } from '../lib/types.js';

export async function ridePage(rideId: string): Promise<HTMLElement> {
  const me = store.me;
  let ride: Ride;
  try {
    ride = await api<Ride>('GET', `/api/rides/${rideId}`);
  } catch {
    return h('div', null, h('h1', null, 'We could not find that page'), h('p', null, h('a', { href: '/search' }, 'Back to search')));
  }

  const driver = ride.driver;
  const isDriver = me?.id === driver.id;
  const searchedFrom = router.query.get('from');
  const searchedTo = router.query.get('to');
  const searchedSeats = Number(router.query.get('seats') ?? '1') || 1;
  const from = searchedFrom && ride.stops.some(s => s.city === searchedFrom) ? searchedFrom : ride.stops[0].city;
  const to = searchedTo && ride.stops.some(s => s.city === searchedTo) ? searchedTo : ride.stops[ride.stops.length - 1].city;

  let boarding = from;
  let alighting = to;
  let seats = Math.min(4, Math.max(1, searchedSeats));
  let span: LegSpanHandle;

  const root = h('article', { class: 'ride-page', 'data-motion': 'shutter-reveal', 'data-motion-ms': motionMs(420), 'data-state': 'done' });
  const heading = h('h1', { tabindex: '-1' }, `${ride.stops[0].city} to ${ride.stops[ride.stops.length - 1].city}, ${shortDate(ride.stops[0].time)}`);
  const stopsList = h('ul', { role: 'list', 'aria-label': 'Stops', class: 'list-plain' });
  const spanWrap = h('div');
  const bookBar = h('div', { role: 'region', 'aria-label': 'Book bar', class: 'book-bar' });
  const driverPanels = h('div', { class: 'driver-panels section-2' });
  const updateRegion = h('div');
  const seatTakenAlert = h('div');

  const renderStops = (): void => {
    clear(stopsList);
    for (const s of ride.stops) {
      stopsList.append(h('li', null, `${hhmm(s.time)} ${s.city}`));
    }
  };

  const segPriceFor = (b: string, a: string): number => {
    const bi = ride.stops.findIndex(s => s.city === b);
    const ai = ride.stops.findIndex(s => s.city === a);
    const km = ride.stops[ai].km - ride.stops[bi].km;
    return Math.floor((ride.price_cents * km) / ride.route_km);
  };

  const renderBookBar = async (): Promise<void> => {
    clear(bookBar);
    const bi = ride.stops.findIndex(s => s.city === boarding);
    const ai = ride.stops.findIndex(s => s.city === alighting);
    let free = 0;
    for (const row of ride.seat_map) {
      let ok = true;
      for (let leg = bi; leg < ai; leg++) if (row.legs[leg] === 'taken') ok = false;
      if (ok) free++;
    }
    const price = money(segPriceFor(boarding, alighting) * seats);
    const figure = h('span', { class: 'price-figure', 'data-motion': 'price-roll', 'data-motion-ms': '280', 'data-state': 'running' }, price);
    const km = h('span', { class: 'price-km' }, `${ride.stops[ai].km - ride.stops[bi].km} km`);

    if (!me) {
      const btn = h('button', { type: 'button', class: 'btn primary', onClick: () => { router.go('/sign-in', { back: `/rides/${ride.id}` }); } }, ride.booking_mode === 'instant' ? 'Book' : 'Request to book');
      bookBar.append(figure, km, btn);
      return;
    }
    if (isDriver) {
      bookBar.append(figure, km, h('span', { class: 'muted' }, 'Your ride'));
      return;
    }
    if (myBooking) {
      const bookingLink = h('a', { href: `/bookings/${myBooking.id}` }, 'Open your booking');
      bookBar.append(figure, km, h('div', { role: 'region', 'aria-label': 'Your booking', ...motionAttrs('booking-confirm', 420) }, h('h3', { tabindex: '-1' }, 'Seat booked'), bookingLink));
      return;
    }
    if (myRequest) {
      bookBar.append(figure, km, renderRequestPanel());
      return;
    }
    const disabled = free < seats;
    const label = ride.booking_mode === 'instant' ? 'Book' : 'Request to book';
    const working = { current: false };
    const btn = h('button', {
      type: 'button', class: 'btn primary', disabled,
      onClick: async () => {
        if (working.current) return;
        working.current = true;
        btn.textContent = 'Working';
        try {
          if (ride.booking_mode === 'instant') {
            const booking = await api<Booking>('POST', `/api/rides/${ride.id}/bookings`, { boarding, alighting, seats, ride_version: ride.version }, { idempotencyKey: idemKey() });
            myBooking = booking;
            openConfirmDialog(booking);
          } else {
            const booking = await api<Booking>('POST', `/api/rides/${ride.id}/bookings`, { boarding, alighting, seats, ride_version: ride.version }, { idempotencyKey: idemKey() });
            myRequest = booking;
            announce(`Waiting for ${ride.driver.display_name} to answer. This request expires at ${hhmm(booking.expires_at ?? '')} on ${shortDate(booking.expires_at ?? '')}.`);
            await renderBookBar();
            live.setHandlers({ ...handlers });
          }
        } catch (e) {
          handleBookingError(e, seatTakenAlert);
        } finally {
          working.current = false;
          btn.textContent = label;
        }
      },
    }, label);
    bookBar.append(figure, km, btn);
    if (disabled) seatTakenAlert.append(alertBox('This seat was just taken. Choose another span or ride.'));
  };

  const renderRequestPanel = (): HTMLElement => {
    const panel = h('div', { role: 'region', 'aria-label': 'Your request', class: 'request-panel' });
    const render = (): void => {
      clear(panel);
      if (myRequest?.state === 'requested') {
        panel.append(h('p', null, `Waiting for ${driver.display_name} to answer. This request expires at ${hhmm(myRequest.expires_at ?? '')} on ${shortDate(myRequest.expires_at ?? '')} (${leftText(myRequest)} left).`));
        const withdraw = h('button', { type: 'button', class: 'btn', onClick: async () => {
          try {
            const updated = await api<Booking>('POST', `/api/bookings/${myRequest!.id}/withdraw`, {});
            myRequest = updated;
            announce(`Request withdrawn. ${money(updated.price_cents)} is back in your wallet.`);
            await refresh();
          } catch (e) { handleBookingError(e, panel); }
        } }, 'Withdraw request');
        panel.append(withdraw);
      } else if (myRequest?.state === 'expired') {
        panel.append(h('h3', null, 'This request expired'), h('p', null, `${money(myRequest.price_cents)} is back in your wallet.`));
      }
    };
    const leftText = (req: Booking): string => {
      const s = req.expires_in_seconds ?? 0;
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      return h > 0 ? `${h} h ${m} min` : `${m} min`;
    };
    render();
    return panel;
  };

  const requestTimer = window.setInterval(() => { if (myRequest?.state === 'requested') myRequest.expires_in_seconds = Math.max(0, (myRequest.expires_in_seconds ?? 0) - 60); }, 60_000);

  let myBooking: Booking | null = null;
  let myRequest: Booking | null = null;

  const findMine = async (): Promise<void> => {
    if (!me) return;
    try {
      const res = await api<{ bookings: Booking[] }>('GET', `/api/me/bookings?tab=upcoming`.replace('upcoming', 'upcoming'));
      void res;
    } catch { /* unused */ }
  };
  void findMine;

  const openConfirmDialog = (booking: Booking): void => {
    const release = async (): Promise<void> => {
      try {
        await api<Booking>('POST', `/api/bookings/${booking.id}/release`, {});
        announce('Your seat hold ended.');
        myBooking = null;
        await renderBookBar();
      } catch { /* already released */ }
      dialog.close();
    };
    const confirmBtn = h('button', {
      type: 'button', class: 'btn primary', 'data-autofocus': true,
      onClick: async () => {
        confirmBtn.textContent = 'Working';
        try {
          const confirmed = await api<Booking>('POST', `/api/bookings/${booking.id}/confirm`, {}, { idempotencyKey: idemKey() });
          myBooking = confirmed;
          announce(`Seat booked: ${confirmed.boarding} to ${confirmed.alighting}, ${shortDate(confirmed.boarding_time)}. ${money(confirmed.price_cents)} paid from your wallet.`);
          dialog.close();
          await renderBookBar();
          const heading = bookBar.querySelector('h3');
          heading?.focus();
        } catch (e) {
          handleBookingError(e, dialogRoot);
          confirmBtn.textContent = 'Confirm and pay';
        }
      },
    }, 'Confirm and pay');
    const dialogRoot = h('div', null,
      h('p', null, `${booking.boarding} to ${booking.alighting}, ${shortDate(booking.boarding_time)}`),
      h('p', null, `${money(booking.price_cents)} from your wallet`),
      confirmBtn,
      h('button', { type: 'button', class: 'btn', onClick: () => void release() }, 'Release seat'),
    );
    const dialog = openDialog({ label: 'Confirm your seat', onClose: () => { void api('POST', `/api/bookings/${booking.id}/release`, {}).catch(() => undefined); void refreshHold(); } }, dialogRoot);
    void dialogRoot;
  };

  const refreshHold = async (): Promise<void> => {
    try {
      const b = await api<Booking>('GET', `/api/bookings/${myBooking?.id ?? myRequest?.id}`);
      if (b.state === 'held' || b.state === 'requested' || b.state === 'confirmed') {
        if (b.state === 'confirmed') myBooking = b; else myRequest = b;
      } else {
        myBooking = null;
        myRequest = b;
      }
      await renderBookBar();
    } catch { /* gone */ }
  };

  const handleBookingError = (e: unknown, alertTarget: HTMLElement): void => {
    if (e instanceof ApiFail) {
      alertTarget.append(alertBox(e.body.message));
      if (e.code === 'seat_taken') {
        span.refresh({ seatMap: ride.seat_map, boarding: ride.stops[0].city, alighting: ride.stops[ride.stops.length - 1].city, seats: 1 });
        boarding = ride.stops[0].city;
        alighting = ride.stops[ride.stops.length - 1].city;
        seats = 1;
        announce(e.body.message);
      }
      if (e.code === 'ride_changed' && e.body.ride) {
        ride = e.body.ride;
        announce(e.body.message);
      }
    }
  };

  const alertBox = (message: string): HTMLElement => h('div', { role: 'alert', class: 'alert' }, message);

  // ---------- driver panels ----------

  const renderDriverPanels = async (): Promise<void> => {
    if (!isDriver) { clear(driverPanels); return; }
    clear(driverPanels);
    const requests = h('section', { role: 'region', 'aria-label': 'Requests', class: 'requests-panel' });
    const passengersList = h('ul', { role: 'list', 'aria-label': 'Passengers', class: 'list-plain' });
    const noticesList = h('ul', { role: 'list', 'aria-label': 'Passenger notices', class: 'list-plain' });
    const queue: Array<HTMLElement> = [];

    let bookings: Booking[] = [];
    try {
      const res = await api<{ bookings: Booking[] }>('GET', `/api/rides/${ride.id}/bookings`);
      bookings = res.bookings;
    } catch { bookings = []; }

    const renderRequests = (): void => {
      clear(requests);
      const pending = bookings.filter(b => b.state === 'requested');
      requests.append(h('h2', null, 'Requests'));
      if (pending.length === 0) {
        requests.append(h('p', { class: 'empty-sentence' }, 'No pending requests.'));
        return;
      }
      for (const b of pending) {
        const row = h('div', { class: 'request-row', 'data-id': b.id },
          h('span', null, `${b.passenger.display_name}: ${b.boarding} to ${b.alighting}`),
          h('button', { type: 'button', class: 'btn', onClick: async (e: Event) => { await decide(b, 'accept'); (e.target as HTMLElement).closest('.request-row')?.nextElementSibling?.querySelector('button')?.focus(); } }, `Accept ${b.passenger.display_name}`),
          h('button', { type: 'button', class: 'btn', onClick: async (e: Event) => { await decide(b, 'decline'); (e.target as HTMLElement).closest('.request-row')?.nextElementSibling?.querySelector('button')?.focus(); } }, `Decline ${b.passenger.display_name}`),
        );
        queue.push(row);
        requests.append(row);
      }
    };

    const decide = async (b: Booking, action: 'accept' | 'decline'): Promise<void> => {
      try {
        await api<Booking>('POST', `/api/bookings/${b.id}/${action}`, {});
        if (action === 'accept') announce(`Request accepted. ${b.passenger.display_name}: ${b.boarding} to ${b.alighting}.`);
        else announce(`Request declined. ${b.passenger.display_name}: ${b.passenger.display_name} gets ${money(b.price_cents)} back.`);
        await renderDriverPanels();
      } catch (e) {
        if (e instanceof ApiFail) announce(e.body.message);
      }
    };

    const renderPassengers = (): void => {
      clear(passengersList);
      for (const b of bookings.filter(x => x.state === 'confirmed')) {
        passengersList.append(h('li', { 'data-id': b.id }, `${b.passenger.display_name}: ${b.boarding} to ${b.alighting}, seats ${b.seat_numbers.join(', ')}`));
      }
      if (passengersList.childElementCount === 0) passengersList.append(h('li', null, 'No passengers yet.'));
    };

    let notices: Notice[] = [];
    try {
      const res = await api<{ notices: Notice[] }>('GET', `/api/rides/${ride.id}/notices`);
      notices = res.notices;
    } catch { notices = []; }
    const renderNotices = (): void => {
      clear(noticesList);
      for (const n of notices) {
        noticesList.append(h('li', { 'data-id': `${n.passenger_id}:${n.kind}` }, `${n.name}: ${n.kind === 'time_change' ? 'time change' : 'cancellation'} ${n.status === 'sent' ? `sent at ${n.sent_at ? hhmm(n.sent_at) : ''}` : 'queued'}`));
      }
    };

    renderRequests();
    renderPassengers();
    renderNotices();

    const actions = h('div', { class: 'driver-actions' },
      h('button', { type: 'button', class: 'btn', onClick: () => openChangeDeparture() }, 'Change departure'),
      h('button', { type: 'button', class: 'btn', onClick: () => openChangeSeats() }, 'Change seats'),
      h('button', { type: 'button', class: 'btn', onClick: () => openCancelRide() }, 'Cancel ride'),
    );

    driverPanels.append(requests, passengersList, noticesList, actions);
  };

  const openChangeDeparture = (): void => {
    const input = h('input', { type: 'text', class: 'field', 'aria-label': 'New departure time', value: hhmm(ride.stops[0].time) }) as HTMLInputElement;
    const save = h('button', {
      type: 'button', class: 'btn primary', 'data-autofocus': true,
      onClick: async () => {
        save.textContent = 'Working';
        try {
          const date = ride.stops[0].time.slice(0, 10);
          const res = await api<{ ride: Ride; notices: Notice[] }>('PATCH', `/api/rides/${ride.id}`, { departure: `${date}T${input.value}:00` }, undefined);
          void res;
          dialog.close();
          const res2 = await patchSend(`${date}T${input.value}:00`);
          announceDeparture(res2);
        } catch (e) {
          if (e instanceof ApiFail) { alertTarget.append(alertBox(e.body.message)); save.textContent = 'Save new time'; }
        }
      },
    }, 'Save new time');
    const alertTarget = h('div');
    const patchSend = async (dep: string): Promise<{ ride: Ride; notices: Notice[] }> => {
      const res = await api<{ ride: Ride; notices: Notice[] }>('PATCH', `/api/rides/${ride.id}`, { departure: dep });
      return res;
    };
    const dialog = openDialog({ label: 'Change departure' }, [
      h('p', null, 'New departure time (HH:MM)'),
      input,
      save,
      alertTarget,
    ]);
    void dialog;
  };

  const announceDeparture = (res: { ride: Ride; notices: Notice[] }): void => {
    ride = res.ride;
    renderStops();
    span.refresh({ seatMap: ride.seat_map, boarding, alighting, seats });
    const allSent = res.notices.every(n => n.status === 'sent');
    if (res.notices.length === 0) announce('Departure saved.');
    else if (allSent) announce(`Departure saved and ${res.notices.length} ${res.notices.length === 1 ? 'passenger' : 'passengers'} emailed.`);
    else announce('Saved. Emails to passengers are queued and will be sent when mail is back.');
    void renderDriverPanels();
  };

  const openChangeSeats = (): void => {
    let seats = ride.seats;
    const spin = seatsStepper(seats, 1, 4, v => { seats = v; });
    const save = h('button', {
      type: 'button', class: 'btn primary', 'data-autofocus': true,
      onClick: async () => {
        save.textContent = 'Working';
        try {
          const res = await api<{ ride: Ride; notices: Notice[] }>('PATCH', `/api/rides/${ride.id}`, { seats });
          ride = res.ride;
          dialog.close();
          span.refresh({ seatMap: ride.seat_map, boarding, alighting, seats });
          announce('Seats saved.');
          await renderBookBar();
        } catch (e) {
          if (e instanceof ApiFail) { alertTarget.append(alertBox(e.body.message)); save.textContent = 'Save seats'; }
        }
      },
    }, 'Save seats');
    const alertTarget = h('div');
    const dialog = openDialog({ label: 'Change seats' }, [spin, save, alertTarget]);
    void dialog;
  };

  const openCancelRide = (): void => {
    const confirmBtn = h('button', {
      type: 'button', class: 'btn primary',
      onClick: async () => {
        confirmBtn.textContent = 'Working';
        try {
          await api('POST', `/api/rides/${ride.id}/cancel`, {}, { idempotencyKey: idemKey() });
          announce('Ride cancelled. Every passenger has been refunded.');
          dialog.close();
          ride = await api<Ride>('GET', `/api/rides/${ride.id}`);
          renderStops();
          await renderDriverPanels();
        } catch (e) {
          if (e instanceof ApiFail) { alertTarget.append(alertBox(e.body.message)); confirmBtn.textContent = 'Cancel ride for everyone'; }
        }
      },
    }, 'Cancel ride for everyone');
    const alertTarget = h('div');
    const dialog = openDialog({ label: 'Cancel this ride' }, [
      h('p', null, 'Every passenger gets a full refund.'),
      confirmBtn,
      h('button', { type: 'button', class: 'btn', onClick: () => dialog.close() }, 'Keep ride'),
      alertTarget,
    ]);
    void dialog;
  };

  // ---------- live handlers ----------

  const handlers = {
    onSeat: (rideIdIn: string, seatMap: SeatRow[]): void => {
      if (rideIdIn !== ride.id) return;
      ride.seat_map = seatMap;
      span.refresh({ seatMap, boarding, alighting, seats });
      void renderBookBar();
    },
    onRide: (updated: Ride): void => {
      if (updated.id !== ride.id) return;
      ride = updated;
      renderStops();
      span.refresh({ seatMap: updated.seat_map, boarding, alighting, seats });
      void renderBookBar();
      if (!isDriver && myBooking?.state === 'confirmed') {
        showRideUpdate(updated);
      }
    },
    onBooking: (booking: Booking): void => {
      if (booking.ride_id !== ride.id) return;
      if (me && booking.passenger?.id === me.id) {
        if (booking.state === 'confirmed' && myRequest?.state === 'requested') {
          announce(`Request accepted by ${ride.driver.display_name}.`);
        } else if (booking.state === 'declined') {
          announce(`Request declined by ${ride.driver.display_name}. ${money(booking.price_cents)} is back in your wallet.`);
        } else if (booking.state === 'expired') {
          announce('This request expired');
        }
        myRequest = booking;
        if (booking.state === 'confirmed') myBooking = booking;
        void renderBookBar();
      }
      if (isDriver) {
        if (booking.state === 'confirmed') {
          const bi = ride.stops.findIndex(s => s.city === booking.boarding);
          const ai = ride.stops.findIndex(s => s.city === booking.alighting);
          let free = 0;
          for (const row of ride.seat_map) {
            let ok = true;
            for (let leg = bi; leg < ai; leg++) if (row.legs[leg] === 'taken') ok = false;
            if (ok) free++;
          }
          announce(`Seat booked by ${booking.passenger.display_name}: ${booking.boarding} to ${booking.alighting}. ${count(free, 'seat left', 'seats left')}.`);
        } else if (booking.state === 'requested') {
          announce(`New request from ${booking.passenger.display_name}: ${booking.boarding} to ${booking.alighting}.`);
        } else if (booking.state === 'cancelled_by_passenger') {
          const kept = booking.price_cents - (booking.cancel_quote?.refund_cents ?? 0);
          announce(`${booking.passenger.display_name} cancelled: ${booking.boarding} to ${booking.alighting}. You keep ${money(kept)}.`);
        }
        void renderDriverPanels();
      }
    },
    onNotice: (n: { ride_id: string; passenger_id: string; kind: string; status: string; sent_at: string | null }): void => {
      if (n.ride_id !== ride.id || !isDriver) return;
      void renderDriverPanels();
    },
    onHello: (): void => { void refresh(); },
  };

  const showRideUpdate = (updated: Ride): void => {
    clear(updateRegion);
    const region = h('div', { role: 'region', 'aria-label': 'Ride update', class: 'banner-outage' });
    if (updated.state === 'cancelled') {
      region.append(h('p', null, `${ride.driver.display_name} cancelled this ride. ${money(myBooking?.price_cents ?? 0)} is back in your wallet.`));
    } else if (updated.stops[0].time !== ride.stops[0].time) {
      const oldTime = ride.stops[0].time;
      const newTime = updated.stops[0].time;
      if (myBooking?.free_cancel_until) {
        region.append(h('p', null, `Departure moved from ${hhmm(oldTime)} to ${hhmm(newTime)}. You can cancel for free until ${timeOn(myBooking.free_cancel_until)}.`));
      } else {
        region.append(h('p', null, `Departure moved from ${hhmm(oldTime)} to ${hhmm(newTime)}.`));
      }
    }
    updateRegion.append(region);
    ride = updated;
  };

  const refresh = async (): Promise<void> => {
    try {
      ride = await api<Ride>('GET', `/api/rides/${ride.id}`);
      renderStops();
      span.refresh({ seatMap: ride.seat_map, boarding, alighting, seats });
      await renderBookBar();
      if (isDriver) await renderDriverPanels();
    } catch { /* ride gone */ }
  };

  // ---------- assemble ----------

  const driverInfo = h('p', { class: 'driver-line' },
    `${ride.driver.display_name}`,
    ride.vehicle ? ` — ${ride.vehicle.make_model}, ${ride.vehicle.colour}` : '',
    ride.driver.rating.count > 0 ? ` — ${ride.driver.rating.average} from ${count(ride.driver.rating.count, 'rating')}` : ' — No ratings yet',
  );
  if (ride.driver.photo_url) {
    const img = h('img', { src: ride.driver.photo_url, alt: '', class: 'driver-photo' });
    driverInfo.prepend(img);
  }

  const bigPlate = plate({ seed: ride.id, caption: `${ride.stops[0].city} to ${ride.stops[ride.stops.length - 1].city}, the road the ride takes`, ratio: '4 / 3' });

  span = legSpan({
    ride, seatMap: ride.seat_map, boarding, alighting, seats, interactive: !isDriver,
    onSpanChange: (b, a) => { boarding = b; alighting = a; void renderBookBar(); },
  });

  const seatsControl = !isDriver ? seatsStepper(seats, 1, 4, v => { seats = v; span.refresh({ seatMap: ride.seat_map, boarding, alighting, seats }); void renderBookBar(); }) : h('span');

  live.setHandlers(handlers);
  live.subscribe(ride.id, null);

  root.append(
    heading,
    driverInfo,
    h('div', { class: 'ride-layout' },
      h('div', null, bigPlate, stopsList),
      h('div', null, spanWrap, seatsControl),
    ),
    seatTakenAlert,
    updateRegion,
    bookBar,
    driverPanels,
  );
  spanWrap.append(span.root);
  renderStops();
  await renderBookBar();
  await renderDriverPanels();

  window.setTimeout(() => heading.focus(), 60);
  const cleanup = () => { window.clearInterval(requestTimer); };
  window.addEventListener('pagehide', cleanup, { once: true });
  document.body.classList.add('has-bookbar');

  return root;
}

let idemCounter = 0;
function idemKey(): string {
  idemCounter += 1;
  return `web-${Date.now().toString(36)}-${idemCounter}`;
}
