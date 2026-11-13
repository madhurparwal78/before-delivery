import { announce, setAlert, setFieldErrors, toast, withPending } from '../announce.js';
import { api } from '../api.js';
import { clear, focus, h } from '../dom.js';
import { CITIES } from '../../shared/cities.js';
import { money } from '../../shared/format.js';
import { navigate, type RouteContext } from '../router.js';
import { mainRegion } from '../shell.js';
import { currentMember, pageConfig, serverToday } from '../state.js';
import { combobox } from '../components/combobox.js';
import { dateField } from '../components/datepicker.js';
import { priceEndMessage, seatEndMessage, stepper } from '../components/stepper.js';
import type { Ride, Vehicle } from '../types.js';

interface PriceRange {
  route_km: number;
  low_cents: number;
  high_cents: number;
}

export function renderOffer(_ctx: RouteContext): void {
  const main = mainRegion();
  clear(main);
  main.appendChild(h('p', { class: 'loading', text: 'Working' }));
  void mount(main);
}

async function mount(main: HTMLElement): Promise<void> {
  const member = currentMember();
  if (!member) {
    navigate('/sign-in?next=%2Foffer');
    return;
  }
  const vehicleResult = await api<{ vehicles: Vehicle[] }>('GET', '/api/vehicles');
  let vehicles = vehicleResult.ok ? vehicleResult.data.vehicles : [];

  let origin = '';
  let destination = '';
  let stopovers: string[] = [];
  let vehicleId = vehicles[0]?.id ?? '';
  let range: PriceRange | null = null;

  const form = h('div', { class: 'offer-form' });
  const recommended = h('p', { class: 'recommended' });
  const publishSlot = h('div', { class: 'alert-slot' });

  const routeCities = (): string[] =>
    [origin, ...stopovers, destination].filter((city) => city.length > 0);

  const price = stepper({
    label: 'Price per seat',
    min: 0,
    max: 0,
    step: 50,
    pageStep: 500,
    value: 0,
    format: (value) => money(value),
    endMessage: priceEndMessage((value) => money(value)),
    disabled: true,
  });

  const seats = stepper({
    label: 'Seats',
    min: 1,
    max: Math.min(4, vehicles[0]?.seats ?? 4),
    step: 1,
    pageStep: 2,
    value: 3,
    endMessage: seatEndMessage,
  });

  const refreshRange = async () => {
    const cities = routeCities();
    if (cities.length < 2 || !origin || !destination) {
      range = null;
      recommended.textContent = '';
      price.setDisabled(true);
      return;
    }
    const result = await api<PriceRange>(
      'GET',
      `/api/price-range?stops=${cities.map((city) => encodeURIComponent(city)).join(',')}`,
    );
    if (!result.ok) {
      range = null;
      recommended.textContent = '';
      price.setDisabled(true);
      return;
    }
    range = result.data;
    recommended.textContent = `Recommended: ${money(range.low_cents)} to ${money(
      range.high_cents,
    )} for ${range.route_km} km`;
    price.setRange(range.low_cents, range.high_cents);
    const middle =
      Math.floor((range.low_cents + range.high_cents) / 2 / 50 + 0.5) * 50;
    price.setValue(middle);
    price.setDisabled(false);
  };

  const stopList = h('ul', { 'aria-label': 'Stopovers', class: 'stopovers' });

  const paintStopovers = (focusCity?: string, focusAction?: 'up' | 'down' | 'remove') => {
    clear(stopList);
    stopovers.forEach((city, index) => {
      const item = h('li', { 'data-id': city, class: 'stopover' });
      const up = h('button', {
        type: 'button',
        class: 'secondary',
        text: `Move ${city} up`,
        onclick: () => moveStopover(index, -1),
      });
      const down = h('button', {
        type: 'button',
        class: 'secondary',
        text: `Move ${city} down`,
        onclick: () => moveStopover(index, 1),
      });
      const remove = h('button', {
        type: 'button',
        class: 'secondary',
        text: `Remove ${city}`,
        onclick: () => removeStopover(index),
      });
      item.append(h('span', { class: 'stopover-name', text: city }), up, down, remove);
      stopList.appendChild(item);
      if (focusCity === city) {
        focus(focusAction === 'up' ? up : focusAction === 'down' ? down : remove);
      }
    });
  };

  const moveStopover = (index: number, delta: number) => {
    const next = index + delta;
    if (next < 0 || next >= stopovers.length) return;
    const city = stopovers[index] as string;
    stopovers.splice(index, 1);
    stopovers.splice(next, 0, city);
    paintStopovers(city, delta < 0 ? 'up' : 'down');
    announce(`${city} moved to stop ${next + 1} of ${stopovers.length}`);
    void refreshRange();
  };

  const removeStopover = (index: number) => {
    const city = stopovers[index] as string;
    stopovers.splice(index, 1);
    paintStopovers();
    void refreshRange();
    announce(
      `${city} removed. Undo is available for ${pageConfig().toast_seconds} seconds.`,
    );
    toast(`${city} removed.`, {
      undo: {
        onUndo: () => {
          stopovers.splice(index, 0, city);
          paintStopovers(city, 'remove');
          void refreshRange();
          announce(`${city} restored to stop ${index + 1}`);
        },
      },
    });
  };

  const vehicleBox = h('div', { class: 'field-box' });
  const paintVehicle = () => {
    clear(vehicleBox);
    if (vehicles.length > 0) {
      const chooser = combobox({
        label: 'Vehicle',
        value: vehicles.find((vehicle) => vehicle.id === vehicleId)?.make_model ?? '',
        choices: () => vehicles.map((vehicle) => vehicle.make_model),
        onSelect: (name) => {
          const chosen = vehicles.find((vehicle) => vehicle.make_model === name);
          if (!chosen) return;
          vehicleId = chosen.id;
          seats.setRange(1, Math.min(4, chosen.seats));
        },
      });
      vehicleBox.append(h('span', { class: 'label', text: 'Vehicle' }), chooser.element);
      return;
    }
    const makeModel = h('input', {
      type: 'text',
      'aria-label': 'Car make and model',
      class: 'field',
    });
    const colour = h('input', { type: 'text', 'aria-label': 'Car colour', class: 'field' });
    const carSeats = stepper({
      label: 'Car seats',
      min: 1,
      max: 4,
      step: 1,
      pageStep: 2,
      value: 3,
    });
    const slot = h('div', { class: 'alert-slot' });
    const save = h('button', { type: 'button', class: 'secondary', text: 'Save car' });
    save.addEventListener('click', () => {
      void (async () => {
        const result = await withPending(save, () =>
          api<Vehicle>('POST', '/api/vehicles', {
            body: {
              make_model: makeModel.value,
              colour: colour.value,
              seats: carSeats.value(),
            },
          }),
        );
        if (!result) return;
        if (!result.ok) {
          setAlert(slot, result.failure.message);
          return;
        }
        vehicles = [result.data];
        vehicleId = result.data.id;
        seats.setRange(1, Math.min(4, result.data.seats));
        paintVehicle();
      })();
    });
    vehicleBox.append(
      h('span', { class: 'label', text: 'Car make and model' }),
      makeModel,
      h('span', { class: 'label', text: 'Car colour' }),
      colour,
      h('span', { class: 'label', text: 'Car seats' }),
      carSeats.element,
      save,
      slot,
    );
  };

  const from = combobox({
    label: 'Leaving from',
    choices: () => CITIES.filter((city) => !routeCities().includes(city) || city === origin),
    onSelect: (city) => {
      origin = city;
      void refreshRange();
    },
  });
  const to = combobox({
    label: 'Going to',
    choices: () => CITIES.filter((city) => !routeCities().includes(city) || city === destination),
    onSelect: (city) => {
      destination = city;
      void refreshRange();
    },
  });
  const addStopover = combobox({
    label: 'Add a stopover',
    clearOnSelect: true,
    choices: () => CITIES.filter((city) => !routeCities().includes(city)),
    onSelect: (city) => {
      stopovers.push(city);
      paintStopovers();
      void refreshRange();
    },
  });

  const date = dateField(serverToday(), () => undefined);
  const departureTime = h('input', {
    type: 'text',
    'aria-label': 'Departure time',
    class: 'field',
  });
  departureTime.value = '08:30';

  let bookingMode: 'instant' | 'request' = 'instant';
  const modeGroup = h('div', {
    role: 'radiogroup',
    'aria-label': 'Booking mode',
    class: 'modes',
  });
  const modes: Array<{ value: 'instant' | 'request'; label: string }> = [
    { value: 'instant', label: 'Instant booking' },
    { value: 'request', label: 'Review each request' },
  ];
  const modeRadios: HTMLElement[] = [];
  modes.forEach((mode, index) => {
    const radio = h('div', {
      role: 'radio',
      'aria-label': mode.label,
      'aria-checked': index === 0 ? 'true' : 'false',
      tabindex: index === 0 ? '0' : '-1',
      class: 'radio',
      text: mode.label,
    });
    const choose = () => {
      bookingMode = mode.value;
      modeRadios.forEach((item, position) => {
        item.setAttribute('aria-checked', position === index ? 'true' : 'false');
        item.setAttribute('tabindex', position === index ? '0' : '-1');
      });
      radio.focus();
    };
    radio.addEventListener('click', choose);
    radio.addEventListener('keydown', (event) => {
      if (['ArrowRight', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        (modeRadios[(index + 1) % modeRadios.length] as HTMLElement).click();
      } else if (['ArrowLeft', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        (
          modeRadios[(index - 1 + modeRadios.length) % modeRadios.length] as HTMLElement
        ).click();
      } else if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        choose();
      }
    });
    modeRadios.push(radio);
    modeGroup.appendChild(radio);
  });

  const publish = h('button', { type: 'button', class: 'action', text: 'Publish ride' });
  publish.addEventListener('click', () => {
    void (async () => {
      const [hour, minute] = departureTime.value.split(':');
      const departure = `${date.value()}T${hour ?? '00'}:${minute ?? '00'}:00`;
      const result = await withPending(publish, () =>
        api<Ride>('POST', '/api/rides', {
          body: {
            vehicle_id: vehicleId,
            stops: routeCities(),
            departure,
            seats: seats.value(),
            price_cents: price.value(),
            booking_mode: bookingMode,
          },
        }),
      );
      if (!result) return;
      if (!result.ok) {
        setAlert(publishSlot, result.failure.message);
        setFieldErrors(form, result.failure.fields);
        return;
      }
      navigate(`/rides/${result.data.id}`);
    })();
  });

  paintVehicle();
  paintStopovers();
  void refreshRange();

  form.append(
    vehicleBox,
    h('div', { class: 'field-box' }, h('span', { class: 'label', text: 'Leaving from' }), from.element,
      h('div', { 'data-field-error': 'stops', class: 'field-error' })),
    h('div', { class: 'field-box' }, h('span', { class: 'label', text: 'Going to' }), to.element),
    h('div', { class: 'field-box' }, h('span', { class: 'label', text: 'Add a stopover' }), addStopover.element),
    stopList,
    h('div', { class: 'field-box' }, h('span', { class: 'label', text: 'Date' }), date.button),
    h('div', { class: 'field-box' }, h('span', { class: 'label', text: 'Departure time' }), departureTime,
      h('div', { 'data-field-error': 'departure', class: 'field-error' })),
    h('div', { class: 'field-box' }, h('span', { class: 'label', text: 'Seats' }), seats.element,
      h('div', { 'data-field-error': 'seats', class: 'field-error' })),
    h('div', { class: 'field-box' }, h('span', { class: 'label', text: 'Price per seat' }), price.element,
      recommended,
      h('div', { 'data-field-error': 'price_cents', class: 'field-error' })),
    h('div', { class: 'field-box' }, h('span', { class: 'label', text: 'Booking mode' }), modeGroup),
    publish,
    publishSlot,
  );

  clear(main);
  main.append(h('h1', { text: 'Offer a ride' }), form);
}
