import type { RequestContext } from '../http/types.js';
import { ApiError } from '../errors.js';
import type { PageContext } from './render.js';
import { layout, escapeHtml, withLang, langParam } from './render.js';
import { t, formatAmount, formatNumber, type Locale } from '../locales.js';
import { getModelBySlug, getModelById, type ModelRow } from '../domain/models.js';
import { publicAccess, embedAllowed, embedModelOf, type ViewerContext, type Viewer } from '../domain/access.js';
import { viewerContextOf, modelDetailOf } from '../api/public.js';
import { sessionSecret } from '../server-context.js';
import { currentPriceCents, editionRemaining, getOrderByReceipt, orderRefunds, upgradeOptionsFor } from '../domain/commerce.js';
import { search } from '../providers/search.js';
import { cardOf } from '../api/public.js';
import { hasPendingRemovals } from '../domain/models.js';

export async function renderModelPage(ctx: PageContext, request: RequestContext): Promise<{ html: string; status: number } | null> {
  const slug = request.params['slug'] ?? '';
  const model = await getModelBySlug(slug);
  if (model === null) throw new ApiError(404, 'not_found');
  const viewer: Viewer = { kind: 'public' };
  const access = await publicAccess(model, viewerContextOf(request, viewer, slug), await sessionSecret());
  if (!access.allowed) throw new ApiError(404, 'not_found');
  if (access.passwordGate) {
    return { html: renderPasswordGate(ctx, model), status: 200 };
  }
  return { html: await renderModelContent(ctx, request, model, `/models/${slug}`), status: 200 };
}

export async function renderSharePage(ctx: PageContext, request: RequestContext): Promise<{ html: string; status: number } | null> {
  const token = request.params['token'] ?? '';
  const row = await (await import('../db/db.js')).one<{ slug: string }>(
    'SELECT m.slug FROM share_tokens s JOIN models m ON m.id = s.model_id WHERE s.token = $1',
    [token],
  );
  if (row === null) throw new ApiError(404, 'not_found');
  const modelRow = await getModelBySlug(row.slug);
  if (modelRow === null || modelRow.visibility !== 'unlisted' || modelRow.state !== 'published' || modelRow.read_only) {
    throw new ApiError(404, 'not_found');
  }
  return { html: await renderModelContent(ctx, request, modelRow, `/u/${token}`), status: 200 };
}

export async function renderEmbedPage(ctx: PageContext, request: RequestContext): Promise<{ html: string; status: number } | null> {
  const token = request.params['token'] ?? '';
  const model = await embedModelOf(token);
  if (model === null || !(await embedAllowed(model))) {
    const main = `<div class="embed-unavailable">
  <p>${t(ctx.locale, 'embed.unavailable')}</p>
  <a href="/catalogue">${t(ctx.locale, 'embed.view_model')}</a>
</div>`;
    return { html: layout({ ...ctx, script: '', title: t(ctx.locale, 'embed.unavailable') }, main), status: 404 };
  }
  const access = await publicAccess(model, { viewer: { kind: 'public' }, accessToken: token }, await sessionSecret());
  if (!access.allowed || access.passwordGate) {
    const main = `<p>${t(ctx.locale, 'embed.unavailable')}</p>`;
    return { html: layout({ ...ctx, script: '', title: t(ctx.locale, 'embed.unavailable') }, main), status: 404 };
  }
  const viewerMarkup = viewerMarkupOf(ctx, model, token);
  const main = `<section class="embed-root">
${viewerMarkup}
  <p class="embed-back"><a href="/models/${model.slug}">${t(ctx.locale, 'embed.view_model')}</a></p>
</section>`;
  return {
    html: layout({ ...ctx, title: model.title, script: '/assets/model.js', clientCopy: viewerClientCopy(ctx.locale) }, main),
    status: 200,
  };
}

