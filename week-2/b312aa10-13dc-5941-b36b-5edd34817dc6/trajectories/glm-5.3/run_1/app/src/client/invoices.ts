import { api, apiOrNull, ApiFailure, freshKey, type InvoiceResponse, type MemberRecord } from './api.js';
import { h, clear, money, monthName, blockLabel } from './ui.js';
import { announce, showAlert, refreshBannerSoon, updateHourBankFigures, type AppState } from './main.js';

// ---------------------------------------------------------------------------
// Invoices with the member picker
// ---------------------------------------------------------------------------
export async function renderInvoices(main: HTMLElement, state: AppState): Promise<void> {
  const session = state.session!;
  const isOperator = session.user.role === 'operator';
  const url = new URLSearchParams(window.location.search);
  const monthParam = url.get('month');
  const memberParam = url.get('member');
  const currentMonth = state.kitchen?.currentMonth ?? '';
  let month = monthParam ?? currentMonth;
  if (!monthParam) history.replaceState({}, '', `/invoices?month=${month}`);
  const monthInput = h('input', { type: 'text', 'aria-label': 'Month', value: month }) as HTMLInputElement;
  const invoiceRegion = h('div', { role: 'region', 'aria-label': 'Invoice', id: 'invoice-region' });

  let selectedMember: MemberRecord | null = null;

  const listbox = h('ul', { role: 'listbox', 'aria-label': 'Members', id: 'member-listbox', class: 'member-listbox hidden' });
  let pickerResults: MemberRecord[] = [];
  let activeOption: number = -1;
  let queryTimer: number | null = null;
  let lastQueryText: string | null = null;

  const pickerInput = h('input', { type: 'text', role: 'combobox', 'aria-label': 'Member', 'aria-expanded': 'false', 'aria-controls': 'member-listbox', 'aria-autocomplete': 'list' }) as HTMLInputElement;
  pickerInput.addEventListener('input', () => {
    selectedMember = null;
    if (queryTimer !== null) window.clearTimeout(queryTimer);
    queryTimer = window.setTimeout(() => void queryMembers(pickerInput.value), 250);
    openListbox();
  });
  pickerInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      if (pickerInput.getAttribute('aria-expanded') !== 'true') {
        openListbox();
        void queryMembers(pickerInput.value).then(() => setActive(0));
      } else if (pickerResults.length > 0) {
        setActive(Math.min(activeOption + 1, pickerResults.length - 1));
      }
      return;
    }
    if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (activeOption >= 0 && pickerResults.length > 0) {
        setActive(Math.max(activeOption - 1, 0));
      }
      return;
    }
    if (ev.key === 'Enter') {
      if (activeOption >= 0 && pickerResults[activeOption]) {
        ev.preventDefault();
        selectMember(pickerResults[activeOption]);
      }
      return;
    }
    if (ev.key === 'Escape') {
      if (pickerInput.getAttribute('aria-expanded') === 'true') {
        ev.preventDefault();
        closeListbox();
      }
      return;
    }
    if (ev.key === 'Tab') {
      closeListbox();
    }
  });

  async function queryMembers(text: string): Promise<void> {
    const myText = text;
    lastQueryText = text;
    listbox.setAttribute('aria-busy', 'true');
    const result = await apiOrNull<{ members: MemberRecord[] }>('GET', `/api/members?q=${encodeURIComponent(text)}`);
    if (!result || lastQueryText !== myText) return;
    listbox.removeAttribute('aria-busy');
    pickerResults = result.data.members;
    activeOption = -1;
    pickerInput.removeAttribute('aria-activedescendant');
    drawOptions();
  }

  function drawOptions(): void {
    clear(listbox);
    if (pickerResults.length === 0) {
      listbox.append(h('li', { class: 'picker-empty', text: 'No members match.' }));
      return;
    }
    pickerResults.forEach((member, index) => {
      const option = h('li', {
        role: 'option',
        'aria-selected': 'false',
        id: `member-option-${index}`,
        text: `${member.businessName} · ${member.name}`,
        onclick: () => selectMember(member),
      });
      listbox.append(option);
    });
  }

  function setActive(index: number): void {
    activeOption = index;
    const options = listbox.querySelectorAll('[role="option"]');
    options.forEach((option, i) => {
      if (i === index) {
        pickerInput.setAttribute('aria-activedescendant', `member-option-${index}`);
        option.setAttribute('aria-selected', 'true');
      } else {
        option.setAttribute('aria-selected', 'false');
      }
    });
  }

  function selectMember(member: MemberRecord): void {
    selectedMember = member;
    pickerInput.value = member.name;
    closeListbox();
  }

  function openListbox(): void {
    pickerInput.setAttribute('aria-expanded', 'true');
    listbox.classList.remove('hidden');
  }

  function closeListbox(): void {
    pickerInput.setAttribute('aria-expanded', 'false');
    listbox.classList.add('hidden');
  }

  const showButton = h('button', { text: 'Show invoice', onclick: () => {
    const target = `/invoices?month=${monthInput.value}${selectedMember ? `&member=${selectedMember.id}` : ''}`;
    history.pushState({}, '', target);
    void loadInvoice();
  } });

  const monthWrap = h('div', { class: 'panel', id: 'invoice-controls' },
    h('label', { text: 'Month' }, monthInput),
    isOperator ? h('div', { class: 'picker-wrap' }, pickerInput, listbox) : null,
    showButton,
  );
  main.append(monthWrap);
  main.append(invoiceRegion);

  if (monthParam && !/^\d{4}-\d{2}$/.test(monthParam)) {
    return;
  }
  await loadInvoice();

  async function loadInvoice(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    const targetMonth = params.get('month') ?? '';
    const targetMember = session.user.role === 'member' ? session.user.memberId : params.get('member');
    if (!targetMonth || !/^\d{4}-\d{2}$/.test(targetMonth)) return;
    if (isOperator && !targetMember) {
      clear(invoiceRegion);
      return;
    }
    if (isOperator && targetMember) {
      const memberResult = await apiOrNull<{ member: MemberRecord }>('GET', `/api/members/${targetMember}`);
      if (!memberResult) return;
      selectedMember = memberResult.data.member;
      pickerInput.value = memberResult.data.member.name;
    }
    invoiceRegion.setAttribute('aria-busy', 'true');
    const result = await apiOrNull<InvoiceResponse>('GET', `/api/members/${targetMember}/invoices/${targetMonth}`);
    if (!result) return;
    if (new URLSearchParams(window.location.search).get('month') !== targetMonth) return;
    invoiceRegion.removeAttribute('aria-busy');
    drawInvoice(invoiceRegion, result.data, state, targetMember ?? '');
    if (session.user.role === 'member') updateHourBankFigures(result.data.hourBank.balanceHours, result.data.month);
    if (result.data.status === 'open') startInvoiceRefresh(targetMonth, targetMember ?? '');
  }

  let refreshTimer: number | null = null;
  function startInvoiceRefresh(month: string, memberId: string): void {
    if (refreshTimer !== null) window.clearInterval(refreshTimer);
    refreshTimer = window.setInterval(async () => {
      const result = await apiOrNull<InvoiceResponse>('GET', `/api/members/${memberId}/invoices/${month}`);
      if (!result) return;
      if (result.data.status === 'open') {
        drawInvoice(invoiceRegion, result.data, state, memberId);
        if (session.user.role === 'member') updateHourBankFigures(result.data.hourBank.balanceHours, result.data.month);
      } else {
        if (refreshTimer !== null) window.clearInterval(refreshTimer);
        refreshTimer = null;
        drawInvoice(invoiceRegion, result.data, state, memberId);
      }
    }, 15000);
  }
}

