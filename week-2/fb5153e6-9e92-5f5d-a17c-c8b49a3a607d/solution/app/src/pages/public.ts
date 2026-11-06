import type { Locale } from '../shared/locale.js';
import { formatAmount, formatNumber } from '../shared/locale.js';
import {
  catalogueResultCount,
  copiesLeft,
  editionCopyLine,
  pageLabel,
  receiptHeadingText,
  refundedLine,
  s,
  totalLine,
} from '../shared/strings.js';
import {
  categoryLabel,
  formatLabel,
  licenceLabel,
  orderStatusLabel,
  sortLabel,
} from '../shared/labels.js';
import type { CatalogueCard, CatalogueReply } from '../api/catalogue.js';
import { selectionToQuery } from '../api/catalogue.js';
import type { SearchSelection } from '../services/search.js';
import type { ModelRecord } from '../db/models.js';
import type { ModelDetail } from '../api/access.js';
import type { OrderRecord } from '../db/orders.js';
import type { UpgradeOption } from '../api/receipts.js';
import type { Role } from '../domain/session.js';
import { esc, join, jsonScript, tag, voidTag } from './html.js';
import { link, page } from './layout.js';
import { viewerMarkup } from './viewer.js';
import type { Category, Format } from '../domain/model.js';
import { CATEGORIES, FORMATS } from '../domain/model.js';
import type { CatalogueLicence, LicenceType } from '../domain/money.js';

export interface PageBase {
  readonly locale: Locale;
  readonly lang: string | null;
  readonly role: Role | null;
  readonly banner?: string | null;
}

const LICENCE_VALUES: readonly CatalogueLicence[] = ['personal', 'commercial', 'studio'];

function facetGroup(
  legend: string,
  name: string,
  values: readonly string[],
  labels: readonly string[],
  counts: Readonly<Record<string, number>>,
  selected: readonly string[],
  locale: Locale,
): string {
  return tag(
    'fieldset',
    { role: 'group', 'aria-label': legend },
    tag('legend', {}, esc(legend)),
    ...values.map((value, i) =>
      tag(
        'label',
        { class: 'facet-option' },
        voidTag('input', {
          type: 'checkbox',
          name,
          value,
          checked: selected.includes(value),
          'data-facet': name,
        }),
        tag('span', {}, esc(labels[i] ?? value)),
        tag('span', { class: 'facet-count mono' }, esc(formatNumber(counts[value] ?? 0, locale))),
      ),
    ),
  );
}

/** Cards are one column below 768, two from 768 and three from 1280, beside the rail. */
const CARD_SIZES = '(min-width: 1280px) 25vw, (min-width: 768px) 33vw, 100vw';

function card(item: CatalogueCard, locale: Locale, lang: string | null): string {
  return tag(
    'li',
    { class: 'card' },
    voidTag('img', {
      class: 'card-media',
      src: item.preview_url.replace(/preview\.png$/, 'preview-512.png'),
      srcset: `${item.preview_url.replace(/preview\.png$/, 'preview-512.png')} 512w, ${item.preview_url} 1024w`,
      sizes: CARD_SIZES,
      alt: '',
      width: 1024,
      height: 768,
      loading: 'lazy',
    }),
    tag(
      'div',
      { class: 'card-body' },
      tag(
        'p',
        { class: 'card-title' },
        tag('a', { href: link(`/models/${item.slug}`, lang) }, esc(item.title)),
      ),
      tag('p', { class: 'card-category' }, esc(categoryLabel(item.category, locale))),
      tag(
        'p',
        { class: 'card-formats mono' },
        esc(item.formats.map((f) => formatLabel(f, locale)).join(' · ')),
      ),
      item.rebuilding ? tag('p', { class: 'notice' }, esc(s('previewRebuilding', locale))) : '',
      tag(
        'p',
        { class: 'card-meta' },
        tag('span', {}, esc(s('fromPrice', locale))),
        tag('span', { class: 'mono' }, esc(formatAmount(item.price_from_cents, locale))),
      ),
    ),
  );
}

function pagination(
  result: CatalogueReply,
  selection: SearchSelection,
  locale: Locale,
  lang: string | null,
): string {
  const href = (page: number): string => {
    const params = selectionToQuery({ ...selection, page });
    if (lang !== null) params.set('lang', lang);
    const qs = params.toString();
    return qs === '' ? '/catalogue' : `/catalogue?${qs}`;
  };
  const links: string[] = [];
  if (result.page > 1) {
    links.push(
      tag('a', { href: href(result.page - 1), rel: 'prev' }, esc(s('previousPage', locale))),
    );
  }
  for (let p = 1; p <= result.pages; p += 1) {
    links.push(
      tag(
        'a',
        { href: href(p), 'aria-current': p === result.page ? 'page' : null },
        esc(pageLabel(p, locale)),
      ),
    );
  }
  if (result.page < result.pages) {
    links.push(tag('a', { href: href(result.page + 1), rel: 'next' }, esc(s('nextPage', locale))));
  }
  return tag('nav', { class: 'pagination', 'aria-label': s('pages', locale) }, ...links);
}