export async function renderReceiptPage(ctx: PageContext, request: RequestContext): Promise<{ html: string; status: number } | null> {
  const token = request.params['token'] ?? '';
  const order = await getOrderByReceipt(token);
  if (order === null) throw new ApiError(404, 'not_found');
  const modelRow = await getModelById(order.model_id);
  if (modelRow === null) throw new ApiError(404, 'not_found');
  const l = ctx.locale;
  const purchasable = modelRow.state === 'published' && !modelRow.read_only;
  const options = await upgradeOptionsFor(order, purchasable);
  const refunds = await orderRefunds(order.id);
  const editionLine =
    order.edition_number !== null && order.edition_total !== null
      ? `<p class="mono">${t(l, 'receipt.edition_line', { n: order.edition_number, total: order.edition_total })}</p>`
      : '';
  const upgradeButtons =
    order.status === 'paid' || order.status === 'partially_refunded'
      ? options.map(option => `<button type="button" class="upgrade-button" data-upgrade="${option.licence}" data-model="${escapeHtml(modelRow.slug)}">${t(l, option.licence === 'commercial' ? 'receipt.upgrade_commercial' : 'receipt.upgrade_studio')} · ${formatAmount(option.amount_cents, l)}</button>`).join('\n')
      : '';
  const downloadLinks =
    order.status === 'refunded'
      ? `<p class="refunded-note">${t(l, 'licence_refunded')}</p>`
      : `<p class="receipt-links">
  <a href="/api/receipts/${token}/files/model.glb">${t(l, 'receipt.download_glb')}</a>
  <a href="/api/receipts/${token}/files/model.stl">${t(l, 'receipt.download_stl')}</a>
  <a href="/api/receipts/${token}/invoice.pdf">${t(l, 'receipt.invoice_pdf')}</a>
</p>`;
  const refundLines = refunds.map(refund => `<p class="mono">${t(l, 'receipt.refunded_line', { amount: formatAmount(refund.amount_cents, l) })}</p>`).join('\n');
  const main = `<article class="receipt">
  <h1 id="receipt-heading" tabindex="-1">${t(l, 'receipt.heading', { ref: order.order_ref })}</h1>
  <dl class="receipt-facts">
    <div><dt>${t(l, 'receipt.licence')}</dt><dd>${escapeHtml(licenceLabel(l, order.licence))}</dd></div>
    <div><dt>${t(l, 'receipt.amount')}</dt><dd class="mono">${t(l, 'receipt.total', { amount: formatAmount(order.amount_cents, l) })}</dd></div>
    <div><dt>${t(l, 'receipt.refunded')}</dt><dd class="mono">${t(l, 'receipt.refunded_line', { amount: formatAmount(order.refunded_cents, l) })}</dd></div>
    <div><dt>${t(l, 'receipt.status')}</dt><dd>${t(l, `order_status.${order.status === 'paid' ? 'paid' : order.status === 'partially_refunded' ? 'partially_refunded' : 'refunded'}`)}</dd></div>
  </dl>
  ${editionLine}
  ${downloadLinks}
  ${refundLines}
  <div class="upgrade-options">${upgradeButtons}</div>
</article>`;
  return {
    html: layout({ ...ctx, title: t(l, 'receipt.heading', { ref: order.order_ref }), script: '/assets/receipt.js' }, main),
    status: 200,
  };
}

function licenceLabel(l: Locale, licence: string): string {
  if (licence === 'edition') return t(l, 'licence.edition');
  if (licence === 'personal') return t(l, 'licence.personal');
  if (licence === 'commercial') return t(l, 'licence.commercial');
  return t(l, 'licence.studio');
}

function renderPasswordGate(ctx: PageContext, model: ModelRow): string {
  const l = ctx.locale;
  const lang = langParam(ctx);
  ctx.title = model.title;
  ctx.script = '/assets/model.js';
  ctx.clientCopy = { ...ctx.clientCopy, 'password.unlock': t(l, 'password.unlock'), 'password.gate_heading': t(l, 'password.gate_heading') };
  const main = `<section class="password-gate">
  <h1>${escapeHtml(model.title)}</h1>
  <p>${t(l, 'password.gate_hint')}</p>
  <form id="unlock-form" data-slug="${escapeHtml(model.slug)}">
    <label for="model-password">${t(l, 'password.gate_heading')}</label>
    <input type="password" id="model-password" name="password" autocomplete="off">
    <button type="submit">${t(l, 'password.unlock')}</button>
    <p class="gate-alert" role="alert" hidden></p>
  </form>
</section>`;
  return layout(ctx, main);
}

