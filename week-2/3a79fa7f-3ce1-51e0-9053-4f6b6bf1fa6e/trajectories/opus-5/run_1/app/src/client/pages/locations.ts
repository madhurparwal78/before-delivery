import { errorBody, get, post } from '../api.js';
import { clear, el, formatEventDate } from '../dom.js';
import { loadMe } from '../store.js';
import { announce, field } from '../ui.js';
import type { EventItem, LocationItem, SlotItem } from '../types.js';

const CITIES: { label: string; lat: string; lon: string }[] = [
  { label: 'San Juan', lat: '18.4655', lon: '-66.1057' },
  { label: 'Miami', lat: '25.7617', lon: '-80.1918' },
  { label: 'Austin', lat: '30.2672', lon: '-97.7431' },
  { label: 'Toronto', lat: '43.6532', lon: '-79.3832' },
  { label: 'Hamburg', lat: '53.5511', lon: '9.9937' },
  { label: 'Nice', lat: '43.7102', lon: '7.2620' },
  { label: 'Sydney', lat: '-33.8688', lon: '151.2093' },
];

const COUNTRIES: { code: string; name: string }[] = [
  { code: 'US', name: 'United States' },
  { code: 'PR', name: 'Puerto Rico' },
  { code: 'CA', name: 'Canada' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'AU', name: 'Australia' },
];

export async function renderLocations(main: HTMLElement): Promise<void> {
  const me = await loadMe();
  const isCustomer = me?.user.role === 'customer';

  const city = field('City', 'select', {
    options: [{ value: '', label: 'Choose a city' }, ...CITIES.map((item) => ({ value: item.label, label: item.label }))],
  });
  const latitude = field('Latitude', 'text');
  const longitude = field('Longitude', 'text');
  const radius = field('Radius', 'select', {
    options: [25, 50, 100, 250, 500].map((km) => ({ value: String(km), label: `${km} km` })),
    value: '100',
  });
  const countrySelect = field('Country', 'select', {
    options: [{ value: '', label: 'All countries' }, ...COUNTRIES.map((item) => ({ value: item.code, label: item.name }))],
  });
  const search = el('button', { class: 'btn', type: 'button' }, 'Search');
  const alert = el('div', { class: 'alert-region', role: 'alert' });
  const results = el('div', { class: 'stack' });

  city.control.addEventListener('change', () => {
    const chosen = CITIES.find((item) => item.label === city.control.value);
    if (!chosen) return;
    latitude.control.value = chosen.lat;
    longitude.control.value = chosen.lon;
  });

  main.replaceChildren(
    el('section', { class: 'band wrap stack' }, [
      el('h1', {}, 'Demo stations near you'),
      el('form', { novalidate: true }, [
        alert,
        el('div', { class: 'grid grid-3' }, [city.wrapper, latitude.wrapper, longitude.wrapper]),
        el('div', { class: 'grid grid-2' }, [radius.wrapper, countrySelect.wrapper]),
        search,
      ]),
      results,
    ]),
  );

  const slotRows = (location: LocationItem, host: HTMLElement): (() => Promise<void>) => {
    const paint = async (): Promise<void> => {
      const response = await get<{ slots: SlotItem[] }>(`/api/locations/${location.id}/slots`);
      clear(host);
      if (!response.ok) {
        host.appendChild(el('p', { class: 'field-error' }, errorBody(response).message));
        return;
      }
      if (response.body.slots.length === 0) {
        host.appendChild(el('p', { class: 'muted' }, 'No demo days scheduled.'));
        return;
      }
      for (const slot of response.body.slots) {
        const seats = slot.seats_left === 0 ? 'Fully booked' : `${slot.seats_left} of ${slot.capacity} seats left`;
        const row = el('div', { class: 'row', style: 'border-top:1px solid var(--rule);padding-top:0.5rem' }, [
          el('span', {}, slot.label),
          el('span', { class: 'caption' }, seats),
        ]);
        if (isCustomer && slot.seats_left > 0) {
          const bookButton = el('button', { class: 'btn btn-small', type: 'button' }, `Book a seat, ${slot.label}`);
          bookButton.addEventListener('click', async () => {
            alert.textContent = '';
            bookButton.disabled = true;
            bookButton.textContent = 'Booking...';
            const result = await post(`/api/demo-bookings`, { slot_id: slot.id });
            if (!result.ok) {
              alert.textContent = errorBody(result).message;
              await paint();
              return;
            }
            announce(`Seat booked. ${slot.seats_left - 1} of ${slot.capacity} seats left.`);
            await paint();
          });
          row.appendChild(bookButton);
        }
        host.appendChild(row);
      }
    };
    return paint;
  };

  const run = async (): Promise<void> => {
    alert.textContent = '';
    latitude.setError(null);
    longitude.setError(null);
    const params = new URLSearchParams();
    if (latitude.control.value.trim() !== '') params.set('lat', latitude.control.value.trim());
    if (longitude.control.value.trim() !== '') params.set('lon', longitude.control.value.trim());
    params.set('radius_km', radius.control.value);
    if (countrySelect.control.value !== '') params.set('country', countrySelect.control.value);

    const response = await get<{ locations: LocationItem[] }>(`/api/locations?${params.toString()}`);
    clear(results);
    if (!response.ok) {
      const body = errorBody(response);
      if (body.fields?.lat) latitude.setError(body.fields.lat);
      if (body.fields?.lon) longitude.setError(body.fields.lon);
      if (body.fields?.radius_km) alert.textContent = body.fields.radius_km;
      if (!body.fields) alert.textContent = body.message;
      return;
    }
    if (response.body.locations.length === 0) {
      results.appendChild(el('p', {}, 'No matches.'));
      return;
    }
    for (const location of response.body.locations) {
      const slotHost = el('div', { class: 'stack', hidden: true });
      const toggle = el('button', { class: 'btn btn-secondary btn-small', type: 'button' }, `See demo days at ${location.name}`);
      const paint = slotRows(location, slotHost);
      toggle.addEventListener('click', async () => {
        slotHost.hidden = false;
        await paint();
      });
      results.appendChild(
        el('article', { class: 'card stack' }, [
          el('h2', { style: 'font-size:1.2rem;margin:0' }, location.name),
          el('p', { class: 'caption', style: 'margin:0' }, `${location.city}, ${location.country} — ${location.opening_hours}`),
          location.distance_km === null ? null : el('p', { style: 'margin:0' }, `${location.distance_km.toFixed(1)} km`),
          toggle,
          slotHost,
        ]),
      );
    }
  };

  search.addEventListener('click', () => void run());
  await run();
}

export async function renderEvents(main: HTMLElement): Promise<void> {
  const response = await get<{ events: EventItem[] }>('/api/events');
  main.replaceChildren(
    el('section', { class: 'band wrap stack' }, [
      el('h1', {}, 'Demo events'),
      response.ok && response.body.events.length > 0
        ? el(
            'div',
            { class: 'grid grid-3' },
            response.body.events.map((event) =>
              el('article', { class: 'card stack' }, [
                el('h2', { style: 'font-size:1.2rem;margin:0' }, event.title),
                el('p', { class: 'caption', style: 'margin:0' }, `${event.location_name}, ${event.city}`),
                el('p', { style: 'margin:0' }, `${formatEventDate(event.starts_on)} to ${formatEventDate(event.ends_on)}`),
              ]),
            ),
          )
        : el('p', {}, 'No upcoming events.'),
    ]),
  );
}
