import { STATUS_COPY } from '../../domain/copy.ts';
import type { Currency } from '../../domain/markets.ts';
import { formatMoney, parseAmount } from '../../domain/money.ts';
import { formatCopenhagenDate } from '../../domain/time.ts';
import { openDialog, setFocusAfterSuccess } from '../dialogs.ts';
import { announce } from '../feedback.ts';
import { DURATIONS, reducedMotion } from '../motion.ts';
import { request, RequestFailed } from '../net.ts';
import { control, numberOf, onAction, onOpen, pageData, valueOf } from '../ui.ts';

interface AllocationLine {
  styleNumber: string;
  styleName: string;
  requestedQuantity: number;
  allocatedQuantity: number;
  unitPriceMinor: number | null;
  netMinor: number | null;
  vatMinor: number | null;
  lineTotalMinor: number | null;
}

interface Allocation {
  id: string;
  version: number;
  currency: Currency;
  status: string;
  invoiceNumber: string | null;
  priceListEffectiveDate: string | null;
  totalMinor: number | null;
  lines: AllocationLine[];
}

interface DropAllocationsData {
  screen: 'drop-allocations';
  dropId: string;
  styles: string[];
}

export function startDropAllocationsScreen(): void {
  const data = pageData<DropAllocationsData>();

  onOpen('open-split', (button) => {
    openDialog('Split edition', button);
    void loadProposal(data);
  });
  setFocusAfterSuccess('Split edition', () =>
    document.querySelector<HTMLElement>('#allocations-heading'),
  );

  onAction(
    'apply-split',
    async () =>
      request<{ items: Allocation[] }>(`/api/drops/${encodeURIComponent(data.dropId)}/split`, {
        method: 'POST',
      }),
    {
      region: 'Allocation status',
      dialog: 'Split edition',
      focusAfter: '#allocations-heading',
      success: (result) => STATUS_COPY.splitApplied((result as { items: Allocation[] }).items.length),
      own: (failure) =>
        failure.code === 'drop_has_confirmed' ? STATUS_COPY.confirmedExists : null,
      reload: true,
    },
  );

  onOpen('open-enter-allocation', (button) => openDialog('Enter allocation', button));
  onAction(
    'save-entered-allocation',
    async () =>
      request('/api/allocations', {
        method: 'POST',
        body: {
          dropId: data.dropId,
          stockistId: valueOf('stockistId'),
          internalNote: control('internalNote')?.value ?? '',
          lines: data.styles.map((styleNumber) => ({
            styleNumber,
            quantity: numberOf(`quantity.${styleNumber}`),
          })),
        },
      }),
    {
      region: 'Allocation status',
      dialog: 'Enter allocation',
      success: STATUS_COPY.allocationSaved,
      own: (failure) => (failure.code === 'allocation_exists' ? STATUS_COPY.allocationExists : null),
      map: lineFieldMapper(data.styles, 'quantity'),
      reload: true,
    },
  );

  onOpen('open-record-request', (button) => openDialog('Record request', button));
  onAction(
    'save-request',
    async () =>
      request(`/api/drops/${encodeURIComponent(data.dropId)}/requests`, {
        method: 'POST',
        body: {
          stockistId: valueOf('requestStockistId'),
          lines: data.styles.map((styleNumber) => ({
            styleNumber,
            quantity: numberOf(`request.${styleNumber}`),
          })),
        },
      }),
    {
      region: 'Allocation status',
      dialog: 'Record request',
      success: STATUS_COPY.requestSaved,
      own: (failure) => (failure.code === 'allocation_split' ? STATUS_COPY.splitExists : null),
      map: lineFieldMapper(data.styles, 'request'),
      reload: true,
    },
  );
}

function lineFieldMapper(styles: readonly string[], prefix: string): (path: string) => string {
  return (path) => {
    const match = /^lines\.(\d+)\.quantity$/.exec(path);
    if (match === null) return path;
    const style = styles[Number(match[1])];
    return style === undefined ? path : `${prefix}.${style}`;
  };
}

interface ProposalShare {
  stockistId: string;
  stockistName: string;
  lines: { styleNumber: string; allocatedQuantity: number }[];
}

