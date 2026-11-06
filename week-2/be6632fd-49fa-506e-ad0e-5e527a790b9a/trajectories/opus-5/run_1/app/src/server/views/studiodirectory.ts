import { ROLE_LABELS, ROLES, type Role, type Session } from '../auth.ts';
import { STATUS_COPY } from '../../domain/copy.ts';
import { MARKETS, marketCity, type Market } from '../../domain/markets.ts';
import { formatMoney } from '../../domain/money.ts';
import type { AllocationRecord } from '../repo/allocations.ts';
import { button, dialog, field, link, pageData, panel, stickyBar, table } from './components.ts';
import { attrs, html, raw } from './html.ts';
import { page, statusMark, statusRegion } from './layout.ts';

const MARKET_OPTIONS = MARKETS.map((market) => ({ value: market, label: marketCity(market) }));
const ROLE_OPTIONS = ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }));

export interface StockistView {
  id: string;
  name: string;
  market: Market;
  contactName: string | null;
  contactErased: boolean;
  status: 'active' | 'archived';
}

function contactCell(stockist: StockistView): string {
  if (stockist.contactErased) return STATUS_COPY.erasedContact;
  return stockist.contactName ?? '—';
}

export function stockistsPage(
  session: Session,
  active: readonly StockistView[],
  archived: readonly StockistView[],
  nextCursor: string | null,
): string {
  const canWrite = session.role === 'merchandiser';
  const main = html`<h1 class="page-heading">Stockists</h1>
<form class="form form--inline" data-form="stockist-search">
  ${field({ name: 'q', label: 'Search stockists', placeholder: 'Search stockists' })}
</form>
${table({
  name: 'Stockists',
  columns: ['Name', 'Market', 'Contact', 'Actions'],
  bodyAttributes: { 'data-stockist-rows': 'rows' },
  rows: active.map(
    (stockist) => html`<tr${attrs({ 'data-stockist-id': stockist.id })}>
    <td>${link(stockist.name, `/studio/stockists/${stockist.id}`)}</td>
    <td>${marketCity(stockist.market)}</td>
    <td>${contactCell(stockist)}</td>
    <td class="actions-cell">${
      canWrite
        ? button('Archive', {
            variant: 'quiet',
            action: 'open-archive',
            attributes: { 'data-stockist-id': stockist.id, 'data-stockist-name': stockist.name },
          })
        : raw('')
    }</td>
  </tr>`,
  ),
})}
<ul class="stockist-cards" aria-label="Stockists" data-stockist-cards>
  ${active.map(
    (stockist) => html`<li class="stockist-card"${attrs({ 'data-stockist-id': stockist.id })}>
    <p class="stockist-card__name">${link(stockist.name, `/studio/stockists/${stockist.id}`)}</p>
    <p>${marketCity(stockist.market)}</p>
    <p>${contactCell(stockist)}</p>
    ${
      canWrite
        ? button('Archive', {
            variant: 'quiet',
            action: 'open-archive',
            attributes: { 'data-stockist-id': stockist.id, 'data-stockist-name': stockist.name },
          })
        : raw('')
    }
  </li>`,
  )}
</ul>
${button('Load more stockists', { variant: 'quiet', action: 'load-more-stockists', attributes: { 'data-cursor': nextCursor } })}
<p class="switch-row">
  <button type="button" class="switch" role="switch" aria-checked="false" data-action="toggle-archived">Show archived</button>
</p>
${table({
  name: 'Archived stockists',
  columns: ['Name', 'Market', 'Contact', 'Actions'],
  bodyAttributes: { 'data-archived-rows': 'rows' },
  rows: archived.map(
    (stockist) => html`<tr${attrs({ 'data-stockist-id': stockist.id })}>
    <td>${stockist.name}</td>
    <td>${marketCity(stockist.market)}</td>
    <td>${contactCell(stockist)}</td>
    <td class="actions-cell">${
      canWrite
        ? button('Restore', {
            variant: 'quiet',
            action: 'open-restore',
            attributes: { 'data-stockist-id': stockist.id, 'data-stockist-name': stockist.name },
          })
        : raw('')
    }</td>
  </tr>`,
  ),
})}
<div class="actions-row actions-row--desktop">
  ${canWrite ? button('Add stockist', { action: 'open-add-stockist' }) : raw('')}
  ${link('Export CSV', '/api/stockists.csv', { attributes: { 'data-export-link': 'stockists' } })}
</div>
${statusRegion('Stockist status')}
${
  canWrite
    ? html`${dialog({
        name: 'Add stockist',
        body: html`${field({ name: 'name', label: 'Name' })}
${field({ name: 'market', label: 'Market', kind: 'select', options: MARKET_OPTIONS, value: 'copenhagen' })}
${field({ name: 'contactName', label: 'Contact name' })}
${field({ name: 'contactEmail', label: 'Contact email', kind: 'email' })}
${field({ name: 'contactPhone', label: 'Contact phone' })}
${field({ name: 'notes', label: 'Notes', kind: 'textarea' })}`,
        actions: html`${button('Save stockist', { pending: 'Saving stockist…', action: 'save-stockist' })}${button('Cancel', { variant: 'quiet', action: 'cancel-dialog' })}`,
      })}
${dialog({
        name: 'Archive stockist',
        body: html`<p data-archive-summary></p>`,
        actions: html`${button('Archive stockist', { variant: 'danger', pending: 'Archiving…', action: 'archive-stockist' })}${button('Cancel', { variant: 'quiet', action: 'cancel-dialog' })}`,
      })}
${dialog({
        name: 'Restore stockist',
        body: html`<p data-restore-summary></p>`,
        actions: html`${button('Restore stockist', { pending: 'Restoring…', action: 'restore-stockist' })}${button('Cancel', { variant: 'quiet', action: 'cancel-dialog' })}`,
      })}`
    : raw('')
}
${stickyBar(html`${canWrite ? button('Add stockist', { action: 'open-add-stockist' }) : raw('')}${link('Export CSV', '/api/stockists.csv', { attributes: { 'data-export-link': 'stockists-sticky' } })}`)}
${pageData({ screen: 'stockists', nextCursor })}`;
  return page({ title: 'Stockists', session, activePath: '/studio/stockists' }, main);
}

