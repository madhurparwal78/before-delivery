import { api, el, isApiError, mountOutageBanner, formatMoneyMinor, CURRENCY_SYMBOLS, CURRENCY_EXPONENTS, formatUtcDate, formatUtcTime, MILESTONE_LABELS, trapDialog, escapeHtml, setStatus } from '../shell';

export interface Engagement {
  id: string;
  reference: string;
  title: string;
  state: string;
  brand: { id: string; name: string; currency: string };
  quote: {
    currency: string;
    exponent: number;
    revision: number;
    fx_rate: string;
    fx_locked: boolean;
    fx_locked_at: string | null;
    lines: { shot_code: string; title: string; quantity: number; unit_price_gbp_minor: number; amount_minor: number }[];
    subtotal_minor: number;
    vat_minor: number;
    total_minor: number;
    milestones: { deposit_minor: number; look_dev_minor: number; final_delivery_minor: number };
  };
  files: IntakeFile[];
  invoices: Invoice[];
  ledger: LedgerEntry[];
  revision_rounds: { look_dev: number; final_delivery: number };
}

export interface IntakeFile {
  id: string;
  name: string;
  kind: string;
  size_bytes: number;
  status: string;
  measurement: string | null;
  needs_unit_confirmation: boolean;
  unit: string | null;
  dimensions_m: { x: number; y: number; z: number } | null;
  dimensions_mm: { x: number; y: number; z: number } | null;
}

export interface Invoice {
  id: string;
  engagement_id: string;
  milestone: string;
  number: string | null;
  status: string;
  lines: { description: string; amount_minor: number }[];
  amount_minor: number;
  balance_minor: number;
  currency: string;
  killbill_invoice_id: string | null;
  failed_attempts: number;
  issued_at: string | null;
  overdue_at: string | null;
}

export interface LedgerEntry {
  id: string;
  kind: string;
  amount_minor: number;
  currency: string;
  invoice_id: string | null;
  killbill_payment_id: string;
  created_at: string;
}

export function mountAccount(): void {
  const main = document.querySelector('main') as HTMLElement;
  main.innerHTML = '';
  main.id = 'main';
  mountOutageBanner();
  const section = el('section', 'page-section');
  const heading = el('h1', 'display-2');
  heading.textContent = 'Your account';
  section.appendChild(heading);
  const list = el('ul');
  list.id = 'engagement-list';
  section.appendChild(list);
  main.appendChild(section);
  void loadEngagements(list);
}

async function loadEngagements(list: HTMLElement): Promise<void> {
  const { status, json } = await api<{ engagements: { id: string; reference: string; title: string; state: string }[] }>('GET', '/api/engagements');
  if (status === 401) {
    redirectToSignIn();
    return;
  }
  if (status !== 200 || isApiError(json)) {
    return;
  }
  const engagements = (json as { engagements: { id: string; reference: string; title: string; state: string }[] }).engagements;
  if (engagements.length === 0) {
    const empty = el('p', 'lede');
    empty.textContent = 'No engagements yet. Start a project to begin.';
    list.appendChild(empty);
    return;
  }
  for (const engagement of engagements) {
    const item = el('li');
    const link = el('a');
    link.href = `/account/engagements/${engagement.id}`;
    link.textContent = `${engagement.reference} — ${engagement.title} (${engagement.state.replace(/_/g, ' ')})`;
    item.appendChild(link);
    list.appendChild(item);
  }
}

export function redirectToSignIn(): void {
  const current = window.location.pathname + window.location.search;
  window.location.href = `/sign-in?next=${encodeURIComponent(current)}`;
}

