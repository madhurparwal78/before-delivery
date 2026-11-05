import type { Locale } from '../shared/locale.js';
import { formatAmount, formatDate, formatNumber } from '../shared/locale.js';
import {
  collectionRegionName,
  moveModel,
  pendingChangeLine,
  quotaLimited,
  quotaUnlimited,
  removeModel,
  revokeKey,
  s,
  switchToPlan,
} from '../shared/strings.js';
import {
  categoryLabel,
  queueStatusLabel,
  sourceUnitLabel,
  stageLabel,
  stageStatusLabel,
  stateLabel,
  totalLabel,
  visibilityLabel,
} from '../shared/labels.js';
import type { Totals } from '../db/models.js';
import type { Quota } from '../db/plan.js';
import type { UploadRecord } from '../db/uploads.js';
import type { CollectionPayload } from '../api/collections.js';
import type { PlanName } from '../domain/plans.js';
import { PLANS, PLAN_NAMES, plan } from '../domain/plans.js';
import { CATEGORIES, SOURCE_UNITS, VISIBILITIES } from '../domain/model.js';
import type { ModelState } from '../domain/states.js';
import { MODEL_STATES, allowedTargets } from '../domain/states.js';
import type { Role } from '../domain/session.js';
import { esc, join, jsonScript, tag, voidTag } from './html.js';
import { link, page } from './layout.js';
import { viewerMarkup } from './viewer.js';
import type { PageBase } from './public.js';
import { mediaUrl } from './public.js';
import type { ModelDetail } from '../api/access.js';

interface NavItem {
  readonly href: string;
  readonly key: Parameters<typeof s>[0];
  readonly authorOnly: boolean;
}

const NAV: readonly NavItem[] = [
  { href: '/studio', key: 'navDashboard', authorOnly: false },
  { href: '/studio/upload', key: 'navUpload', authorOnly: true },
  { href: '/studio/review', key: 'navReview', authorOnly: false },
  { href: '/studio/collections', key: 'navCollections', authorOnly: false },
  { href: '/studio/plan', key: 'navPlan', authorOnly: true },
  { href: '/studio/api-keys', key: 'navApiKeys', authorOnly: true },
  { href: '/studio/export', key: 'navExport', authorOnly: true },
];

function studioNav(locale: Locale, lang: string | null, role: Role, current: string): string {
  return join(
    tag(
      'button',
      {
        type: 'button',
        class: 'button button-secondary studio-menu-button',
        'data-open-studio-menu': 'true',
      },
      esc(s('studioMenu', locale)),
    ),
    tag(
      'nav',
      { class: 'studio-nav', 'aria-label': s('studio', locale), 'data-studio-nav': 'true' },
      tag(
        'ul',
        {},
        ...NAV.filter((item) => !item.authorOnly || role === 'author').map((item) =>
          tag(
            'li',
            {},
            tag(
              'a',
              { href: link(item.href, lang), 'aria-current': item.href === current ? 'page' : null },
              esc(s(item.key, locale)),
            ),
          ),
        ),
      ),
    ),
    tag(
      'dialog',
      { class: 'sheet', 'aria-label': s('studioMenu', locale), 'data-studio-menu-dialog': 'true' },
      tag('div', { 'data-studio-menu-slot': 'true' }),
      tag(
        'div',
        { class: 'dialog-actions' },
        tag(
          'button',
          { type: 'button', class: 'button', 'data-close-studio-menu': 'true' },
          esc(s('cancel', locale)),
        ),
      ),
    ),
  );
}

export function quotaBadge(quota: Quota, locale: Locale): string {
  const copy =
    quota.limit === null
      ? quotaUnlimited(quota.used, locale)
      : quotaLimited(quota.used, quota.limit, formatDate(quota.resets_on, locale), locale);
  return tag(
    'div',
    { role: 'status', 'aria-live': 'polite', 'aria-label': s('quota', locale), class: 'mono', 'data-quota': 'true' },
    esc(copy),
  );
}

function notices(locale: Locale): string {
  return tag('div', {
    role: 'status',
    'aria-live': 'polite',
    'aria-label': s('studioNotices', locale),
    'data-studio-notices': 'true',
  });
}