export function cataloguePage(
  base: PageBase,
  selection: SearchSelection,
  result: CatalogueReply,
): string {
  const { locale, lang } = base;
  const rail = tag(
    'div',
    { class: 'facet-rail', 'data-facet-rail': 'true' },
    facetGroup(
      s('groupCategory', locale),
      'category',
      CATEGORIES,
      CATEGORIES.map((c: Category) => categoryLabel(c, locale)),
      result.facets.category,
      selection.category,
      locale,
    ),
    facetGroup(
      s('groupLicence', locale),
      'licence',
      LICENCE_VALUES,
      LICENCE_VALUES.map((l) => licenceLabel(l, locale)),
      result.facets.licence,
      selection.licence,
      locale,
    ),
    facetGroup(
      s('groupFormat', locale),
      'format',
      FORMATS,
      FORMATS.map((f: Format) => formatLabel(f, locale)),
      result.facets.format,
      selection.format,
      locale,
    ),
  );

  const sortPicker = tag(
    'label',
    { class: 'field' },
    tag('span', {}, esc(s('sort', locale))),
    tag(
      'select',
      { 'data-sort': 'true', 'aria-label': s('sort', locale) },
      ...(['newest', 'price_asc', 'price_desc'] as const).map((value) =>
        tag('option', { value, selected: selection.sort === value }, esc(sortLabel(value, locale))),
      ),
    ),
  );

  return page(
    {
      locale,
      lang,
      role: base.role,
      title: s('catalogueHeading', locale),
      banner: base.banner ?? null,
      scripts: ['catalogue.js'],
    },
    tag(
      'div',
      { class: 'panel' },
      tag('h1', {}, esc(s('catalogueHeading', locale))),
      tag(
        'label',
        { class: 'field' },
        tag('span', {}, esc(s('searchModels', locale))),
        voidTag('input', {
          type: 'search',
          'data-search': 'true',
          value: selection.q,
          'aria-label': s('searchModels', locale),
          placeholder: s('searchModels', locale),
        }),
      ),
      tag(
        'button',
        { type: 'button', class: 'button button-secondary filters-button', 'data-open-filters': 'true' },
        esc(s('filters', locale)),
      ),
    ),
    rail,
    tag(
      'div',
      { class: 'results-area' },
      sortPicker,
      tag(
        'div',
        { role: 'status', 'aria-live': 'polite', 'aria-label': s('catalogueResults', locale), 'data-result-count': 'true' },
        esc(catalogueResultCount(result.total, locale)),
      ),
      tag(
        'ul',
        { class: 'card-grid', role: 'list', 'aria-label': s('results', locale), 'data-results': 'true' },
        ...result.items.map((item) => card(item, locale, lang)),
      ),
      tag('div', { 'data-pagination': 'true' }, pagination(result, selection, locale, lang)),
    ),
    tag(
      'dialog',
      { class: 'sheet', 'aria-label': s('filters', locale), 'data-filters-dialog': 'true' },
      tag('div', { 'data-filters-slot': 'true' }),
      tag(
        'div',
        { class: 'dialog-actions' },
        tag('button', { type: 'button', class: 'button', 'data-close-filters': 'true' }, esc(s('showResults', locale))),
      ),
    ),
    jsonScript('catalogue-state', { selection, lang }),
  );
}

