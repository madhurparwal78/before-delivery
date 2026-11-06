import { formatAmount, formatDate, formatNumber } from '../shared/locale.js';
import { queueCountLine, s } from '../shared/strings.js';
import {
  licenceLabel,
  orderStatusLabel,
  queueStatusLabel,
  serviceLabel,
  serviceStateLabel,
  stateLabel,
} from '../shared/labels.js';
import type { HealthSnapshot } from '../services/health.js';
import { SERVICE_NAMES } from '../services/health.js';
import type { QueueCounts } from '../db/uploads.js';
import type { OrderRecord } from '../db/orders.js';
import { esc, jsonScript, scrollTable, tag, voidTag } from './html.js';
import { link, page } from './layout.js';
import type { PageBase } from './public.js';
import type { ModelRow } from './studio-pages.js';

export interface ContributePageData {
  readonly models: readonly ModelRow[];
  readonly drafts: readonly { readonly slug: string; readonly title: string }[];
}

export function contributePage(base: PageBase, data: ContributePageData): string {
  const { locale, lang } = base;
  return page(
    { locale, lang, role: base.role, title: s('contributeHeading', locale), scripts: ['contribute.js'] },
    tag(
      'section',
      { class: 'panel' },
      tag('h1', {}, esc(s('contributeHeading', locale))),
      tag('div', {
        role: 'status',
        'aria-live': 'polite',
        'aria-label': s('studioNotices', locale),
        'data-studio-notices': 'true',
      }),
      tag('div', { role: 'alert', 'data-upload-alert': 'true' }),
      tag('h2', {}, esc(s('yourModels', locale))),
      scrollTable(
        { 'aria-label': s('models', locale) },
        tag(
          'thead',
          {},
          tag(
            'tr',
            {},
            tag('th', { scope: 'col' }, esc(s('colTitle', locale))),
            tag('th', { scope: 'col' }, esc(s('colState', locale))),
            tag('th', { scope: 'col', class: 'col-queue' }, esc(s('colQueue', locale))),
          ),
        ),
        tag(
          'tbody',
          {},
          ...data.models.map((row) =>
            tag(
              'tr',
              {},
              tag(
                'td',
                {},
                tag('a', { href: link(`/contribute/models/${row.slug}`, lang) }, esc(row.title)),
              ),
              tag('td', {}, esc(stateLabel(row.state, locale))),
              tag('td', { class: 'col-queue' }, esc(queueStatusLabel(row.queue_status, locale))),
            ),
          ),
        ),
      ),
    ),
    tag(
      'section',
      { class: 'panel' },
      tag('h2', {}, esc(s('uploadHeading', locale))),
      tag(
        'form',
        { 'data-contrib-upload': 'true' },
        tag(
          'label',
          { class: 'field' },
          tag('span', {}, esc(s('modelFile', locale))),
          voidTag('input', { type: 'file', name: 'file', 'aria-label': s('modelFile', locale) }),
        ),
        tag(
          'label',
          { class: 'field' },
          tag('span', {}, esc(s('title', locale))),
          voidTag('input', { type: 'text', name: 'title', 'aria-label': s('title', locale) }),
        ),
        tag(
          'label',
          { class: 'field' },
          tag('span', {}, esc(s('sourceUnit', locale))),
          tag(
            'select',
            { name: 'source_unit', 'aria-label': s('sourceUnit', locale) },
            tag('option', { value: 'mm' }, esc(s('unitMm', locale))),
            tag('option', { value: 'cm' }, esc(s('unitCm', locale))),
            tag('option', { value: 'm' }, esc(s('unitM', locale))),
            tag('option', { value: 'in' }, esc(s('unitIn', locale))),
          ),
        ),
        tag(
          'label',
          { class: 'field' },
          tag('span', {}, esc(s('category', locale))),
          tag(
            'select',
            { name: 'category', 'aria-label': s('category', locale) },
            tag('option', { value: 'hard-surface' }, esc(s('catHardSurface', locale))),
            tag('option', { value: 'miniature' }, esc(s('catMiniature', locale))),
            tag('option', { value: 'scan' }, esc(s('catScan', locale))),
          ),
        ),
        tag('button', { type: 'submit', class: 'button' }, esc(s('upload', locale))),
      ),
      tag('progress', {
        value: '0',
        max: '100',
        'aria-label': s('uploadProgress', locale),
        'data-upload-progress': 'true',
      }, ''),
    ),
    tag(
      'section',
      { class: 'panel' },
      tag('h2', {}, esc(s('submitTextureSet', locale))),
      tag('div', { role: 'alert', 'data-texture-alert': 'true' }),
      tag(
        'form',
        { 'data-texture-form': 'true' },
        tag(
          'label',
          { class: 'field' },
          tag('span', {}, esc(s('textureSetName', locale))),
          voidTag('input', { type: 'text', name: 'name', 'aria-label': s('textureSetName', locale) }),
        ),
        tag(
          'label',
          { class: 'field' },
          tag('span', {}, esc(s('textureArchive', locale))),
          voidTag('input', { type: 'file', name: 'file', 'aria-label': s('textureArchive', locale) }),
        ),
        tag(
          'label',
          { class: 'field' },
          tag('span', {}, esc(s('draft', locale))),
          tag(
            'select',
            { name: 'model', 'aria-label': s('draft', locale) },
            ...data.drafts.map((draft) => tag('option', { value: draft.slug }, esc(draft.title))),
          ),
        ),
        tag('button', { type: 'submit', class: 'button' }, esc(s('submitTextureSet', locale))),
      ),
    ),
  );
}

