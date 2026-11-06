import { api, ApiError, errorCopy } from './api.js';
import { h, qs, qsa, announce, openDialog, message } from './ui.js';
import { fmtDateOnly, fmtDateTime, fmtMoney, fmtMeasurement } from '../shared/bases.js';
import { member, isSessionError, sessionBanner } from './shell.js';

export function weekLabel(weekStart: string): string {
  return `Week of ${fmtDateOnly('split', weekStart)}`;
}

export function holdStatusLabel(status: string, position: number | null): string {
  if (status === 'waiting' && position !== null) return `Waiting, ${position} in line`;
  if (status === 'live') return 'Live';
  if (status === 'lapsed') return 'Lapsed';
  if (status === 'released') return 'Released';
  if (status === 'charter') return 'Charter';
  return status;
}

export function holdLapseLabel(hold: any): string {
  return hold.lapsesAt ? fmtDateTime('split', { ms: Date.parse(hold.lapsesAt) }) : '—';
}

// ---------------- staff yacht screen with availability strip and holds ----------------

export async function staffYachtScreen(ws: string, slug: string): Promise<HTMLElement> {
  const data = await api<any>(`/api/w/${ws}/yachts/${slug}`);
  const weeksData = await api<any>(`/api/w/${ws}/yachts/${slug}/weeks`);
  const y = data.yacht;
  const canHold = member!.role === 'charter_manager' || member!.role === 'fleet_director';
  const weeks = h('ul', { 'aria-label': 'Weeks', style: 'list-style:none;padding:0;display:contents' });
  const holdsTable = h('table', { 'aria-label': 'Holds on this yacht' });
  const msgBox = h('div', {});

  const placeHoldDialog = (week: any, button: HTMLElement) => {
    openDialog('Place hold', (panel, ctrl) => {
      const name = h('input', { 'aria-label': 'Client name', id: 'ph-client' });
      const errBox = h('div', {});
      const queue = week.status === 'held';
      const btn = h('button', { class: 'primary' }, queue ? 'Join the line' : 'Place hold');
      const cancel = h('button', { onclick: () => ctrl.close() }, 'Cancel');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const original = btn.textContent;
        btn.textContent = 'Placing hold';
        announce('Placing hold');
        try {
          const res = await api<any>(`/api/w/${ws}/holds`, {
            method: 'POST',
            body: JSON.stringify({ yachtSlug: slug, weekStart: week.weekStart, clientName: name.value, queue }),
          });
          ctrl.close();
          location.href = `/w/${ws}/holds/${res.hold.id}`;
        } catch (err) {
          btn.disabled = false;
          btn.textContent = original;
          const copy = errorCopy(err as ApiError, { takenAt: (err as ApiError).body?.takenAt ? fmtDateTime('split', { ms: Date.parse((err as ApiError).body.takenAt) }) : undefined });
          if (err instanceof ApiError && err.status === 401) {
            errBox.textContent = '';
            errBox.append(sessionBanner(err as ApiError));
            announce((err as ApiError).body?.error === 'access_removed' ? 'Your access to this workspace was removed. Ask your fleet director if this is a mistake.' : 'Your session has ended. Sign in again — what you typed is kept.');
            return;
          }
          if (copy.fields?.clientName) {
            errBox.textContent = '';
            errBox.append(h('p', { class: 'msg err' }, copy.fields.clientName));
          } else if (copy.message) {
            errBox.textContent = '';
            errBox.append(h('p', { class: 'msg err' }, copy.message));
            announce(copy.message);
          }
        }
      });
      panel.append(
        h('h2', {}, 'Place hold'),
        h('div', { class: 'field' }, h('label', { for: 'ph-client' }, 'Client name'), name),
        errBox,
        h('div', { style: 'display:flex;gap:0.6rem' }, btn, cancel),
      );
    });
  };

  const renderWeeks = (weeks: any[]) => {
    weeksEl.textContent = '';
    for (const w of weeks) {
      const li = h('li', { class: 'card', style: 'min-width:220px' });
      li.append(
        h('p', {}, `Week of ${fmtDateOnly('split', w.weekStart)}`),
        h('span', { class: `status-chip ${w.status}` }, w.status === 'free' ? 'Free' : w.status === 'held' ? 'Held' : 'Booked'),
        h('p', { class: 'num' }, fmtMoney(w.weeklyRateMinor, w.currency)),
      );
      if (canHold && w.status !== 'booked') {
        const btn = h('button', {}, `Hold week of ${fmtDateOnly('split', w.weekStart)}`);
        btn.addEventListener('click', () => placeHoldDialog(w, btn));
        li.append(btn);
      }
      weeksEl.append(li);
    }
  };

  const weeksEl = h('ul', { 'aria-label': 'Weeks', style: 'list-style:none;padding:0;display:contents' });
  renderWeeks(weeksData.weeks);

  const renderHolds = async () => {
    const holds = await api<any>(`/api/w/${ws}/holds?yachtSlug=${slug}`);
    const rows = [h('thead', {}, h('tr', {}, ...['Yacht', 'Week', 'Client', 'Placed by', 'Status', 'Lapses'].map((c) => h('th', { scope: 'col' }, c))))];
    const body = h('tbody', {});
    if (holds.holds.length === 0) {
      body.append(h('tr', {}, h('td', { colspan: '6' }, 'No holds yet.')));
    }
    for (const hold of holds.holds) {
      body.append(h('tr', {},
        h('td', {}, hold.yachtSlug),
        h('td', {}, fmtDateOnly('split', hold.weekStart)),
        h('td', {}, h('a', { href: `/w/${ws}/holds/${hold.id}` }, hold.clientName)),
        h('td', {}, `${hold.placedBy.name}`),
        h('td', {}, holdStatusLabel(hold.status, hold.position)),
        h('td', {}, holdLapseLabel(hold)),
      ));
    }
    rows.push(body);
    holdsTable.textContent = '';
    holdsTable.append(...rows);
  };
  await renderHolds();

  const root = h('div', {},
    h('h1', {}, y.name),
    h('p', {}, `${y.base === 'split' ? 'Split' : 'Lavrio'} · ${y.cabins} cabins · ${fmtMeasurement(y.lengthM)}`),
    h('h2', {}, 'Weeks'),
    h('div', { class: 'strip-wrap' }, h('div', { class: 'strip cards-col', tabindex: '0' }, weeksEl)),
    h('h2', {}, 'Holds on this yacht'),
    holdsTable,
    msgBox,
  );
  return root;
}