function licencesTable(detail: ModelDetail, locale: Locale, editionAvailable: boolean): string {
  const buyLabel: Readonly<Record<LicenceType, string>> = {
    personal: s('buyPersonal', locale),
    commercial: s('buyCommercial', locale),
    studio: s('buyStudio', locale),
    edition: s('buyEdition', locale),
  };
  const rows = detail.licences.map((licence) =>
    tag(
      'tr',
      { role: 'row' },
      tag('td', { role: 'cell' }, esc(licenceLabel(licence.type, locale))),
      tag('td', { class: 'num', role: 'cell' }, esc(formatNumber(licence.seats, locale))),
      tag('td', { class: 'num', role: 'cell' }, esc(formatAmount(licence.price_cents, locale))),
      tag(
        'td',
        { role: 'cell' },
        tag(
          'button',
          {
            type: 'button',
            class: 'button',
            'data-buy': licence.type,
            'data-amount': licence.price_cents,
          },
          esc(buyLabel[licence.type]),
        ),
      ),
    ),
  );
  if (detail.edition !== null) {
    rows.push(
      tag(
        'tr',
        { role: 'row' },
        tag('td', { role: 'cell' }, esc(s('specEdition', locale))),
        tag('td', { class: 'num', role: 'cell' }, esc(formatNumber(1, locale))),
        tag('td', { class: 'num', role: 'cell' }, esc(formatAmount(detail.edition.price_cents, locale))),
        tag(
          'td',
          { role: 'cell' },
          tag(
            'button',
            {
              type: 'button',
              class: 'button',
              'data-buy': 'edition',
              'data-amount': detail.edition.price_cents,
              disabled: !editionAvailable,
            },
            esc(buyLabel.edition),
          ),
        ),
      ),
    );
  }
  return tag(
    'table',
    { 'aria-label': s('licences', locale), class: 'licence-table', role: 'table' },
    tag('caption', {}, esc(s('licences', locale))),
    tag(
      'thead',
      { role: 'rowgroup' },
      tag(
        'tr',
        { role: 'row' },
        tag('th', { scope: 'col', role: 'columnheader' }, esc(s('colLicence', locale))),
        tag('th', { scope: 'col', role: 'columnheader' }, esc(s('colSeats', locale))),
        tag('th', { scope: 'col', role: 'columnheader' }, esc(s('colPrice', locale))),
        tag('th', { scope: 'col', role: 'columnheader' }, ''),
      ),
    ),
    tag('tbody', { role: 'rowgroup' }, ...rows),
  );
}

function specificationsTable(detail: ModelDetail, locale: Locale): string {
  const row = (label: string, value: string, numeric: boolean): string =>
    tag(
      'tr',
      {},
      tag('th', { scope: 'row' }, esc(label)),
      tag('td', { class: numeric ? 'num' : '' }, esc(value)),
    );
  return tag(
    'table',
    { 'aria-label': s('specifications', locale) },
    tag('caption', {}, esc(s('specifications', locale))),
    tag(
      'tbody',
      {},
      row(s('specWidth', locale), `${formatNumber(detail.dimensions_mm.width, locale)} mm`, true),
      row(s('specHeight', locale), `${formatNumber(detail.dimensions_mm.height, locale)} mm`, true),
      row(s('specDepth', locale), `${formatNumber(detail.dimensions_mm.depth, locale)} mm`, true),
      row(
        s('specFormats', locale),
        detail.formats.map((f) => formatLabel(f as Format, locale)).join(' · '),
        false,
      ),
      row(s('specScale', locale), `1:${formatNumber(detail.scale_denominator, locale)}`, true),
      row(
        s('specEdition', locale),
        detail.edition === null ? '—' : `${formatNumber(detail.edition.total, locale)}`,
        true,
      ),
    ),
  );
}

export interface ModelPageData {
  readonly model: ModelRecord;
  readonly detail: ModelDetail;
  readonly recommendations: readonly CatalogueCard[];
  readonly accessToken: string | null;
}

export function modelPage(base: PageBase, data: ModelPageData): string {
  const { locale, lang } = base;
  const { detail } = data;
  const editionLeft = detail.edition?.remaining ?? 0;

  const viewer = viewerMarkup({
    locale,
    title: detail.title,
    slug: detail.slug,
    camera: detail.default_camera,
    boundingRadiusMm: detail.bounding_radius_mm,
    scaleDenominator: detail.scale_denominator,
    hotspots: detail.hotspots,
    dimensionsMm: detail.dimensions_mm,
    previewUrl: mediaUrl(detail.slug, 'preview.png', data.accessToken),
    glbUrl: mediaUrl(detail.slug, 'view.glb', data.accessToken),
    rebuilding: detail.rebuilding,
  });

  return page(
    {
      locale,
      lang,
      role: base.role,
      title: detail.title,
      banner: base.banner ?? null,
      scripts: ['viewer.js', 'checkout.js'],
    },
    tag('div', { class: 'panel' }, tag('h1', {}, esc(detail.title))),
    tag('div', { class: 'viewer-column' }, viewer),
    tag(
      'div',
      { class: 'detail-column' },
      detail.edition === null
        ? ''
        : tag(
            'div',
            {
              role: 'status',
              'aria-live': 'polite',
              'aria-label': s('editionAvailability', locale),
              'data-edition-status': detail.slug,
            },
            esc(
              editionLeft === 0
                ? s('soldOut', locale)
                : copiesLeft(editionLeft, detail.edition.total, locale),
            ),
          ),
      licencesTable(detail, locale, editionLeft > 0),
      specificationsTable(detail, locale),
      detail.description === '' ? '' : tag('p', {}, esc(detail.description)),
    ),
    tag(
      'section',
      { class: 'panel', role: 'region', 'aria-label': s('moreFromWorkshop', locale) },
      tag('h2', {}, esc(s('moreFromWorkshop', locale))),
      tag(
        'ul',
        { class: 'card-grid', role: 'list' },
        ...data.recommendations.map((item) => card(item, locale, lang)),
      ),
    ),
    checkoutDialog(locale),
    jsonScript('model-state', {
      slug: detail.slug,
      locale,
      lang,
      access: data.accessToken,
      camera: detail.default_camera,
      boundingRadiusMm: detail.bounding_radius_mm,
      scaleDenominator: detail.scale_denominator,
      modelHeightMm: detail.dimensions_mm.height,
      hotspots: detail.hotspots,
      edition: detail.edition,
      licences: detail.licences,
      glbUrl: mediaUrl(detail.slug, 'view.glb', data.accessToken),
    }),
  );
}