export interface StaffPageData {
  readonly orders: readonly OrderRecord[];
  readonly health: HealthSnapshot;
  readonly queue: QueueCounts;
  readonly lookup: string;
}

function ordersTable(orders: readonly OrderRecord[], base: PageBase): string {
  const { locale, lang } = base;
  return scrollTable(
    { 'aria-label': s('orders', locale) },
    tag(
      'thead',
      {},
      tag(
        'tr',
        {},
        tag('th', { scope: 'col' }, esc(s('colOrder', locale))),
        tag('th', { scope: 'col' }, esc(s('email', locale))),
        tag('th', { scope: 'col' }, esc(s('colModel', locale))),
        tag('th', { scope: 'col' }, esc(s('colLicence', locale))),
        tag('th', { scope: 'col' }, esc(s('colAmount', locale))),
        tag('th', { scope: 'col' }, esc(s('colRefunded', locale))),
        tag('th', { scope: 'col' }, esc(s('colStatus', locale))),
      ),
    ),
    tag(
      'tbody',
      {},
      ...orders.map((order) =>
        tag(
          'tr',
          {},
          tag(
            'td',
            {},
            tag(
              'a',
              { href: link(`/staff/orders/${order.orderRef}`, lang), class: 'mono' },
              esc(order.orderRef),
            ),
          ),
          tag('td', {}, esc(order.email)),
          tag('td', {}, esc(order.modelTitle)),
          tag('td', {}, esc(licenceLabel(order.licence, locale))),
          tag('td', { class: 'num' }, esc(formatAmount(order.amountCents, locale))),
          tag('td', { class: 'num' }, esc(formatAmount(order.refundedCents, locale))),
          tag('td', {}, esc(orderStatusLabel(order.status, locale))),
        ),
      ),
    ),
  );
}

function healthPanel(data: StaffPageData, base: PageBase): string {
  const { locale } = base;
  return tag(
    'section',
    { role: 'region', 'aria-label': s('serviceHealth', locale), 'data-health-panel': 'true' },
    tag('h2', {}, esc(s('serviceHealth', locale))),
    tag(
      'ul',
      {},
      ...SERVICE_NAMES.map((name) =>
        tag(
          'li',
          { 'data-service': name },
          esc(`${serviceLabel(name, locale)} — ${serviceStateLabel(data.health.services[name], locale)}`),
        ),
      ),
    ),
    tag(
      'p',
      { class: 'mono' },
      esc(
        [
          queueCountLine('pending', data.queue.pending, locale),
          queueCountLine('running', data.queue.running, locale),
          queueCountLine('failed', data.queue.failed, locale),
        ].join(' · '),
      ),
    ),
  );
}