export interface StudioShell extends PageBase {
  readonly role: Role;
  readonly current: string;
  readonly title: string;
  readonly scripts?: readonly string[];
}

function studioPage(shell: StudioShell, ...content: string[]): string {
  return page(
    {
      locale: shell.locale,
      lang: shell.lang,
      role: shell.role,
      title: shell.title,
      banner: shell.banner ?? null,
      scripts: ['studio.js', ...(shell.scripts ?? [])],
    },
    studioNav(shell.locale, shell.lang, shell.role, shell.current),
    tag('div', { class: 'studio-body' }, notices(shell.locale), ...content),
  );
}

export interface ModelRow {
  readonly slug: string;
  readonly title: string;
  readonly state: ModelState;
  readonly visibility: 'public' | 'unlisted' | 'private' | 'password';
  readonly read_only: boolean;
  readonly price_from_cents: number;
  readonly queue_status: 'in_progress' | 'completed' | 'failed' | 'none';
}

function modelsTable(rows: readonly ModelRow[], locale: Locale, lang: string | null): string {
  return tag(
    'table',
    { 'aria-label': s('models', locale) },
    tag('caption', {}, esc(s('models', locale))),
    tag(
      'thead',
      {},
      tag(
        'tr',
        {},
        tag('th', { scope: 'col' }, esc(s('colTitle', locale))),
        tag('th', { scope: 'col' }, esc(s('colState', locale))),
        tag('th', { scope: 'col', class: 'col-visibility' }, esc(s('colVisibility', locale))),
        tag('th', { scope: 'col', class: 'col-price' }, esc(s('colPriceFrom', locale))),
        tag('th', { scope: 'col', class: 'col-queue' }, esc(s('colQueue', locale))),
      ),
    ),
    tag(
      'tbody',
      {},
      ...rows.map((row) =>
        tag(
          'tr',
          {},
          tag('td', {}, tag('a', { href: link(`/studio/models/${row.slug}`, lang) }, esc(row.title))),
          tag('td', {}, esc(stateLabel(row.state, locale))),
          tag('td', { class: 'col-visibility' }, esc(visibilityLabel(row.visibility, locale))),
          tag('td', { class: 'col-price num' }, esc(formatAmount(row.price_from_cents, locale))),
          tag('td', { class: 'col-queue' }, esc(queueStatusLabel(row.queue_status, locale))),
        ),
      ),
    ),
  );
}

function queuePanel(
  uploads: readonly UploadRecord[],
  locale: Locale,
  lang: string | null,
): string {
  return tag(
    'section',
    { class: 'queue-panel', role: 'region', 'aria-label': s('queue', locale) },
    tag('h2', {}, esc(s('queue', locale))),
    tag(
      'ul',
      { class: 'stage-list' },
      ...uploads.map((upload) =>
        tag(
          'li',
          { class: 'stage-item' },
          tag(
            'a',
            { href: link(`/studio/models/${upload.modelSlug}/queue`, lang) },
            esc(upload.modelSlug),
          ),
          tag('span', {}, esc(queueStatusLabel(upload.status, locale))),
        ),
      ),
    ),
  );
}

export interface DashboardData {
  readonly totals: Totals;
  readonly quota: Quota;
  readonly models: readonly ModelRow[];
  readonly uploads: readonly UploadRecord[];
}

export function dashboardPage(shell: StudioShell, data: DashboardData): string {
  const { locale, lang } = shell;
  const totalKeys = [
    'public',
    'unlisted',
    'password',
    'private',
    'draft',
    'in_review',
    'withdrawn',
  ] as const;
  return studioPage(
    shell,
    tag('h1', {}, esc(s('dashboardHeading', locale))),
    quotaBadge(data.quota, locale),
    tag(
      'section',
      { role: 'region', 'aria-label': s('catalogueTotals', locale) },
      tag('h2', {}, esc(s('catalogueTotals', locale))),
      tag(
        'div',
        { class: 'totals-grid' },
        ...totalKeys.map((key) =>
          tag(
            'div',
            {},
            tag('span', {}, esc(totalLabel(key, locale))),
            tag('span', { class: 'mono' }, esc(formatNumber(data.totals[key], locale))),
          ),
        ),
      ),
    ),
    tag('section', { class: 'models-panel' }, modelsTable(data.models, locale, lang)),
    queuePanel(data.uploads, locale, lang),
  );
}