export interface StockistDetail {
  id: string;
  name: string;
  market: Market;
  currency: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  contactErased: boolean;
  notes: string;
}

export function stockistPage(
  session: Session,
  stockist: StockistDetail,
  allocations: readonly AllocationRecord[],
): string {
  const erased = stockist.contactErased;
  const main = html`<h1 class="page-heading" id="stockist-heading" tabindex="-1">${stockist.name}</h1>
<dl class="detail-list">
  <dt>Market</dt><dd>${marketCity(stockist.market)}</dd>
  <dt>Currency</dt><dd class="mono">${stockist.currency}</dd>
  <dt>Contact name</dt><dd data-contact-name>${erased ? STATUS_COPY.erasedContact : (stockist.contactName ?? '—')}</dd>
  <dt>Contact email</dt><dd data-contact-email>${erased ? STATUS_COPY.erasedContact : (stockist.contactEmail ?? '—')}</dd>
  <dt>Contact phone</dt><dd data-contact-phone>${erased ? STATUS_COPY.erasedContact : (stockist.contactPhone ?? '—')}</dd>
  <dt>Notes</dt><dd>${stockist.notes === '' ? '—' : stockist.notes}</dd>
</dl>
${panel(
  'Allocations',
  table({
    name: 'Allocations',
    columns: ['Drop', 'Status', 'Invoice', 'Total'],
    rows: allocations.map(
      (allocation) => html`<tr>
      <td>${link(allocation.dropName, `/studio/allocations/${allocation.id}`)}</td>
      <td>${allocation.status === 'confirmed' ? statusMark('live') : statusMark('upcoming')}</td>
      <td class="mono">${allocation.invoiceNumber ?? '—'}</td>
      <td class="mono">${allocation.totalMinor === null ? '—' : formatMoney(allocation.totalMinor, allocation.currency)}</td>
    </tr>`,
    ),
  }),
)}
${session.role === 'merchandiser' ? button('Erase contact', { variant: 'danger', action: 'open-erase' }) : raw('')}
${statusRegion('Stockist status')}
${
  session.role === 'merchandiser'
    ? dialog({
        name: 'Erase contact',
        body: html`<p>The contact name, email and phone are removed and queued email to that address is dropped. Invoice amounts stay as they were.</p>`,
        actions: html`${button('Erase contact', { variant: 'danger', pending: 'Erasing…', action: 'erase-contact' })}${button('Cancel', { variant: 'quiet', action: 'cancel-dialog' })}`,
      })
    : raw('')
}
${pageData({ screen: 'stockist', stockistId: stockist.id })}`;
  return page({ title: stockist.name, session, activePath: '/studio/stockists' }, main);
}

