import { api, ApiError, errorCopy } from './api.js';
import { h, qs, qsa, announce, openDialog } from './ui.js';
import { fmtDateOnly, fmtDateTime, fmtMoney, fmtMeasurement } from '../shared/bases.js';
import { member } from './shell.js';

// ---------------- fleet (staff) ----------------

export async function fleetScreenStaff(ws: string): Promise<HTMLElement> {
  const data = await api<any>(`/api/w/${ws}/yachts`);
  const list = h('ul', { 'aria-label': 'Yachts', style: 'list-style:none;padding:0' });
  const isDirector = member!.role === 'fleet_director';
  for (const y of data.yachts) {
    list.append(h('li', { class: 'card', style: 'display:flex;gap:0.8rem;align-items:center;flex-wrap:wrap' },
      h('span', { style: 'flex:1' },
        h('a', { href: `/w/${ws}/yachts/${y.slug}` }, y.name),
        h('span', { class: 'num', style: 'margin-left:0.6rem' }, `${y.base} · ${y.cabins} cabins · ${fmtMeasurement(y.lengthM)}`),
        h('span', { class: `status-chip ${y.status}`, style: 'margin-left:0.6rem' }, y.status === 'on_sale' ? 'On sale' : 'Withdrawn'),
      ),
      h('a', { href: `/w/${ws}/yachts/${y.slug}` }, 'Weeks'),
      isDirector ? h('a', { href: `/w/${ws}/yachts/${y.slug}/profile` }, 'Profile') : h('span', {}),
    ));
  }
  return h('div', {}, h('h1', {}, 'Fleet'), list);
}

// ---------------- yacht profile ----------------