async function renderModelContent(ctx: PageContext, request: RequestContext, model: ModelRow, pagePath: string): Promise<string> {
  const l = ctx.locale;
  const lang = langParam(ctx);
  const detail = modelDetailOf(model, 'public');
  if (detail.edition !== null) {
    detail.edition.remaining = await editionRemaining(model.id);
  }
  ctx.title = model.title;
  ctx.script = '/assets/model.js';
  ctx.clientCopy = { ...ctx.clientCopy, ...viewerClientCopy(l) };

  const recommendations = (await hasPendingRemovals()) || !(await serviceIsUp())
    ? []
    : (await search({ q: '', category: [], licence: [], format: [], sort: 'newest', page: 1, perPage: 5, withFacets: false }))
        .hits.filter(hit => hit.slug !== model.slug)
        .slice(0, 4)
        .map(cardOf);

  const licenceRows = detail.licences
    .map(licence => `        <tr>
          <td>${escapeHtml(licence.type === 'personal' ? t(l, 'licence.personal') : licence.type === 'commercial' ? t(l, 'licence.commercial') : t(l, 'licence.studio'))}</td>
          <td class="mono">${licence.seats}</td>
          <td class="mono">${formatAmount(licence.price_cents, l)}</td>
          <td><button type="button" class="buy-button" data-licence="${licence.type}">${t(l, `model.buy_${licence.type}`)}</button></td>
        </tr>`)
    .join('\n');
  const editionRow =
    detail.edition !== null
      ? `        <tr>
          <td>${escapeHtml(t(l, 'licence.edition'))}</td>
          <td class="mono">1</td>
          <td class="mono">${formatAmount(detail.edition.price_cents, l)}</td>
          <td><button type="button" class="buy-button" data-licence="edition"${detail.edition.remaining === 0 ? ' disabled' : ''}>${t(l, 'model.buy_numbered')}</button></td>
        </tr>`
      : '';
  const editionStatus =
    detail.edition !== null
      ? `<p class="mono" role="status" id="edition-availability" aria-live="polite">${editionCopy(l, detail.edition.remaining, detail.edition.total)}</p>`
      : '';

  const specs = `      <tr><th scope="row">${t(l, 'spec.dimensions')}</th><td class="mono">${formatNumber(detail.dimensions_mm.width, l, 1)} × ${formatNumber(detail.dimensions_mm.height, l, 1)} × ${formatNumber(detail.dimensions_mm.depth, l, 1)} mm</td></tr>
      <tr><th scope="row">${t(l, 'spec.formats')}</th><td>${detail.formats.map(format => format.toUpperCase()).join(', ')}</td></tr>
      <tr><th scope="row">${t(l, 'spec.figure_scale')}</th><td class="mono">${t(l, 'scale.denominator', { n: detail.scale_denominator })}</td></tr>
      ${detail.edition !== null ? `<tr><th scope="row">${t(l, 'spec.edition')}</th><td>${t(l, 'spec.edition_value', { total: detail.edition.total })}</td></tr>` : ''}`;

  const viewerMarkup = viewerMarkupOf(ctx, model, undefined);

  const main = `<article class="model-page" data-slug="${escapeHtml(model.slug)}">
  <h1>${escapeHtml(model.title)}</h1>
  ${pagePath.startsWith('/u/') ? `<p class="share-note">${t(l, 'studio_model.share_hint')}</p>` : ''}
  <div class="model-layout">
    <div class="viewer-column">
${viewerMarkup}
    </div>
    <div class="tables-column">
      <section aria-labelledby="licences-heading">
        <h2 id="licences-heading">${t(l, 'model.licences')}</h2>
        <table class="data-table" aria-label="${t(l, 'model.licences')}">
          <thead><tr><th scope="col">${t(l, 'model.licence')}</th><th scope="col">${t(l, 'model.seats')}</th><th scope="col">${t(l, 'model.price')}</th><th scope="col">${t(l, 'model.buy')}</th></tr></thead>
          <tbody>
${licenceRows}
${editionRow}
          </tbody>
        </table>
        ${editionStatus}
      </section>
      <section aria-labelledby="specs-heading">
        <h2 id="specs-heading">${t(l, 'model.specifications')}</h2>
        <table class="data-table" aria-label="${t(l, 'model.specifications')}">
          <tbody>
${specs}
          </tbody>
        </table>
      </section>
    </div>
  </div>
  <section class="recommendations" aria-labelledby="more-heading">
    <h2 id="more-heading">${t(l, 'model.more_from')}</h2>
    <ul class="card-grid small" role="list" aria-label="${t(l, 'model.more_from')}">
${recommendations.map(card => `      <li class="card"><a class="card-link" href="${withLang(`/models/${card.slug}`, lang)}"><span class="card-title">${escapeHtml(card.title)}</span><span class="card-meta mono">${escapeHtml(t(l, 'catalogue.from', { amount: formatAmount(card.price_from_cents, l) }))}</span></a></li>`).join('\n') || `      <li class="empty-state">${t(l, 'catalogue.results.none')}</li>`}
    </ul>
  </section>
</article>`;
  return layout(ctx, main);
}