export interface MemberView {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export function membersPage(
  session: Session,
  members: readonly MemberView[],
  stockists: readonly { id: string; name: string }[],
): string {
  const canWrite = session.role === 'launch_producer';
  const stockistOptions = [
    { value: '', label: 'Choose a stockist' },
    ...stockists.map((stockist) => ({ value: stockist.id, label: stockist.name })),
  ];
  const main = html`<h1 class="page-heading" id="members-heading" tabindex="-1">Members</h1>
${canWrite ? button('Invite member', { action: 'open-invite' }) : raw('')}
${table({
  name: 'Members',
  columns: ['Name', 'Email', 'Role', 'Actions'],
  bodyAttributes: { 'data-member-rows': 'rows' },
  rows: members.map(
    (member) => html`<tr${attrs({ 'data-member-id': member.id })}>
    <td>${member.name}</td>
    <td class="mono">${member.email}</td>
    <td>${ROLE_LABELS[member.role]}</td>
    <td class="actions-cell">${
      canWrite
        ? html`${button('Change role', {
            variant: 'quiet',
            action: 'open-change-role',
            attributes: { 'data-member-id': member.id, 'data-member-role': member.role },
          })}${button('Remove', {
            variant: 'quiet',
            action: 'open-remove-member',
            attributes: { 'data-member-id': member.id },
          })}`
        : raw('')
    }</td>
  </tr>`,
  ),
})}
${statusRegion('Members status')}
${
  canWrite
    ? html`${dialog({
        name: 'Invite member',
        body: html`${field({ name: 'email', label: 'Email', kind: 'email' })}
${field({ name: 'role', label: 'Role', kind: 'select', options: ROLE_OPTIONS, value: 'merchandiser' })}
<div data-invite-stockist hidden>${field({ name: 'stockistId', label: 'Stockist', kind: 'select', options: stockistOptions })}</div>`,
        actions: html`${button('Send invitation', { pending: 'Sending…', action: 'send-invitation' })}${button('Cancel', { variant: 'quiet', action: 'cancel-dialog' })}`,
      })}
${dialog({
        name: 'Change role',
        body: field({ name: 'newRole', label: 'Role', kind: 'select', options: ROLE_OPTIONS }),
        actions: html`${button('Save role', { pending: 'Saving role…', action: 'save-role' })}${button('Cancel', { variant: 'quiet', action: 'cancel-dialog' })}`,
      })}
${dialog({
        name: 'Remove member',
        body: html`<p>The member loses access at once.</p>`,
        actions: html`${button('Remove member', { variant: 'danger', pending: 'Removing…', action: 'remove-member' })}${button('Cancel', { variant: 'quiet', action: 'cancel-dialog' })}`,
      })}`
    : raw('')
}
${pageData({ screen: 'members' })}`;
  return page({ title: 'Members', session, activePath: '/studio/members' }, main);
}
