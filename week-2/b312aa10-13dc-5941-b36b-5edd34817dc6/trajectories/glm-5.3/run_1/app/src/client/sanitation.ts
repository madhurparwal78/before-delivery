import { api, apiOrNull, ApiFailure, freshKey, type KitchenInfo } from './api.js';
import { h, clear, money, monthName } from './ui.js';
import { announce, showAlert, refreshBannerSoon, type AppState } from './main.js';

const AREAS = ['Prep stations', 'Ovens and ranges', 'Walk-in cooler', 'Dish area', 'Floors and drains'];

// ---------------------------------------------------------------------------
// Sanitation
// ---------------------------------------------------------------------------
export async function renderSanitation(main: HTMLElement, state: AppState): Promise<void> {
  const session = state.session!;
  const isOperator = session.user.role === 'operator';
  const areaSelect = h('select', { 'aria-label': 'Area' }) as HTMLSelectElement;
  for (const area of AREAS) areaSelect.append(h('option', { value: area, text: area }));
  const taskInput = h('input', { type: 'text', 'aria-label': 'Task' }) as HTMLInputElement;
  const ppmInput = h('input', { type: 'number', 'aria-label': 'Sanitizer ppm' }) as HTMLInputElement;
  const initialsInput = h('input', { type: 'text', 'aria-label': 'Initials' }) as HTMLInputElement;
  const notesInput = h('input', { type: 'text', 'aria-label': 'Notes' }) as HTMLInputElement;
  const errorLine = h('p', { class: 'field-error' });
  const logTable = h('table', { 'aria-label': 'Sanitation log' });

  main.append(h('div', { class: 'panel', role: 'region', 'aria-label': 'Log entry' },
    h('h2', { class: 'display', text: 'Log an entry' }),
    h('label', { text: 'Area' }, areaSelect),
    h('label', { text: 'Task' }, taskInput),
    h('label', { text: 'Sanitizer ppm' }, ppmInput),
    h('label', { text: 'Initials' }, initialsInput),
    h('label', { text: 'Notes' }, notesInput),
    errorLine,
    h('button', { text: 'Log entry', onclick: async (ev) => {
      const button = ev.target as HTMLElement;
      button.setAttribute('aria-busy', 'true');
      (button as HTMLButtonElement).disabled = true;
      announce('Logging…');
      try {
        await api('POST', '/api/sanitation-entries', {
          area: areaSelect.value,
          task: taskInput.value,
          sanitizerPpm: ppmInput.value === '' ? null : Number(ppmInput.value),
          initials: initialsInput.value,
          notes: notesInput.value,
        });
        announce('Logged.');
        taskInput.value = '';
        notesInput.value = '';
        await loadLog();
      } catch (err) {
        announce('');
        const failure = err as ApiFailure;
        if (failure instanceof ApiFailure && failure.body.error === 'validation_failed' && failure.body.errors) {
          errorLine.textContent = Object.values(failure.body.errors)[0] ?? '';
        } else if (failure instanceof ApiFailure) {
          showAlert(failure.body.message);
        } else {
          showAlert('Lineboard could not reach the server. Check the connection and try again.');
        }
      }
      button.removeAttribute('aria-busy');
      (button as HTMLButtonElement).disabled = false;
    } }),
  ));
  main.append(h('div', { class: 'panel' }, h('h2', { class: 'display', text: 'Sanitation log' }), logTable));

  if (isOperator) {
    const reportMonth = h('input', { type: 'text', 'aria-label': 'Report month', value: state.kitchen?.currentMonth ?? '' }) as HTMLInputElement;
    const pdfTable = h('table', { 'aria-label': 'Monthly PDFs' });
    main.append(h('div', { class: 'panel' },
      h('h2', { class: 'display', text: 'Monthly PDF' }),
      h('label', { text: 'Report month' }, reportMonth),
      h('button', { text: 'Generate monthly PDF', onclick: async (ev) => {
        const button = ev.target as HTMLElement;
        button.setAttribute('aria-busy', 'true');
        (button as HTMLButtonElement).disabled = true;
        announce(`Saving PDF…`);
        try {
          const result = await api<{ report: { month: string; status: string } } | { report: { month: string; status: string } }>('POST', '/api/sanitation-reports', { month: reportMonth.value });
          const report = (result.data as { report: { month: string; status: string } }).report;
          announce(report.status === 'stored'
            ? `Sanitation PDF for ${monthName(report.month)} saved.`
            : `Storage is unavailable. The sanitation PDF for ${monthName(report.month)} is queued and will be saved when storage returns.`);
          refreshBannerSoon();
          await loadPdfs();
        } catch (err) {
          announce('');
          const failure = err as ApiFailure;
          if (failure instanceof ApiFailure && failure.body.error === 'validation_failed' && failure.body.errors) {
            showAlert(Object.values(failure.body.errors)[0] ?? '');
          } else if (failure instanceof ApiFailure) {
            showAlert(failure.body.message);
          } else {
            showAlert('Lineboard could not reach the server. Check the connection and try again.');
          }
        }
        button.removeAttribute('aria-busy');
        (button as HTMLButtonElement).disabled = false;
      } }),
      pdfTable,
    ));

    const emailInput = h('input', { type: 'text', 'aria-label': 'Inspector email' }) as HTMLInputElement;
    const expiresInput = h('input', { type: 'text', 'aria-label': 'Link expires' }) as HTMLInputElement;
    const linksTable = h('table', { 'aria-label': 'Inspector links' });
    main.append(h('div', { class: 'panel' },
      h('h2', { class: 'display', text: 'Inspector links' }),
      h('label', { text: 'Inspector email' }, emailInput),
      h('label', { text: 'Link expires' }, expiresInput),
      h('button', { text: 'Send link', onclick: async (ev) => {
        const button = ev.target as HTMLElement;
        button.setAttribute('aria-busy', 'true');
        (button as HTMLButtonElement).disabled = true;
        announce('Sending…');
        try {
          const result = await api<{ link: { email: string; expiresAt: string; url: string } }>('POST', '/api/inspector-links', {
            email: emailInput.value,
            expiresAt: expiresInput.value,
          });
          announce(`Link sent to ${result.data.link.email}, active until ${result.data.link.expiresAt.slice(0, 16).replace('T', ' ')}.`);
          await loadLinks();
        } catch (err) {
          announce('');
          const failure = err as ApiFailure;
          if (failure instanceof ApiFailure && failure.body.error === 'validation_failed' && failure.body.errors) {
            showAlert(Object.values(failure.body.errors)[0] ?? '');
          } else if (failure instanceof ApiFailure) {
            showAlert(failure.body.message);
          } else {
            showAlert('Lineboard could not reach the server. Check the connection and try again.');
          }
        }
        button.removeAttribute('aria-busy');
        (button as HTMLButtonElement).disabled = false;
      } }),
      linksTable,
    ));

    // The Inspector links table re-reads at least every 10 seconds.
    window.setInterval(() => void loadLinks(), 10000);

    async function loadPdfs(): Promise<void> {
      const result = await apiOrNull<{ reports: { month: string; status: string }[] }>('GET', '/api/sanitation-reports');
      if (!result) return;
      clear(pdfTable);
      pdfTable.append(h('thead', {}, h('tr', {}, h('th', { text: 'Month' }), h('th', { text: 'Status' }), h('th', { text: 'File' }))));
      const body = h('tbody');
      for (const report of result.data.reports) {
        body.append(h('tr', {},
          h('td', { text: report.month }),
          h('td', { text: report.status === 'stored' ? 'Saved' : 'Queued' }),
          h('td', {}, report.status === 'stored'
            ? h('a', { href: `/api/sanitation-reports/${report.month}/file`, text: `Sanitation PDF ${monthName(report.month)}` })
            : h('span', { text: '' })),
        ));
      }
      pdfTable.append(body);
    }

    async function loadLinks(): Promise<void> {
      const result = await apiOrNull<{ links: InspectorLink[] }>('GET', '/api/inspector-links');
      if (!result) return;
      clear(linksTable);
      linksTable.append(h('thead', {}, h('tr', {},
        h('th', { text: 'Email' }), h('th', { text: 'Expires' }), h('th', { text: 'Status' }), h('th', { text: 'Last opened' }),
        h('th', { text: 'Views' }), h('th', { text: 'Downloads' }), h('th', { text: 'Actions' }),
      )));
      const body = h('tbody');
      for (const link of result.data.links) {
        body.append(h('tr', {},
          h('td', { text: link.email }),
          h('td', { text: link.expiresAt.slice(0, 16).replace('T', ' ') }),
          h('td', { text: link.status === 'active' ? 'Active' : link.status === 'expired' ? 'Expired' : 'Revoked' }),
          h('td', { text: link.lastAccessAt ? link.lastAccessAt.slice(0, 16).replace('T', ' ') : 'Never' }),
          h('td', { text: String(link.views) }),
          h('td', { text: String(link.downloads) }),
          h('td', {},
            h('button', { text: `Revoke link for ${link.email}`, onclick: async (ev) => {
              const button = ev.target as HTMLElement;
              button.setAttribute('aria-busy', 'true');
              (button as HTMLButtonElement).disabled = true;
              announce('Revoking…');
              try {
                await api('DELETE', `/api/inspector-links/${link.id}`);
                announce('Link revoked.');
                await loadLinks();
              } catch (err) {
                announce('');
                const failure = err as ApiFailure;
                if (failure instanceof ApiFailure) showAlert(failure.body.message);
                else showAlert('Lineboard could not reach the server. Check the connection and try again.');
              }
            } }),
            h('button', { text: `Regenerate link for ${link.email}`, onclick: async (ev) => {
              const button = ev.target as HTMLElement;
              button.setAttribute('aria-busy', 'true');
              (button as HTMLButtonElement).disabled = true;
              announce('Sending…');
              try {
                await api('POST', `/api/inspector-links/${link.id}/regenerate`, {});
                announce(`New link sent to ${link.email}. The old link no longer works.`);
                await loadLinks();
              } catch (err) {
                announce('');
                const failure = err as ApiFailure;
                if (failure instanceof ApiFailure) showAlert(failure.body.message);
                else showAlert('Lineboard could not reach the server. Check the connection and try again.');
              }
            } }),
          ),
        ));
      }
      linksTable.append(body);
    }

    await loadPdfs();
    await loadLinks();
  }

  async function loadLog(): Promise<void> {
    const result = await apiOrNull<{ entries: { localDate: string; localTime: string; area: string; task: string; sanitizerPpm: number | null; initials: string; notes: string; loggedBy: string }[] }>('GET', '/api/sanitation-entries');
    if (!result) return;
    clear(logTable);
    logTable.append(h('thead', {}, h('tr', {},
      h('th', { text: 'Date' }), h('th', { text: 'Time' }), h('th', { text: 'Area' }), h('th', { text: 'Task' }),
      h('th', { text: 'Sanitizer' }), h('th', { text: 'Initials' }), h('th', { text: 'Notes' }), h('th', { text: 'Logged by' }),
    )));
    const body = h('tbody');
    for (const entry of result.data.entries) {
      body.append(h('tr', {},
        h('td', { text: entry.localDate }),
        h('td', { text: entry.localTime }),
        h('td', { text: entry.area }),
        h('td', { text: entry.task }),
        h('td', { text: entry.sanitizerPpm === null ? '' : String(entry.sanitizerPpm) }),
        h('td', { text: entry.initials }),
        h('td', { text: entry.notes }),
        h('td', { text: entry.loggedBy }),
      ));
    }
    logTable.append(body);
  }

  await loadLog();
}