export function mountEngagement(path: string): void {
  const engagementId = path.split('/')[3] ?? '';
  const main = document.querySelector('main') as HTMLElement;
  main.innerHTML = '';
  main.id = 'main';
  const refreshStatus = mountOutageBanner().refresh;
  const section = el('section', 'page-section');
  const heading = el('h1', 'display-2');
  const headMeta = el('p', 'section-label');
  const rigLink = el('a', 'button');
  rigLink.textContent = 'Open the Shot Rig';
  const invoicesHeading = el('h2', 'display-4');
  invoicesHeading.textContent = 'Invoices';
  const invoicesRegion = el('div');
  invoicesRegion.id = 'invoices';
  const receiptsHeading = el('h2', 'display-4');
  receiptsHeading.textContent = 'Receipts';
  const receiptsList = el('ul');
  receiptsList.setAttribute('aria-label', 'Receipts');
  const filesHeading = el('h2', 'display-4');
  filesHeading.textContent = 'Intake files';
  const filesList = el('ul', 'intake-list');
  filesList.setAttribute('aria-label', 'Intake files');
  section.append(heading, headMeta, rigLink, invoicesHeading, invoicesRegion, receiptsHeading, receiptsList, filesHeading, filesList);
  main.appendChild(section);

  const load = async (): Promise<void> => {
    const { status, json } = await api<Engagement>('GET', `/api/engagements/${engagementId}`);
    if (status === 401) {
      redirectToSignIn();
      return;
    }
    if (status !== 200 || isApiError(json)) {
      void import('./notfound').then(m => {
        main.innerHTML = '';
        m.mountNotFound();
      });
      return;
    }
    const engagement = json as Engagement;
    render(engagement);
  };

  const render = (engagement: Engagement): void => {
    heading.textContent = engagement.title;
    headMeta.textContent = `${engagement.reference} · ${engagement.brand.name} · ${engagement.state.replace(/_/g, ' ')}`;
    rigLink.href = `/rig/${engagement.id}`;
    renderInvoices(invoicesRegion, engagement, {
      reload: load,
      refreshStatus,
      onPaid: () => {
        const success = el('div');
        success.innerHTML = `<h2 class="display-4" role="status">Invoice paid</h2><p>Thank you. A receipt will follow by email.</p>`;
        success.setAttribute('role', 'status');
        section.prepend(success);
      },
    });
    renderReceipts(receiptsList, engagement);
    renderFiles(filesList, engagement);
  };

  void load();
  void refreshStatus;
  // Poll while any invoice is payment_failed (statuses update in place).
  setInterval(() => {
    void load();
  }, 10_000);
}

interface InvoiceDialogHooks {
  reload: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  onPaid: () => void;
}

