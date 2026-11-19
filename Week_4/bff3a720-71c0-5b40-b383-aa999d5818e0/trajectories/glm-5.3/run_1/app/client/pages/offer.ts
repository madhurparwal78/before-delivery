import { h, clear } from '../lib/els.js';
import { router } from '../lib/router.js';
import { store } from '../lib/store.js';
import { api, ApiFail } from '../lib/api.js';
import { announce, toast } from '../lib/announce.js';
import { combobox } from '../lib/combobox.js';
import { priceStepper } from '../lib/stepper.js';
import { datePickerButton } from '../lib/datepicker.js';
import { money, longDate } from '../lib/fmt.js';
import type { Ride, Vehicle } from '../lib/types.js';

const CITIES = ['Kestrevel', 'Vardholm', 'Brisanne', 'Oakhythe', 'Tollemarch', 'Saint Ivrel', 'Corrandy', 'Hesketh Mere'];

interface RangeInfo { route_km: number; low_cents: number; high_cents: number }

export async function offerPage(): Promise<HTMLElement> {
  const root = h('div', { class: 'offer-page' });
  const form = h('form', { class: 'offer-form', onSubmit: (e: Event) => { e.preventDefault(); void publish(); } });

  let vehicles: Vehicle[] = [];
  let selectedVehicle: Vehicle | null = null;
  let origin = 'Kestrevel';
  let destination = 'Tollemarch';
  let stopovers: string[] = [];
  let seats = 3;
  let priceCents = 0;
  let range: RangeInfo | null = null;
  let mode: 'instant' | 'request' = 'instant';
  const alertTarget = h('div');

  if (!store.me) {
    root.append(h('h1', null, 'Offer a ride'), h('p', null, h('a', { href: '/sign-in', class: 'link' }, 'Sign in to offer a ride.')));
    return root;
  }
  if (store.me.id_state !== 'verified') {
    root.append(h('h1', null, 'Offer a ride'),
      h('div', { role: 'alert', class: 'banner-outage' }, 'Your ID must be verified before you can offer a ride.'),
      h('p', null, h('a', { href: '/profile' }, 'Upload your ID document on your profile.')));
    return root;
  }

  vehicles = await api<{ vehicles: Vehicle[] }>('GET', '/api/vehicles').then(r => r.vehicles).catch(() => []);
  selectedVehicle = vehicles[0] ?? null;

  // ---------- car form when no car yet ----------

  const carSection = h('section');
  if (vehicles.length === 0) {
    carSection.append(h('h2', null, 'Your car'));
    const make = h('input', { type: 'text', class: 'field', 'aria-label': 'Car make and model' }) as HTMLInputElement;
    const colour = h('input', { type: 'text', class: 'field', 'aria-label': 'Car colour' }) as HTMLInputElement;
    let carSeats = 3;
    const seatSpin = h('input', { type: 'number', class: 'field', min: '1', max: '4', value: '3', 'aria-label': 'Car seats' }) as HTMLInputElement;
    seatSpin.addEventListener('change', () => { carSeats = Number(seatSpin.value) || 3; });
    const save = h('button', {
      type: 'button', class: 'btn primary', onClick: async () => {
        save.textContent = 'Working';
        try {
          const v = await api<Vehicle>('POST', '/api/vehicles', { make_model: make.value, colour: colour.value, seats: carSeats });
          vehicles.push(v);
          selectedVehicle = v;
          clear(carSection);
          carSection.append(h('p', null, `Your car: ${v.make_model}, ${v.colour}, ${v.seats} seats.`));
          void updateRange();
        } catch (e) {
          if (e instanceof ApiFail) { alertTarget.append(h('div', { role: 'alert', class: 'alert' }, e.body.message)); save.textContent = 'Save car'; }
        }
      },
    }, 'Save car');
    carSection.append(
      h('p', null, h('label', null, 'Car make and model'), make),
      h('p', null, h('label', null, 'Car colour'), colour),
      h('p', null, h('label', null, 'Car seats'), seatSpin),
      save,
    );
  } else {
    carSection.append(h('h2', null, 'Your car'));
    const select = h('select', { class: 'field', 'aria-label': 'Vehicle' }) as HTMLSelectElement;
    for (const v of vehicles) {
      const opt = h('option', { value: v.id }, `${v.make_model}, ${v.colour}, ${v.seats} seats`);
      select.append(opt);
    }
    select.addEventListener('change', () => { selectedVehicle = vehicles.find(v => v.id === select.value) ?? null; void updateRange(); });
    carSection.append(select);
  }

  // ---------- route ----------

  const originBox = combobox({ label: 'Leaving from', towns: CITIES, value: origin, onSelect: city => { origin = city; void updateRange(); } });
  const destBox = combobox({ label: 'Going to', towns: CITIES, value: destination, onSelect: city => { destination = city; void updateRange(); } });
  const stopoverBox = combobox({ label: 'Add a stopover', towns: CITIES, value: null, placeholder: 'Add a stopover', onSelect: city => { addStopover(city); } });
  const stopoversList = h('ol', { role: 'list', 'aria-label': 'Stopovers', class: 'list-plain' });

  const addStopover = (city: string): void => {
    if (stopovers.includes(city)) return;
    stopovers.push(city);
    renderStopovers();
    announceStopovers();
    void updateRange();
  };

  const renderStopovers = (): void => {
    clear(stopoversList);
    stopovers.forEach((city, idx) => {
      const li = h('li', { 'data-id': city },
        city,
        h('button', { type: 'button', class: 'btn ghost', 'aria-label': `Move ${city} up`, disabled: idx === 0, onClick: () => {
          if (idx === 0) return;
          stopovers.splice(idx - 1, 0, stopovers.splice(idx, 1)[0]);
          renderStopovers();
          announce(`${city} moved to stop ${idx} of ${stopovers.length}`);
          void updateRange();
          stopoversList.querySelectorAll('li')[idx - 1]?.querySelector<HTMLElement>('[aria-label^="Remove"]')?.focus();
        } }, '↑'),
        h('button', { type: 'button', class: 'btn ghost', 'aria-label': `Move ${city} down`, disabled: idx === stopovers.length - 1, onClick: () => {
          if (idx === stopovers.length - 1) return;
          stopovers.splice(idx + 1, 0, stopovers.splice(idx, 1)[0]);
          renderStopovers();
          announce(`${city} moved to stop ${idx + 2} of ${stopovers.length}`);
          void updateRange();
          stopoversList.querySelectorAll('li')[idx + 1]?.querySelector<HTMLElement>('[aria-label^="Remove"]')?.focus();
        } }, '↓'),
        h('button', { type: 'button', class: 'btn ghost', 'aria-label': `Remove ${city}`, onClick: () => removeStopover(city, idx) }, '✕'),
      );
      stopoversList.append(li);
    });
  };

  const announceStopovers = (): void => {
    if (stopovers.length === 0) return;
    announce(`${stopovers[stopovers.length - 1]} added at stop ${stopovers.length}.`);
  };

  const removeStopover = (city: string, idx: number): void => {
    stopovers.splice(idx, 1);
    renderStopovers();
    announce(`${city} removed. Undo is available for ${store.config.toastSeconds} seconds.`);
    toast(`${city} removed`, { label: 'Undo', onClick: () => {
      stopovers.splice(Math.min(idx, stopovers.length), 0, city);
      renderStopovers();
      announce(`${city} restored to stop ${Math.min(idx + 1, stopovers.length)}`);
      void updateRange();
      stopoversList.querySelectorAll('li')[Math.min(idx, stopovers.length - 1)]?.querySelector<HTMLElement>('[aria-label^="Remove"]')?.focus();
    } });
    void updateRange();
  };

  // ---------- date, seats, price ----------

  let date = defaultDate();
  const dateButton = datePickerButton({
    selected: date,
    today: todayIso(),
    labelForButton: iso => `Date, ${longDate(iso)}`,
    onPick: iso => { date = iso; dateButton.textContent = `Date, ${longDate(iso)}`; },
  });

  const timeInput = h('input', { type: 'text', class: 'field', 'aria-label': 'Departure time', placeholder: 'HH:MM' }) as HTMLInputElement;

  const priceWrap = h('div');
  const rangeLine = h('p', { class: 'muted' }, '');
  let priceSpin: HTMLElement | null = null;

  const updateRange = async (): Promise<void> => {
    const stops = [origin, ...stopovers, destination];
    if (new Set(stops).size !== stops.length || !CITIES.includes(origin) || !CITIES.includes(destination)) {
      range = null;
      rangeLine.textContent = '';
      if (priceSpin) priceSpin.querySelector('input')?.setAttribute('disabled', 'disabled');
      return;
    }
    try {
      range = await api<RangeInfo>('GET', `/api/price-range?stops=${stops.join(',')}`);
      const low = money(range.low_cents);
      const high = money(range.high_cents);
      rangeLine.textContent = `Recommended: ${low} to ${high} for ${range.route_km} km`;
      const middle = Math.round(((range.low_cents + range.high_cents) / 2) / 50) * 50;
      priceCents = Math.min(range.high_cents, Math.max(range.low_cents, middle));
      clear(priceWrap);
      priceSpin = priceStepper(priceCents, range.low_cents, range.high_cents, v => { priceCents = v; });
      priceWrap.append(priceSpin);
    } catch {
      range = null;
      rangeLine.textContent = 'Choose an origin and a destination that the table connects.';
    }
  };

  const modeGroup = h('div', { role: 'radiogroup', 'aria-label': 'Booking mode', class: 'sort-group' });
  const instantRadio = h('input', { type: 'radio', name: 'mode', value: 'instant', checked: true, onChange: () => { mode = 'instant'; } }) as HTMLInputElement;
  const requestRadio = h('input', { type: 'radio', name: 'mode', value: 'request', onChange: () => { mode = 'request'; } }) as HTMLInputElement;
  modeGroup.append(h('label', null, instantRadio, ' Instant booking'), h('label', null, requestRadio, ' Review each request'));

  const publish = async (): Promise<void> => {
    const btn = form.querySelector('.publish') as HTMLButtonElement | null;
    if (!btn) return;
    btn.textContent = 'Working';
    clear(alertTarget);
    try {
      const stops = [origin, ...stopovers, destination];
      const departure = `${date}T${timeInput.value.padStart(5, '0')}:00`;
      const ride = await api<Ride>('POST', '/api/rides', {
        vehicle_id: selectedVehicle?.id,
        stops,
        departure,
        seats,
        price_cents: priceCents,
        booking_mode: mode,
      });
      announce('Ride published.');
      router.go(`/rides/${ride.id}`);
    } catch (e) {
      if (e instanceof ApiFail) {
        alertTarget.append(h('div', { role: 'alert', class: 'alert' }, e.body.message));
        for (const [field, msg] of Object.entries(e.fields ?? {})) {
          alertTarget.append(h('div', { role: 'alert', class: 'alert' }, `${field}: ${msg}`));
        }
      }
      btn.textContent = 'Publish ride';
    }
  };

  const seatsSpin = h('input', { type: 'number', class: 'field', min: '1', max: '4', value: '3', 'aria-label': 'Seats' }) as HTMLInputElement;
  seatsSpin.addEventListener('change', () => { seats = Number(seatsSpin.value) || 3; });

  form.append(
    h('h1', null, 'Offer a ride'),
    carSection,
    h('section', null,
      h('h2', null, 'The route'),
      h('p', null, h('label', null, 'Leaving from'), originBox),
      h('div', null, h('label', null, 'Stopovers'), stopoverBox),
      stopoversList,
      h('p', null, h('label', null, 'Going to'), destBox),
    ),
    h('section', null,
      h('h2', null, 'When'),
      h('p', null, h('label', null, 'Date'), dateButton),
      h('p', null, h('label', null, 'Departure time'), timeInput),
    ),
    h('section', null,
      h('h2', null, 'Seats and price'),
      h('p', null, h('label', null, 'Seats'), seatsSpin),
      h('p', null, h('label', null, 'Price per seat'), priceWrap),
      rangeLine,
      modeGroup,
    ),
    h('button', { type: 'submit', class: 'btn primary publish' }, 'Publish ride'),
    alertTarget,
  );

  root.append(form);
  await updateRange();
  renderStopovers();
  return root;
}

function todayIso(): string {
  return store.serverNow.slice(0, 10);
}

function defaultDate(): string {
  const d = new Date(store.serverNow);
  d.setDate(d.getDate() + 3);
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t: string) => p.find(x => x.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