interface InspectorLink {
  id: string;
  email: string;
  expiresAt: string;
  status: 'active' | 'expired' | 'revoked';
  lastAccessAt: string | null;
  views: number;
  downloads: number;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
export async function renderSettings(main: HTMLElement, state: AppState): Promise<void> {
  const kitchen = state.kitchen!;
  let rulesVersion = kitchen.rulesVersion;
  const stationsTable = h('table', { 'aria-label': 'Stations' });
  const versionsTable = h('table', { 'aria-label': 'Rate versions' });
  const peakGroup = h('div', { role: 'group', 'aria-label': 'Peak windows' });
  const insuranceCheck = h('input', { type: 'checkbox', 'aria-label': 'Insurance certificate required' }) as HTMLInputElement;
  const cardCheck = h('input', { type: 'checkbox', 'aria-label': 'Food-handler card required' }) as HTMLInputElement;

  main.append(h('div', { class: 'panel' }, h('h2', { class: 'display', text: 'Stations' }), stationsTable));
  main.append(h('div', { class: 'panel' }, h('h2', { class: 'display', text: 'Rate versions' }), versionsTable));
  main.append(h('div', { class: 'panel' }, h('h2', { class: 'display', text: 'Peak windows' }), peakGroup,
    h('button', { text: 'Save peak windows', onclick: async (ev) => {
      const button = ev.target as HTMLElement;
      button.setAttribute('aria-busy', 'true');
      (button as HTMLButtonElement).disabled = true;
      announce('Saving…');
      const windows = readPeakWindows();
      try {
        const result = await api<KitchenInfo>('PUT', '/api/kitchen/peak-windows', { windows, rulesVersion });
        rulesVersion = result.data.rulesVersion;
        announce('Peak windows saved. They apply to bookings confirmed from now on.');
        drawPeakWindows(result.data.peakWindows);
      } catch (err) {
        announce('');
        const failure = err as ApiFailure;
        if (failure instanceof ApiFailure && failure.body.error === 'stale_version' && failure.body.current) {
          const current = failure.body.current as KitchenInfo;
          rulesVersion = current.rulesVersion;
          announce('');
          showAlert('Kitchen rules changed since you opened Settings. The latest rules are shown.');
          drawPeakWindows(current.peakWindows);
        } else if (failure instanceof ApiFailure && failure.body.error === 'validation_failed' && failure.body.errors) {
          showAlert(Object.values(failure.body.errors)[0] ?? '');
        } else if (failure instanceof ApiFailure) {
          showAlert(failure.body.message);
        } else {
          showAlert('Lineboard could not reach the server. Check the connection and try again.');
        }
      }
      button.removeAttribute('aria-busy');
      (button as HTMLButtonElement).disabled = false;
    } }),
  ));
  main.append(h('div', { class: 'panel' }, h('h2', { class: 'display', text: 'Required documents' }),
    h('label', {}, insuranceCheck, ' Insurance certificate required'),
    h('label', {}, cardCheck, ' Food-handler card required'),
    h('button', { text: 'Save requirements', onclick: async (ev) => {
      const button = ev.target as HTMLElement;
      button.setAttribute('aria-busy', 'true');
      (button as HTMLButtonElement).disabled = true;
      announce('Saving…');
      const required = [insuranceCheck.checked ? 'insurance_certificate' : '', cardCheck.checked ? 'food_handler_card' : ''].filter(Boolean);
      try {
        const result = await api<KitchenInfo>('PUT', '/api/kitchen/document-requirements', { required, rulesVersion });
        rulesVersion = result.data.rulesVersion;
        announce('Document requirements saved.');
        insuranceCheck.checked = result.data.requiredDocuments.includes('insurance_certificate');
        cardCheck.checked = result.data.requiredDocuments.includes('food_handler_card');
      } catch (err) {
        announce('');
        const failure = err as ApiFailure;
        if (failure instanceof ApiFailure && failure.body.error === 'stale_version' && failure.body.current) {
          const current = failure.body.current as KitchenInfo;
          rulesVersion = current.rulesVersion;
          showAlert('Kitchen rules changed since you opened Settings. The latest rules are shown.');
          insuranceCheck.checked = current.requiredDocuments.includes('insurance_certificate');
          cardCheck.checked = current.requiredDocuments.includes('food_handler_card');
        } else if (failure instanceof ApiFailure) {
          showAlert(failure.body.message);
        } else {
          showAlert('Lineboard could not reach the server. Check the connection and try again.');
        }
      }
      button.removeAttribute('aria-busy');
      (button as HTMLButtonElement).disabled = false;
    } }),
  ));

  interface PeakWindowRow {
    days: string[];
    start: string;
    end: string;
  }
  let windows: PeakWindowRow[] = kitchen.peakWindows.map((w) => ({ days: [...w.days], start: w.start, end: w.end }));

  function drawPeakWindows(rows: PeakWindowRow[]): void {
    windows = rows.map((w) => ({ ...w }));
    clear(peakGroup);
    windows.forEach((window, index) => {
      const daysInput = h('input', { type: 'text', 'aria-label': `Window ${index + 1} days`, value: window.days.join(',') }) as HTMLInputElement;
      const startInput = h('input', { type: 'text', 'aria-label': `Window ${index + 1} start`, value: window.start }) as HTMLInputElement;
      const endInput = h('input', { type: 'text', 'aria-label': `Window ${index + 1} end`, value: window.end }) as HTMLInputElement;
      daysInput.dataset.row = String(index);
      startInput.dataset.row = String(index);
      endInput.dataset.row = String(index);
      daysInput.dataset.field = 'days';
      startInput.dataset.field = 'start';
      endInput.dataset.field = 'end';
      peakGroup.append(h('div', { class: 'peak-row' }, daysInput, startInput, endInput));
    });
    peakGroup.append(h('button', { text: 'Add peak window', onclick: () => {
      windows.push({ days: ['mon'], start: '16:00', end: '19:00' });
      drawPeakWindows(windows);
    } }));
    windows.forEach((_, index) => {
      const remove = h('button', { text: `Remove window ${index + 1}`, onclick: () => {
        windows.splice(index, 1);
        drawPeakWindows(windows);
      } });
      peakGroup.append(remove);
    });
  }

  function readPeakWindows(): PeakWindowRow[] {
    const rows: PeakWindowRow[] = [];
    const groups = new Map<number, Record<string, string>>();
    peakGroup.querySelectorAll('input').forEach((input) => {
      const row = Number((input as HTMLInputElement).dataset.row);
      const field = (input as HTMLInputElement).dataset.field ?? '';
      if (!groups.has(row)) groups.set(row, {});
      groups.get(row)![field] = (input as HTMLInputElement).value;
    });
    for (const [row, fields] of [...groups.entries()].sort(([a], [b]) => a - b)) {
      rows.push({ days: (fields.days ?? '').split(',').map((d) => d.trim()).filter(Boolean), start: fields.start ?? '', end: fields.end ?? '' });
    }
    return rows;
  }

  drawPeakWindows(windows);
  insuranceCheck.checked = kitchen.requiredDocuments.includes('insurance_certificate');
  cardCheck.checked = kitchen.requiredDocuments.includes('food_handler_card');

  async function loadStations(): Promise<void> {
    const result = await apiOrNull<{ stations: { id: string; name: string; kind: string; capacity: number | null; currentRate: { offPeakHourlyCents?: number; peakHourlyCents?: number; shelfDayCents?: number } | null; rates: { effectiveFrom: string; effectiveAt: string; status: string; offPeakHourlyCents?: number; peakHourlyCents?: number; shelfDayCents?: number }[] }[] }>('GET', '/api/stations');
    if (!result) return;
    clear(stationsTable);
    stationsTable.append(h('thead', {}, h('tr', {}, h('th', { text: 'Station' }), h('th', { text: 'Current rate' }), h('th', { text: 'Actions' }))));
    const body = h('tbody');
    for (const station of result.data.stations) {
      const rate = station.currentRate;
      const rateText = rate
        ? station.kind === 'hourly'
          ? `${money(rate.offPeakHourlyCents ?? 0)} / ${money(rate.peakHourlyCents ?? 0)} peak`
          : `${money(rate.shelfDayCents ?? 0)} a day`
        : '—';
      const editButton = h('button', { text: `Edit rates for ${station.name}`, onclick: () => openRatesDialog(station) });
      editButton.id = `edit-rates-${station.id}`;
      body.append(h('tr', {}, h('td', { text: station.name }), h('td', { text: rateText }), h('td', {}, editButton)));
    }
    stationsTable.append(body);
    clear(versionsTable);
    versionsTable.append(h('thead', {}, h('tr', {},
      h('th', { text: 'Station' }), h('th', { text: 'Effective from' }), h('th', { text: 'Standard hourly' }),
      h('th', { text: 'Peak hourly' }), h('th', { text: 'Shelf-day' }), h('th', { text: 'Status' }),
    )));
    const vBody = h('tbody');
    for (const station of result.data.stations) {
      for (const rate of station.rates) {
        vBody.append(h('tr', {},
          h('td', { text: station.name }),
          h('td', { text: rate.effectiveAt.slice(0, 16).replace('T', ' ') }),
          h('td', { text: rate.offPeakHourlyCents === undefined ? '' : money(rate.offPeakHourlyCents) }),
          h('td', { text: rate.peakHourlyCents === undefined ? '' : money(rate.peakHourlyCents) }),
          h('td', { text: rate.shelfDayCents === undefined ? '' : money(rate.shelfDayCents) }),
          h('td', { text: rate.status === 'past' ? 'Past' : rate.status === 'current' ? 'Current' : 'Scheduled' }),
        ));
      }
    }
    versionsTable.append(vBody);
  }

  function openRatesDialog(station: { id: string; name: string; kind: string; capacity: number | null; currentRate: { offPeakHourlyCents?: number; peakHourlyCents?: number; shelfDayCents?: number } | null }): void {
    const existing = document.getElementById('dialog-dim');
    if (existing) existing.remove();
    const dim = h('div', { class: 'dialog-dim', id: 'dialog-dim' });
    const dialog = h('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Station rates', class: 'board-dialog' });
    const isShelf = station.kind === 'shelf';
    const standardInput = h('input', { type: 'text', 'aria-label': 'Standard hourly rate', value: ((station.currentRate?.offPeakHourlyCents ?? 0) / 100).toFixed(2) }) as HTMLInputElement;
    const peakInput = h('input', { type: 'text', 'aria-label': 'Peak hourly rate', value: ((station.currentRate?.peakHourlyCents ?? 0) / 100).toFixed(2) }) as HTMLInputElement;
    const shelfInput = h('input', { type: 'text', 'aria-label': 'Shelf-day rate', value: ((station.currentRate?.shelfDayCents ?? 0) / 100).toFixed(2) }) as HTMLInputElement;
    const effectiveInput = h('input', { type: 'text', 'aria-label': 'Effective from', value: '' }) as HTMLInputElement;
    const errorLine = h('p', { class: 'field-error' });
    dialog.append(
      h('h2', { class: 'display', text: `Station rates` }),
      h('p', { text: station.name }),
      isShelf ? h('label', { text: 'Shelf-day rate' }, shelfInput) : h('label', { text: 'Standard hourly rate' }, standardInput),
      isShelf ? h('span', {}) : h('label', { text: 'Peak hourly rate' }, peakInput),
      h('label', { text: 'Effective from' }, effectiveInput),
      errorLine,
      h('button', { text: 'Save rates', onclick: async (ev) => {
        const button = ev.target as HTMLElement;
        button.setAttribute('aria-busy', 'true');
        (button as HTMLButtonElement).disabled = true;
        announce('Saving…');
        try {
          const body = isShelf
            ? { shelfDayCents: Math.round(Number(shelfInput.value) * 100), effectiveFrom: effectiveInput.value }
            : { offPeakHourlyCents: Math.round(Number(standardInput.value) * 100), peakHourlyCents: Math.round(Number(peakInput.value) * 100), effectiveFrom: effectiveInput.value };
          const result = await api<{ station: { rates: { effectiveAt: string; effectiveFrom: string }[] } }>('POST', `/api/stations/${station.id}/rates`, body);
          const created = result.data.station.rates[result.data.station.rates.length - 1];
          announce(`New rates for ${station.name} start ${created.effectiveAt.slice(0, 16).replace('T', ' ')}.`);
          dim.remove();
          document.getElementById(`edit-rates-${station.id}`)?.focus();
          await loadStations();
        } catch (err) {
          announce('');
          button.removeAttribute('aria-busy');
          (button as HTMLButtonElement).disabled = false;
          const failure = err as ApiFailure;
          if (failure instanceof ApiFailure && failure.body.error === 'validation_failed' && failure.body.errors) {
            errorLine.textContent = Object.values(failure.body.errors)[0] ?? '';
          } else if (failure instanceof ApiFailure) {
            showAlert(failure.body.message);
          } else {
            showAlert('Lineboard could not reach the server. Check the connection and try again.');
          }
        }
      } }),
      h('button', { text: 'Close', onclick: () => {
        dim.remove();
        document.getElementById(`edit-rates-${station.id}`)?.focus();
      } }),
    );
    dim.append(dialog);
    document.body.append(dim);
    (dialog.querySelector('input') as HTMLElement).focus();
  }