async function loadProposal(data: DropAllocationsData): Promise<void> {
  const body = document.querySelector<HTMLElement>('[data-split-rows]');
  if (body === null) return;
  try {
    const answer = await request<{ items: ProposalShare[] }>(
      `/api/drops/${encodeURIComponent(data.dropId)}/split`,
    );
    body.replaceChildren(
      ...answer.items.map((share) => {
        const row = document.createElement('tr');
        const name = document.createElement('td');
        name.textContent = share.stockistName;
        row.append(name);
        for (const styleNumber of data.styles) {
          const cell = document.createElement('td');
          cell.className = 'mono';
          cell.textContent = String(
            share.lines.find((line) => line.styleNumber === styleNumber)?.allocatedQuantity ?? 0,
          );
          row.append(cell);
        }
        return row;
      }),
    );
  } catch (error) {
    if (error instanceof RequestFailed) announce('Allocation status', error.failure.message);
  }
}

interface AllocationData {
  screen: 'allocation';
  allocationId: string;
  version: number;
  currency: Currency;
  styles: string[];
}

export function startAllocationScreen(): void {
  const data = pageData<AllocationData>();
  let version = data.version;

  onAction(
    'save-allocation',
    async () =>
      request<Allocation>(`/api/allocations/${encodeURIComponent(data.allocationId)}`, {
        method: 'PATCH',
        body: {
          version,
          internalNote: control('internalNote')?.value ?? '',
          lines: data.styles.map((styleNumber) => ({
            styleNumber,
            quantity: Number(
              document.querySelector<HTMLInputElement>(`[data-allocated="${styleNumber}"]`)?.value ??
                '0',
            ),
          })),
        },
      }),
    {
      region: 'Allocation status',
      success: STATUS_COPY.allocationSaved,
      own: (failure) => {
        if (failure.code === 'allocation_confirmed') return STATUS_COPY.alreadyConfirmed;
        return null;
      },
      map: lineFieldMapper(data.styles, 'allocated'),
      after: (result) => {
        const saved = result as Allocation;
        version = saved.version;
        applyAllocation(saved, false);
      },
    },
  );

  document.addEventListener('hourline:stale-allocation', (event) => {
    const detail = (event as CustomEvent<Allocation>).detail;
    version = detail.version;
    applyAllocation(detail, true);
  });

  onOpen('open-confirm', (button) => {
    openDialog('Confirm allocation', button);
    void loadQuote(data);
  });
  setFocusAfterSuccess('Confirm allocation', () =>
    document.querySelector<HTMLElement>('h1.page-heading'),
  );

  onAction(
    'confirm-allocation',
    async () =>
      request<Allocation>(`/api/allocations/${encodeURIComponent(data.allocationId)}/confirm`, {
        method: 'POST',
        body: { version },
      }),
    {
      region: 'Invoicing status',
      dialog: 'Confirm allocation',
      focusAfter: 'h1.page-heading',
      success: (result) =>
        STATUS_COPY.allocationConfirmedCopy((result as Allocation).invoiceNumber ?? ''),
      own: (failure) => {
        if (failure.code === 'allocation_confirmed') return STATUS_COPY.alreadyConfirmed;
        if (failure.code === 'billing_unavailable') return STATUS_COPY.billingDown;
        return failure.status === 409 ? failure.message : null;
      },
      reload: true,
    },
  );
}