// ---------------- holds list ----------------

export async function holdsScreen(ws: string): Promise<HTMLElement> {
  const data = await api<any>(`/api/w/${ws}/holds`);
  const table = h('table', { 'aria-label': 'Holds' });
  const thead = h('thead', {}, h('tr', {}, ...['Yacht', 'Week', 'Client', 'Placed by', 'Status', 'Lapses'].map((c) => h('th', { scope: 'col' }, c))));
  const tbody = h('tbody', {});
  if (data.holds.length === 0) {
    tbody.append(h('tr', {}, h('td', { colspan: '6' }, 'No holds yet.')));
  }
  for (const hold of data.holds) {
    tbody.append(h('tr', {},
      h('td', {}, hold.yachtSlug),
      h('td', {}, fmtDateOnly('split', hold.weekStart)),
      h('td', {}, h('a', { href: `/w/${ws}/holds/${hold.id}` }, hold.clientName)),
      h('td', {}, hold.placedBy.name),
      h('td', {}, holdStatusLabel(hold.status, hold.position)),
      h('td', {}, holdLapseLabel(hold)),
    ));
  }
  table.append(thead, tbody);
  return h('div', {}, h('h1', {}, 'Holds'), table);
}

// ---------------- hold detail ----------------

export async function holdScreen(ws: string, id: string): Promise<HTMLElement> {
  const load = () => api<any>(`/api/w/${ws}/holds/${id}`);
  const data = await load();
  const hold = data.hold;
  const canAct = member!.role === 'charter_manager' || member!.role === 'fleet_director';

  const details = h('div', { class: 'card' });
  const actions = h('div', {});
  const msgBox = h('div', {});

  const render = (hold: any) => {
    details.textContent = '';
    details.append(
      h('h2', {}, `Hold for ${hold.clientName}`),
      h('p', {}, `Yacht: ${hold.yachtSlug}`),
      h('p', {}, `Week: ${fmtDateOnly('split', hold.weekStart)} to ${fmtDateOnly('split', hold.weekEnd)}`),
      h('p', {}, `Placed by: ${hold.placedBy.name}`),
      h('p', {}, 'Status: ', h('span', { class: `status-chip ${hold.status}` }, holdStatusLabel(hold.status, hold.position))),
      hold.lapsesAt ? h('p', { class: 'num' }, `Lapses ${fmtDateTime('split', { ms: Date.parse(hold.lapsesAt) })}`) : h('p', {}, 'Waiting in line'),
    );
    actions.textContent = '';
    if (canAct) {
      const record = h('button', { class: 'primary' }, 'Record deposit');
      record.disabled = hold.status !== 'live';
      record.addEventListener('click', () => recordDepositDialog(hold, record));
      const release = h('button', { class: 'danger' }, 'Release hold');
      release.disabled = !(hold.status === 'live' || hold.status === 'waiting');
      release.addEventListener('click', () => releaseDialog(hold, release));
      actions.append(record, h('div', { style: 'height:0.6rem' }), release);
      if (hold.status === 'charter' && hold.charterId) {
        actions.append(h('p', {}, h('a', { href: `/w/${ws}/charters/${hold.charterId}` }, 'Open charter')));
      }
    }
  };
  render(hold);

  const refresh = async () => {
    try {
      const fresh = await load();
      render(fresh.hold);
    } catch { /* the hold may be gone; leave the screen as it is */ }
  };
  window.setInterval(() => { void refresh(); }, 10000);

  const recordDepositDialog = (hold: any, opener: HTMLElement) => {
    openDialog('Record deposit', (panel, ctrl) => {
      const email = h('input', { type: 'email', 'aria-label': 'Client email', id: 'rd-email' });
      const radios = ['EUR', 'GBP', 'USD'].map((c, i) =>
        h('label', { style: 'display:inline-flex;gap:0.4rem;align-items:center;margin-right:1rem' },
          h('input', { type: 'radio', name: 'currency', value: c, checked: i === 0 ? '' : null }), c));
      const priceTable = h('table', { 'aria-label': 'Price' });
      const errBox = h('div', {});
      const btn = h('button', { class: 'primary' }, 'Record deposit');
      const cancel = h('button', { onclick: () => ctrl.close() }, 'Cancel');
      const loadQuote = async (currency: string) => {
        priceTable.textContent = '';
        try {
          const q = await api<any>(`/api/w/${ws}/holds/${hold.id}/quote?currency=${currency}`);
          const body = h('tbody', {});
          for (const line of q.quote.lines) {
            body.append(h('tr', {}, h('td', {}, line.label), h('td', { class: 'num' }, fmtMoney(line.amountMinor, currency))));
          }
          body.append(h('tr', {}, h('td', {}, 'Total'), h('td', { class: 'num' }, fmtMoney(q.quote.totalMinor, currency))));
          priceTable.append(h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Line'), h('th', { scope: 'col' }, 'Amount'))), body);
        } catch { /* leave the table empty */ }
      };
      void loadQuote('EUR');
      for (const r of radios) {
        (r.querySelector('input') as HTMLInputElement).addEventListener('change', (e) => {
          void loadQuote((e.target as HTMLInputElement).value);
        });
      }
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Recording deposit';
        announce('Recording deposit');
        const currency = (panel.querySelector('input[name="currency"]:checked') as HTMLInputElement).value;
        try {
          const res = await api<any>(`/api/w/${ws}/holds/${hold.id}/deposit`, {
            method: 'POST',
            body: JSON.stringify({ clientEmail: email.value, currency }),
          });
          const copy = `Deposit recorded. Charter invoiced and confirmation sent to ${email.value}.`;
          announce(copy);
          location.href = `/w/${ws}/charters/${res.charter.id}`;
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'Record deposit';
          const e = err as ApiError;
          if (e.status === 401) {
            errBox.textContent = '';
            errBox.append(sessionBanner(e));
            announce(e.body?.error === 'access_removed' ? 'Your access to this workspace was removed. Ask your fleet director if this is a mistake.' : 'Your session has ended. Sign in again — what you typed is kept.');
            return;
          }
          const copy = errorCopy(e);
          if (copy.fields?.clientEmail) {
            errBox.textContent = '';
            errBox.append(h('p', { class: 'msg err' }, copy.fields.clientEmail));
            email.setAttribute('aria-invalid', 'true');
            email.focus();
          } else if (copy.message) {
            errBox.textContent = '';
            errBox.append(h('p', { class: 'msg err' }, copy.message));
            announce(copy.message);
          }
        }
      });
      panel.append(
        h('h2', {}, 'Record deposit'),
        h('div', { class: 'field' }, h('label', { for: 'rd-email' }, 'Client email'), email),
        h('fieldset', {}, h('legend', {}, 'Currency'), ...radios),
        priceTable,
        errBox,
        h('div', { style: 'display:flex;gap:0.6rem;margin-top:0.8rem' }, btn, cancel),
      );
    });
  };

  const releaseDialog = (hold: any, opener: HTMLElement) => {
    openDialog('Release hold', (panel, ctrl) => {
      const keep = h('button', { class: 'primary', onclick: () => ctrl.close() }, 'Keep hold');
      const release = h('button', { class: 'danger' }, 'Release hold');
      const errBox = h('div', {});
      release.addEventListener('click', async () => {
        release.disabled = true;
        release.textContent = 'Releasing hold';
        announce('Releasing hold');
        try {
          await api(`/api/w/${ws}/holds/${hold.id}/release`, { method: 'POST' });
          const copy = 'Hold released.';
          announce(copy);
          ctrl.close();
          await refresh();
        } catch (err) {
          release.disabled = false;
          release.textContent = 'Release hold';
          const e = err as ApiError;
          if (e.status === 401) {
            errBox.textContent = '';
            errBox.append(sessionBanner(e));
            return;
          }
          const lapsedAt = e.body?.lapsedAt ? fmtDateTime('split', { ms: Date.parse(e.body.lapsedAt) }) : undefined;
          const copy = errorCopy(e, { lapsedAt });
          errBox.textContent = '';
          errBox.append(h('p', { class: 'msg err' }, copy.message));
          announce(copy.message);
        }
      });
      panel.append(
        h('h2', {}, 'Release hold'),
        h('p', {}, `Release the hold for ${hold.clientName}?`),
        errBox,
        h('div', { style: 'display:flex;gap:0.6rem;margin-top:0.8rem' }, keep, release),
      );
    });
  };

  return h('div', { class: 'two-col' },
    h('div', {}, h('h1', {}, `Hold for ${hold.clientName}`), details, msgBox),
    h('div', {}, actions),
  );
}