function editionCopy(l: Locale, remaining: number, total: number): string {
  if (remaining <= 0) return t(l, 'model.sold_out');
  return t(l, 'model.edition_left', { remaining, total });
}

async function serviceIsUp(): Promise<boolean> {
  const { serviceUp } = await import('../providers/availability.js');
  return serviceUp('search');
}

export function viewerClientCopy(l: Locale): Record<string, string> {
  const keys = [
    'viewer.group', 'viewer.ring', 'viewer.readout', 'viewer.distance', 'viewer.fov', 'viewer.tilt', 'viewer.azimuth',
    'viewer.prev_hotspot', 'viewer.next_hotspot', 'viewer.first_person', 'viewer.reset', 'viewer.announcements',
    'viewer.fallback', 'viewer.rebuilding', 'viewer.announcements.hotspot', 'viewer.heading_strip',
    'checkout.title', 'checkout.email', 'checkout.terms', 'checkout.pay_now', 'checkout.cancel', 'checkout.status',
    'checkout.pending', 'error.summary_title', 'field.email', 'field.terms', 'model.buy_numbered',
    'edition_sold_out', 'password_required', 'wrong_password', 'billing_unavailable', 'derivatives_rebuilding',
    'model.edition_availability', 'model.sold_out', 'model.edition_left',
  ];
  const out: Record<string, string> = {};
  for (const key of keys) out[key] = t(l, key);
  return out;
}