function renderInvoices(region: HTMLElement, engagement: Engagement, hooks: InvoiceDialogHooks): void {
  region.innerHTML = '';
  const invoices = engagement.invoices.filter(invoice => invoice.issued_at !== null);
  const symbol = CURRENCY_SYMBOLS[engagement.brand.currency] ?? '£';
  const exponent = CURRENCY_EXPONENTS[engagement.brand.currency] ?? 2;
  const format = (minor: number): string => formatMoneyMinor(minor, symbol, exponent);

  const payable = (invoice: Invoice): boolean => invoice.status === 'issued' || invoice.status === 'payment_failed' || invoice.status === 'overdue';

  const payButtonLabel = (invoice: Invoice): string => `Pay invoice ${invoice.number}`;

  const mountPayDialog = (invoice: Invoice, button: HTMLElement): void => {
    button.addEventListener('click', () => {
      const dialog = document.createElement('dialog');
      dialog.setAttribute('aria-label', payButtonLabel(invoice));
      const body = el('div', 'dialog-body');
      const title = el('h2');
      title.textContent = payButtonLabel(invoice);
      const testCards = el('p', 'test-cards');
      testCards.innerHTML = `Test cards: <code>4242 4242 4242 4242</code> approves, <code>4000 0000 0000 0002</code> declines.`;
      const fields = [
        { name: 'number', label: 'Card number' },
        { name: 'expiry', label: 'Expiry (MM/YY)' },
        { name: 'cvc', label: 'Security code' },
        { name: 'name', label: 'Name on card' },
      ];
      const inputs: Record<string, HTMLInputElement> = {};
      for (const field of fields) {
        const wrap = el('div', 'field');
        const label = el('label');
        label.htmlFor = `card-${field.name}`;
        label.textContent = field.label;
        const input = el('input');
        input.id = `card-${field.name}`;
        input.setAttribute('data-field', `card.${field.name}`);
        inputs[field.name] = input;
        wrap.append(label, input);
        body.appendChild(wrap);
      }
      const errorLine = el('p', 'dialog-error');
      errorLine.hidden = true;
      const actions = el('div', 'dialog-actions');
      const payButton = el('button', 'button');
      payButton.textContent = `Pay ${format(invoice.amount_minor)}`;
      payButton.dataset.pendingLabel = 'Processing payment';
      const cancelButton = el('button', 'button secondary');
      cancelButton.textContent = 'Cancel';
      actions.append(cancelButton, payButton);
      body.append(errorLine, actions);
      dialog.appendChild(body);
      document.body.appendChild(dialog);
      trapDialog(dialog, () => {
        dialog.remove();
      });
      cancelButton.addEventListener('click', () => {
        dialog.close();
        dialog.remove();
        button.focus();
      });
      payButton.addEventListener('click', async () => {
        errorLine.hidden = true;
        payButton.setAttribute('aria-busy', 'true');
        payButton.textContent = payButton.dataset.pendingLabel ?? 'Processing payment';
        const key = `pay-${invoice.id}-${Date.now()}`;
        const { status, json } = await api<{ invoice: Invoice }>('POST', `/api/invoices/${invoice.id}/payments`, {
          card: {
            number: inputs.number.value,
            expiry: inputs.expiry.value,
            cvc: inputs.cvc.value,
            name: inputs.name.value,
          },
        }, { 'Idempotency-Key': key });
        payButton.removeAttribute('aria-busy');
        payButton.textContent = `Pay ${format(invoice.amount_minor)}`;
        if (status === 201 && !isApiError(json)) {
          dialog.close();
          dialog.remove();
          hooks.onPaid();
          void hooks.reload();
          return;
        }
        if (status === 503) {
          errorLine.textContent = isApiError(json) ? json.message : 'Billing is offline right now. Nothing has been charged. Please try again in a few minutes.';
          errorLine.hidden = false;
          payButton.focus();
          void hooks.refreshStatus();
          return;
        }
        if (isApiError(json)) {
          const fieldsCopy = json.fields ?? {};
          if (Object.keys(fieldsCopy).length > 0) {
            errorLine.textContent = Object.values(fieldsCopy)[0] ?? json.message;
          } else {
            errorLine.textContent = json.message;
          }
          errorLine.hidden = false;
          payButton.focus();
        }
      });
    });
  };

  const makePayButton = (invoice: Invoice): HTMLButtonElement => {
    const button = el('button', 'button secondary');
    button.textContent = payButtonLabel(invoice);
    mountPayDialog(invoice, button);
    return button;
  };

  // Wide table (five columns) from 1200px.
  const wide = el('table', 'data-table invoices-wide');
  const wideCaption = el('caption', 'visually-hidden');
  wideCaption.textContent = 'Invoices';
  wide.appendChild(wideCaption);
  const wideHead = el('thead');
  const wideHeadRow = el('tr');
  for (const column of ['Milestone', 'Invoice', 'Amount', 'Status', 'Action']) {
    const th = el('th');
    th.textContent = column;
    th.scope = 'col';
    wideHeadRow.appendChild(th);
  }
  wideHead.appendChild(wideHeadRow);
  wide.appendChild(wideHead);
  const wideBody = el('tbody');
  wide.appendChild(wideBody);
  for (const invoice of invoices) {
    const row = el('tr');
    const milestoneCell = el('td');
    milestoneCell.textContent = MILESTONE_LABELS[invoice.milestone] ?? invoice.milestone;
    const invoiceCell = el('td');
    invoiceCell.textContent = invoice.number ?? '';
    const amountCell = el('td', 'num');
    amountCell.textContent = format(invoice.amount_minor);
    const statusCell = el('td');
    const statusWord = el('span', `status-word ${invoice.status}`);
    statusWord.textContent = statusWordFor(invoice.status);
    statusCell.appendChild(statusWord);
    const actionCell = el('td');
    if (payable(invoice)) {
      actionCell.appendChild(makePayButton(invoice));
    }
    row.append(milestoneCell, invoiceCell, amountCell, statusCell, actionCell);
    wideBody.appendChild(row);
  }

  // Narrow table (three columns) from 768 to 1199.
  const narrow = el('table', 'data-table invoices-narrow');
  const narrowCaption = el('caption', 'visually-hidden');
  narrowCaption.textContent = 'Invoices';
  narrow.appendChild(narrowCaption);
  const narrowHead = el('thead');
  const narrowHeadRow = el('tr');
  for (const column of ['Milestone', 'Amount', 'Status']) {
    const th = el('th');
    th.textContent = column;
    th.scope = 'col';
    narrowHeadRow.appendChild(th);
  }
  narrowHead.appendChild(narrowHeadRow);
  narrow.appendChild(narrowHead);
  const narrowBody = el('tbody');
  narrow.appendChild(narrowBody);
  for (const invoice of invoices) {
    const row = el('tr');
    const milestoneCell = el('td');
    const milestoneLabel = el('div');
    milestoneLabel.textContent = MILESTONE_LABELS[invoice.milestone] ?? invoice.milestone;
    const invoiceNumber = el('div');
    invoiceNumber.className = 'file-size';
    invoiceNumber.textContent = invoice.number ?? '';
    milestoneCell.append(milestoneLabel, invoiceNumber);
    const amountCell = el('td', 'num');
    amountCell.textContent = format(invoice.amount_minor);
    const statusCell = el('td');
    const statusWord = el('span', `status-word ${invoice.status}`);
    statusWord.textContent = statusWordFor(invoice.status);
    statusCell.appendChild(statusWord);
    if (invoice.status === 'payment_failed') {
      const payBy = el('div', 'pay-by');
      payBy.textContent = payByLine(invoice);
      statusCell.appendChild(payBy);
    }
    if (payable(invoice)) {
      statusCell.appendChild(makePayButton(invoice));
    }
    row.append(milestoneCell, amountCell, statusCell);
    narrowBody.appendChild(row);
  }

  // Cards below 768.
  const cards = el('div', 'invoices-cards');
  for (const invoice of invoices) {
    const card = el('div', 'invoice-card');
    card.innerHTML = `
      <div class="row"><span>${escapeHtml(MILESTONE_LABELS[invoice.milestone] ?? invoice.milestone)}</span><span class="status-word ${invoice.status}">${escapeHtml(statusWordFor(invoice.status))}</span></div>
      <div class="row"><span>Invoice</span><span>${escapeHtml(invoice.number ?? '')}</span></div>
      <div class="row"><span>Amount</span><span>${escapeHtml(format(invoice.amount_minor))}</span></div>
    `;
    if (invoice.status === 'payment_failed') {
      const payBy = el('p', 'pay-by');
      payBy.textContent = payByLine(invoice);
      card.appendChild(payBy);
    }
    if (payable(invoice)) {
      card.appendChild(makePayButton(invoice));
    }
    cards.appendChild(card);
  }

  region.append(wide, narrow, cards);
}