export function uploadPage(shell: StudioShell): string {
  const { locale } = shell;
  return studioPage(
    { ...shell, scripts: ['upload.js'] },
    tag('h1', {}, esc(s('uploadHeading', locale))),
    tag('div', { role: 'alert', 'data-upload-alert': 'true' }),
    tag(
      'form',
      { method: 'post', 'data-upload-form': 'true' },
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
          ...SOURCE_UNITS.map((unit) =>
            tag('option', { value: unit }, esc(sourceUnitLabel(unit, locale))),
          ),
        ),
      ),
      tag(
        'label',
        { class: 'field' },
        tag('span', {}, esc(s('category', locale))),
        tag(
          'select',
          { name: 'category', 'aria-label': s('category', locale) },
          ...CATEGORIES.map((category) =>
            tag('option', { value: category }, esc(categoryLabel(category, locale))),
          ),
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
  );
}

export interface QueuePageData {
  readonly slug: string;
  readonly upload: UploadRecord | null;
  readonly contributor: boolean;
  readonly canSubmit: boolean;
}

export function queueStagesMarkup(upload: UploadRecord | null, locale: Locale): string {
  const stages = upload?.stages ?? [];
  return tag(
    'ul',
    { class: 'stage-list', role: 'list', 'aria-label': s('queueStages', locale), 'data-stage-list': 'true' },
    ...stages.map((stage) =>
      tag(
        'li',
        { class: 'stage-item', 'data-stage': stage.name, 'data-status': stage.status },
        tag(
          'span',
          {},
          tag('span', { class: 'stage-mark' }, ''),
          esc(`${stageLabel(stage.name, locale)} — ${stageStatusLabel(stage.status, locale)}`),
        ),
        tag(
          'span',
          { class: 'mono' },
          esc(
            `${s('attempts', locale)} ${formatNumber(stage.attempts, locale)}${
              stage.nextAttemptAt === null
                ? ''
                : ` · ${s('nextRetry', locale)} ${stage.nextAttemptAt.toISOString()}`
            }`,
          ),
        ),
      ),
    ),
  );
}

export function queuePage(shell: StudioShell, data: QueuePageData): string {
  const { locale, lang } = shell;
  const body = join(
    tag('h1', {}, esc(s('queueHeading', locale))),
    tag('p', {}, tag('a', { href: link(`/studio/models/${data.slug}`, lang) }, esc(data.slug))),
    tag(
      'div',
      {
        role: 'status',
        'aria-live': 'polite',
        'aria-label': s('queueProgress', locale),
        'data-queue-progress': 'true',
      },
      esc(s('queueStarted', locale)),
    ),
    tag('div', { 'data-stage-container': 'true' }, queueStagesMarkup(data.upload, locale)),
    tag(
      'div',
      { class: 'viewer-controls' },
      tag(
        'button',
        {
          type: 'button',
          class: 'button',
          'data-requeue': data.upload?.uploadRef ?? '',
          disabled: data.upload?.status !== 'failed',
        },
        esc(s('requeue', locale)),
      ),
      data.contributor
        ? tag(
            'button',
            {
              type: 'button',
              class: 'button',
              'data-submit-draft': data.slug,
              disabled: !data.canSubmit,
            },
            esc(s('sendToReview', locale)),
          )
        : '',
    ),
    jsonScript('queue-state', { slug: data.slug, upload: data.upload?.uploadRef ?? null, contributor: data.contributor, locale, lang }),
  );

  if (data.contributor) {
    return page(
      { locale, lang, role: shell.role, title: s('queueHeading', locale), scripts: ['queue.js'] },
      tag('div', { class: 'panel' }, notices(locale), body),
    );
  }
  return studioPage({ ...shell, scripts: ['queue.js'] }, body);
}

export interface StudioModelData {
  readonly detail: ModelDetail;
  readonly state: ModelState;
  readonly visibility: 'public' | 'unlisted' | 'private' | 'password';
  readonly readOnly: boolean;
  readonly shareUrl: string | null;
  readonly embeds: readonly { readonly token: string; readonly url: string }[];
  readonly latestUpload: string | null;
  readonly owner: string;
  readonly prices: { readonly personal: number; readonly commercial: number | null; readonly studio: number | null };
}

function stateButtons(data: StudioModelData, role: Role, locale: Locale): string {
  const mover = role === 'editor' ? 'editor' : 'author';
  const allowed = new Set(allowedTargets(data.state, mover));
  const labels: Readonly<Record<ModelState, Parameters<typeof s>[0]>> = {
    draft: 'returnToDraft',
    in_review: 'sendToReview',
    published: 'publish',
    withdrawn: 'withdraw',
  };
  return tag(
    'div',
    { class: 'viewer-controls' },
    ...MODEL_STATES.map((target) =>
      tag(
        'button',
        {
          type: 'button',
          class: 'button',
          'data-transition': target,
          disabled: !allowed.has(target) || (data.readOnly && target !== 'withdrawn'),
        },
        esc(s(labels[target], locale)),
      ),
    ),
  );
}

export function studioModelPage(shell: StudioShell, data: StudioModelData): string {
  const { locale, lang } = shell;
  const { detail } = data;
  const author = shell.role === 'author';

  const settings = tag(
    'form',
    { 'data-model-form': detail.slug },
    tag('div', { role: 'alert', 'data-model-alert': 'true' }),
    tag(
      'label',
      { class: 'field' },
      tag('span', {}, esc(s('title', locale))),
      voidTag('input', { type: 'text', name: 'title', value: detail.title, 'aria-label': s('title', locale) }),
    ),
    tag(
      'label',
      { class: 'field' },
      tag('span', {}, esc(s('description', locale))),
      tag('textarea', { name: 'description', 'aria-label': s('description', locale) }, esc(detail.description)),
    ),
    tag(
      'label',
      { class: 'field' },
      tag('span', {}, esc(s('category', locale))),
      tag(
        'select',
        { name: 'category', 'aria-label': s('category', locale) },
        ...CATEGORIES.map((category) =>
          tag(
            'option',
            { value: category, selected: category === detail.category },
            esc(categoryLabel(category, locale)),
          ),
        ),
      ),
    ),
    tag(
      'label',
      { class: 'field' },
      tag('span', {}, esc(s('visibility', locale))),
      tag(
        'select',
        { name: 'visibility', 'aria-label': s('visibility', locale) },
        ...VISIBILITIES.map((value) =>
          tag(
            'option',
            { value, selected: value === data.visibility },
            esc(visibilityLabel(value, locale)),
          ),
        ),
      ),
    ),
    tag(
      'label',
      { class: 'field' },
      tag('span', {}, esc(s('password', locale))),
      voidTag('input', { type: 'password', name: 'password', 'aria-label': s('password', locale) }),
    ),
    tag(
      'label',
      { class: 'field' },
      tag('span', {}, esc(s('pricePersonal', locale))),
      voidTag('input', { type: 'number', name: 'personal_cents', value: data.prices.personal, 'aria-label': s('pricePersonal', locale) }),
    ),
    tag(
      'label',
      { class: 'field' },
      tag('span', {}, esc(s('priceCommercial', locale))),
      voidTag('input', { type: 'number', name: 'commercial_cents', value: data.prices.commercial ?? '', 'aria-label': s('priceCommercial', locale) }),
    ),
    tag(
      'label',
      { class: 'field' },
      tag('span', {}, esc(s('priceStudio', locale))),
      voidTag('input', { type: 'number', name: 'studio_cents', value: data.prices.studio ?? '', 'aria-label': s('priceStudio', locale) }),
    ),
    tag(
      'label',
      { class: 'field' },
      tag('span', {}, esc(s('discountPercent', locale))),
      voidTag('input', { type: 'number', name: 'discount_percent', value: detail.discount_percent, 'aria-label': s('discountPercent', locale) }),
    ),
    tag(
      'label',
      { class: 'field' },
      tag('span', {}, esc(s('editionTotal', locale))),
      voidTag('input', { type: 'number', name: 'edition_total', value: detail.edition?.total ?? '', 'aria-label': s('editionTotal', locale) }),
    ),
    tag(
      'label',
      { class: 'field' },
      tag('span', {}, esc(s('editionPrice', locale))),
      voidTag('input', { type: 'number', name: 'edition_price_cents', value: detail.edition?.price_cents ?? '', 'aria-label': s('editionPrice', locale) }),
    ),
    tag('button', { type: 'submit', class: 'button' }, esc(s('saveChanges', locale))),
  );

  const sharePanel = tag(
    'section',
    {},
    tag('h2', {}, esc(s('shareLink', locale))),
    tag('p', { 'data-share-url': 'true' }, data.shareUrl === null ? '' : esc(data.shareUrl)),
    tag(
      'div',
      { class: 'viewer-controls' },
      tag('button', { type: 'button', class: 'button button-secondary', 'data-new-share-link': 'true' }, esc(s('newShareLink', locale))),
      tag('button', { type: 'button', class: 'button button-secondary', 'data-create-embed': 'true' }, esc(s('createEmbed', locale))),
    ),
    tag('h2', {}, esc(s('embeds', locale))),
    tag(
      'ul',
      { 'data-embed-list': 'true' },
      ...data.embeds.map((embed) =>
        tag(
          'li',
          {},
          tag('span', { class: 'mono' }, esc(embed.url)),
          ' ',
          tag(
            'button',
            { type: 'button', class: 'button button-secondary', 'data-remove-embed': embed.token },
            esc(s('removeEmbed', locale)),
          ),
        ),
      ),
    ),
  );

  const sourcePanel = tag(
    'section',
    {},
    tag(
      'form',
      { 'data-replace-form': detail.slug },
      tag(
        'label',
        { class: 'field' },
        tag('span', {}, esc(s('modelFile', locale))),
        voidTag('input', { type: 'file', name: 'file', 'aria-label': s('modelFile', locale) }),
      ),
      tag(
        'label',
        { class: 'field' },
        tag('span', {}, esc(s('sourceUnit', locale))),
        tag(
          'select',
          { name: 'source_unit', 'aria-label': s('sourceUnit', locale) },
          ...SOURCE_UNITS.map((unit) =>
            tag('option', { value: unit }, esc(sourceUnitLabel(unit, locale))),
          ),
        ),
      ),
      tag('button', { type: 'submit', class: 'button' }, esc(s('replaceSource', locale))),
    ),
    tag(
      'p',
      {},
      tag('a', { href: `/api/studio/models/${detail.slug}/original` }, esc(s('downloadOriginal', locale))),
    ),
  );

  const viewerControls = tag(
    'div',
    { class: 'viewer-controls' },
    tag('button', { type: 'button', class: 'button button-secondary', 'data-save-view': 'true' }, esc(s('saveDefaultView', locale))),
    tag('button', { type: 'button', class: 'button button-secondary', 'data-add-hotspot': 'true' }, esc(s('addHotspot', locale))),
    tag(
      'label',
      { class: 'field' },
      tag('span', {}, esc(s('hotspotLabel', locale))),
      voidTag('input', { type: 'text', 'data-hotspot-label': 'true', 'aria-label': s('hotspotLabel', locale) }),
    ),
    tag('button', { type: 'button', class: 'button button-secondary', 'data-save-hotspots': 'true' }, esc(s('saveHotspots', locale))),
  );

  return studioPage(
    { ...shell, scripts: ['viewer.js', 'studio-model.js'] },
    tag('h1', {}, esc(detail.title)),
    data.readOnly
      ? tag(
          'div',
          { role: 'status', 'aria-live': 'polite', 'aria-label': s('readOnly', locale) },
          esc(s('readOnlyOnPlan', locale)),
        )
      : '',
    stateButtons(data, shell.role, locale),
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
        previewUrl: mediaUrl(detail.slug, 'preview.png', null),
        glbUrl: mediaUrl(detail.slug, 'view.glb', null),
        rebuilding: detail.rebuilding,
        studio: true,
      }),
      viewerControls,
    ),
    tag('div', { class: 'detail-column' }, author ? settings : '', author ? sharePanel : '', author ? sourcePanel : ''),
    jsonScript('model-state', {
      slug: detail.slug,
      locale,
      lang,
      access: null,
      camera: detail.default_camera,
      boundingRadiusMm: detail.bounding_radius_mm,
      scaleDenominator: detail.scale_denominator,
      modelHeightMm: detail.dimensions_mm.height,
      hotspots: detail.hotspots,
      edition: detail.edition,
      licences: detail.licences,
      glbUrl: mediaUrl(detail.slug, 'view.glb', null),
      studio: true,
    }),
  );
}

