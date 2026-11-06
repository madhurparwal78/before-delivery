import type { Session } from '../auth.ts';
import { CURRENCIES, marketCity, type Currency } from '../../domain/markets.ts';
import { formatAmount, formatMoney } from '../../domain/money.ts';
import { copenhagenTomorrow, formatCopenhagenDate, formatCopenhagenInstant } from '../../domain/time.ts';
import type { AllocationRecord } from '../repo/allocations.ts';
import type { DropRecord } from '../repo/drops.ts';
import {
  button,
  dialog,
  field,
  link,
  pageData,
  panel,
  stickyBar,
  table,
} from './components.ts';
import { attrs, html, raw } from './html.ts';
import { page, problemsRegion, statusMark, statusRegion } from './layout.ts';

export interface StockistOption {
  id: string;
  name: string;
}

function money(minor: number | null, currency: Currency): string {
  return minor === null ? '—' : formatMoney(minor, currency);
}

export function dropAllocationsPage(
  session: Session,
  drop: DropRecord,
  allocations: readonly AllocationRecord[],
  stockists: readonly StockistOption[],
): string {
  const stockistOptions = [
    { value: '', label: 'Choose a stockist' },
    ...stockists.map((stockist) => ({ value: stockist.id, label: stockist.name })),
  ];
  const quantityFields = drop.styles.map((style) =>
    field({
      name: `quantity.${style.styleNumber}`,
      label: `${style.styleNumber} quantity`,
      kind: 'number',
      value: '0',
      min: 0,
      max: style.wholesaleEdition,
    }),
  );

  const main = html`<h1 class="page-heading">Allocations · ${drop.name}</h1>
<div class="actions-row">
  ${button('Split edition', { variant: 'quiet', action: 'open-split' })}
  ${button('Enter allocation', { variant: 'quiet', action: 'open-enter-allocation' })}
  ${button('Record request', { variant: 'quiet', action: 'open-record-request' })}
</div>
<h2 class="panel__heading" id="allocations-heading" tabindex="-1">Allocations</h2>
${table({
  name: 'Allocations',
  columns: ['Stockist', 'Status', ...drop.styles.map((style) => style.styleNumber), 'Requested at'],
  rows: allocations.map(
    (allocation) => html`<tr>
    <td>${link(allocation.stockistName, `/studio/allocations/${allocation.id}`)}</td>
    <td>${allocation.status === 'confirmed' ? statusMark('live') : statusMark('upcoming')}<span class="sr-detail">${allocation.status}</span></td>
    ${drop.styles.map((style) => {
      const line = allocation.lines.find((entry) => entry.styleNumber === style.styleNumber);
      return html`<td class="mono">${line?.requestedQuantity ?? 0} / ${line?.allocatedQuantity ?? 0}</td>`;
    })}
    <td class="mono">${formatCopenhagenInstant(allocation.requestedAtMs)}</td>
  </tr>`,
  ),
})}
${statusRegion('Allocation status')}
${dialog({
  name: 'Split edition',
  body: table({
    name: 'Proposed split',
    columns: ['Stockist', ...drop.styles.map((style) => style.styleNumber)],
    rows: [],
    bodyAttributes: { 'data-split-rows': 'rows' },
  }),
  actions: html`${button('Apply split', { pending: 'Splitting…', action: 'apply-split' })}${button('Cancel', { variant: 'quiet', action: 'cancel-dialog' })}`,
})}
${dialog({
  name: 'Enter allocation',
  body: html`${field({ name: 'stockistId', label: 'Stockist', kind: 'select', options: stockistOptions })}
${quantityFields}
${field({ name: 'internalNote', label: 'Internal note', kind: 'textarea' })}`,
  actions: html`${button('Save allocation', { pending: 'Saving allocation…', action: 'save-entered-allocation' })}${button('Cancel', { variant: 'quiet', action: 'cancel-dialog' })}`,
})}
${dialog({
  name: 'Record request',
  body: html`${field({ name: 'requestStockistId', label: 'Stockist', kind: 'select', options: stockistOptions })}
${drop.styles.map((style) =>
  field({
    name: `request.${style.styleNumber}`,
    label: `${style.styleNumber} quantity`,
    kind: 'number',
    value: '0',
    min: 0,
    max: style.wholesaleEdition,
  }),
)}`,
  actions: html`${button('Save request', { pending: 'Saving request…', action: 'save-request' })}${button('Cancel', { variant: 'quiet', action: 'cancel-dialog' })}`,
})}
${pageData({
  screen: 'drop-allocations',
  dropId: drop.id,
  styles: drop.styles.map((style) => style.styleNumber),
})}`;
  return page({ title: `Allocations · ${drop.name}`, session, activePath: '/studio/drops' }, main);
}

