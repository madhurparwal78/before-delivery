import { ApiRequest, errorText } from './api.js';
import { el, status, dollarsToCents, centsToDollars } from './ui.js';
import type { App } from './main.js';
import { navigate } from './main.js';
import type { RatePlan, TaxRate } from './types.js';

export async function renderRates(app: App): Promise<void> {
  const ratesStatus = status('');
  ratesStatus.setAttribute('role', 'status');
  const plansWrap = el('div', {});
  const taxWrap = el('div', {});

  const load = async () => {
    const plansRes = await ApiRequest.get('/api/rate-plans');
    plansWrap.replaceChildren();
    if (plansRes.status === 200) {
      for (const plan of plansRes.data.ratePlans as RatePlan[]) {
        const weeknight = el('input', { type: 'text', value: centsToDollars(plan.weeknightCents), 'aria-label': `${plan.name} weeknight price` }) as HTMLInputElement;
        const weekend = el('input', { type: 'text', value: centsToDollars(plan.weekendCents), 'aria-label': `${plan.name} weekend price` }) as HTMLInputElement;
        const save = el('button', { text: `Save ${plan.name}` }) as HTMLButtonElement;
        save.addEventListener('click', async () => {
          ratesStatus.textContent = 'Saving rates…';
          const res = await ApiRequest.patch(`/api/rate-plans/${plan.id}`, {
            weeknightCents: dollarsToCents(weeknight.value),
            weekendCents: dollarsToCents(weekend.value)
          });
          ratesStatus.textContent = res.status === 200 ? 'Rates saved.' : errorText(res.data) ?? 'Save failed.';
          await load();
        });
        plansWrap.append(el('div', { class: 'form-row' },
          el('h3', { text: plan.name }),
          el('div', {}, el('label', { text: 'Weeknight price' }), weeknight),
          el('div', {}, el('label', { text: 'Weekend price' }), weekend),
          save));
      }
    }
    const taxRes = await ApiRequest.get('/api/tax-rates');
    taxWrap.replaceChildren();
    if (taxRes.status === 200) {
      const table = el('table', { class: 'data', 'aria-label': 'Tax rates' });
      table.append(el('thead', {}, el('tr', {}, el('th', { text: 'Rate' }), el('th', { text: 'Starts on' }))));
      for (const rate of taxRes.data.taxRates as TaxRate[]) {
        table.append(el('tr', {},
          el('td', { text: `${Number(rate.percent).toFixed(2)}%` }),
          el('td', { text: rate.startDate ?? '—' })));
      }
      taxWrap.append(table);
    }
  };
  await load();

  const percent = el('input', { type: 'text', 'aria-label': 'Tax rate percent' }) as HTMLInputElement;
  const startsOn = el('input', { type: 'text', 'aria-label': 'Starts on' }) as HTMLInputElement;
  const saveTax = el('button', { text: 'Save tax rate' }) as HTMLButtonElement;
  saveTax.addEventListener('click', async () => {
    ratesStatus.textContent = 'Saving rates…';
    const res = await ApiRequest.post('/api/tax-rates', { percent: percent.value, startDate: startsOn.value });
    ratesStatus.textContent = res.status === 201 ? 'Rates saved.' : errorText(res.data) ?? 'Save failed.';
    await load();
  });

  const signOutBtn = el('button', { text: 'Sign out' });
  signOutBtn.addEventListener('click', async () => {
    await ApiRequest.del('/api/session');
    app.user = null;
    navigate('/');
  });
  const nav = el('nav', { 'aria-label': 'Main' });
  for (const [label, path, roles] of [
    ['Desk', '/desk', ['owner']],
    ['Guests', '/guests', ['owner', 'front_desk']],
    ['Rates', '/rates', ['owner']],
    ['Reports', '/reports', ['owner']],
    ['Board', '/board', ['owner', 'front_desk', 'housekeeper']]
  ] as Array<[string, string, string[]]>) {
    if (!app.user || !roles.includes(app.user.role)) continue;
    const a = el('a', { href: path, text: label });
    if (window.location.pathname === path) a.classList.add('current');
    a.addEventListener('click', ev => { ev.preventDefault(); navigate(path); });
    nav.append(a);
  }

  const content = el('div', { class: 'two-col' },
    el('div', {},
      el('h1', { text: 'Rates' }),
      el('h2', { text: 'Rate plans' }), plansWrap,
      el('h2', { text: 'Tax' }),
      el('div', { class: 'form-row' }, el('label', { text: 'Tax rate percent' }), percent),
      el('div', { class: 'form-row' }, el('label', { text: 'Starts on' }), startsOn),
      el('div', {}, saveTax),
      ratesStatus),
    el('div', {}, el('h2', { text: 'Tax rates' }), taxWrap));
  app.root.replaceChildren(el('div', {},
    el('div', { class: 'topbar' }, el('span', { class: 'brand', text: 'Nightroll' }), nav,
      el('span', { class: 'spacer' }), el('span', { text: app.user?.name ?? '' }), signOutBtn),
    el('main', {}, content)));
}