export function reviewPage(shell: StudioShell, rows: readonly (ModelRow & { owner: string })[]): string {
  const { locale, lang } = shell;
  return studioPage(
    { ...shell, scripts: ['review.js'] },
    tag('h1', {}, esc(s('reviewHeading', locale))),
    tag(
      'table',
      { 'aria-label': s('models', locale) },
      tag(
        'thead',
        {},
        tag(
          'tr',
          {},
          tag('th', { scope: 'col' }, esc(s('colTitle', locale))),
          tag('th', { scope: 'col' }, esc(s('colSubmitter', locale))),
          tag('th', { scope: 'col' }, esc(s('colState', locale))),
        ),
      ),
      tag(
        'tbody',
        {},
        ...rows.map((row) =>
          tag(
            'tr',
            {},
            tag('td', {}, tag('a', { href: link(`/studio/models/${row.slug}`, lang) }, esc(row.title))),
            tag('td', {}, esc(row.owner)),
            tag(
              'td',
              {},
              esc(stateLabel(row.state, locale)),
              tag(
                'div',
                { class: 'viewer-controls' },
                ...MODEL_STATES.map((target) =>
                  tag(
                    'button',
                    {
                      type: 'button',
                      class: 'button button-secondary',
                      'data-review-transition': target,
                      'data-slug': row.slug,
                      disabled: !allowedTargets(row.state, 'editor').includes(target),
                    },
                    esc(
                      s(
                        target === 'draft'
                          ? 'returnToDraft'
                          : target === 'in_review'
                            ? 'sendToReview'
                            : target === 'published'
                              ? 'publish'
                              : 'withdraw',
                        locale,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

export function collectionsPage(
  shell: StudioShell,
  collections: readonly CollectionPayload[],
  titles: ReadonlyMap<string, string>,
  allSlugs: readonly { readonly slug: string; readonly title: string }[],
): string {
  const { locale } = shell;
  return studioPage(
    { ...shell, scripts: ['collections.js'] },
    tag('h1', {}, esc(s('collectionsHeading', locale))),
    tag('div', { role: 'alert', 'data-collections-alert': 'true' }),
    tag(
      'form',
      { 'data-create-collection': 'true' },
      tag(
        'label',
        { class: 'field' },
        tag('span', {}, esc(s('collectionName', locale))),
        voidTag('input', { type: 'text', name: 'name', 'aria-label': s('collectionName', locale) }),
      ),
      tag('button', { type: 'submit', class: 'button' }, esc(s('createCollection', locale))),
    ),
    ...collections.map((collection) =>
      tag(
        'section',
        {
          role: 'region',
          'aria-label': collectionRegionName(collection.name, collection.item_count),
          'data-collection': collection.slug,
        },
        tag('h2', {}, esc(collectionRegionName(collection.name, collection.item_count))),
        tag(
          'ul',
          {},
          ...collection.models.map((slug) =>
            tag(
              'li',
              {},
              esc(titles.get(slug) ?? slug),
              ' ',
              tag(
                'button',
                {
                  type: 'button',
                  class: 'button button-secondary',
                  'data-move-model': slug,
                  'data-collection': collection.slug,
                },
                esc(moveModel(titles.get(slug) ?? slug, locale)),
              ),
              ' ',
              tag(
                'button',
                {
                  type: 'button',
                  class: 'button button-secondary',
                  'data-remove-model': slug,
                  'data-collection': collection.slug,
                },
                esc(removeModel(titles.get(slug) ?? slug, locale)),
              ),
            ),
          ),
        ),
        tag(
          'div',
          { class: 'viewer-controls' },
          tag(
            'select',
            { 'data-add-slug': collection.slug, 'aria-label': s('addToCollection', locale) },
            ...allSlugs.map((model) => tag('option', { value: model.slug }, esc(model.title))),
          ),
          tag(
            'select',
            { 'data-move-target': collection.slug, 'aria-label': s('moveTo', locale) },
            ...collections
              .filter((other) => other.slug !== collection.slug)
              .map((other) => tag('option', { value: other.slug }, esc(other.name))),
          ),
          tag(
            'button',
            { type: 'button', class: 'button button-secondary', 'data-add-model': collection.slug },
            esc(s('addToCollection', locale)),
          ),
          tag(
            'button',
            { type: 'button', class: 'button button-secondary', 'data-delete-collection': collection.slug },
            esc(s('deleteCollection', locale)),
          ),
        ),
      ),
    ),
    jsonScript('collections-state', {
      collections: collections.map((c) => ({ slug: c.slug, name: c.name })),
      titles: Object.fromEntries(titles),
    }),
  );
}

export interface PlanPageData {
  readonly current: PlanName;
  readonly pending: { readonly plan: PlanName; readonly effective_date: string } | null;
  readonly quota: Quota;
}

export function planPage(shell: StudioShell, data: PlanPageData): string {
  const { locale } = shell;
  const yesNo = (value: boolean): string => (value ? s('yes', locale) : s('no', locale));
  const limit = (value: number | null): string =>
    value === null ? s('noLimit', locale) : formatNumber(value, locale);

  return studioPage(
    { ...shell, scripts: ['plan.js'] },
    tag('h1', {}, esc(s('planHeading', locale))),
    tag('p', { class: 'mono', 'data-current-plan': data.current }, esc(PLANS[data.current].label)),
    data.pending === null
      ? ''
      : tag(
          'p',
          { 'data-pending-change': 'true' },
          esc(
            pendingChangeLine(
              PLANS[data.pending.plan].label,
              formatDate(data.pending.effective_date, locale),
              locale,
            ),
          ),
        ),
    quotaBadge(data.quota, locale),
    tag(
      'table',
      { 'aria-label': s('plans', locale) },
      tag('caption', {}, esc(s('plans', locale))),
      tag(
        'thead',
        {},
        tag(
          'tr',
          {},
          tag('th', { scope: 'col' }, esc(s('planHeading', locale))),
          ...PLAN_NAMES.map((name) => tag('th', { scope: 'col' }, esc(PLANS[name].label))),
        ),
      ),
      tag(
        'tbody',
        {},
        tag(
          'tr',
          {},
          tag('th', { scope: 'row' }, esc(s('planMonthly', locale))),
          ...PLAN_NAMES.map((name) =>
            tag('td', { class: 'num' }, esc(formatAmount(PLANS[name].monthlyPriceCents, locale))),
          ),
        ),
        tag(
          'tr',
          {},
          tag('th', { scope: 'row' }, esc(s('planPackage', locale))),
          ...PLAN_NAMES.map((name) =>
            tag('td', { class: 'num' }, esc(`${formatNumber(PLANS[name].maxPackageBytes, locale)} bytes`)),
          ),
        ),
        tag(
          'tr',
          {},
          tag('th', { scope: 'row' }, esc(s('planPublishes', locale))),
          ...PLAN_NAMES.map((name) => tag('td', { class: 'num' }, esc(limit(PLANS[name].publishesPerCycle)))),
        ),
        tag(
          'tr',
          {},
          tag('th', { scope: 'row' }, esc(s('planModels', locale))),
          ...PLAN_NAMES.map((name) => tag('td', { class: 'num' }, esc(limit(PLANS[name].publishedWithinPlan)))),
        ),
        tag(
          'tr',
          {},
          tag('th', { scope: 'row' }, esc(s('planEmbeds', locale))),
          ...PLAN_NAMES.map((name) => tag('td', {}, esc(yesNo(PLANS[name].embeds)))),
        ),
        tag(
          'tr',
          {},
          tag('th', { scope: 'row' }, esc(s('planEditions', locale))),
          ...PLAN_NAMES.map((name) => tag('td', {}, esc(yesNo(PLANS[name].editions)))),
        ),
        tag(
          'tr',
          {},
          tag('th', { scope: 'row' }, esc(s('planKeys', locale))),
          ...PLAN_NAMES.map((name) => tag('td', { class: 'num' }, esc(formatNumber(PLANS[name].readKeys, locale)))),
        ),
        tag(
          'tr',
          {},
          tag('th', { scope: 'row' }, ''),
          ...PLAN_NAMES.map((name) =>
            tag(
              'td',
              {},
              tag(
                'button',
                { type: 'button', class: 'button', 'data-switch-plan': name, disabled: name === data.current },
                esc(switchToPlan(PLANS[name].label, locale)),
              ),
            ),
          ),
        ),
      ),
    ),
    tag(
      'dialog',
      { 'aria-label': s('changePlan', locale), 'data-plan-dialog': 'true' },
      tag('h2', {}, esc(s('changePlan', locale))),
      tag('p', { 'data-plan-target': 'true' }),
      tag('div', { role: 'alert', 'data-plan-alert': 'true' }),
      tag(
        'div',
        { class: 'dialog-actions' },
        tag('button', { type: 'button', class: 'button', 'data-confirm-plan': 'true' }, esc(s('confirmChange', locale))),
        tag('button', { type: 'button', class: 'button button-secondary', 'data-cancel-plan': 'true' }, esc(s('cancel', locale))),
      ),
    ),
    jsonScript('plan-state', { current: data.current, labels: Object.fromEntries(PLAN_NAMES.map((n) => [n, PLANS[n].label])) }),
  );
}

export interface KeyRow {
  readonly ref: string;
  readonly name: string;
  readonly created_at: string;
  readonly active: boolean;
}

export function apiKeysPage(shell: StudioShell, keys: readonly KeyRow[]): string {
  const { locale } = shell;
  return studioPage(
    { ...shell, scripts: ['api-keys.js'] },
    tag('h1', {}, esc(s('apiKeysHeading', locale))),
    tag('div', { role: 'alert', 'data-keys-alert': 'true' }),
    tag(
      'form',
      { 'data-create-key': 'true' },
      tag(
        'label',
        { class: 'field' },
        tag('span', {}, esc(s('keyName', locale))),
        voidTag('input', { type: 'text', name: 'name', 'aria-label': s('keyName', locale) }),
      ),
      tag('button', { type: 'submit', class: 'button' }, esc(s('createKey', locale))),
    ),
    tag(
      'table',
      { 'aria-label': s('apiKeysHeading', locale) },
      tag(
        'thead',
        {},
        tag(
          'tr',
          {},
          tag('th', { scope: 'col' }, esc(s('keyName', locale))),
          tag('th', { scope: 'col' }, esc(s('colReference', locale))),
          tag('th', { scope: 'col' }, esc(s('colCreated', locale))),
          tag('th', { scope: 'col' }, ''),
        ),
      ),
      tag(
        'tbody',
        {},
        ...keys
          .filter((key) => key.active)
          .map((key) =>
            tag(
              'tr',
              {},
              tag('td', {}, esc(key.name)),
              tag('td', { class: 'mono' }, esc(key.ref)),
              tag('td', { class: 'mono' }, esc(formatDate(key.created_at.slice(0, 10), locale))),
              tag(
                'td',
                {},
                tag(
                  'button',
                  { type: 'button', class: 'button button-secondary', 'data-revoke-key': key.ref },
                  esc(revokeKey(key.name, locale)),
                ),
              ),
            ),
          ),
      ),
    ),
  );
}

export function exportPage(shell: StudioShell): string {
  const { locale } = shell;
  return studioPage(
    shell,
    tag('h1', {}, esc(s('exportHeading', locale))),
    tag(
      'p',
      {},
      tag('a', { href: '/api/studio/exports/catalogue.csv' }, esc(s('downloadCsv', locale))),
    ),
  );
}

export { plan };