/** A refused save slides the inputs back to the saved values and announces the stale copy. */
function applyAllocation(allocation: Allocation, rollback: boolean): void {
  for (const line of allocation.lines) {
    const input = document.querySelector<HTMLInputElement>(`[data-allocated="${line.styleNumber}"]`);
    if (input !== null) {
      if (rollback && !reducedMotion()) {
        input.animate(
          [{ opacity: '0.4' }, { opacity: '1' }],
          { duration: DURATIONS.state, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
        );
      }
      input.value = String(line.allocatedQuantity);
    }
    const row = document.querySelector<HTMLElement>(`[data-line="${line.styleNumber}"]`);
    if (row === null) continue;
    const set = (selector: string, minor: number | null): void => {
      const cell = row.querySelector<HTMLElement>(selector);
      if (cell !== null) cell.textContent = minor === null ? '—' : formatMoney(minor, allocation.currency);
    };
    set('[data-unit-price]', line.unitPriceMinor);
    set('[data-net]', line.netMinor);
    set('[data-vat]', line.vatMinor);
    set('[data-line-total]', line.lineTotalMinor);
  }
  const total = document.querySelector<HTMLElement>('[data-allocation-total]');
  if (total !== null) {
    total.textContent =
      allocation.totalMinor === null ? '' : `Total ${formatMoney(allocation.totalMinor, allocation.currency)}`;
  }
}

async function loadQuote(data: AllocationData): Promise<void> {
  const body = document.querySelector<HTMLElement>('[data-quote-rows]');
  const dateLine = document.querySelector<HTMLElement>('[data-quote-date]');
  if (body === null) return;
  try {
    const quote = await request<Allocation>(
      `/api/allocations/${encodeURIComponent(data.allocationId)}/quote`,
    );
    body.replaceChildren(
      ...quote.lines
        .filter((line) => line.allocatedQuantity > 0)
        .map((line) => {
          const row = document.createElement('tr');
          for (const text of [
            `${line.styleNumber} ${line.styleName}`,
            String(line.allocatedQuantity),
            line.unitPriceMinor === null ? '—' : formatMoney(line.unitPriceMinor, quote.currency),
            line.netMinor === null ? '—' : formatMoney(line.netMinor, quote.currency),
            line.vatMinor === null ? '—' : formatMoney(line.vatMinor, quote.currency),
            line.lineTotalMinor === null ? '—' : formatMoney(line.lineTotalMinor, quote.currency),
          ]) {
            const cell = document.createElement('td');
            cell.className = 'mono';
            cell.textContent = text;
            row.append(cell);
          }
          return row;
        }),
    );
    if (dateLine !== null && quote.priceListEffectiveDate !== null) {
      dateLine.textContent = `Prices from the list in force on ${formatCopenhagenDate(quote.priceListEffectiveDate)}`;
    }
  } catch (error) {
    if (error instanceof RequestFailed) announce('Invoicing status', error.failure.message);
  }
}

interface PriceListData {
  screen: 'price-lists';
  currencies: Currency[];
}

export function startPriceListsScreen(): void {
  const data = pageData<PriceListData>();
  onOpen('open-add-price-list', (button) => openDialog('Add price list', button));

  onAction(
    'save-price-list',
    async () => {
      const prices = parsePriceLines(control('prices')?.value ?? '', data.currencies);
      const effectiveDate = valueOf('effectiveDate');
      await request('/api/price-lists', {
        method: 'POST',
        body: { name: valueOf('priceListName'), effectiveDate, prices },
      });
      return effectiveDate;
    },
    {
      region: 'Price list status',
      dialog: 'Add price list',
      success: (result) => STATUS_COPY.priceListSaved(formatCopenhagenDate(result as string)),
      map: (path) => (path.startsWith('prices') ? 'prices' : path === 'name' ? 'priceListName' : path),
      reload: true,
    },
  );
}

function parsePriceLines(
  value: string,
  currencies: readonly Currency[],
): { styleNumber: string; currency: string; unitPriceMinor: number }[] {
  const prices: { styleNumber: string; currency: string; unitPriceMinor: number }[] = [];
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const parts = trimmed.split(/\s+/);
    const styleNumber = parts[0] ?? '';
    const currency = (parts[1] ?? '').toUpperCase();
    const amount = parts.slice(2).join('');
    const known = currencies.find((code) => code === currency);
    const minor = known === undefined ? null : parseAmount(amount, known);
    prices.push({
      styleNumber,
      currency,
      unitPriceMinor: minor ?? 0,
    });
  }
  return prices;
}

interface LineSheetData {
  screen: 'line-sheet';
  dropId: string;
  currency: Currency;
}

interface ImportReport {
  rows: number;
  matched: number;
  updated: number;
  unchanged: number;
  orphans: { line: number; styleNumber: string }[];
  report: { line: number; styleNumber: string; outcome: string }[];
}