/** The Survey Ring markup: SVG ring with ticks, index mark, tilt marker and caliper. */
function viewerMarkupOf(ctx: PageContext, model: ModelRow, accessToken: string | undefined): string {
  const l = ctx.locale;
  const ticks: string[] = [];
  for (let deg = 0; deg < 360; deg += 5) {
    const major = deg % 30 === 0;
    const r = major ? 118 : 124;
    const a = (deg * Math.PI) / 180;
    ticks.push(
      `            <line data-azimuth-tick="${deg}" x1="${(150 + r * Math.sin(a)).toFixed(1)}" y1="${(150 - r * Math.cos(a)).toFixed(1)}" x2="${(150 + 132 * Math.sin(a)).toFixed(1)}" y2="${(150 - 132 * Math.cos(a)).toFixed(1)}" class="${major ? 'tick major' : 'tick'}"></line>`,
    );
  }
  const labels: string[] = [];
  for (let deg = 0; deg < 360; deg += 30) {
    const a = (deg * Math.PI) / 180;
    labels.push(
      `            <text class="tick-label" x="${(150 + 103 * Math.sin(a)).toFixed(1)}" y="${(150 - 103 * Math.cos(a) + 4).toFixed(1)}" text-anchor="middle">${deg}</text>`,
    );
  }
  const camera = {
    azimuth: model.cam_azimuth,
    tilt: model.cam_tilt,
    distanceFactor: model.cam_distance_factor,
    fov: model.cam_fov,
  };
  const distance = camera.distanceFactor * Number(model.bounding_radius_mm);
  const accessQuery = accessToken === undefined ? '' : `?access=${encodeURIComponent(accessToken)}`;
  const hotspots = (model.hotspots ?? []).map((hotspot, index) => `              <circle data-part="hotspot-dot" data-index="${index + 1}" r="4" class="hotspot-dot"></circle>`).join('\n');
  const main = `      <div class="viewer-root" id="viewer-root" tabindex="0" role="group" aria-label="${t(l, 'viewer.group')}"
        data-render="pending" data-mode="orbit"
        data-azimuth="${camera.azimuth}" data-tilt="${camera.tilt}"
        data-camera-distance="${distance.toFixed(1)}" data-fov="${camera.fov}"
        data-animating="false" data-slug="${escapeHtml(model.slug)}"
        data-radius="${Number(model.bounding_radius_mm).toFixed(1)}"
        data-distance-factor="${camera.distanceFactor.toFixed(1)}"
        data-default-azimuth="${camera.azimuth}" data-default-tilt="${camera.tilt}"
        data-default-distance-factor="${camera.distanceFactor}" data-default-fov="${camera.fov}"
        data-hotspots="${escapeHtml(JSON.stringify(model.hotspots ?? []))}"
        data-model-url="/media/${escapeHtml(model.slug)}/view.glb${accessQuery}"
        data-preview-url="/media/${escapeHtml(model.slug)}/preview.png${accessQuery}"
        data-rebuilding="${model.rebuilding || model.outdated ? 'true' : 'false'}"
        data-scale-denominator="${model.scale_denominator}"
        data-canvas-width="600" data-canvas-height="450">
        <svg class="ring-svg" viewBox="0 0 300 300" role="img" aria-label="${t(l, 'viewer.ring')}">
          <g class="ring-ticks">
${ticks.join('\n')}
${labels.join('\n')}
          </g>
          <path data-part="tilt-arc" class="tilt-arc" d="M 278 150 A 128 128 0 0 1 262 200"></path>
          <g data-part="index-mark" data-angle="${camera.azimuth}" class="index-mark">
            <line x1="0" y1="-132" x2="0" y2="-118" class="index-line"></line>
          </g>
          <g data-part="tilt-marker" data-angle="${camera.tilt}" class="tilt-marker" transform="translate(278,150)">
            <line x1="-6" y1="0" x2="6" y2="0" class="tilt-line"></line>
          </g>
          <line data-part="caliper" class="caliper" x1="150" y1="150" x2="150" y2="150" hidden></line>
${hotspots}
        </svg>
        <div class="viewer-stage" id="viewer-stage">
          <img class="viewer-fallback" alt="${escapeHtml(t(l, 'viewer.preview_of', { title: model.title }))}" src="/media/${escapeHtml(model.slug)}/preview.png${accessQuery}" hidden>
        </div>
      </div>
      <div class="viewer-controls">
        <button type="button" class="viewer-button" id="prev-hotspot">${t(l, 'viewer.prev_hotspot')}</button>
        <button type="button" class="viewer-button" id="next-hotspot">${t(l, 'viewer.next_hotspot')}</button>
        <button type="button" class="viewer-button" id="first-person" aria-pressed="false">${t(l, 'viewer.first_person')}</button>
        <button type="button" class="viewer-button" id="reset-view">${t(l, 'viewer.reset')}</button>
      </div>
      <p class="visually-hidden" role="status" id="viewer-announcements" aria-live="polite"></p>
      <div class="camera-readout" role="group" aria-label="${t(l, 'viewer.readout')}">
        <p class="mono" data-readout="distance">${t(l, 'viewer.distance')} <span id="readout-distance">${distance.toFixed(1)}</span> mm</p>
        <p class="mono" data-readout="fov">${t(l, 'viewer.fov')} <span id="readout-fov">${camera.fov.toFixed(1)}</span>°</p>
        <p class="mono" data-readout="tilt">${t(l, 'viewer.tilt')} <span id="readout-tilt">${camera.tilt.toFixed(1)}</span>°</p>
        <p class="mono" data-readout="azimuth">${t(l, 'viewer.azimuth')} <span id="readout-azimuth">${camera.azimuth.toFixed(1)}</span>°</p>
      </div>`;
  return main;
}

