import { api, ApiError, errorCopy } from './api.js';
import { h, qs, announce, openDialog } from './ui.js';
import { fmtDateOnly, fmtDateTime, fmtMoney } from '../shared/bases.js';
import { member, isSessionError, sessionBanner } from './shell.js';

export async function chartersScreen(ws: string): Promise<HTMLElement> {
  const data = await api<any>(`/api/w/${ws}/charters`);
  const table = h('table', { 'aria-label': 'Charters' });
  const thead = h('thead', {}, h('tr', {}, ...['Yacht', 'Week', 'Client', 'Total', 'Invoice'].map((c) => h('th', { scope: 'col' }, c))));
  const tbody = h('tbody', {});
  if (data.charters.length === 0) {
    tbody.append(h('tr', {}, h('td', { colspan: '5' }, 'No charters yet.')));
  }
  for (const c of data.charters) {
    tbody.append(h('tr', {},
      h('td', {}, c.yachtSlug),
      h('td', {}, fmtDateOnly('split', c.weekStart)),
      h('td', {}, h('a', { href: `/w/${ws}/charters/${c.id}` }, c.clientName)),
      h('td', { class: 'num' }, fmtMoney(c.totalMinor, c.currency)),
      h('td', {}, c.invoiceStatus === 'invoiced' ? 'Invoiced' : 'Not invoiced'),
    ));
  }
  table.append(thead, tbody);
  return h('div', {}, h('h1', {}, 'Charters'), table);
}

