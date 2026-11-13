// The hire desk: stock form, holds table, quotes, confirm and countdowns (DP-18 to DP-27).

import { h, clear, announce, showProblem, hideProblem, statusRegion, COPY } from './ui.js';
import { api, idempotencyKey, formatCents, formatMmSS, subscribe } from './app.js';
import { route } from './main.js';

export async function renderHire(shell, band) {
  const holds = await api.get('/api/holds');
  shell.append(nav('/hire'));

  const heading = h('h1', { class: 'sentence' });
  const slot = h('span', { class: 'slot', 'aria-hidden': 'true' }, `${holds.items.filter((h) => h.status === 'Held').length} on hold`);
  const heldCount = holds.items.filter((h) => h.status === 'Held').length;
  heading.append(
    heldCount === 1 ? '1 BODY ON HOLD' : `${heldCount} BODIES ON HOLD`,
    slot);
  shell.append(heading);

  const evidence = h('div', { class: 'two-col' });
  const left = h('div');
  const right = h('div');
  const status = statusRegion('Hire');

  // stock form
  const model = h('input', { type: 'text', 'aria-label': 'Model', placeholder: 'VK-20' });
  const firstDay = h('input', { type: 'text', 'aria-label': 'First day', placeholder: '2027-02-12' });
  const days = h('input', { type: 'number', 'aria-label': 'Days', value: '2', min: '1', max: '7', step: '1', role: 'spinbutton', 'aria-valuenow': '2', 'aria-valuemin': '1', 'aria-valuemax': '7' });
  const stockResult = statusRegion('Stock');
  const check = h('button', {
    onclick: async () => {
      hideProblem(band);
      clear(stockResult);
      try {
        const stock = await api.get(`/api/hire/stock?model=${encodeURIComponent(model.value)}&from=${firstDay.value}&days=${days.value}`);
        stockResult.textContent = `${stock.model}: ${stock.available} free, ${formatCents(stock.dayRateCents)} a day`;
      } catch (err) {
        showProblem(band, err.problem ?? err);
      }
    },
  }, 'Check stock');
  const ask = h('button', {
    onclick: async () => {
      hideProblem(band);
      announce(status, COPY.hirePending);
      try {
        await api.post('/api/holds', { model: model.value, from: firstDay.value, days: Number(days.value) }, { headers: { 'Idempotency-Key': idempotencyKey('ask', model.value + firstDay.value + days.value) } });
        route('/hire');
      } catch (err) {
        const problem = err.problem ?? err;
        showProblem(band, problem);
        clear(status);
      }
    },
  }, 'Ask for a hold');

  const stockForm = h('form', { 'aria-label': 'Check stock', onsubmit: (e) => { e.preventDefault(); } },
    h('div', {}, h('label', {}, 'Model'), model),
    h('div', { class: 'row' },
      h('div', { class: 'grow' }, h('label', {}, 'First day'), firstDay),
      h('div', { style: 'flex:0 0 110px' }, h('label', {}, 'Days'), days)),
    h('div', { class: 'row' }, check, ask), stockResult);

  // holds table
  const table = h('table', { 'aria-label': 'Holds' });
  table.append(h('thead', {}, h('tr', {}, h('th', {}, 'Model'), h('th', {}, 'Dates'), h('th', {}, 'Status'), h('th', {}, 'Countdown'), h('th', {}, ''))));
  const body = h('tbody');
  for (const hold of holds.items) {
    const countdown = statusRegion(`Countdown ${hold.id}`);
    body.append(h('tr', {},
      h('td', {}, hold.model),
      h('td', {}, `${hold.from} + ${hold.days}d`),
      h('td', {}, hold.status),
      h('td', {}, countdown),
      h('td', {},
        h('button', {
          onclick: async () => {
            hideProblem(band);
            try {
              const quote = await api.post(`/api/holds/${hold.id}/quote`);
              announce(status, COPY.hireQuote(formatCents(quote.totalCents)));
            } catch (err) {
              showProblem(band, err.problem ?? err);
            }
          },
        }, `Quote ${hold.id}`),
        h('button', {
          onclick: async () => {
            hideProblem(band);
            try {
              const confirmed = await api.post(`/api/holds/${hold.id}/confirm`, {}, { headers: { 'Idempotency-Key': idempotencyKey('confirm', hold.id) } });
              announce(status, COPY.hireHired(confirmed.serial));
              route('/hire');
            } catch (err) {
              const problem = err.problem ?? err;
              showProblem(band, problem);
              if (problem.code === 'hold_lapsed') announce(status, COPY.hireLapsed);
            }
          },
        }, `Confirm ${hold.id}`),
        h('button', {
          onclick: async () => {
            hideProblem(band);
            try {
              await api.post(`/api/holds/${hold.id}/release`, {}, { headers: { 'Idempotency-Key': idempotencyKey('release', hold.id) } });
              announce(status, COPY.hireReleased);
              route('/hire');
            } catch (err) {
              showProblem(band, err.problem ?? err);
            }
          },
        }, `Release ${hold.id}`))));
    startCountdown(hold, countdown);
  }
  table.append(body);
  left.append(table, status);
  right.append(stockForm);

  evidence.append(left, right);
  shell.append(evidence);

  subscribe((event) => {
    if (event.type === 'hold.changed') route('/hire');
  });
}

// Countdown text derives from remainingSeconds as last returned, ticking on elapsed
// monotonic time, re-read at least every 30 seconds and on every hold.changed.
function startCountdown(hold, element) {
  let remaining = hold.remainingSeconds;
  let lastRead = performance.now();
  clear(element);
  if (hold.status === 'Held') element.textContent = COPY.hireHeld(formatMmSS(remaining));
  else element.textContent = '';
  const timer = setInterval(async () => {
    const now = performance.now();
    if (hold.status !== 'Held') {
      clearInterval(timer);
      return;
    }
    remaining = Math.max(0, remaining - Math.round((now - lastRead) / 1000));
    lastRead = now;
    if (now - start > 30000) {
      try {
        const fresh = await api.get(`/api/holds/${hold.id}`);
        remaining = fresh.remainingSeconds;
        lastRead = performance.now();
      } catch {
        // the next tick retries
      }
    }
    element.textContent = COPY.hireHeld(formatMmSS(remaining));
  }, 1000);
  const start = performance.now();
  timer.unref?.();
}

function nav(current) {
  const links = [
    { href: '/sites', label: 'Walls' },
    { href: '/kit', label: 'Shelf' },
    { href: '/hire', label: 'Hire' },
  ];
  return h('nav', { class: 'landmark', 'aria-label': 'Workspace' },
    links.map((link) => h('a', { href: link.href, 'data-link': '', 'aria-current': link.href === current ? 'page' : null }, link.label)));
}