export function drawInvoice(region: HTMLElement, invoice: InvoiceResponse, state: AppState, memberId: string): void {
  const session = state.session!;
  const isOperator = session.user.role === 'operator';
  clear(region);
  const table = h('table', { 'aria-label': 'Invoice lines' });
  table.append(h('thead', {}, h('tr', {}, h('th', { text: 'Description' }), h('th', { text: 'Amount' }), h('th', { text: 'Billing state' }), h('th', { text: 'Actions' }))));
  const body = h('tbody');
  for (const line of invoice.lines) {
    const row = h('tr', {},
      h('td', { text: line.description }),
      h('td', { text: money(line.amountCents) }),
      h('td', { text: line.billingStatus === 'billed' ? 'Billed' : 'Pending billing' }),
      h('td', {}),
    );
    if (isOperator && line.kind === 'penalty' && line.bookingId) {
      row.lastElementChild!.append(h('button', {
        text: `Waive fee for ${line.bookingId}`,
        'aria-label': `Waive fee (${line.bookingId})`,
        onclick: async (ev) => {
          const button = ev.target as HTMLElement;
          button.setAttribute('aria-busy', 'true');
          (button as HTMLButtonElement).disabled = true;
          announce('Waiving…');
          try {
            const result = await api<{ booking: { penaltyWaived: boolean }; creditMonth: string }>('POST', `/api/bookings/${line.bookingId}/waive-penalty`, {}, { idempotencyKey: freshKey() });
            if (result.data.booking.penaltyWaived) {
              announce(`Fee waived for ${line.bookingId}.`);
            }
            button.remove();
            refreshBannerSoon();
          } catch (err) {
            announce('');
            button.removeAttribute('aria-busy');
            (button as HTMLButtonElement).disabled = false;
            const failure = err as ApiFailure;
            if (failure instanceof ApiFailure) showAlert(failure.body.message);
            else showAlert('Lineboard could not reach the server. Check the connection and try again.');
          }
        },
      }));
    }
  }
  table.append(body);
  region.append(table);
  region.append(h('p', { class: 'invoice-total display', text: `Total ${money(invoice.totalCents)}` }));
  region.append(h('p', { text: invoice.status === 'closed' ? 'Invoice closed' : 'Invoice open' }));
  if (isOperator && invoice.status === 'open') {
    region.append(h('button', { text: 'Close month', onclick: () => openCloseDialog(region, invoice.month) }));
  }
  region.dataset.month = invoice.month;
  region.dataset.member = memberId;
}

