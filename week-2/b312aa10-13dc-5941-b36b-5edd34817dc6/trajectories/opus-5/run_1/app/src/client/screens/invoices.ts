import { isMonth, monthLabel } from '../../shared/calendar.js';
import { formatMoney } from '../../shared/format.js';
import { AbandonedError, ApiError, NetworkError, networkCopy, get, post, writeAction } from '../api.js';
import { openDialog } from '../components/dialog.js';
import { memberPicker, type MemberOption } from '../components/memberPicker.js';
import { clear, el, fieldError, labelled, on, replace, setFieldError } from '../dom.js';
import { labelFor } from './bookings.js';
import type { Screen, ScreenContext } from '../screen.js';
import type { HourBank } from '../shell.js';

type InvoiceLine = {
  kind: string;
  bookingId: string;
  description: string;
  amountCents: number;
  billingStatus: 'billed' | 'pending_billing';
};

type Invoice = {
  memberId: string;
  month: string;
  status: 'open' | 'closed';
  lines: InvoiceLine[];
  totalCents: number;
  hourBank: HourBank;
};

type BookingRow = Parameters<typeof labelFor>[0] & { id: string; actions: string[] };

export function invoicesScreen(context: ScreenContext): Screen {
  const isOperator = context.session!.user.role === 'operator';
  const monthInput = el('input', { type: 'text', value: context.query.get('month') ?? '' });
  const monthError = fieldError();
  const showButton = el('button', { type: 'button', text: 'Show invoice' });
  const invoiceRegion = el('div', { role: 'region', 'aria-label': 'Invoice' });
  const picker = isOperator ? memberPicker() : null;

  const header = el('div', { class: 'invoice-controls' }, [
    labelled('Month', monthInput, monthError),
    picker ? el('div', { class: 'picker' }, [labelled('Member', picker.field), picker.listbox]) : null,
    showButton,
  ]);
  const element = el('div', { class: 'invoices-screen' }, [header, invoiceRegion]);

  let token = 0;
  let destroyed = false;
  let bookings: BookingRow[] = [];
  const waived = new Set<string>();
  const waiving = new Set<string>();
  let shownClosed = false;
  let refreshTimer: number | null = null;
  let dialogOpen = false;

  on(showButton, 'click', () => {
    const month = monthInput.value.trim();
    const member = picker?.selectedId() ?? null;
    const parts = [`month=${encodeURIComponent(month)}`];
    if (member) parts.push(`member=${encodeURIComponent(member)}`);
    context.navigate(`/invoices?${parts.join('&')}`);
  });

  function commitMonth(): void {
    const month = monthInput.value.trim();
    if (month.length === 0) return;
    const member = context.query.get('member');
    const parts = [`month=${encodeURIComponent(month)}`];
    if (member) parts.push(`member=${encodeURIComponent(member)}`);
    context.navigate(`/invoices?${parts.join('&')}`);
  }
  on(monthInput, 'keydown', (event) => {
    if (event.key === 'Enter') commitMonth();
  });

  function memberIdForView(): string | null {
    if (!isOperator) return context.session!.user.memberId;
    return context.query.get('member');
  }

  async function load(initial: boolean): Promise<void> {
    const month = context.query.get('month');
    if (month !== null && !isMonth(month)) {
      setFieldError(monthInput, monthError, 'Use a month in the form YYYY-MM.');
      clear(invoiceRegion);
      return;
    }
    setFieldError(monthInput, monthError, null);
    const memberId = memberIdForView();
    if (memberId === null) {
      clear(invoiceRegion);
      if (month !== null) monthInput.value = month;
      else monthInput.value = await currentMonth();
      return;
    }
    token += 1;
    const mine = token;
    if (initial) {
      invoiceRegion.setAttribute('aria-busy', 'true');
      clear(invoiceRegion);
    }
    try {
      const target = month ?? (await currentMonth());
      const result = await get<Invoice>(`/api/members/${memberId}/invoices/${target}`);
      if (destroyed || mine !== token) return;
      if (shownClosed && result.body.status === 'open') return;
      if (month === null) {
        const parts = [`month=${result.body.month}`, `member=${encodeURIComponent(memberId)}`];
        context.fillAddress(`/invoices?${parts.join('&')}`);
      }
      monthInput.value = result.body.month;
      shownClosed = result.body.status === 'closed';
      await loadBookings(memberId, result.body.month, mine);
      if (destroyed || mine !== token) return;
      drawInvoice(result.body);
      context.setHourBank(result.body.hourBank);
      if (isOperator && picker && picker.selectedId() === null) await selectFromAddress(memberId);
    } catch (error) {
      if (error instanceof AbandonedError) return;
      if (destroyed || mine !== token) return;
      if (error instanceof ApiError) {
        if (error.status === 404) {
          picker?.setSelected(null);
          clear(invoiceRegion);
          context.showAlert('That member was not found.');
        } else if (error.status === 422) {
          setFieldError(monthInput, monthError, error.firstFieldMessage() ?? error.copy);
        } else {
          context.showAlert(error.copy);
        }
      } else if (error instanceof NetworkError) {
        context.showAlert(networkCopy);
      }
    } finally {
      if (mine === token) invoiceRegion.removeAttribute('aria-busy');
    }
  }

  async function currentMonth(): Promise<string> {
    const kitchen = await get<{ currentMonth: string }>('/api/kitchen');
    return kitchen.body.currentMonth;
  }

  async function selectFromAddress(memberId: string): Promise<void> {
    try {
      const result = await get<{ member: MemberOption }>(`/api/members/${memberId}`);
      picker?.setSelected(result.body.member);
    } catch {
      // The field stays as typed.
    }
  }

  async function loadBookings(memberId: string, month: string, mine: number): Promise<void> {
    try {
      const result = await get<{ bookings: BookingRow[] }>(
        `/api/bookings?month=${month}&memberId=${memberId}`,
      );
      if (mine === token) bookings = result.body.bookings;
    } catch {
      bookings = [];
    }
  }

  function drawInvoice(invoice: Invoice): void {
    const table = el('table', { 'aria-label': 'Invoice lines' }, [
      el('thead', {}, el('tr', {}, [
        el('th', { text: 'Description' }),
        el('th', { text: 'Amount' }),
        el('th', { text: 'Billing' }),
        el('th', { text: 'Actions' }),
      ])),
      el(
        'tbody',
        {},
        invoice.lines.map((line) =>
          el('tr', {}, [
            el('td', { text: line.description }),
            el('td', { text: formatMoney(line.amountCents) }),
            el('td', { text: line.billingStatus === 'billed' ? 'Billed' : 'Pending billing' }),
            el('td', {}, waiveButton(line)),
          ]),
        ),
      ),
    ]);
    const children: Array<HTMLElement | null> = [
      table,
      el('p', { text: `Total ${formatMoney(invoice.totalCents)}` }),
      el('p', { text: invoice.status === 'closed' ? 'Invoice closed' : 'Invoice open' }),
      el('p', {
        text: `${invoice.hourBank.balanceHours} h left \u00b7 ${monthLabel(invoice.month)}`,
        class: 'invoice-bank',
      }),
    ];
    if (isOperator && invoice.status === 'open') {
      const closeButton = el('button', { type: 'button', text: 'Close month' });
      on(closeButton, 'click', () => openCloseDialog(invoice, closeButton));
      children.push(closeButton);
    }
    replace(invoiceRegion, children);
  }

  function waiveButton(line: InvoiceLine): HTMLElement | null {
    if (!isOperator || line.kind !== 'penalty') return null;
    const booking = bookings.find((candidate) => candidate.id === line.bookingId);
    if (!booking || !booking.actions.includes('waive_penalty')) return null;
    if (waived.has(line.bookingId)) return null;
    const label = `Waive fee for ${labelFor(booking)} (${booking.id})`;
    const button = el('button', { type: 'button', text: 'Waive fee', 'aria-label': label });
    if (waiving.has(line.bookingId)) {
      button.setAttribute('disabled', '');
      button.setAttribute('aria-busy', 'true');
    }
    on(button, 'click', () => void waive(line.bookingId, labelFor(booking), button));
    return button;
  }

  async function waive(bookingId: string, label: string, button: HTMLElement): Promise<void> {
    waiving.add(bookingId);
    button.setAttribute('disabled', '');
    button.setAttribute('aria-busy', 'true');
    context.announce('Waiving\u2026');
    try {
      const result = await writeAction<{ creditMonth: string }>(
        `/api/bookings/${bookingId}/waive-penalty`,
        {},
      );
      waiving.delete(bookingId);
      waived.add(bookingId);
      const creditMonth = result.body.creditMonth;
      context.announce(
        creditMonth === context.query.get('month')
          ? `Fee waived for ${label}.`
          : `Fee waived for ${label}. The credit appears on the ${monthLabel(creditMonth)} invoice.`,
      );
      await load(false);
    } catch (error) {
      waiving.delete(bookingId);
      if (error instanceof AbandonedError) return;
      if (error instanceof ApiError) context.showAlert(error.copy);
      else if (error instanceof NetworkError) context.showAlert(networkCopy);
    }
  }

  function openCloseDialog(invoice: Invoice, opener: HTMLElement): void {
    const label = monthLabel(invoice.month);
    const confirmButton = el('button', { type: 'button', text: `Close ${label}` });
    const keepButton = el('button', { type: 'button', text: 'Keep open' });
    dialogOpen = true;
    const handle = openDialog({
      label: 'Close month',
      opener,
      content: [
        el('p', { text: `Close ${label}? Bookings in this month can no longer change.` }),
        el('div', { class: 'dialog-actions' }, [confirmButton, keepButton]),
      ],
      onClosed: () => {
        dialogOpen = false;
      },
    });
    on(keepButton, 'click', () => handle.close());
    on(confirmButton, 'click', () => {
      handle.close();
      void runClose(invoice, opener, label);
    });
  }

  async function runClose(
    invoice: Invoice,
    closeButton: HTMLElement,
    label: string,
  ): Promise<void> {
    closeButton.setAttribute('disabled', '');
    closeButton.setAttribute('aria-busy', 'true');
    context.announce(`Closing ${label}\u2026`);
    try {
      const result = await post<{ invoices: unknown[] }>(
        `/api/months/${invoice.month}/close`,
        {},
      );
      shownClosed = true;
      context.announce(`${label} closed. ${result.body.invoices.length} invoices committed.`);
      await load(false);
      invoiceRegion.querySelector('table')?.setAttribute('tabindex', '-1');
      invoiceRegion.querySelector<HTMLElement>('table')?.focus();
    } catch (error) {
      if (error instanceof AbandonedError) return;
      if (error instanceof ApiError) {
        context.showAlert(error.copy);
        if (error.code === 'month_closed') {
          shownClosed = true;
          await load(false);
          invoiceRegion.querySelector<HTMLElement>('table')?.focus();
          return;
        }
      } else if (error instanceof NetworkError) {
        context.showAlert(networkCopy);
      }
      closeButton.removeAttribute('disabled');
      closeButton.removeAttribute('aria-busy');
      closeButton.focus();
    }
  }

  void load(true);
  refreshTimer = window.setInterval(() => {
    if (shownClosed) return;
    if (dialogOpen) {
      void refreshLinesOnly();
      return;
    }
    void load(false);
  }, 12000);

  /** Keeps the operator's place: the dialog stays open while the lines redraw. */
  async function refreshLinesOnly(): Promise<void> {
    await load(false);
  }

  return {
    element,
    destroy: () => {
      destroyed = true;
      if (refreshTimer !== null) window.clearInterval(refreshTimer);
    },
  };
}