export function allocationPage(session: Session, allocation: AllocationRecord): string {
  const currency = allocation.currency;
  const canEdit = session.role === 'merchandiser' && allocation.status !== 'confirmed';
  const canConfirm = session.role === 'finance_lead' && allocation.status === 'split';

  const main = html`<h1 class="page-heading">Allocation · ${allocation.stockistName}</h1>
<p class="lead">${allocation.dropName} · ${marketCity(allocation.market)} · ${currency}</p>
${problemsRegion()}
${table({
  name: 'Allocation lines',
  columns: ['Style', 'Requested', 'Allocated', 'Unit price', 'Net', 'VAT', 'Line total'],
  bodyAttributes: { 'data-allocation-lines': 'rows' },
  rows: allocation.lines.map(
    (line) => html`<tr${attrs({ 'data-line': line.styleNumber })}>
    <td>${line.styleNumber} ${line.styleName}</td>
    <td class="mono">${line.requestedQuantity}</td>
    <td>${
      canEdit
        ? html`<input${attrs({
            type: 'number',
            class: 'field__control field__control--inline',
            min: 0,
            max: 100000,
            step: 1,
            value: line.allocatedQuantity,
            'aria-label': `${line.styleNumber} allocated`,
            'data-allocated': line.styleNumber,
          })}>`
        : html`<span class="mono">${line.allocatedQuantity}</span>`
    }</td>
    <td class="mono" data-unit-price>${money(line.unitPriceMinor, currency)}</td>
    <td class="mono" data-net>${money(line.netMinor, currency)}</td>
    <td class="mono" data-vat>${money(line.vatMinor, currency)}</td>
    <td class="mono" data-line-total>${money(line.lineTotalMinor, currency)}</td>
  </tr>`,
  ),
})}
<p class="mono" data-allocation-total>${allocation.totalMinor === null ? '' : `Total ${formatMoney(allocation.totalMinor, currency)}`}</p>
${
  allocation.invoiceNumber === null
    ? raw('')
    : html`<p class="mono" data-invoice-number>Invoice ${allocation.invoiceNumber}</p>
<p>${allocation.priceListEffectiveDate === null ? '' : `Prices from the list in force on ${formatCopenhagenDate(allocation.priceListEffectiveDate)}`}</p>`
}
${field({ name: 'internalNote', label: 'Internal note', kind: 'textarea', value: allocation.internalNote })}
<div class="actions-row actions-row--desktop">
  ${canEdit ? button('Save allocation', { pending: 'Saving allocation…', action: 'save-allocation' }) : raw('')}
  ${canConfirm ? button('Confirm allocation', { variant: 'quiet', action: 'open-confirm' }) : raw('')}
  ${link('Download line sheet', `/api/allocations/${allocation.id}/line-sheet.csv`)}
</div>
${statusRegion('Allocation status')}
${
  canConfirm
    ? dialog({
        name: 'Confirm allocation',
        body: html`${table({
          name: 'Quote',
          columns: ['Style', 'Quantity', 'Unit price', 'Net', 'VAT', 'Line total'],
          rows: [],
          bodyAttributes: { 'data-quote-rows': 'rows' },
        })}
<p data-quote-date></p>
${statusRegion('Invoicing status')}`,
        actions: html`${button('Confirm and invoice', { pending: 'Confirming…', action: 'confirm-allocation' })}${button('Cancel', { variant: 'quiet', action: 'cancel-dialog' })}`,
      })
    : raw('')
}
${stickyBar(html`${canEdit ? button('Save allocation', { pending: 'Saving allocation…', action: 'save-allocation' }) : raw('')}${canConfirm ? button('Confirm allocation', { variant: 'quiet', action: 'open-confirm' }) : raw('')}`)}
${pageData({
  screen: 'allocation',
  allocationId: allocation.id,
  version: allocation.version,
  currency,
  styles: allocation.lines.map((line) => line.styleNumber),
})}`;
  return page(
    { title: `Allocation · ${allocation.stockistName}`, session, activePath: '/studio/invoicing' },
    main,
  );
}