  await loadStations();
  window.setInterval(() => void loadStations(), 15000);
}

// ---------------------------------------------------------------------------
// Inspector view
// ---------------------------------------------------------------------------
export async function renderInspector(root: HTMLElement, path: string): Promise<void> {
  const token = path.replace('/inspect/', '').split('/')[0];
  const response = await fetch(`/api/inspect/${encodeURIComponent(token)}`);
  if (!response.ok) {
    let code = 'not_found';
    try {
      code = (await response.json() as { error: string }).error;
    } catch {
      code = 'not_found';
    }
    const text = code === 'link_expired' ? 'This link has expired.' : code === 'link_revoked' ? 'This link is no longer active.' : 'This link is not valid.';
    root.append(h('main', { class: 'inspector' },
      h('h1', { class: 'display', text: 'Lineboard' }),
      h('div', { role: 'alert', class: 'alert', text }),
    ));
    return;
  }
  const data = (await response.json()) as {
    kitchen: { name: string; timeZone: string };
    expiresAt: string;
    sanitationEntries: { localDate: string; localTime: string; area: string; task: string; sanitizerPpm: number | null; initials: string; notes: string; loggedBy: string }[];
    sanitationReports: { month: string }[];
    certificates: { documentId: string; businessName: string; type: string; expiryDate: string; status: string }[];
  };
  const alertBox = h('div', { role: 'alert', class: 'alert' });
  const table = h('table', { 'aria-label': 'Sanitation log' });
  table.append(h('thead', {}, h('tr', {},
    h('th', { text: 'Date' }), h('th', { text: 'Time' }), h('th', { text: 'Area' }), h('th', { text: 'Task' }),
    h('th', { text: 'Sanitizer' }), h('th', { text: 'Initials' }), h('th', { text: 'Notes' }), h('th', { text: 'Logged by' }),
  )));
  const body = h('tbody');
  for (const entry of data.sanitationEntries) {
    body.append(h('tr', {},
      h('td', { text: entry.localDate }),
      h('td', { text: entry.localTime }),
      h('td', { text: entry.area }),
      h('td', { text: entry.task }),
      h('td', { text: entry.sanitizerPpm === null ? '' : String(entry.sanitizerPpm) }),
      h('td', { text: entry.initials }),
      h('td', { text: entry.notes }),
      h('td', { text: entry.loggedBy }),
    ));
  }
  table.append(body);
  const pdfList = h('ul', { 'aria-label': 'Monthly PDFs' });
  for (const report of data.sanitationReports) {
    pdfList.append(h('li', {}, h('a', { href: `/api/inspect/${encodeURIComponent(token)}/sanitation-reports/${report.month}/file`, text: `Sanitation PDF ${monthName(report.month)}` })));
  }
  const certTable = h('table', { 'aria-label': 'Member certificates' });
  certTable.append(h('thead', {}, h('tr', {}, h('th', { text: 'Business' }), h('th', { text: 'Type' }), h('th', { text: 'Expires' }), h('th', { text: 'File' }))));
  const certBody = h('tbody');
  for (const cert of data.certificates) {
    certBody.append(h('tr', {},
      h('td', { text: cert.businessName }),
      h('td', { text: cert.type === 'insurance_certificate' ? 'Insurance certificate' : 'Food-handler card' }),
      h('td', { text: cert.expiryDate }),
      h('td', {}, h('a', {
        href: `/api/inspect/${encodeURIComponent(token)}/documents/${cert.documentId}/file`,
        'aria-label': `Download ${cert.businessName} ${cert.type === 'insurance_certificate' ? 'insurance certificate' : 'food-handler card'}`,
        text: 'Download',
      })),
    ));
  }
  certTable.append(certBody);
  root.append(h('main', { class: 'inspector' },
    h('h1', { class: 'display', text: data.kitchen.name }),
    h('p', { text: `Read-only records for ${data.kitchen.name}, available until ${data.expiresAt.slice(0, 16).replace('T', ' ')}` }),
    alertBox,
    h('h2', { class: 'display', text: 'Sanitation log' }),
    table,
    h('h2', { class: 'display', text: 'Monthly PDFs' }),
    pdfList,
    h('h2', { class: 'display', text: 'Member certificates' }),
    certTable,
  ));
  // Downloads that fail after expiry or revocation replace the view in place.
  root.querySelectorAll('a[href$="/file"]').forEach((link) => {
    link.addEventListener('click', async (ev) => {
      ev.preventDefault();
      const href = (link as HTMLAnchorElement).href;
      const result = await fetch(href);
      if (result.ok) {
        const blob = await result.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = '';
        a.click();
        URL.revokeObjectURL(url);
        return;
      }
      let code = '';
      try {
        code = (await result.json() as { error: string }).error;
      } catch {
        code = 'internal';
      }
      if (code === 'link_expired' || code === 'link_revoked') {
        clear(root);
        root.append(h('main', { class: 'inspector' },
          h('div', { role: 'alert', class: 'alert', text: code === 'link_expired' ? 'This link has expired.' : 'This link is no longer active.' }),
        ));
        return;
      }
      if (result.status === 503) {
        alertBox.textContent = 'Document storage is unavailable. Try again shortly.';
        return;
      }
      alertBox.textContent = 'That was not found.';
    });
  });
}
