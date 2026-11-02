import { api, announceStatus, el } from '../api.js';

const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  Montreal: { lat: 45.5231, lng: -73.5817 },
  'Quebec City': { lat: 46.8123, lng: -71.2145 },
  Toronto: { lat: 43.6532, lng: -79.3832 },
  Ottawa: { lat: 45.4215, lng: -75.6972 },
  Halifax: { lat: 44.6488, lng: -63.5752 },
  Calgary: { lat: 51.0447, lng: -114.0719 },
  Vancouver: { lat: 49.2827, lng: -123.1207 },
};

export async function renderStockists(): Promise<void> {
  const main = el('main', { class: 'page' });
  main.append(el('h1', { text: 'Stockists' }));
  const status = el('p', { role: 'status', 'aria-live': 'polite', 'data-region': 'stockist-results' });
  const city = el('select', { 'aria-label': 'Near', class: 'field-row' });
  for (const name of Object.keys(CITY_COORDS)) {
    city.append(el('option', { value: name, text: name }));
  }
  const results = el('ul', { 'aria-label': 'Stockists', class: 'stockist-columns', 'data-stockist-list': 'true' });
  const load = async (lat?: number, lng?: number, place?: string): Promise<void> => {
    let url = '/api/stockists';
    if (lat !== undefined && lng !== undefined) url = `/api/stockists?lat=${lat}&lng=${lng}`;
    try {
      const data = await api<{
        stockists: { name: string; address: string; city: string; province: string; distance_km: number | null }[];
      }>(url);
      results.textContent = '';
      for (const stockist of data.stockists.slice(0, 5)) {
        results.append(el('li', { class: 'stockist-item' },
          el('p', { text: `${stockist.name} - ${stockist.address}, ${stockist.city} ${stockist.province}` }),
          stockist.distance_km !== null ? el('p', { class: 'distance', text: `${stockist.distance_km.toFixed(1)} km` }) : null
        ));
      }
      const n = Math.min(5, data.stockists.length);
      announceStatus(status, `Showing ${n} stockists nearest ${place ?? 'you'}.`);
    } catch {
      announceStatus(status, "We couldn't load stockists right now.");
    }
  };
  city.addEventListener('change', () => {
    const coords = CITY_COORDS[city.value];
    void load(coords.lat, coords.lng, city.value);
  });
  const locate = el('button', { class: 'btn btn-secondary', text: 'Use my location' });
  locate.addEventListener('click', () => {
    if (!navigator.geolocation) {
      announceStatus(status, 'Location is off. Pick a city instead.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        void load(position.coords.latitude, position.coords.longitude, 'your location');
      },
      () => {
        announceStatus(status, 'Location is off. Pick a city instead.');
      }
    );
  });
  main.append(el('div', { class: 'field-row' }, city, locate), status, results);
  main.append(el('h2', { text: 'Stock Ceibo' }));
  main.append(el('p', {}, el('a', { class: 'btn btn-primary', href: '/stockists/apply', text: 'Apply to stock Ceibo' })));
  document.getElementById('app')!.append(main);
  void load(undefined, undefined, 'Montreal');
}

export function renderApply(): void {
  const main = el('main', { class: 'page narrow' });
  main.append(el('h1', { text: 'Apply to stock Ceibo' }));
  const status = el('p', { role: 'status', 'aria-live': 'polite', 'data-region': 'application-status' });
  const businessName = el('input', { 'aria-label': 'Business name', class: 'field-row' });
  const contactName = el('input', { 'aria-label': 'Contact name', class: 'field-row' });
  const email = el('input', { type: 'email', 'aria-label': 'Email', class: 'field-row' });
  const province = el('select', { 'aria-label': 'Province', class: 'field-row' },
    ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'].map((c) => el('option', { value: c, text: c })));
  const file = el('input', { type: 'file', 'aria-label': 'Business licence (PDF, PNG or JPEG)', accept: '.pdf,.png,.jpg,.jpeg' });
  file.style.width = '100%';
  const submit = el('button', { class: 'btn btn-primary', text: 'Submit application' });
  submit.addEventListener('click', async () => {
    const licence = file.files?.[0];
    const fields: Record<string, string> = {};
    if (!licence) fields.licence = 'Upload a PDF, PNG or JPEG.';
    if (businessName.value.trim().length < 2) fields.business_name = 'Enter your business name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) fields.email = 'Enter a valid email.';
    if (contactName.value.trim().length < 2) fields.contact_name = 'Enter your contact name.';
    if (Object.keys(fields).length > 0) {
      announceStatus(status, Object.values(fields)[0]);
      return;
    }
    announceStatus(status, 'Uploading your licence.');
    const form = new FormData();
    form.append('business_name', businessName.value.trim());
    form.append('contact_name', contactName.value.trim());
    form.append('email', email.value.trim());
    form.append('province', province.value);
    form.append('licence', licence!);
    try {
      const res = await fetch('/api/retailer-applications', {
        method: 'POST',
        body: form,
        credentials: 'same-origin',
      });
      const body = (await res.json()) as { application?: { id: string }; message?: string; error?: string };
      if (!res.ok || !body.application) {
        if (body.error === 'too_large') announceStatus(status, 'Licence files can be up to 5,000,000 bytes.');
        else if (body.error === 'unsupported_type') announceStatus(status, 'Upload a PDF, PNG or JPEG.');
        else if (body.error === 'files_unavailable') announceStatus(status, 'Uploads are unavailable right now. Nothing was submitted.');
        else announceStatus(status, body.message ?? 'Something went wrong. Try again.');
        return;
      }
      window.history.pushState({}, '', `/stockists/applications/${body.application.id}`);
      const { renderRoute } = await import('../app.js');
      await renderRoute();
    } catch {
      announceStatus(status, 'Uploads are unavailable right now. Nothing was submitted.');
    }
  });
  main.append(
    el('div', { class: 'field-row' }, el('label', { text: 'Business name' }), businessName),
    el('div', { class: 'field-row' }, el('label', { text: 'Contact name' }), contactName),
    el('div', { class: 'field-row' }, el('label', { text: 'Email' }), email),
    el('div', { class: 'field-row' }, el('label', { text: 'Province' }), province),
    el('div', { class: 'field-row' }, el('label', { text: 'Business licence (PDF, PNG or JPEG)' }), file),
    submit,
    status
  );
  document.getElementById('app')!.append(main);
}

export async function renderApplication(id: string): Promise<void> {
  const main = el('main', { class: 'page narrow' });
  try {
    const data = await api<{ application: { id: string; status: string; business_name: string; submitted_at: string } }>(
      `/api/retailer-applications/${id}`
    );
    main.append(el('h1', { text: 'Application received' }));
    main.append(el('p', { text: data.application.business_name }));
    const statusLabel = data.application.status[0].toUpperCase() + data.application.status.slice(1);
    main.append(el('p', { 'data-application-status': 'true', text: statusLabel }));
    main.append(el('p', { class: 'muted mono', text: new Date(data.application.submitted_at).toLocaleString() }));
  } catch {
    const { renderNotFound } = await import('../app.js');
    renderNotFound();
    return;
  }
  document.getElementById('app')!.append(main);
}