export function invoicingPage(
  session: Session,
  ready: readonly AllocationRecord[],
  confirmed: readonly AllocationRecord[],
): string {
  const main = html`<h1 class="page-heading">Invoicing</h1>
${panel(
  'Ready to confirm',
  table({
    name: 'Ready to confirm',
    columns: ['Stockist', 'Drop', 'Status', 'Pieces'],
    rows: ready.map(
      (allocation) => html`<tr>
      <td>${link(allocation.stockistName, `/studio/allocations/${allocation.id}`)}</td>
      <td>${allocation.dropName}</td>
      <td>${statusMark('upcoming')}</td>
      <td class="mono">${allocation.lines.reduce((sum, line) => sum + line.allocatedQuantity, 0)}</td>
    </tr>`,
    ),
  }),
)}
${panel(
  'Confirmed allocations',
  table({
    name: 'Confirmed allocations',
    columns: ['Stockist', 'Drop', 'Invoice', 'Total', 'Confirmed'],
    rows: confirmed.map(
      (allocation) => html`<tr>
      <td>${link(allocation.stockistName, `/studio/allocations/${allocation.id}`)}</td>
      <td>${allocation.dropName}</td>
      <td class="mono">${allocation.invoiceNumber ?? '—'}</td>
      <td class="mono">${money(allocation.totalMinor, allocation.currency)}</td>
      <td class="mono">${allocation.confirmedAtMs === null ? '—' : formatCopenhagenInstant(allocation.confirmedAtMs)}</td>
    </tr>`,
    ),
  }),
)}
${statusRegion('Invoicing status')}
${pageData({ screen: 'invoicing' })}`;
  return page({ title: 'Invoicing', session, activePath: '/studio/invoicing' }, main);
}

export interface PriceListView {
  id: string;
  name: string;
  effectiveDate: string;
  priceCount: number;
  inForce: boolean;
}

export function priceListsPage(
  session: Session,
  lists: readonly PriceListView[],
  nowMs: number,
): string {
  const main = html`<h1 class="page-heading">Price lists</h1>
${button('Add price list', { action: 'open-add-price-list' })}
${table({
  name: 'Price lists',
  columns: ['Name', 'Effective from', 'Prices', 'In force'],
  rows: lists.map(
    (list) => html`<tr>
    <td>${list.name}</td>
    <td class="mono">${formatCopenhagenDate(list.effectiveDate)}</td>
    <td class="mono">${list.priceCount}</td>
    <td>${list.inForce ? statusMark('live') : statusMark('upcoming')}</td>
  </tr>`,
  ),
})}
${statusRegion('Price list status')}
${dialog({
  name: 'Add price list',
  body: html`${field({ name: 'priceListName', label: 'Name' })}
${field({ name: 'effectiveDate', label: 'Effective date', value: copenhagenTomorrow(nowMs), placeholder: 'YYYY-MM-DD' })}
${field({ name: 'prices', label: 'Prices', kind: 'textarea', rows: 6, hint: 'One "<style number> <currency> <amount>" per line.' })}`,
  actions: html`${button('Save price list', { pending: 'Saving price list…', action: 'save-price-list' })}${button('Cancel', { variant: 'quiet', action: 'cancel-dialog' })}`,
})}
${pageData({ screen: 'price-lists', currencies: CURRENCIES })}`;
  return page({ title: 'Price lists', session, activePath: '/studio/price-lists' }, main);
}

export interface LineSheetRow {
  styleNumber: string;
  name: string;
  colour: string;
  wholesaleEdition: number;
  rrpDkkMinor: number;
  unitPriceMinor: number | null;
  priceListFrom: string | null;
}