export function mediaUrl(slug: string, file: string, access: string | null): string {
  return access === null
    ? `/media/${slug}/${file}`
    : `/media/${slug}/${file}?access=${encodeURIComponent(access)}`;
}

export function checkoutDialog(locale: Locale): string {
  return tag(
    'dialog',
    { 'aria-label': s('checkout', locale), 'data-checkout-dialog': 'true' },
    tag('h2', { 'data-checkout-title': 'true' }, esc(s('checkout', locale))),
    tag('p', { class: 'mono', 'data-checkout-amount': 'true' }),
    tag('div', { role: 'alert', 'data-checkout-alert': 'true' }),
    tag(
      'label',
      { class: 'field' },
      tag('span', {}, esc(s('email', locale))),
      voidTag('input', { type: 'email', 'data-checkout-email': 'true', 'aria-label': s('email', locale) }),
    ),
    tag(
      'label',
      { class: 'facet-option' },
      voidTag('input', { type: 'checkbox', 'data-checkout-terms': 'true' }),
      tag('span', {}, esc(s('acceptTerms', locale))),
    ),
    tag(
      'div',
      { role: 'status', 'aria-live': 'polite', 'aria-label': s('checkoutStatus', locale), 'data-checkout-status': 'true' },
    ),
    tag(
      'div',
      { class: 'dialog-actions' },
      tag('button', { type: 'button', class: 'button', 'data-checkout-pay': 'true' }, esc(s('payNow', locale))),
      tag('button', { type: 'button', class: 'button button-secondary', 'data-checkout-cancel': 'true' }, esc(s('cancel', locale))),
    ),
  );
}

export function passwordGatePage(base: PageBase, title: string, slug: string): string {
  const { locale, lang } = base;
  return page(
    { locale, lang, role: base.role, title, scripts: ['unlock.js'] },
    tag(
      'section',
      { class: 'panel narrow' },
      tag('h1', {}, esc(title)),
      tag('div', { role: 'alert', 'data-unlock-alert': 'true' }),
      tag(
        'form',
        { method: 'post', 'data-unlock-form': slug },
        tag(
          'label',
          { class: 'field' },
          tag('span', {}, esc(s('password', locale))),
          voidTag('input', { type: 'password', name: 'password', 'aria-label': s('password', locale) }),
        ),
        tag('button', { type: 'submit', class: 'button' }, esc(s('unlock', locale))),
      ),
    ),
  );
}

export function signInPage(base: PageBase, next: string | null): string {
  const { locale, lang } = base;
  return page(
    { locale, lang, role: base.role, title: s('signInHeading', locale), scripts: ['sign-in.js'] },
    tag(
      'section',
      { class: 'panel narrow' },
      tag('h1', {}, esc(s('signInHeading', locale))),
      tag('div', { role: 'alert', 'data-sign-in-alert': 'true' }),
      tag(
        'form',
        { method: 'post', 'data-sign-in-form': 'true', 'data-next': next ?? '' },
        tag(
          'label',
          { class: 'field' },
          tag('span', {}, esc(s('email', locale))),
          voidTag('input', { type: 'email', name: 'email', 'aria-label': s('email', locale) }),
        ),
        tag(
          'label',
          { class: 'field' },
          tag('span', {}, esc(s('password', locale))),
          voidTag('input', { type: 'password', name: 'password', 'aria-label': s('password', locale) }),
        ),
        tag('button', { type: 'submit', class: 'button' }, esc(s('signIn', locale))),
      ),
    ),
  );
}