function statusWordFor(status: string): string {
  switch (status) {
    case 'payment_failed': return 'Payment failed';
    default: return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
  }
}

function payByLine(invoice: Invoice): string {
  if (!invoice.overdue_at) {
    return '';
  }
  const date = new Date(invoice.overdue_at);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const dateText = `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  const timeText = `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
  return `Pay by ${dateText}, ${timeText} UTC to avoid an overdue notice.`;
}

function renderReceipts(list: HTMLElement, engagement: Engagement): void {
  list.innerHTML = '';
  const symbol = CURRENCY_SYMBOLS[engagement.brand.currency] ?? '£';
  const exponent = CURRENCY_EXPONENTS[engagement.brand.currency] ?? 2;
  for (const entry of engagement.ledger) {
    const item = el('li');
    const kind = entry.kind === 'invoice_payment' ? 'Invoice payment' : entry.kind === 'deposit' ? 'Deposit' : 'Refund';
    const date = new Date(entry.created_at);
    item.textContent = `${kind} — ${formatMoneyMinor(entry.amount_minor, symbol, exponent)} — ${date.toISOString().slice(0, 10)}`;
    list.appendChild(item);
  }
  if (engagement.ledger.length === 0) {
    const empty = el('li');
    empty.textContent = 'No receipts yet.';
    list.appendChild(empty);
  }
  void formatUtcDate;
  void formatUtcTime;
  void setStatus;
}

function renderFiles(list: HTMLElement, engagement: Engagement): void {
  list.innerHTML = '';
  for (const file of engagement.files) {
    const item = el('li');
    const name = el('span', 'file-name');
    name.textContent = file.name;
    const size = el('span', 'file-size');
    size.textContent = formatBytes(file.size_bytes);
    const status = el('span', `intake-status ${file.status === 'superseded' ? 'superseded' : ''}`);
    status.textContent = file.status === 'received' ? 'Received' : 'Superseded';
    const download = el('a');
    download.href = `/api/engagements/${engagement.id}/files/${file.id}/content`;
    download.textContent = `Download ${file.name}`;
    item.append(name, size, status, download);
    list.appendChild(item);
  }
  if (engagement.files.length === 0) {
    const empty = el('li');
    empty.textContent = 'No files uploaded yet.';
    list.appendChild(empty);
  }
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) {
    return `${(bytes / 1_000_000).toFixed(1)} MB`;
  }
  if (bytes >= 1000) {
    return `${(bytes / 1000).toFixed(0)} kB`;
  }
  return `${bytes} B`;
}