export async function profileScreen(ws: string, slug: string): Promise<HTMLElement> {
  const data = await api<any>(`/api/w/${ws}/yachts/${slug}`);
  const y = data.yacht;
  const problems = h('div', { role: 'region', 'aria-label': 'Problems', class: 'problems', style: 'display:none' }, h('h2', {}, 'Problems'));
  const name = h('input', { 'aria-label': 'Name', value: y.name });
  const cabins = h('input', { type: 'number', 'aria-label': 'Cabins', value: String(y.cabins), min: '2', max: '6' });
  const length = h('input', { 'aria-label': 'Length (m)', value: String(y.lengthM) });
  const beam = h('input', { 'aria-label': 'Beam (m)', value: String(y.beamM) });
  const draft = h('input', { 'aria-label': 'Draft (m)', value: String(y.draftM) });
  const low = h('input', { 'aria-label': 'Low season weekly rate (EUR)', value: (y.rates.lowMinor / 100).toFixed(2) });
  const shoulder = h('input', { 'aria-label': 'Shoulder season weekly rate (EUR)', value: (y.rates.shoulderMinor / 100).toFixed(2) });
  const high = h('input', { 'aria-label': 'High season weekly rate (EUR)', value: (y.rates.highMinor / 100).toFixed(2) });
  const msgBox = h('div', {});
  const preview = h('div', { class: 'card' });

  const renderPreview = () => {
    preview.textContent = '';
    preview.append(
      h('h2', {}, 'Figures preview'),
      h('p', { class: 'num' }, `Length ${fmtMeasurement(length.value)}`),
      h('p', { class: 'num' }, `Beam ${fmtMeasurement(beam.value)}`),
      h('p', { class: 'num' }, `Draft ${fmtMeasurement(draft.value)}`),
      h('p', { class: 'num' }, `Low season ${fmtMoney(Math.round(Number(low.value) * 100), 'EUR')} a week`),
      h('p', { class: 'num' }, `Shoulder season ${fmtMoney(Math.round(Number(shoulder.value) * 100), 'EUR')} a week`),
      h('p', { class: 'num' }, `High season ${fmtMoney(Math.round(Number(high.value) * 100), 'EUR')} a week`),
    );
  };
  renderPreview();
  for (const el of [length, beam, draft, low, shoulder, high]) {
    el.addEventListener('input', renderPreview);
  }

  const statusBox = h('div', { class: 'card' });
  const renderStatus = () => {
    statusBox.textContent = '';
    statusBox.append(h('h2', {}, 'Status'), h('p', {}, y.status === 'on_sale' ? 'On sale' : 'Withdrawn'));
    const toggle = h('button', { class: y.status === 'on_sale' ? 'danger' : 'primary' }, y.status === 'on_sale' ? 'Withdraw yacht' : 'Put back on sale');
    toggle.addEventListener('click', () => {
      const action = y.status === 'on_sale' ? 'withdraw' : 'return-to-sale';
      const label = y.status === 'on_sale' ? 'Withdraw yacht' : 'Put back on sale';
      openDialog(label, (panel, ctrl) => {
        const cancel = h('button', { class: 'primary', onclick: () => ctrl.close() }, 'Cancel');
        const confirm = h('button', { class: y.status === 'on_sale' ? 'danger' : 'primary' }, label);
        const err2 = h('div', {});
        confirm.addEventListener('click', async () => {
          confirm.disabled = true;
          confirm.textContent = 'Working';
          try {
            await api(`/api/w/${ws}/yachts/${slug}/${action}`, { method: 'POST' });
            const copy = y.status === 'on_sale' ? `${y.name} withdrawn from sale.` : `${y.name} is back on sale.`;
            announce(copy);
            ctrl.close();
            location.reload();
          } catch (err) {
            const e = err as ApiError;
            confirm.disabled = false;
            confirm.textContent = label;
            const copy = errorCopy(e);
            err2.textContent = '';
            err2.append(h('p', { class: 'msg err' }, copy.message));
            announce(copy.message);
          }
        });
        panel.append(h('h2', {}, label), h('p', {}, y.status === 'on_sale' ? `Withdraw ${y.name} from sale?` : `Put ${y.name} back on sale?`), err2, h('div', { style: 'display:flex;gap:0.6rem;margin-top:0.8rem' }, cancel, confirm));
      });
    });
    statusBox.append(toggle);
  };
  renderStatus();

  const save = h('button', { class: 'primary' }, 'Save profile');
  save.addEventListener('click', async () => {
    const errors: Record<string, string> = {};
    if (!name.value.trim()) errors.name = 'This field is required.';
    else if ([...name.value].length > 80) errors.name = 'Use at most 80 characters.';
    const cabinsN = Number(cabins.value);
    if (!Number.isInteger(cabinsN) || cabinsN < 2 || cabinsN > 6) errors.cabins = 'Enter a whole number from 2 to 6.';
    for (const [el, key, min, max, label] of [
      [length, 'lengthM', '8.00', '40.00', 'Length (m)'],
      [beam, 'beamM', '3.00', '15.00', 'Beam (m)'],
      [draft, 'draftM', '0.50', '3.00', 'Draft (m)'],
    ] as Array<[HTMLInputElement, string, string, string, string]>) {
      if (!/^\d{1,2}(\.\d{1,2})?$/.test(el.value)) errors[key] = /^\d+(\.\d{3,})?$/.test(el.value) ? 'Use at most two decimals.' : 'This field is required.';
      else if (Number(el.value) < Number(min) || Number(el.value) > Number(max)) errors[key] = `Enter a number from ${min} to ${max}.`;
    }
    for (const [el, key, label] of [
      [low, 'rates.lowMinor', 'Low season weekly rate (EUR)'],
      [shoulder, 'rates.shoulderMinor', 'Shoulder season weekly rate (EUR)'],
      [high, 'rates.highMinor', 'High season weekly rate (EUR)'],
    ] as Array<[HTMLInputElement, string, string]>) {
      if (!/^\d+(\.\d{1,2})?$/.test(el.value)) errors[key] = 'This field is required.';
      else if (Number(el.value) < 1000 || Number(el.value) > 1000000) errors[key] = 'Enter an amount from EUR 1,000.00 to EUR 1,000,000.00.';
    }
    if (Object.keys(errors).length > 0) {
      problems.style.display = '';
      problems.textContent = '';
      problems.append(h('h2', {}, 'Problems'));
      const fieldEls: Record<string, HTMLInputElement> = { name, cabins, lengthM: length, beamM: beam, draftM: draft, 'rates.lowMinor': low, 'rates.shoulderMinor': shoulder, 'rates.highMinor': high };
      for (const [field, msg] of Object.entries(errors)) {
        const target = fieldEls[field];
        problems.append(h('p', {}, h('a', {
          href: '#',
          onclick: (e: Event) => { e.preventDefault(); target.setAttribute('aria-invalid', 'true'); target.focus(); },
        }, `${labelOf(field)}: ${msg}`)));
      }
      return;
    }
    problems.style.display = 'none';
    save.disabled = true;
    save.textContent = 'Saving profile';
    announce('Saving profile');
    try {
      await api(`/api/w/${ws}/yachts/${slug}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: name.value,
          cabins: cabinsN,
          lengthM: length.value,
          beamM: beam.value,
          draftM: draft.value,
          rates: {
            lowMinor: Math.round(Number(low.value) * 100),
            shoulderMinor: Math.round(Number(shoulder.value) * 100),
            highMinor: Math.round(Number(high.value) * 100),
          },
        }),
      });
      const copy = 'Profile saved.';
      message('ok', copy, msgBox);
      announce(copy);
    } catch (err) {
      const e = err as ApiError;
      if (e.status === 401) {
        msgBox.textContent = '';
        msgBox.append(h('div', { class: 'msg err', role: 'alert' },
          h('span', {}, e.body?.error === 'access_removed' ? 'Your access to this workspace was removed. Ask your fleet director if this is a mistake.' : 'Your session has ended. Sign in again — what you typed is kept.' + ' '),
          h('a', { href: `/sign-in?returnTo=${encodeURIComponent(location.pathname)}` }, 'Sign in again')));
        announce('Your session has ended. Sign in again — what you typed is kept.');
        return;
      }
      const copy = errorCopy(e);
      if (copy.fields) {
        problems.style.display = '';
        problems.textContent = '';
        problems.append(h('h2', {}, 'Problems'));
        const fieldEls: Record<string, HTMLInputElement> = { name, cabins, lengthM: length, beamM: beam, draftM: draft, 'rates.lowMinor': low, 'rates.shoulderMinor': shoulder, 'rates.highMinor': high };
        for (const [field, msg] of Object.entries(copy.fields)) {
          const target = fieldEls[field];
          if (target) {
            target.setAttribute('aria-invalid', 'true');
            problems.append(h('p', {}, h('a', { href: '#', onclick: (ev: Event) => { ev.preventDefault(); target.focus(); } }, `${labelOf(field)}: ${msg}`)));
          }
        }
      } else {
        message('err', copy.message, msgBox);
        announce(copy.message);
      }
    } finally {
      save.disabled = false;
      save.textContent = 'Save profile';
    }
  });

  const form = h('form', { novalidate: true, onsubmit: (e: Event) => e.preventDefault() },
    problems,
    h('div', { class: 'field' }, h('label', {}, 'Name'), name),
    h('div', { class: 'field' }, h('label', {}, 'Cabins'), cabins),
    h('div', { class: 'field' }, h('label', {}, 'Length (m)'), length),
    h('div', { class: 'field' }, h('label', {}, 'Beam (m)'), beam),
    h('div', { class: 'field' }, h('label', {}, 'Draft (m)'), draft),
    h('div', { class: 'field' }, h('label', {}, 'Low season weekly rate (EUR)'), low),
    h('div', { class: 'field' }, h('label', {}, 'Shoulder season weekly rate (EUR)'), shoulder),
    h('div', { class: 'field' }, h('label', {}, 'High season weekly rate (EUR)'), high),
    msgBox,
    save,
  );

  const sticky = h('div', { class: 'stickybar' }, save);
  return h('div', { class: 'two-col' },
    h('div', {}, h('h1', {}, `${y.name} profile`), form),
    h('div', {}, preview, h('div', { style: 'height:1rem' }), statusBox),
  );
}

function labelOf(field: string): string {
  const map: Record<string, string> = {
    name: 'Name', cabins: 'Cabins', lengthM: 'Length (m)', beamM: 'Beam (m)', draftM: 'Draft (m)',
    'rates.lowMinor': 'Low season weekly rate (EUR)', 'rates.shoulderMinor': 'Shoulder season weekly rate (EUR)', 'rates.highMinor': 'High season weekly rate (EUR)',
  };
  return map[field] ?? field;
}

function message(kind: 'ok' | 'err', text: string, box: HTMLElement): void {
  box.textContent = '';
  box.append(h('p', { class: `msg ${kind}`, role: 'status' }, text));
}

// ---------------- brokers ----------------

export async function brokersScreen(ws: string): Promise<HTMLElement> {
  const data = await api<any>(`/api/w/${ws}/brokers`);
  const table = h('table', { 'aria-label': 'Brokers' });
  const tbody = h('tbody', {});
  if (data.brokers.length === 0) {
    tbody.append(h('tr', {}, h('td', { colspan: '3' }, 'No brokers yet.')));
  }
  for (const b of data.brokers) {
    const pageCell = h('td', {},
      b.page.status === 'live' ? `Live until ${fmtDateTime('split', { ms: Date.parse(b.page.endsAt) })}` : b.page.status === 'ended' ? 'Ended' : 'No page');
    const actions = h('span', { style: 'white-space:nowrap' });
    const issue = h('button', { class: 'primary' }, `Issue broker page for ${b.name}`);
    issue.addEventListener('click', () => {
      openDialog('Issue broker page', (panel, ctrl) => {
        const cancel = h('button', { class: 'primary', onclick: () => ctrl.close() }, 'Cancel');
        const confirm = h('button', { class: 'primary' }, 'Issue page');
        const err2 = h('div', {});
        confirm.addEventListener('click', async () => {
          confirm.disabled = true;
          confirm.textContent = 'Sending page';
          announce('Sending page');
          try {
            await api(`/api/w/${ws}/brokers/${b.id}/page`, { method: 'POST', body: JSON.stringify({}) });
            const copy = `Broker page sent to ${b.email}.`;
            announce(copy);
            ctrl.close();
            location.reload();
          } catch (err) {
            const e = err as ApiError;
            confirm.disabled = false;
            confirm.textContent = 'Issue page';
            const copy = errorCopy(e);
            err2.textContent = '';
            err2.append(h('p', { class: 'msg err' }, copy.message));
            announce(copy.message);
          }
        });
        panel.append(h('h2', {}, 'Issue broker page'), h('p', {}, `Issue a new broker page for ${b.name}?`), h('p', {}, 'Any earlier page for this broker ends at once.'), err2, h('div', { style: 'display:flex;gap:0.6rem;margin-top:0.8rem' }, cancel, confirm));
      });
    });
    actions.append(issue);
    if (b.page.status === 'live') {
      const end = h('button', { class: 'danger', style: 'margin-left:0.5rem' }, `End broker page for ${b.name}`);
      end.addEventListener('click', () => {
        openDialog('End broker page', (panel, ctrl) => {
          const keep = h('button', { class: 'primary', onclick: () => ctrl.close() }, 'Keep page');
          const confirm = h('button', { class: 'danger' }, 'End page');
          const err2 = h('div', {});
          confirm.addEventListener('click', async () => {
            confirm.disabled = true;
            confirm.textContent = 'Ending page';
            announce('Ending page');
            try {
              await api(`/api/w/${ws}/brokers/${b.id}/page/end`, { method: 'POST' });
              announce('Page ended.');
              ctrl.close();
              location.reload();
            } catch (err) {
              const e = err as ApiError;
              confirm.disabled = false;
              confirm.textContent = 'End page';
              const copy = errorCopy(e);
              err2.textContent = '';
              err2.append(h('p', { class: 'msg err' }, copy.message));
              announce(copy.message);
            }
          });
          panel.append(h('h2', {}, 'End broker page'), h('p', {}, `End the broker page for ${b.name}?`), err2, h('div', { style: 'display:flex;gap:0.6rem;margin-top:0.8rem' }, keep, confirm));
        });
      });
      actions.append(end);
    }
    pageCell.append(actions);
    tbody.append(h('tr', {},
      h('td', {}, b.name),
      h('td', {}, b.contactName),
      pageCell,
    ));
  }
  table.append(h('thead', {}, h('tr', {}, ...['Broker', 'Contact', 'Page'].map((c) => h('th', { scope: 'col' }, c)))), tbody);
  return h('div', {}, h('h1', {}, 'Brokers'), table);
}

// ---------------- tariffs ----------------

export async function tariffsScreen(ws: string): Promise<HTMLElement> {
  const [marinasData, exchangeData] = await Promise.all([
    api<any>(`/api/w/${ws}/marinas`),
    api<any>(`/api/w/${ws}/exchange-tables`),
  ]);
  const tariffsTable = h('table', { 'aria-label': 'Marina tariffs' });
  {
    const tbody = h('tbody', {});
    for (const m of marinasData.marinas) {
      for (const t of m.tariffs) {
        tbody.append(h('tr', {}, h('td', {}, m.name), h('td', {}, t.effectiveDate), h('td', { class: 'num' }, fmtMoney(t.ratePerMetreMinor, t.currency))));
      }
    }
    if (tbody.children.length === 0) tbody.append(h('tr', {}, h('td', { colspan: '3' }, 'No tariffs yet.')));
    tariffsTable.append(h('thead', {}, h('tr', {}, ...['Marina', 'From', 'Rate per metre per night'].map((c) => h('th', { scope: 'col' }, c)))), tbody);
  }
  const exchangeTable = h('table', { 'aria-label': 'Exchange tables' });
  {
    const tbody = h('tbody', {});
    for (const t of exchangeData.exchangeTables) {
      tbody.append(h('tr', {}, h('td', {}, t.effectiveDate), h('td', { class: 'num' }, t.rates.GBP), h('td', { class: 'num' }, t.rates.USD)));
    }
    if (tbody.children.length === 0) tbody.append(h('tr', {}, h('td', { colspan: '3' }, 'No exchange tables yet.')));
    exchangeTable.append(h('thead', {}, h('tr', {}, ...['From', 'EUR to GBP', 'EUR to USD'].map((c) => h('th', { scope: 'col' }, c)))), tbody);
  }
  const msgBox = h('div', {});
  const addTariff = h('button', { class: 'primary' }, 'Add tariff');
  addTariff.addEventListener('click', () => {
    openDialog('Add tariff', (panel, ctrl) => {
      const marina = h('select', { 'aria-label': 'Marina' });
      for (const m of marinasData.marinas) marina.append(h('option', { value: m.id }, m.name));
      marina.value = 'split-marina';
      const dateEl = h('input', { type: 'text', 'aria-label': 'Effective date', placeholder: 'YYYY-MM-DD' });
      const rate = h('input', { type: 'text', 'aria-label': 'Rate per metre per night (EUR)', placeholder: '4.50' });
      const err2 = h('div', {});
      const btn = h('button', { class: 'primary' }, 'Add tariff');
      const cancel = h('button', { onclick: () => ctrl.close() }, 'Cancel');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Adding tariff';
        announce('Adding tariff');
        try {
          await api(`/api/w/${ws}/marinas/${marina.value}/tariffs`, {
            method: 'POST',
            body: JSON.stringify({ effectiveDate: dateEl.value, ratePerMetreMinor: Math.round(Number(rate.value) * 100) }),
          });
          const copy = `Tariff added from ${dateEl.value}.`;
          announce(copy);
          ctrl.close();
          location.reload();
        } catch (err) {
          const e = err as ApiError;
          btn.disabled = false;
          btn.textContent = 'Add tariff';
          const copy = errorCopy(e);
          err2.textContent = '';
          err2.append(h('p', { class: 'msg err' }, copy.message));
          announce(copy.message);
        }
      });
      panel.append(
        h('h2', {}, 'Add tariff'),
        h('div', { class: 'field' }, h('label', {}, 'Marina'), marina),
        h('div', { class: 'field' }, h('label', {}, 'Effective date'), dateEl),
        h('div', { class: 'field' }, h('label', {}, 'Rate per metre per night (EUR)'), rate),
        err2,
        h('div', { style: 'display:flex;gap:0.6rem' }, btn, cancel),
      );
    });
  });
  const addExchange = h('button', { class: 'primary' }, 'Add exchange table');
  addExchange.addEventListener('click', () => {
    openDialog('Add exchange table', (panel, ctrl) => {
      const dateEl = h('input', { type: 'text', 'aria-label': 'Effective date', placeholder: 'YYYY-MM-DD' });
      const gbp = h('input', { type: 'text', 'aria-label': 'EUR to GBP', placeholder: '0.8700' });
      const usd = h('input', { type: 'text', 'aria-label': 'EUR to USD', placeholder: '1.1500' });
      const err2 = h('div', {});
      const btn = h('button', { class: 'primary' }, 'Add exchange table');
      const cancel = h('button', { onclick: () => ctrl.close() }, 'Cancel');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Adding exchange table';
        announce('Adding exchange table');
        try {
          await api(`/api/w/${ws}/exchange-tables`, {
            method: 'POST',
            body: JSON.stringify({ effectiveDate: dateEl.value, rates: { GBP: gbp.value, USD: usd.value } }),
          });
          const copy = `Exchange table added from ${dateEl.value}.`;
          announce(copy);
          ctrl.close();
          location.reload();
        } catch (err) {
          const e = err as ApiError;
          btn.disabled = false;
          btn.textContent = 'Add exchange table';
          const copy = errorCopy(e);
          err2.textContent = '';
          err2.append(h('p', { class: 'msg err' }, copy.message));
          announce(copy.message);
        }
      });
      panel.append(
        h('h2', {}, 'Add exchange table'),
        h('div', { class: 'field' }, h('label', {}, 'Effective date'), dateEl),
        h('div', { class: 'field' }, h('label', {}, 'EUR to GBP'), gbp),
        h('div', { class: 'field' }, h('label', {}, 'EUR to USD'), usd),
        err2,
        h('div', { style: 'display:flex;gap:0.6rem' }, btn, cancel),
      );
    });
  });
  return h('div', { class: 'two-col' },
    h('div', {}, h('h1', {}, 'Tariffs and exchange tables'), h('h2', {}, 'Marina tariffs'), tariffsTable, h('div', { style: 'height:0.8rem' }), addTariff),
    h('div', {}, h('h2', {}, 'Exchange tables'), exchangeTable, h('div', { style: 'height:0.8rem' }), addExchange, msgBox),
  );
}
