/**
 * The signed-in desks and the public notice page. Each control works by
 * keyboard, every async outcome is announced in its named live region, and the
 * 5-second refreshes keep field text, caret, focus, open dialogs and scroll.
 */
import { el, input, dialog, api, rupees, displayDate, type NoticeVersion } from './lib.js';

interface DeliveryEntry {
  eventId: string;
  eventType: string;
  noticeNumber: string | null;
  noticeVersion: number | null;
  endpointUrl: string | null;
  endpointRemoved: boolean;
  state: string;
  redeliveryRequested: boolean;
  attempts: Array<{ at: string; responseStatus: number | null; outcome: string }>;
}

// ---------- stockist ----------

async function runStockist(): Promise<void> {
  const app = document.getElementById('app') as HTMLElement;
  const session = await api<{ role: string; accountId: string; displayName: string }>('/api/session');
  if (!session.ok) {
    location.href = '/sign-in';
    return;
  }
  const loadedAccount = session.body.accountId;
  app.textContent = '';

  const endpointStatus = el('div', { role: 'status', 'aria-live': 'polite', id: 'endpoint-status', class: 'status-line live-region' });
  const deliveryStatus = el('div', { role: 'status', 'aria-live': 'polite', id: 'delivery-status', class: 'status-line live-region' });
  const messageAlert = el('div', { role: 'alert', id: 'message-status', class: 'outage-alert' });
  const workAlert = el('div', { role: 'alert', id: 'work-status', class: 'outage-alert' });

  const desk = el('div', { class: 'desk' });
  const columns = el('div', { class: 'desk-columns' });
  const left = el('div');
  const right = el('div');
  columns.append(left, right);
  desk.appendChild(columns);
  app.append(desk, messageAlert, workAlert);

  desk.prepend(el('h2', { text: 'Stockist desk' }));
  const signOut = el('button', { class: 'rectangle-button', text: 'Sign out' });
  signOut.addEventListener('click', () => {
    void api('/api/session', { method: 'DELETE' }).then(() => {
      location.href = '/';
    });
  });
  desk.appendChild(signOut);

  const urlLabel = el('label', { class: 'form-label', for: 'endpoint-url', text: 'Endpoint URL' });
  const urlInput = input({ type: 'url', class: 'form-input', id: 'endpoint-url' });
  const saveButton = el('button', { class: 'rectangle-button', text: 'Save endpoint' });
  const form = el('form');
  form.append(urlLabel, urlInput, saveButton);
  left.append(form, endpointStatus);

  const endpointsList = el('div');
  left.appendChild(endpointsList);
  const logRegion = el('div');
  right.append(logRegion, deliveryStatus);

  const secretDialog = dialog({ 'aria-label': 'Signing secret' });
  const secretText = el('p', { class: 'long-value' });
  const savedIt = el('button', { class: 'rectangle-button', text: 'I have saved it' });
  secretDialog.append(el('h3', { text: 'Signing secret' }), secretText, savedIt);
  app.appendChild(secretDialog);
  let secretOpener: HTMLElement | null = null;
  savedIt.addEventListener('click', () => {
    secretDialog.close();
    secretOpener?.focus();
  });

  saveButton.addEventListener('click', () => {
    if (saveButton.getAttribute('aria-disabled') === 'true') return;
    saveButton.setAttribute('aria-disabled', 'true');
    endpointStatus.textContent = 'Checking the address.';
    void (async () => {
      const r = await api<{ signingSecret?: string }>('/api/stockist/endpoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput.value }),
      });
      saveButton.removeAttribute('aria-disabled');
      if (r.status === 401) { location.href = '/sign-in'; return; }
      if (r.status === 403) { location.href = '/editor'; return; }
      if (!r.ok) {
        endpointStatus.textContent = (r.body as { message?: string }).message ?? '';
        return;
      }
      endpointStatus.textContent = 'Endpoint saved.';
      secretText.textContent = r.body.signingSecret ?? '';
      secretOpener = saveButton;
      secretDialog.showModal();
      await refresh();
    })();
  });

  const pendingButtons = new Set<HTMLButtonElement>();

  function actionButton(label: string, run: () => Promise<void>): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'rectangle-button';
    b.textContent = label;
    b.addEventListener('click', () => {
      if (b.getAttribute('aria-disabled') === 'true') return;
      b.setAttribute('aria-disabled', 'true');
      pendingButtons.add(b);
      void run().finally(() => {
        b.removeAttribute('aria-disabled');
        pendingButtons.delete(b);
      });
    });
    return b;
  }

  async function refresh(): Promise<void> {
    const ep = await api<{ endpoints: Array<{ id: string; url: string; registered: boolean }> }>('/api/stockist/endpoints');
    const dl = await api<{ messagesQueued: boolean; workQueued: boolean; deliveries: DeliveryEntry[] }>('/api/stockist/deliveries');
    if (ep.status === 401 || dl.status === 401) { location.href = '/sign-in'; return; }
    if (ep.status === 403 || dl.status === 403) { location.href = '/editor'; return; }
    const s = await api<{ accountId: string }>('/api/session');
    if (s.ok && s.body.accountId !== loadedAccount) { location.href = '/stockist'; return; }
    if (!ep.ok || !dl.ok) return;
    messageAlert.textContent = dl.body.messagesQueued ? 'Stockist messages are queued. Nothing has been lost.' : '';
    workAlert.textContent = dl.body.workQueued ? 'Background work is queued. Nothing has been lost.' : '';

    endpointsList.textContent = '';
    const prevFocus = document.activeElement as HTMLElement | null;
    for (const e of ep.body.endpoints) {
      const row = el('div', { class: 'row-line' });
      row.appendChild(el('div', { class: 'long-value', text: e.url }));
      const actions = el('div', { class: 'row-actions' });
      actions.append(
        actionButton(`Send test to ${e.url}`, async () => {
          endpointStatus.textContent = 'Checking the address.';
          const r = await api<Record<string, unknown>>(`/api/stockist/endpoints/${e.id}/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
          if (r.ok) {
            endpointStatus.textContent = 'Test message accepted. Check the delivery log for the result.';
            await refresh();
          } else {
            endpointStatus.textContent = (r.body as { message?: string }).message ?? '';
          }
        }),
        actionButton(`Rotate secret for ${e.url}`, async () => {
          endpointStatus.textContent = 'Rotating the secret.';
          const r = await api<{ signingSecret?: string }>(`/api/stockist/endpoints/${e.id}/rotate-secret`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
          if (r.ok) {
            endpointStatus.textContent = 'Secret rotated.';
            secretText.textContent = r.body.signingSecret ?? '';
            secretOpener = actions.querySelectorAll('button')[1] ?? null;
            secretDialog.showModal();
          } else {
            endpointStatus.textContent = (r.body as { message?: string }).message ?? '';
          }
        }),
        actionButton(`Recover failed for ${e.url}`, async () => {
          endpointStatus.textContent = 'Asking for recovery.';
          const r = await api<{ requested: string[] }>(`/api/stockist/endpoints/${e.id}/recover`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
          if (r.ok) {
            endpointStatus.textContent = `Recovery requested: ${r.body.requested.length}. Check the delivery log for the result.`;
            await refresh();
          } else {
            endpointStatus.textContent = (r.body as { message?: string }).message ?? '';
          }
        }),
        actionButton(`Remove ${e.url}`, async () => {
          endpointStatus.textContent = 'Removing the endpoint.';
          const r = await api(`/api/stockist/endpoints/${e.id}`, { method: 'DELETE' });
          if (r.status === 204 || r.status === 404) {
            endpointStatus.textContent = 'Endpoint removed.';
            await refresh();
            urlInput.focus();
          } else {
            endpointStatus.textContent = (r.body as { message?: string }).message ?? '';
          }
        })
      );
      row.appendChild(actions);
      endpointsList.appendChild(row);
    }
    drawLog(dl.body.deliveries);
    if (prevFocus && pendingButtons.size === 0 && document.contains(prevFocus)) {
      // keep focus where it was when nothing removed it
    } else if (pendingButtons.size > 0) {
      // a pending action keeps its button
    } else {
      logTable?.focus();
    }
  }

  let logTable: HTMLElement | null = null;

  function drawLog(entries: DeliveryEntry[]): void {
    logRegion.textContent = '';
    const table = el('table', { 'aria-label': 'Delivery log', class: 'responsive', id: 'delivery-log' });
    table.tabIndex = -1;
    const thead = el('thead');
    const hr = el('tr');
    for (const c of ['Event', 'Endpoint', 'State', 'Attempts', '']) hr.appendChild(el('th', { text: c }));
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = el('tbody');
    for (const d of entries) {
      const tr = el('tr');
      tr.appendChild(el('td', { class: 'long-value', text: d.eventId }));
      tr.appendChild(el('td', { class: 'long-value', text: d.endpointUrl ?? '' }));
      tr.appendChild(el('td', { text: d.state }));
      tr.appendChild(el('td', { text: String(d.attempts.length) }));
      const td = el('td');
      if (d.state === 'failed' && !d.endpointRemoved) {
        td.appendChild(
          actionButton(`Redeliver ${d.eventId}`, async () => {
            endpointStatus.textContent = 'Asking for a redelivery.';
            const r = await api(`/api/stockist/deliveries/${encodeURIComponent(d.eventId)}/redeliver`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
            if (r.ok) {
              endpointStatus.textContent = 'Redelivery requested. Check the delivery log for the result.';
              await refresh();
            } else {
              endpointStatus.textContent = (r.body as { message?: string }).message ?? '';
            }
          })
        );
      }
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    logRegion.appendChild(table);
    logTable = table;
  }

  const sheetLink = el('a', { href: '/api/stockist/price-sheet.csv', class: 'download-link', text: 'Download price sheet' });
  left.appendChild(sheetLink);

  await refresh();
  setInterval(refresh, 5000);
}

// ---------- notice page ----------

async function runNoticePage(number: string): Promise<void> {
  const app = document.getElementById('app') as HTMLElement;
  const r = await api<{ number: string; state: string; versions: NoticeVersion[] }>(`/api/notices/${encodeURIComponent(number)}`);
  if (!r.ok) {
    app.innerHTML = `<div class="intermission"><div class="display-line">REEL MISSING</div><p class="italic-line">This page isn't in the programme.</p></div>`;
    return;
  }
  app.textContent = '';
  const page = el('div', { class: 'notice-page' });
  page.appendChild(el('h2', { text: `${r.body.versions[0]?.title ?? 'Notice'} — ${r.body.number}` }));
  const printStatus = el('div', { role: 'status', 'aria-live': 'polite', id: 'print-status', class: 'status-line live-region' });
  printStatus.tabIndex = -1;
  app.append(page, printStatus);

  const openVersions = new Set<number>();
  const linkTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const linkHeld = new Map<number, string>();
  const lastDrawnStates = new Map<string, string>();

  function drawVersion(v: NoticeVersion): HTMLElement {
    const block = el('article', { class: 'version-block' });
    const isLatest = v.version === r.body.versions[0]?.version;
    const head = el('div', { class: 'version-head' });
    if (!isLatest) {
      const btn = el('button', { class: 'version-button', 'aria-expanded': openVersions.has(v.version) ? 'true' : 'false', text: `Version ${v.version}` });
      btn.addEventListener('click', () => {
        if (openVersions.has(v.version)) openVersions.delete(v.version);
        else openVersions.add(v.version);
        btn.setAttribute('aria-expanded', openVersions.has(v.version) ? 'true' : 'false');
        drawAll();
      });
      head.appendChild(btn);
      head.appendChild(el('span', { class: 'version-state', text: printStateLabel(v.printState) }));
      head.appendChild(el('span', { class: 'superseded-line', text: `Superseded by version ${v.supersededBy}` }));
      block.appendChild(head);
      const body = el('div', { class: 'version-body' });
      if (!openVersions.has(v.version)) body.hidden = true;
      fillBody(body, v);
      block.appendChild(body);
    } else {
      head.appendChild(el('span', { class: 'version-state', text: printStateLabel(v.printState) }));
      head.appendChild(el('span', { class: 'superseded-line', text: v.state === 'superseded' ? `Superseded by version ${v.supersededBy}` : '' }));
      block.appendChild(head);
      const body = el('div', { class: 'version-body' });
      fillBody(body, v);
      block.appendChild(body);
    }
    return block;
  }

  function fillBody(body: HTMLElement, v: NoticeVersion): void {
    body.textContent = '';
    body.appendChild(el('p', { text: `Effective ${displayDate(v.effectiveDate)}` }));
    if (v.runOutUntil) body.appendChild(el('p', { class: 'runout-line', text: `Old wrappers allowed until ${displayDate(v.runOutUntil)}` }));
    if (v.reason) body.appendChild(el('p', { class: 'runout-line', text: v.reason }));
    const table = el('table', { 'aria-label': `Revised prices ${r.body.number}`, class: 'responsive' });
    const thead = el('thead');
    const hr = el('tr');
    for (const c of ['Pack', 'Old MRP', 'Revised MRP', 'Kind']) hr.appendChild(el('th', { text: c }));
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = el('tbody');
    for (const row of v.rows) {
      const tr = el('tr');
      tr.append(
        el('td', { text: row.name }),
        el('td', { text: rupees(row.oldMrpPaise) }),
        el('td', { text: rupees(row.revisedMrpPaise) }),
        el('td', { class: 'kind-label', text: row.kind === 'sticker' ? 'Sticker' : 'New print' })
      );
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    body.appendChild(table);
    const linkWrap = el('p', { id: `link-v${v.version}` });
    body.appendChild(linkWrap);
    if (v.printState === 'printable') {
      if (linkHeld.has(v.version)) {
        linkWrap.appendChild(el('a', { class: 'download-link', href: linkHeld.get(v.version)!, text: `Download notice ${r.body.number} version ${v.version}` }));
      } else {
        void mintLink(v.version);
      }
    } else if (v.printState === 'pending') {
      linkWrap.appendChild(el('span', { class: 'runout-line', text: 'This notice is still being printed.' }));
    } else {
      linkWrap.appendChild(el('span', { class: 'runout-line', text: 'Printing is down. The prices on this page are still correct.' }));
    }
  }

  async function mintLink(version: number): Promise<void> {
    const res = await api<{ url: string; expiresInSeconds: number }>(`/api/notices/${encodeURIComponent(r.body.number)}/versions/${version}/link`);
    const wrap = document.getElementById(`link-v${version}`);
    if (!res.ok) {
      if (res.status === 503) {
        if (wrap) {
          wrap.textContent = '';
          wrap.appendChild(el('span', { class: 'runout-line', text: 'Stored copies are unavailable right now. The prices on this page are still correct.' }));
        }
      }
      return;
    }
    if (wrap) {
      wrap.textContent = '';
      wrap.appendChild(el('a', { class: 'download-link', href: res.body.url, text: `Download notice ${r.body.number} version ${version}` }));
    }
    linkHeld.set(version, res.body.url);
    const ttl = (res.body.expiresInSeconds - 30) * 1000;
    const timer = setTimeout(() => {
      linkHeld.delete(version);
      void mintLink(version);
      drawAll();
    }, Math.max(5000, ttl));
    linkTimers.set(version, timer);
  }

  function printStateLabel(state: string): string {
    if (state === 'printable') return 'Printable';
    if (state === 'pending') return 'Print pending';
    return 'Print failed';
  }

  function drawAll(): void {
    page.textContent = '';
    page.appendChild(el('h2', { text: `${r.body.versions[0]?.title ?? 'Notice'} — ${r.body.number}` }));
    for (const v of r.body.versions) {
      page.appendChild(drawVersion(v));
    }
  }
  drawAll();

  // Open public notice: while any version is pending, check every 5 seconds.
  setInterval(async () => {
    const anyPending = r.body.versions.some((v) => v.printState === 'pending');
    if (!anyPending) return;
    const fresh = await api<{ versions: NoticeVersion[] }>(`/api/notices/${encodeURIComponent(r.body.number)}`);
    if (!fresh.ok) return;
    r.body.versions = fresh.body.versions;
    for (const v of r.body.versions) {
      const before = lastDrawnStates.get(`v${v.version}`);
      const now = v.printState;
      if (before !== undefined && before !== now) {
        printStatus.textContent = `Notice ${r.body.number} version ${v.version} is now ${printStateLabel(now)}.`;
      }
      lastDrawnStates.set(`v${v.version}`, now);
    }
    drawAll();
  }, 5000);
  for (const v of r.body.versions) lastDrawnStates.set(`v${v.version}`, v.printState);
}

export { runStockist, runNoticePage };
