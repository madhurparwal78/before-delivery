// Clinchline browser API client.
const api = {
  async call(method, path, body, opts) {
    const headers = {};
    if (opts && opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
    let payload;
    if (body !== undefined) {
      if (opts && opts.raw) {
        headers['Content-Type'] = opts.contentType || 'application/octet-stream';
        payload = body;
      } else {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
      }
    }
    const res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) data = await res.json().catch(() => null);
    return { status: res.status, data, headers: res.headers };
  },
  get(path) { return api.call('GET', path); },
  post(path, body, opts) { return api.call('POST', path, body, opts); },
  put(path, body, opts) { return api.call('PUT', path, body, opts); },
  patch(path, body, opts) { return api.call('PATCH', path, body, opts); },
  del(path) { return api.call('DELETE', path); }
};

function money(cents) {
  if (cents === null || cents === undefined) return '';
  const v = Math.abs(cents);
  return (cents < 0 ? '−' : '') + '$' + (v / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function signedDiff(v) {
  const d = Math.round(v * 10) / 10;
  if (d === 0) return '±0.0';
  return (d > 0 ? '+' : '−') + Math.abs(d).toFixed(1);
}

function angle(v) { return (Math.round(v * 10) / 10).toFixed(1); }

const HOOF_LABELS = { LF: 'Left fore', RF: 'Right fore', LH: 'Left hind', RH: 'Right hind' };
const HOOF_ORDER = ['LF', 'RF', 'LH', 'RH'];
const SERVICE_LABELS = {
  trim: 'Trim', front_reset: 'Front shoes, reset', full_reset: 'Full set, reset',
  front_new: 'Front shoes, new', full_new: 'Full set, new'
};
const SERVICE_ORDER = ['trim', 'front_reset', 'full_reset', 'front_new', 'full_new'];
const CARDS = [
  ['tok_approve_4242', 'Test card 4242 (approves)'],
  ['tok_decline_0002', 'Test card 0002 (declines)'],
  ['tok_funds_9995', 'Test card 9995 (insufficient funds)']
];