export async function charterScreen(ws: string, id: string): Promise<HTMLElement> {
  const [charterRes, manifestRes] = await Promise.all([
    api<any>(`/api/w/${ws}/charters/${id}`),
    api<any>(`/api/w/${ws}/charters/${id}/manifest`),
  ]);
  const charter = charterRes.charter;
  const manifest = manifestRes;
  const canManifest = member!.role === 'charter_manager' || member!.role === 'fleet_director';
  const canClose = member!.role === 'captain' || member!.role === 'fleet_director';
  const seesPassport = member!.role === 'captain' || member!.role === 'fleet_director';

  const lines = h('table', { 'aria-label': 'Charter lines' });
  {
    const tbody = h('tbody', {});
    for (const line of charter.lines) {
      tbody.append(h('tr', {},
        h('td', {}, line.label),
        h('td', { class: 'num' }, fmtMoney(line.eurMinor, 'EUR')),
        h('td', { class: 'num' }, fmtMoney(line.amountMinor, charter.currency)),
      ));
    }
    tbody.append(h('tr', {},
      h('td', {}, 'Total'),
      h('td', { class: 'num' }, fmtMoney(charter.totalEurMinor, 'EUR')),
      h('td', { class: 'num' }, fmtMoney(charter.totalMinor, charter.currency)),
    ));
    lines.append(h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Line'), h('th', { scope: 'col' }, 'EUR'), h('th', { scope: 'col' }, charter.currency))), tbody);
  }

  const guests = h('table', { 'aria-label': 'Guests' });
  const renderGuests = () => {
    const cols = seesPassport ? ['Name', 'Nationality', 'Date of birth', 'Passport number', 'Photo'] : ['Name'];
    const tbody = h('tbody', {});
    if ((manifest.guests ?? []).length === 0) {
      tbody.append(h('tr', {}, h('td', { colspan: String(cols.length) }, 'No guests yet.')));
    }
    for (const g of manifest.guests ?? []) {
      const row = h('tr', {}, h('td', {}, g.fullName));
      if (seesPassport) {
        row.append(
          h('td', {}, g.nationality ?? '—'),
          h('td', { class: 'num' }, g.dateOfBirth ?? '—'),
          h('td', { class: 'num' }, g.passportNumber ?? '—'),
          h('td', {}, g.photo ? h('a', { href: `/api/w/${ws}/charters/${id}/manifest/guests/${g.id}/photo` }, `Photo of ${g.fullName}`) : '—'),
        );
      }
      tbody.append(row);
    }
    guests.textContent = '';
    guests.append(h('thead', {}, h('tr', {}, ...cols.map((c) => h('th', { scope: 'col' }, c)))), tbody);
  };
  renderGuests();

  const pageStatus = manifest.page
    ? manifest.page.status === 'live'
      ? `Manifest page live until ${fmtDateTime('split', { ms: Date.parse(manifest.page.endsAt) })}`
      : manifest.page.status === 'ended' ? 'Manifest page ended' : 'No manifest page sent'
    : 'No manifest page sent';

  const manifestActions = h('div', {});
  if (canManifest) {
    const send = h('button', { class: 'primary' }, 'Send manifest page');
    send.addEventListener('click', () => {
      openDialog('Send manifest page', (panel, ctrl) => {
        const name = h('input', { 'aria-label': 'Lead guest name', id: 'sm-name' });
        const email = h('input', { type: 'email', 'aria-label': 'Lead guest email', id: 'sm-email' });
        const errBox = h('div', {});
        const btn = h('button', { class: 'primary' }, 'Send manifest page');
        const cancel = h('button', { onclick: () => ctrl.close() }, 'Cancel');
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          btn.textContent = 'Sending page';
          announce('Sending page');
          try {
            await api(`/api/w/${ws}/charters/${id}/manifest-page`, { method: 'POST', body: JSON.stringify({ leadGuestName: name.value, leadGuestEmail: email.value }) });
            const copy = `Manifest page sent to ${email.value}.`;
            announce(copy);
            ctrl.close();
            location.reload();
          } catch (err) {
            btn.disabled = false;
            btn.textContent = 'Send manifest page';
            const e = err as ApiError;
            if (e.status === 401) {
              errBox.textContent = '';
              errBox.append(sessionBanner(e));
              return;
            }
            const copy = errorCopy(e);
            errBox.textContent = '';
            if (copy.fields?.leadGuestName) {
              errBox.append(h('p', { class: 'msg err' }, copy.fields.leadGuestName));
              name.setAttribute('aria-invalid', 'true');
              name.focus();
            } else if (copy.fields?.leadGuestEmail) {
              errBox.append(h('p', { class: 'msg err' }, copy.fields.leadGuestEmail));
              email.setAttribute('aria-invalid', 'true');
              email.focus();
            } else {
              errBox.append(h('p', { class: 'msg err' }, copy.message));
              announce(copy.message);
            }
          }
        });
        panel.append(
          h('h2', {}, 'Send manifest page'),
          h('div', { class: 'field' }, h('label', { for: 'sm-name' }, 'Lead guest name'), name),
          h('div', { class: 'field' }, h('label', { for: 'sm-email' }, 'Lead guest email'), email),
          errBox,
          h('div', { style: 'display:flex;gap:0.6rem' }, btn, cancel),
        );
      });
    });
    manifestActions.append(send);
    if (manifest.page?.status === 'live') {
      const end = h('button', { class: 'danger' }, 'End manifest page');
      end.addEventListener('click', () => {
        openDialog('End manifest page', (panel, ctrl) => {
          const keep = h('button', { class: 'primary', onclick: () => ctrl.close() }, 'Keep page');
          const endBtn = h('button', { class: 'danger' }, 'End page');
          endBtn.addEventListener('click', async () => {
            endBtn.disabled = true;
            endBtn.textContent = 'Ending page';
            announce('Ending page');
            try {
              await api(`/api/w/${ws}/charters/${id}/manifest-page/end`, { method: 'POST' });
              announce('Page ended.');
              ctrl.close();
              location.reload();
            } catch (err) {
              endBtn.disabled = false;
              endBtn.textContent = 'End page';
              const e = err as ApiError;
              if (e.status === 401) {
                panel.append(sessionBanner(e));
                return;
              }
              const copy = errorCopy(e);
              panel.append(h('p', { class: 'msg err' }, copy.message));
              announce(copy.message);
            }
          });
          panel.append(h('h2', {}, 'End manifest page'), h('p', {}, 'End the manifest page for this charter?'), h('div', { style: 'display:flex;gap:0.6rem;margin-top:0.8rem' }, keep, endBtn));
        });
      });
      manifestActions.append(h('div', { style: 'height:0.6rem' }), end);
    }
  }

  const closeActions = h('div', {});
  const statusText = h('p', { class: 'num' }, charter.status === 'closed' && charter.erasesAt ? `Charter closed. Passport details will be erased ${fmtDateTime('split', { ms: Date.parse(charter.erasesAt) })}.` : '');
  if (canClose && charter.status !== 'closed') {
    const closeBtn = h('button', { class: 'danger' }, 'Close charter');
    closeBtn.addEventListener('click', () => {
      openDialog('Close charter', (panel, ctrl) => {
        const cancel = h('button', { class: 'primary', onclick: () => ctrl.close() }, 'Cancel');
        const confirm = h('button', { class: 'danger' }, 'Close charter');
        const errBox = h('div', {});
        confirm.addEventListener('click', async () => {
          confirm.disabled = true;
          confirm.textContent = 'Closing charter';
          announce('Closing charter');
          try {
            const res = await api<any>(`/api/w/${ws}/charters/${id}/close`, { method: 'POST' });
            const copy = `Charter closed. Passport details will be erased ${fmtDateTime('split', { ms: Date.parse(res.charter.erasesAt) })}.`;
            announce(copy);
            ctrl.close();
            location.reload();
          } catch (err) {
            confirm.disabled = false;
            confirm.textContent = 'Close charter';
            const e = err as ApiError;
            if (e.status === 401) {
              errBox.textContent = '';
              errBox.append(sessionBanner(e));
              return;
            }
            const copy = errorCopy(e);
            errBox.textContent = '';
            errBox.append(h('p', { class: 'msg err' }, copy.message));
            announce(copy.message);
          }
        });
        panel.append(h('h2', {}, 'Close charter'), h('p', {}, 'Close this charter? Passport details will be erased after the retention time.'), errBox, h('div', { style: 'display:flex;gap:0.6rem;margin-top:0.8rem' }, cancel, confirm));
      });
    });
    closeActions.append(closeBtn, statusText);
  } else if (charter.status === 'closed') {
    closeActions.append(statusText);
  }

  return h('div', { class: 'two-col' },
    h('div', {},
      h('h1', {}, `Charter for ${charter.clientName}`),
      h('div', { class: 'card' },
        h('p', {}, `Yacht: ${charter.yachtSlug}`),
        h('p', {}, `Week: ${fmtDateOnly('split', charter.weekStart)} to ${fmtDateOnly('split', charter.weekEnd)}`),
        h('p', {}, `Client: ${charter.clientName} · ${charter.clientEmail}`),
        h('p', { class: 'num' }, `Deposit date ${fmtDateOnly('split', charter.depositDate)}`),
        h('p', {}, 'Invoice: ', h('span', { class: `status-chip ${charter.invoiceStatus}` }, charter.invoiceStatus === 'invoiced' ? 'Invoiced' : 'Not invoiced')),
      ),
      h('h2', {}, 'Charter lines'),
      lines,
    ),
    h('div', {},
      h('h2', {}, 'Manifest'),
      h('p', { class: 'num' }, pageStatus),
      guests,
      manifestActions,
      h('div', { style: 'height:1rem' }),
      closeActions,
    ),
  );
}