export function startLineSheetScreen(): void {
  const data = pageData<LineSheetData>();

  control('exportCurrency')?.addEventListener('change', (event) => {
    const currency = (event.target as HTMLSelectElement).value;
    for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-export-link]')) {
      link.href = `/api/drops/${encodeURIComponent(data.dropId)}/line-sheet.csv?currency=${currency}`;
    }
    window.location.assign(`${window.location.pathname}?currency=${currency}`);
  });

  onOpen('open-import', (button) => openDialog('Import line sheet', button));
  setFocusAfterSuccess('Import line sheet', () =>
    document.querySelector<HTMLElement>('#import-report-heading'),
  );

  onAction(
    'import-line-sheet',
    async () => {
      const input = document.querySelector<HTMLInputElement>('[data-field-control="lineSheetFile"]');
      const file = input?.files?.[0];
      const form = new FormData();
      if (file !== undefined) form.set('file', file);
      return request<ImportReport>(
        `/api/drops/${encodeURIComponent(data.dropId)}/line-sheet/import`,
        { method: 'POST', formData: form },
      );
    },
    {
      region: 'Line sheet status',
      dialog: 'Import line sheet',
      success: (result) => {
        const report = result as ImportReport;
        return STATUS_COPY.importFinished(
          report.matched,
          report.updated,
          report.unchanged,
          report.orphans.length,
        );
      },
      own: (failure) =>
        failure.status === 413
          ? STATUS_COPY.importTooLarge
          : failure.status === 415
            ? STATUS_COPY.importWrongType
            : null,
      after: (result) => renderImportReport(result as ImportReport),
    },
  );
}

function renderImportReport(report: ImportReport): void {
  const body = document.querySelector<HTMLElement>('[data-import-report]');
  if (body === null) return;
  body.replaceChildren(
    ...report.report.map((row) => {
      const tr = document.createElement('tr');
      for (const [index, text] of [String(row.line), row.styleNumber, row.outcome].entries()) {
        const cell = document.createElement('td');
        if (index === 0) cell.className = 'mono';
        cell.textContent = text;
        tr.append(cell);
      }
      return tr;
    }),
  );
}

interface MyStoreData {
  screen: 'my-store';
  stockistId: string;
  drops: { id: string; name: string; styles: { styleNumber: string; edition: number }[] }[];
}

export function startMyStoreScreen(): void {
  const data = pageData<MyStoreData>();
  let chosen = data.drops[0]?.id ?? '';

  document.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      '[data-action="open-request"]',
    );
    if (button === null || button === undefined) return;
    chosen = button.dataset['dropId'] ?? '';
    renderRequestFields(data, chosen);
    openDialog('Request quantities', button);
  });

  onAction(
    'send-request',
    async () => {
      const drop = data.drops.find((entry) => entry.id === chosen);
      return request(`/api/drops/${encodeURIComponent(chosen)}/requests`, {
        method: 'POST',
        body: {
          stockistId: data.stockistId,
          lines: (drop?.styles ?? []).map((style) => ({
            styleNumber: style.styleNumber,
            quantity: numberOf(`store.${style.styleNumber}`),
          })),
        },
      });
    },
    {
      region: 'Store status',
      dialog: 'Request quantities',
      success: STATUS_COPY.requestSaved,
      own: (failure) => (failure.code === 'allocation_split' ? STATUS_COPY.splitExists : null),
      reload: true,
    },
  );
}

function renderRequestFields(data: MyStoreData, dropId: string): void {
  const host = document.querySelector<HTMLElement>('[data-request-fields]');
  const drop = data.drops.find((entry) => entry.id === dropId);
  if (host === null || drop === undefined) return;
  host.replaceChildren(
    ...drop.styles.map((style) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'field field--number';
      wrapper.dataset['field'] = `store.${style.styleNumber}`;
      const label = document.createElement('label');
      label.className = 'field__label';
      label.htmlFor = `f-store.${style.styleNumber}`;
      label.textContent = `${style.styleNumber} quantity`;
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'field__control';
      input.id = `f-store.${style.styleNumber}`;
      input.min = '0';
      input.max = String(style.edition);
      input.step = '1';
      input.value = '0';
      input.dataset['fieldControl'] = `store.${style.styleNumber}`;
      const error = document.createElement('p');
      error.className = 'field__error';
      error.dataset['fieldError'] = `store.${style.styleNumber}`;
      error.hidden = true;
      wrapper.append(label, input, error);
      return wrapper;
    }),
  );
}