export function staffPage(base: PageBase, data: StaffPageData): string {
  const { locale, lang } = base;
  return page(
    { locale, lang, role: base.role, title: s('staffHeading', locale), scripts: ['staff.js'] },
    tag(
      'section',
      { class: 'panel' },
      tag('h1', {}, esc(s('staffHeading', locale))),
      tag('div', {
        role: 'status',
        'aria-live': 'polite',
        'aria-label': s('staffNotices', locale),
        'data-staff-notices': 'true',
      }),
      tag('div', { role: 'alert', 'data-staff-alert': 'true' }),
      tag(
        'form',
        { method: 'get', action: '/staff', 'data-order-search': 'true' },
        tag(
          'label',
          { class: 'field' },
          tag('span', {}, esc(s('findOrders', locale))),
          voidTag('input', {
            type: 'search',
            name: 'q',
            value: data.lookup,
            'aria-label': s('findOrders', locale),
          }),
        ),
        tag('button', { type: 'submit', class: 'button' }, esc(s('findOrders', locale))),
      ),
      ordersTable(data.orders, base),
    ),
    tag('div', { class: 'panel' }, healthPanel(data, base)),
  );
}

export interface OrderDetailData {
  readonly order: OrderRecord;
  readonly health: HealthSnapshot;
  readonly queue: QueueCounts;
}

export function orderDetailPage(base: PageBase, data: OrderDetailData): string {
  const { locale, lang } = base;
  const { order } = data;
  const seatsLeft = order.seats - order.refundedSeats;
  return page(
    { locale, lang, role: base.role, title: order.orderRef, scripts: ['staff.js'] },
    tag(
      'section',
      { class: 'panel narrow' },
      tag('h1', { class: 'mono' }, esc(order.orderRef)),
      tag('div', {
        role: 'status',
        'aria-live': 'polite',
        'aria-label': s('staffNotices', locale),
        'data-staff-notices': 'true',
      }),
      tag('div', { role: 'alert', 'data-staff-alert': 'true' }),
      tag('p', {}, esc(order.email)),
      tag('p', {}, esc(order.modelTitle)),
      tag('p', {}, esc(licenceLabel(order.licence, locale))),
      tag(
        'p',
        { class: 'mono', 'data-order-amount': 'true' },
        esc(formatAmount(order.amountCents, locale)),
      ),
      tag(
        'p',
        { class: 'mono', 'data-order-refunded': 'true' },
        esc(formatAmount(order.refundedCents, locale)),
      ),
      tag('p', { 'data-order-status': 'true' }, esc(orderStatusLabel(order.status, locale))),
      tag('p', { class: 'mono' }, esc(`${formatNumber(seatsLeft, locale)} / ${formatNumber(order.seats, locale)}`)),
      tag('p', { class: 'mono' }, esc(formatDate(order.createdAt.toISOString().slice(0, 10), locale))),
      tag(
        'div',
        { class: 'viewer-controls' },
        tag(
          'button',
          { type: 'button', class: 'button', 'data-refund-full': order.orderRef },
          esc(s('refundInFull', locale)),
        ),
        tag(
          'label',
          { class: 'field' },
          tag('span', {}, esc(s('seatsToRefund', locale))),
          voidTag('input', {
            type: 'number',
            min: '1',
            max: String(Math.max(1, seatsLeft - 1)),
            value: '1',
            'data-refund-seats-input': 'true',
            'aria-label': s('seatsToRefund', locale),
          }),
        ),
        tag(
          'button',
          {
            type: 'button',
            class: 'button',
            'data-refund-seats': order.orderRef,
            disabled: order.licence !== 'studio' || seatsLeft <= 1,
          },
          esc(s('refundSeats', locale)),
        ),
      ),
    ),
    tag('div', { class: 'panel' }, healthPanel({ ...data, orders: [], lookup: '' }, base)),
    jsonScript('order-state', { order: order.orderRef, locale, lang }),
  );
}