export function lineSheetPage(
  session: Session,
  drop: DropRecord,
  rows: readonly LineSheetRow[],
  currency: Currency,
): string {
  const main = html`<h1 class="page-heading">Line sheet · ${drop.name}</h1>
${table({
  name: 'Line sheet',
  columns: ['Style number', 'Name', 'Colour', 'Wholesale edition', 'RRP DKK', 'Wholesale price', 'Price list from'],
  rows: rows.map(
    (row) => html`<tr>
    <td class="mono">${row.styleNumber}</td>
    <td>${row.name}</td>
    <td>${row.colour}</td>
    <td class="mono">${row.wholesaleEdition}</td>
    <td class="mono">${formatAmount(row.rrpDkkMinor, 'DKK')}</td>
    <td class="mono">${row.unitPriceMinor === null ? '—' : formatMoney(row.unitPriceMinor, currency)}</td>
    <td class="mono">${row.priceListFrom === null ? '—' : formatCopenhagenDate(row.priceListFrom)}</td>
  </tr>`,
  ),
})}
<div class="actions-row actions-row--desktop">
  ${field({
    name: 'exportCurrency',
    label: 'Export currency',
    kind: 'select',
    value: currency,
    options: CURRENCIES.map((code) => ({ value: code, label: code })),
  })}
  ${link('Export CSV', `/api/drops/${drop.id}/line-sheet.csv?currency=${currency}`, { attributes: { 'data-export-link': 'line-sheet' } })}
  ${button('Import line sheet', { variant: 'quiet', action: 'open-import' })}
</div>
<h2 class="panel__heading" id="import-report-heading" tabindex="-1">Import report</h2>
${table({
  name: 'Import report',
  columns: ['Line', 'Style number', 'Outcome'],
  rows: [],
  className: 'table-wrap--pinned',
  bodyAttributes: { 'data-import-report': 'rows' },
})}
${statusRegion('Line sheet status')}
${dialog({
  name: 'Import line sheet',
  body: field({ name: 'lineSheetFile', label: 'Line sheet file', kind: 'file' }),
  actions: html`${button('Import', { pending: 'Importing…', action: 'import-line-sheet' })}${button('Cancel', { variant: 'quiet', action: 'cancel-dialog' })}`,
})}
${stickyBar(html`${link('Export CSV', `/api/drops/${drop.id}/line-sheet.csv?currency=${currency}`, { attributes: { 'data-export-link': 'line-sheet-sticky' } })}${button('Import line sheet', { variant: 'quiet', action: 'open-import' })}`)}
${pageData({ screen: 'line-sheet', dropId: drop.id, currency })}`;
  return page({ title: `Line sheet · ${drop.name}`, session, activePath: '/studio/drops' }, main);
}

export interface MyStoreModel {
  stockistName: string;
  openDrops: { id: string; name: string; styles: { styleNumber: string; edition: number }[] }[];
  allocations: readonly AllocationRecord[];
}

export function myStorePage(session: Session, model: MyStoreModel): string {
  const invoiced = model.allocations.filter((allocation) => allocation.invoiceNumber !== null);
  const main = html`<h1 class="page-heading">${model.stockistName}</h1>
${panel(
  'Open drops',
  table({
    name: 'Open drops',
    columns: ['Drop', 'Styles', 'Actions'],
    rows: model.openDrops.map(
      (drop) => html`<tr>
      <td>${drop.name}</td>
      <td class="mono">${drop.styles.length}</td>
      <td>${button('Request quantities', {
        variant: 'quiet',
        action: 'open-request',
        attributes: { 'data-drop-id': drop.id },
      })}</td>
    </tr>`,
    ),
  }),
)}
${panel(
  'My allocations',
  table({
    name: 'My allocations',
    columns: ['Drop', 'Status', 'Pieces', 'Total'],
    rows: model.allocations.map(
      (allocation) => html`<tr>
      <td>${link(allocation.dropName, `/studio/allocations/${allocation.id}`)}</td>
      <td>${allocation.status === 'confirmed' ? statusMark('live') : statusMark('upcoming')}</td>
      <td class="mono">${allocation.lines.reduce((sum, line) => sum + line.allocatedQuantity, 0)}</td>
      <td class="mono">${money(allocation.totalMinor, allocation.currency)}</td>
    </tr>`,
    ),
  }),
)}
${panel(
  'My invoices',
  table({
    name: 'My invoices',
    columns: ['Invoice', 'Drop', 'Total', 'Confirmed'],
    rows: invoiced.map(
      (allocation) => html`<tr>
      <td class="mono">${allocation.invoiceNumber}</td>
      <td>${allocation.dropName}</td>
      <td class="mono">${money(allocation.totalMinor, allocation.currency)}</td>
      <td class="mono">${allocation.confirmedAtMs === null ? '—' : formatCopenhagenInstant(allocation.confirmedAtMs)}</td>
    </tr>`,
    ),
  }),
)}
${statusRegion('Store status')}
${dialog({
  name: 'Request quantities',
  body: html`<div data-request-fields></div>`,
  actions: html`${button('Send request', { pending: 'Sending request…', action: 'send-request' })}${button('Cancel', { variant: 'quiet', action: 'cancel-dialog' })}`,
})}
${pageData({
  screen: 'my-store',
  stockistId: session.stockistId,
  drops: model.openDrops,
})}`;
  return page({ title: model.stockistName, session, activePath: '/studio/my-store' }, main);
}