function openCloseDialog(region: HTMLElement, month: string): void {
  const dim = h('div', { class: 'dialog-dim', id: 'dialog-dim' });
  const dialog = h('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Close month', class: 'board-dialog' },
    h('h2', { class: 'display', text: 'Close month' }),
    h('p', { text: `Close ${monthName(month)}? Bookings in this month can no longer change.` }),
    h('button', { text: `Close ${monthName(month)}`, onclick: async (ev) => {
      const button = ev.target as HTMLElement;
      button.setAttribute('aria-busy', 'true');
      (button as HTMLButtonElement).disabled = true;
      announce(`Closing ${monthName(month)}…`);
      dim.remove();
      const closeButton = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Close month');
      if (closeButton) {
        (closeButton as HTMLButtonElement).disabled = true;
        closeButton.setAttribute('aria-busy', 'true');
      }
      try {
        const result = await api<{ month: string; invoices: { memberId: string; totalCents: number }[] }>('POST', `/api/months/${month}/close`, {});
        announce(`${monthName(month)} closed. ${result.data.invoices.length} invoices committed.`);
        const response = await api<{ status: string }>('GET', `/api/members/${region.dataset.member}/invoices/${month}`);
        void response;
        window.setTimeout(() => window.location.reload(), 300);
      } catch (err) {
        announce('');
        const failure = err as ApiFailure;
        if (failure instanceof ApiFailure && failure.body.error === 'month_closed') {
          announce(`${monthName(month)} closed.`);
          showAlert(failure.body.message);
          window.location.reload();
        } else if (failure instanceof ApiFailure) {
          showAlert(failure.body.message);
          if (closeButton) {
            (closeButton as HTMLButtonElement).disabled = false;
            closeButton.removeAttribute('aria-busy');
          }
        } else {
          showAlert('Lineboard could not reach the server. Check the connection and try again.');
          if (closeButton) {
            (closeButton as HTMLButtonElement).disabled = false;
            closeButton.removeAttribute('aria-busy');
          }
        }
      }
    } }),
    h('button', { text: 'Keep open', onclick: () => dim.remove() }),
  );
  dim.append(dialog);
  document.body.append(dim);
  dialog.querySelector('button')?.focus();
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
export async function renderReports(main: HTMLElement, state: AppState): Promise<void> {
  const url = new URLSearchParams(window.location.search);
  const monthParam = url.get('month');
  const currentMonth = state.kitchen?.currentMonth ?? '';
  let month = monthParam ?? currentMonth;
  if (!monthParam) history.replaceState({}, '', `/reports?month=${month}`);
  const monthInput = h('input', { type: 'text', 'aria-label': 'Month', value: month }) as HTMLInputElement;
  const region = h('div', { role: 'region', 'aria-label': 'Utilisation report', id: 'utilisation-region' });
  main.append(h('div', { class: 'panel' }, h('label', { text: 'Month' }, monthInput)));
  main.append(region);
  const commit = () => {
    const value = monthInput.value;
    if (!/^\d{4}-\d{2}$/.test(value)) return;
    history.pushState({}, '', `/reports?month=${value}`);
    void loadReport(value);
  };
  monthInput.addEventListener('change', commit);
  monthInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      commit();
    }
  });
  await loadReport(month);

  async function loadReport(requested: string): Promise<void> {
    region.setAttribute('aria-busy', 'true');
    clear(region);
    const result = await apiOrNull<{
      month: string;
      stations: { stationId: string; name: string; bookedHours: number; peakHours: number; shelfDays: number; revenueCents: number }[];
      totals: { bookedHours: number; peakHours: number; shelfDays: number; revenueCents: number; adjustmentCents: number };
    }>('GET', `/api/reports/utilisation?month=${requested}`);
    if (!result || new URLSearchParams(window.location.search).get('month') !== requested) return;
    region.removeAttribute('aria-busy');
    clear(region);
    region.append(h('h2', { class: 'display', text: `Utilisation for ${monthName(result.data.month)}` }));
    const table = h('table', { 'aria-label': 'Utilisation' });
    table.append(h('thead', {}, h('tr', {},
      h('th', { text: 'Station' }), h('th', { text: 'Booked hours' }), h('th', { text: 'Peak hours' }), h('th', { text: 'Shelf days' }), h('th', { text: 'Revenue' }),
    )));
    const body = h('tbody');
    for (const station of result.data.stations) {
      body.append(h('tr', {},
        h('td', { text: station.name }),
        h('td', { text: String(station.bookedHours) }),
        h('td', { text: String(station.peakHours) }),
        h('td', { text: String(station.shelfDays) }),
        h('td', { text: money(station.revenueCents) }),
      ));
    }
    const totals = result.data.totals;
    body.append(h('tr', { class: 'totals' },
      h('td', { text: 'Totals' }),
      h('td', { text: String(totals.bookedHours) }),
      h('td', { text: String(totals.peakHours) }),
      h('td', { text: String(totals.shelfDays) }),
      h('td', { text: `${money(totals.revenueCents)} Adjustments ${money(totals.adjustmentCents)}` }),
    ));
    table.append(body);
    region.append(table);
    region.append(h('a', { href: `/api/exports/usage.csv?month=${result.data.month}`, text: 'Export usage CSV' }));
  }
}