export interface ReceiptPageData {
  readonly order: OrderRecord;
  readonly upgradeOptions: readonly UpgradeOption[];
}

export function receiptPage(base: PageBase, data: ReceiptPageData): string {
  const { locale, lang } = base;
  const { order } = data;
  const upgradeLabel: Partial<Record<LicenceType, string>> = {
    commercial: s('upgradeToCommercial', locale),
    studio: s('upgradeToStudio', locale),
  };
  return page(
    {
      locale,
      lang,
      role: base.role,
      title: receiptHeadingText(order.orderRef, locale),
      scripts: ['receipt.js'],
    },
    tag(
      'section',
      { class: 'panel narrow' },
      tag('h1', { tabindex: '-1', 'data-receipt-heading': 'true' }, esc(receiptHeadingText(order.orderRef, locale))),
      tag('p', {}, esc(order.modelTitle)),
      tag('p', {}, esc(licenceLabel(order.licence, locale))),
      order.editionNumber === null || order.editionTotal === null
        ? ''
        : tag('p', { class: 'mono' }, esc(editionCopyLine(order.editionNumber, order.editionTotal, locale))),
      tag('p', { class: 'mono' }, esc(totalLine(formatAmount(order.amountCents, locale), locale))),
      order.refundedCents === 0
        ? ''
        : tag('p', { class: 'mono' }, esc(refundedLine(formatAmount(order.refundedCents, locale), locale))),
      tag('p', {}, esc(orderStatusLabel(order.status, locale))),
      tag(
        'p',
        {},
        tag('a', { href: `/api/receipts/${order.receiptToken}/files/model.glb` }, esc(s('downloadGlb', locale))),
        ' · ',
        tag('a', { href: `/api/receipts/${order.receiptToken}/files/model.stl` }, esc(s('downloadStl', locale))),
        ' · ',
        tag('a', { href: `/api/receipts/${order.receiptToken}/invoice.pdf` }, esc(s('invoicePdf', locale))),
      ),
      tag('div', { role: 'alert', 'data-receipt-alert': 'true' }),
      tag(
        'div',
        { class: 'viewer-controls' },
        ...data.upgradeOptions.map((option) =>
          tag(
            'button',
            {
              type: 'button',
              class: 'button',
              'data-upgrade': option.licence,
              'data-amount': option.amount_cents,
            },
            esc(upgradeLabel[option.licence] ?? option.licence),
          ),
        ),
      ),
    ),
    checkoutDialog(locale),
    jsonScript('receipt-state', {
      slug: order.modelSlug,
      receipt: order.receiptToken,
      email: order.email,
      locale,
      lang,
    }),
  );
}

export function embedPage(base: PageBase, data: ModelPageData): string {
  const { locale, lang } = base;
  const { detail } = data;
  return page(
    { locale, lang, role: null, title: detail.title, scripts: ['viewer.js'] },
    tag(
      'div',
      { class: 'viewer-column' },
      viewerMarkup({
        locale,
        title: detail.title,
        slug: detail.slug,
        camera: detail.default_camera,
        boundingRadiusMm: detail.bounding_radius_mm,
        scaleDenominator: detail.scale_denominator,
        hotspots: detail.hotspots,
        dimensionsMm: detail.dimensions_mm,
        previewUrl: mediaUrl(detail.slug, 'preview.png', data.accessToken),
        glbUrl: mediaUrl(detail.slug, 'view.glb', data.accessToken),
        rebuilding: detail.rebuilding,
      }),
      tag('p', {}, tag('a', { href: link(`/models/${detail.slug}`, lang) }, esc(s('backToModel', locale)))),
    ),
    jsonScript('model-state', {
      slug: detail.slug,
      locale,
      lang,
      access: data.accessToken,
      camera: detail.default_camera,
      boundingRadiusMm: detail.bounding_radius_mm,
      scaleDenominator: detail.scale_denominator,
      modelHeightMm: detail.dimensions_mm.height,
      hotspots: detail.hotspots,
      edition: null,
      licences: [],
      glbUrl: mediaUrl(detail.slug, 'view.glb', data.accessToken),
    }),
  );
}

export function simpleMessagePage(base: PageBase, message: string): string {
  const { locale, lang } = base;
  return page(
    { locale, lang, role: base.role, title: message },
    tag('section', { class: 'panel narrow' }, tag('h1', {}, esc(message))),
  );
}

export { join };
