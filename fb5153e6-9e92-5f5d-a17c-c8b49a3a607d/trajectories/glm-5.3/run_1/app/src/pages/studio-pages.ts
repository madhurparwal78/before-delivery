import type { RequestContext } from '../http/types.js';
import { ApiError } from '../errors.js';
import type { PageContext } from './render.js';
import { layout, escapeHtml, withLang, langParam } from './render.js';
import { t, formatAmount, formatDate, type Locale } from '../locales.js';
import { query, one } from '../db/db.js';
import { getModelBySlug, studioSummary, type ModelRow, MODEL_COLUMNS } from '../domain/models.js';
import { planState, quotaInfo } from '../domain/plan-service.js';
import { PLAN_ORDER, PLANS, planOf, type PlanId } from '../domain/plans.js';
import { uploadStatus } from '../queue/runner.js';
import { STAGE_NAMES } from '../queue/runner.js';
import { getUpload } from '../queue/runner.js';
import { serviceUp } from '../providers/availability.js';

function studioCopy(l: Locale): Record<string, string> {
  const keys = [
    'studio.dashboard', 'studio.upload', 'studio.review', 'studio.collections', 'studio.plan', 'studio.api_keys', 'studio.export',
    'studio.menu', 'studio.quota.limited', 'studio.quota.premium', 'studio.notices', 'studio.saved', 'studio.moved',
    'studio.share_link', 'studio.embed_created', 'studio.embed_removed', 'studio.added_to', 'studio.moved_to',
    'studio.removed_from', 'studio.collection_deleted', 'studio.key_created', 'studio.key_revoked', 'studio.saving',
    'studio.downgrade_accepted', 'studio.upgrade_done', 'studio.plan_pending', 'queue.requeued', 'queue.stage.confirmed',
    'queue.stage.retry', 'queue.stage.out_of_retries', 'queue.validation_failed', 'queue.all_confirmed', 'upload.received',
    'upload.sending', 'studio_model.read_only_copy', 'error.summary_title', 'field.name', 'field.title', 'field.file_missing',
    'common.save', 'plan.confirm', 'plan.dialog', 'common.close',
  ];
  const out: Record<string, string> = {};
  for (const key of keys) out[key] = t(l, key);
  return out;
}

function studioNav(l: Locale, active: string, lang: string): string {
  const items: [string, string, string][] = [
    ['studio.dashboard', '/studio', 'dashboard'],
    ['studio.upload', '/studio/upload', 'upload'],
    ['studio.review', '/studio/review', 'review'],
    ['studio.collections', '/studio/collections', 'collections'],
    ['studio.plan', '/studio/plan', 'plan'],
    ['studio.api_keys', '/studio/api-keys', 'api-keys'],
    ['studio.export', '/studio/export', 'export'],
  ];
  const links = items
    .map(([key, href, id]) => `<a href="${withLang(href, lang)}" class="studio-nav-link${id === active ? ' active' : ''}" data-nav="${id}">${t(l, key)}</a>`)
    .join('\n      ');
  return `<nav class="studio-nav" aria-label="${t(l, 'studio.nav')}">
      ${links}
    </nav>
    <button type="button" class="studio-menu-toggle" id="studio-menu-toggle" aria-expanded="false">${t(l, 'studio.menu')}</button>`;
}

export async function renderDashboard(ctx: PageContext): Promise<{ html: string; status: number }> {
  const l = ctx.locale;
  const lang = langParam(ctx);
  ctx.title = t(l, 'studio.dashboard');
  ctx.script = '/assets/studio.js';
  ctx.clientCopy = { ...ctx.clientCopy, ...studioCopy(l) };
  const summary = await (await import('../db/db.js')).withTransaction(async client => studioSummary(client));
  const models = await query<ModelRow>('SELECT * FROM models ORDER BY created_at DESC, id DESC');
  const uploads = await query<{ ref: string; slug: string; status: string; created_at: string }>(
    `SELECT u.ref, m.slug, u.status, u.created_at FROM uploads u JOIN model_revisions r ON r.id = u.revision_id
     JOIN models m ON m.id = u.model_id ORDER BY u.created_at DESC LIMIT 5`,
  );
  const quotaCopy =
    summary.quota.limit === null
      ? t(l, 'studio.quota.premium', { used: summary.quota.used })
      : t(l, 'studio.quota.limited', { used: summary.quota.used, limit: summary.quota.limit, date: summary.quota.resets_on });
  const queueCells: Record<string, string> = {};
  for (const model of models.rows) {
    queueCells[model.slug] = await queueCell(model);
  }
  const modelRows = models.rows.map(model => `        <tr>
          <td><a href="${withLang(`/studio/models/${model.slug}`, lang)}">${escapeHtml(model.title)}</a></td>
          <td>${t(l, `state.${model.state}`)}</td>
          <td>${t(l, `visibility.${model.visibility}`)}</td>
          <td class="mono">${formatAmount(Math.round(model.price_personal_cents * (100 - model.discount_percent) / 100), l)}</td>
          <td data-queue-cell="${model.slug}">${queueCells[model.slug] ?? ''}</td>
        </tr>`);
  const totalsLine = (key: string, value: number): string =>
    `<p class="mono">${t(l, key)} ${value}</p>`;
  const main = `<div class="studio" data-page="dashboard">
${studioNav(l, 'dashboard', lang)}
  <p class="visually-hidden" role="status" id="studio-notices" aria-live="polite"></p>
  <p class="visually-hidden" role="status" id="quota-badge" aria-live="polite">${quotaCopy}</p>
  <section class="quota-badge visible" aria-hidden="true"><p class="mono">${quotaCopy}</p></section>
  <section class="totals" aria-label="${t(l, 'studio.catalogue_totals')}">
    <h2>${t(l, 'studio.catalogue_totals')}</h2>
    ${totalsLine('dashboard.public', summary.totals.public)}
    ${totalsLine('dashboard.unlisted', summary.totals.unlisted)}
    ${totalsLine('dashboard.password', summary.totals.password)}
    ${totalsLine('dashboard.private', summary.totals.private)}
    ${totalsLine('dashboard.drafts', summary.totals.draft)}
    ${totalsLine('dashboard.in_review', summary.totals.in_review)}
    ${totalsLine('dashboard.withdrawn', summary.totals.withdrawn)}
  </section>
  <section class="models-table-section" aria-label="${t(l, 'studio.models')}">
    <h2>${t(l, 'studio.models')}</h2>
    <table class="data-table" id="models-table" aria-label="${t(l, 'studio.models')}">
      <thead><tr><th scope="col">${t(l, 'dashboard.model.title')}</th><th scope="col">${t(l, 'dashboard.model.state')}</th><th scope="col">${t(l, 'dashboard.model.visibility')}</th><th scope="col">${t(l, 'dashboard.model.price_from')}</th><th scope="col">${t(l, 'dashboard.model.queue')}</th></tr></thead>
      <tbody>
${modelRows.join('\n') || `        <tr><td colspan="5">${t(l, 'dashboard.empty')}</td></tr>`}
      </tbody>
    </table>
  </section>
  <section class="queue-panel" aria-label="${t(l, 'studio.queue')}">
    <h2>${t(l, 'studio.queue')}</h2>
    <ul class="upload-list">
${uploads.rows.map(upload => `        <li><a href="${withLang(`/studio/models/${upload.slug}/queue`, lang)}">${escapeHtml(upload.slug)}</a> <span class="mono">${upload.ref}</span></li>`).join('\n') || `        <li class="empty-state">${t(l, 'common.none')}</li>`}
    </ul>
  </section>
</div>`;
  return { html: layout(ctx, main), status: 200 };
}

async function queueCell(model: ModelRow): Promise<string> {
  const upload = await one<{ status: string }>(
    `SELECT u.status FROM uploads u JOIN model_revisions r ON r.id = u.revision_id
     WHERE r.model_id = $1 AND r.revision_no = $2`,
    [model.id, model.revision_count],
  );
  const key = upload?.status === 'in_progress' ? 'in_progress' : upload?.status === 'failed' ? 'failed' : upload?.status === 'completed' ? 'completed' : 'none';
  const l = 'en' as Locale;
  return t(l, `queue_status.${key}`);
}

export function renderUpload(ctx: PageContext): string {
  const l = ctx.locale;
  ctx.title = t(l, 'studio.upload');
  ctx.script = '/assets/studio.js';
  ctx.clientCopy = { ...ctx.clientCopy, ...studioCopy(l) };
  const main = `<div class="studio" data-page="upload">
${studioNav(l, 'upload', langParam(ctx))}
  <h1>${t(l, 'studio.upload')}</h1>
  <form id="upload-form">
    <label for="upload-file">${t(l, 'upload.model_file')}</label>
    <input type="file" id="upload-file" name="file" accept=".glb,.zip,.gltf">
    <label for="upload-title">${t(l, 'upload.title')}</label>
    <input type="text" id="upload-title" name="title" maxlength="120">
    <label for="upload-unit">${t(l, 'upload.source_unit')}</label>
    <select id="upload-unit" name="source_unit">
      <option value="mm">${t(l, 'unit.mm')}</option>
      <option value="cm">${t(l, 'unit.cm')}</option>
      <option value="m">${t(l, 'unit.m')}</option>
      <option value="in">${t(l, 'unit.in')}</option>
    </select>
    <label for="upload-category">${t(l, 'upload.category')}</label>
    <select id="upload-category" name="category">
      <option value="hard-surface">${t(l, 'facet.hard-surface')}</option>
      <option value="miniature">${t(l, 'facet.miniature')}</option>
      <option value="scan">${t(l, 'facet.scan')}</option>
    </select>
    <button type="submit" id="upload-submit">${t(l, 'upload.submit')}</button>
    <p class="visually-hidden" role="status" aria-live="polite" id="upload-progress-label"></p>
    <progress id="upload-progress" max="100" value="0" aria-label="${t(l, 'upload.progress')}"></progress>
    <p class="form-alert" role="alert" hidden></p>
  </form>
</div>`;
  return main;
}

export async function renderReview(ctx: PageContext): Promise<string> {
  const l = ctx.locale;
  const lang = langParam(ctx);
  ctx.title = t(l, 'studio.review');
  ctx.script = '/assets/studio.js';
  ctx.clientCopy = { ...ctx.clientCopy, ...studioCopy(l) };
  const rows = await query<ModelRow & { owner_email: string }>(
    `SELECT m.*, u.email AS owner_email FROM models m JOIN users u ON u.id = m.owner_id
     WHERE m.state = 'in_review' ORDER BY m.created_at DESC`,
  );
  const items = rows.rows.map(model => `      <tr data-slug="${escapeHtml(model.slug)}">
        <td><a href="${withLang(`/studio/models/${model.slug}`, lang)}">${escapeHtml(model.title)}</a></td>
        <td>${escapeHtml(model.owner_email)}</td>
        <td>${t(l, `state.${model.state}`)}</td>
        <td class="state-buttons">
          <button type="button" data-transition="draft"${canMove('in_review', 'draft') ? '' : ' disabled'}>${t(l, 'studio_model.return_to_draft')}</button>
          <button type="button" data-transition="published"${canMove('in_review', 'published') ? '' : ' disabled'}>${t(l, 'studio_model.publish')}</button>
        </td>
      </tr>`);
  const main = `<div class="studio" data-page="review">
${studioNav(l, 'review', lang)}
  <h1>${t(l, 'studio.review')}</h1>
  <table class="data-table" aria-label="${t(l, 'studio.review')}">
    <thead><tr><th scope="col">${t(l, 'dashboard.model.title')}</th><th scope="col">${t(l, 'review.submitter')}</th><th scope="col">${t(l, 'review.state')}</th><th scope="col">${t(l, 'studio_model.state')}</th></tr></thead>
    <tbody>
${items.join('\n') || `      <tr><td colspan="4">${t(l, 'review.empty')}</td></tr>`}
    </tbody>
  </table>
  <p class="visually-hidden" role="status" id="studio-notices" aria-live="polite"></p>
</div>`;
  return main;
}

function canMove(from: string, to: string): boolean {
  const moves: Record<string, string[]> = {
    draft: ['in_review'],
    in_review: ['draft', 'published'],
    published: ['withdrawn'],
    withdrawn: ['in_review'],
  };
  return (moves[from] ?? []).includes(to);
}

export async function renderCollections(ctx: PageContext): Promise<string> {
  const l = ctx.locale;
  const lang = langParam(ctx);
  ctx.title = t(l, 'studio.collections');
  ctx.script = '/assets/studio.js';
  ctx.clientCopy = { ...ctx.clientCopy, ...studioCopy(l) };
  const collections = await query<{ slug: string; name: string; item_count: string; models: { slug: string; title: string }[] | null }>(
    `SELECT c.slug, c.name,
       (SELECT count(*)::text FROM collection_items ci WHERE ci.collection_id = c.id) AS item_count,
       (SELECT json_agg(json_build_object('slug', m.slug, 'title', m.title) ORDER BY m.title) FROM collection_items ci JOIN models m ON m.id = ci.model_id WHERE ci.collection_id = c.id) AS models
     FROM collections c ORDER BY c.name`,
  );
  const allModels = await query<ModelRow>('SELECT slug, title FROM models ORDER BY title');
  const regions = collections.rows.map(collection => {
    const items = (collection.models ?? []).map(
      model => `        <li data-slug="${escapeHtml(model.slug)}">
          <span>${escapeHtml(model.title)}</span>
          <span class="item-actions">
            <select data-move-to aria-label="${escapeHtml(t(l, 'collections.name'))}">
${allModels.rows.map(m => `              <option value="${escapeHtml(m.slug)}">${escapeHtml(m.title)}</option>`).join('\n')}
              <option value="__new__">${t(l, 'collections.name')}</option>
            </select>
            <button type="button" class="move-button" data-move="${escapeHtml(model.title)}">${t(l, 'collections.name')}</button>
            <button type="button" class="remove-button" data-remove="${escapeHtml(model.title)}">${t(l, 'collections.name')}</button>
          </span>
        </li>`,
    );
    return `  <section class="collection-region" aria-labelledby="collection-${escapeHtml(collection.slug)}" data-slug="${escapeHtml(collection.slug)}">
    <h2 id="collection-${escapeHtml(collection.slug)}">${escapeHtml(collection.name)} (${Number(collection.item_count)})</h2>
    <ul class="collection-items">
${items.join('\n') || `        <li class="empty-state">${t(l, 'common.none')}</li>`}
    </ul>
    <form class="collection-add" data-slug="${escapeHtml(collection.slug)}">
      <label>
        <span class="visually-hidden">${t(l, 'collections.add_model')}</span>
        <select name="model">
${allModels.rows.map(m => `          <option value="${escapeHtml(m.slug)}">${escapeHtml(m.title)}</option>`).join('\n')}
        </select>
      </label>
      <button type="submit">${t(l, 'common.save')}</button>
    </form>
    <button type="button" class="delete-collection" data-slug="${escapeHtml(collection.slug)}">${t(l, 'collections.delete')}</button>
  </section>`;
  });
  const main = `<div class="studio" data-page="collections">
${studioNav(l, 'collections', lang)}
  <h1>${t(l, 'studio.collections')}</h1>
  <form id="collection-form">
    <label for="collection-name">${t(l, 'collections.name')}</label>
    <input type="text" id="collection-name" name="name" maxlength="60" required>
    <button type="submit">${t(l, 'collections.create')}</button>
    <p class="form-alert" role="alert" hidden></p>
  </form>
  <p class="visually-hidden" role="status" id="studio-notices" aria-live="polite"></p>
${regions.join('\n') || `  <p class="empty-state">${t(l, 'collections.empty')}</p>`}
</div>`;
  return main;
}

export async function renderPlan(ctx: PageContext): Promise<string> {
  const l = ctx.locale;
  const lang = langParam(ctx);
  ctx.title = t(l, 'studio.plan');
  ctx.script = '/assets/studio.js';
  ctx.clientCopy = { ...ctx.clientCopy, ...studioCopy(l) };
  const state = await planState();
  const quota = await quotaInfo();
  const pending =
    state.pending_plan === null || state.pending_effective_date === null
      ? ''
      : `<p>${t(l, 'plan.pending_change', { plan: t(l, `plan.${state.pending_plan}`), date: state.pending_effective_date })}</p>`;
  const quotaCopy =
    quota.limit === null
      ? t(l, 'studio.quota.premium', { used: quota.used })
      : t(l, 'studio.quota.limited', { used: quota.used, limit: quota.limit, date: quota.resets_on });
  const rows = PLAN_ORDER.map((planId: PlanId) => {
    const plan = PLANS[planId];
    const current = state.plan === planId;
    return `      <tr>
        <th scope="row">${t(l, `plan.${planId}`)}</th>
        <td class="mono">${formatAmount(plan.monthlyCents, l)}</td>
        <td class="mono">${plan.maxPackageBytes.toLocaleString('en-US')} bytes</td>
        <td>${plan.packages.map(kind => (kind === 'glb' ? 'glTF binary' : 'glTF package')).join(', ')}</td>
        <td class="mono">${plan.publishesPerCycle === null ? t(l, 'plan.no_limit') : plan.publishesPerCycle}</td>
        <td class="mono">${plan.publishedModelsLimit === null ? t(l, 'plan.no_limit') : plan.publishedModelsLimit}</td>
        <td>${plan.embeds ? t(l, 'common.yes') : t(l, 'common.no')}</td>
        <td>${plan.editions ? t(l, 'common.yes') : t(l, 'common.no')}</td>
        <td class="mono">${plan.apiKeys}</td>
        <td>${current ? t(l, 'plan.current') : `<button type="button" class="switch-plan" data-plan="${planId}">${t(l, 'plan.switch_to', { plan: t(l, `plan.${planId}`) })}</button>`}</td>
      </tr>`;
  });
  const main = `<div class="studio" data-page="plan">
${studioNav(l, 'plan', lang)}
  <h1>${t(l, 'plan.heading')}</h1>
  <p class="mono">${t(l, 'plan.current')}: ${t(l, `plan.${state.plan}`)}</p>
  ${pending}
  <p class="visually-hidden" role="status" id="quota-badge" aria-live="polite">${quotaCopy}</p>
  <section class="quota-badge visible" aria-hidden="true"><p class="mono">${quotaCopy}</p></section>
  <p class="visually-hidden" role="status" id="studio-notices" aria-live="polite"></p>
  <table class="data-table" id="plans-table" aria-label="${t(l, 'plan.table')}">
    <thead><tr>
      <th scope="col">${t(l, 'plan.table')}</th><th scope="col">${t(l, 'plan.monthly_price')}</th><th scope="col">${t(l, 'plan.max_package')}</th>
      <th scope="col">${t(l, 'plan.packages')}</th><th scope="col">${t(l, 'plan.publishes')}</th><th scope="col">${t(l, 'plan.published_models')}</th>
      <th scope="col">${t(l, 'plan.embeds')}</th><th scope="col">${t(l, 'plan.editions')}</th><th scope="col">${t(l, 'plan.keys')}</th><th scope="col"></th>
    </tr></thead>
    <tbody>
${rows.join('\n')}
    </tbody>
  </table>
</div>`;
  return main;
}

export async function renderApiKeys(ctx: PageContext): Promise<string> {
  const l = ctx.locale;
  const lang = langParam(ctx);
  ctx.title = t(l, 'studio.api_keys');
  ctx.script = '/assets/studio.js';
  ctx.clientCopy = { ...ctx.clientCopy, ...studioCopy(l) };
  const rows = await query<{ ref: string; name: string; created_at: string; active: boolean }>(
    'SELECT ref, name, created_at, active FROM api_keys ORDER BY created_at',
  );
  const items = rows.rows.map(
    key => `      <tr data-ref="${escapeHtml(key.ref)}">
        <td>${escapeHtml(key.name)}</td>
        <td class="mono">${escapeHtml(key.ref)}</td>
        <td class="mono">${formatDate(new Date(key.created_at), l)}</td>
        <td>${key.active ? `<button type="button" class="revoke-key" data-ref="${escapeHtml(key.ref)}" data-name="${escapeHtml(key.name)}">${t(l, 'api_keys.revoke', { name: key.name })}</button>` : t(l, 'studio.key_revoked')}</td>
      </tr>`,
  );
  const main = `<div class="studio" data-page="api-keys">
${studioNav(l, 'api-keys', lang)}
  <h1>${t(l, 'studio.api_keys')}</h1>
  <form id="api-key-form">
    <label for="key-name">${t(l, 'api_keys.name')}</label>
    <input type="text" id="key-name" name="name" maxlength="60" required>
    <button type="submit">${t(l, 'api_keys.create')}</button>
    <p class="form-alert" role="alert" hidden></p>
  </form>
  <p class="visually-hidden" role="status" id="studio-notices" aria-live="polite"></p>
  <table class="data-table" aria-label="${t(l, 'studio.api_keys')}">
    <thead><tr><th scope="col">${t(l, 'api_keys.name')}</th><th scope="col">${t(l, 'api_keys.ref')}</th><th scope="col">${t(l, 'api_keys.created')}</th><th scope="col"></th></tr></thead>
    <tbody>
${items.join('\n') || `      <tr><td colspan="4">${t(l, 'common.none')}</td></tr>`}
    </tbody>
  </table>
</div>`;
  return main;
}

export function renderExport(ctx: PageContext): string {
  const l = ctx.locale;
  const lang = langParam(ctx);
  ctx.title = t(l, 'studio.export');
  ctx.script = '/assets/studio.js';
  ctx.clientCopy = { ...ctx.clientCopy, ...studioCopy(l) };
  const main = `<div class="studio" data-page="export">
${studioNav(l, 'export', lang)}
  <h1>${t(l, 'studio.export')}</h1>
  <p>${t(l, 'export.explain')}</p>
  <a class="download-csv" href="/api/studio/exports/catalogue.csv" download>${t(l, 'export.download')}</a>
</div>`;
  return main;
}

export async function renderStudioModel(ctx: PageContext, request: RequestContext): Promise<{ html: string; status: number }> {
  const slug = request.params['slug'] ?? '';
  const model = await getModelBySlug(slug);
  if (model === null) throw new ApiError(404, 'not_found');
  const l = ctx.locale;
  const lang = langParam(ctx);
  ctx.title = model.title;
  ctx.script = '/assets/model.js';
  ctx.clientCopy = { ...ctx.clientCopy, ...studioCopy(l) };
  const detail = await (await import('../api/studio.js')).studioDetail(slug);
  const readOnly = model.read_only;
  const embeds = (detail['embeds'] as { token: string; url: string }[]) ?? [];
  const share = detail['share_url'] as string | null;
  const transitions: { to: string; label: string; enabled: boolean }[] = [
    { to: 'in_review', label: t(l, 'studio_model.send_to_review'), enabled: canMove(model.state, 'in_review') && !readOnly },
    { to: 'draft', label: t(l, 'studio_model.return_to_draft'), enabled: canMove(model.state, 'draft') && !readOnly },
    { to: 'published', label: t(l, 'studio_model.publish'), enabled: canMove(model.state, 'published') && !readOnly },
    { to: 'withdrawn', label: t(l, 'studio_model.withdraw'), enabled: canMove(model.state, 'withdrawn') },
  ];
  const main = `<div class="studio model-page" data-page="model">
${studioNav(l, 'model', lang)}
  <h1>${escapeHtml(model.title)}</h1>
  <p class="state-line mono">${t(l, `state.${model.state}`)} · ${t(l, `visibility.${model.visibility}`)} · ${t(l, 'studio_model.revision')} ${model.revision}${readOnly ? ` · ${t(l, 'studio_model.read_only_copy')}` : ''}</p>
  ${readOnly ? `<p class="visually-hidden" role="status">${t(l, 'studio_model.read_only_copy')}</p>` : ''}
  <p class="visually-hidden" role="status" id="studio-notices" aria-live="polite"></p>
  <section class="state-buttons">
    <h2 class="visually-hidden">${t(l, 'studio_model.state')}</h2>
    ${transitions.map(item => `    <button type="button" data-transition="${item.to}"${item.enabled ? '' : ' disabled'}>${item.label}</button>`).join('\n')}
  </section>
  <div class="model-layout">
    <div class="viewer-column">
      <div class="viewer-root studio-viewer" id="viewer-root" tabindex="0" role="group" aria-label="${t(l, 'viewer.group')}"
        data-render="pending" data-mode="orbit"
        data-azimuth="${model.cam_azimuth}" data-tilt="${model.cam_tilt}"
        data-camera-distance="${(model.cam_distance_factor * Number(model.bounding_radius_mm)).toFixed(1)}" data-fov="${model.cam_fov}"
        data-animating="false" data-slug="${escapeHtml(model.slug)}"
        data-radius="${Number(model.bounding_radius_mm).toFixed(1)}"
        data-distance-factor="${model.cam_distance_factor.toFixed(1)}"
        data-default-azimuth="${model.cam_azimuth}" data-default-tilt="${model.cam_tilt}"
        data-default-distance-factor="${model.cam_distance_factor}" data-default-fov="${model.cam_fov}"
        data-hotspots="${escapeHtml(JSON.stringify(model.hotspots ?? []))}"
        data-box="${Number(model.width_mm).toFixed(1)} ${Number(model.height_mm).toFixed(1)} ${Number(model.depth_mm).toFixed(1)}"
        data-model-url="/media/${escapeHtml(model.slug)}/view.glb"
        data-preview-url="/media/${escapeHtml(model.slug)}/preview.png"
        data-rebuilding="${model.rebuilding || model.outdated ? 'true' : 'false'}"
        data-scale-denominator="${model.scale_denominator}"
        data-canvas-width="600" data-canvas-height="450">
      </div>
      <div class="viewer-controls">
        <button type="button" id="prev-hotspot">${t(l, 'viewer.prev_hotspot')}</button>
        <button type="button" id="next-hotspot">${t(l, 'viewer.next_hotspot')}</button>
        <button type="button" id="first-person" aria-pressed="false">${t(l, 'viewer.first_person')}</button>
        <button type="button" id="reset-view">${t(l, 'viewer.reset')}</button>
        <button type="button" id="save-default-view">${t(l, 'studio_model.save_default_view')}</button>
        <button type="button" id="add-hotspot">${t(l, 'studio_model.add_hotspot')}</button>
        <button type="button" id="save-hotspots">${t(l, 'studio_model.save_hotspots')}</button>
        <input type="text" id="hotspot-label" placeholder="${t(l, 'studio_model.hotspot_label')}" aria-label="${t(l, 'studio_model.hotspot_label')}">
      </div>
      <p class="visually-hidden" role="status" id="viewer-announcements" aria-live="polite"></p>
      <div class="camera-readout" role="group" aria-label="${t(l, 'viewer.readout')}">
        <p class="mono" data-readout="distance">${t(l, 'viewer.distance')} <span id="readout-distance">${(model.cam_distance_factor * Number(model.bounding_radius_mm)).toFixed(1)}</span> mm</p>
        <p class="mono" data-readout="fov">${t(l, 'viewer.fov')} <span id="readout-fov">${model.cam_fov.toFixed(1)}</span>°</p>
        <p class="mono" data-readout="tilt">${t(l, 'viewer.tilt')} <span id="readout-tilt">${model.cam_tilt.toFixed(1)}</span>°</p>
        <p class="mono" data-readout="azimuth">${t(l, 'viewer.azimuth')} <span id="readout-azimuth">${model.cam_azimuth.toFixed(1)}</span>°</p>
      </div>
    </div>
    <div class="tables-column">
      <section aria-label="${t(l, 'studio_model.settings')}">
        <h2>${t(l, 'studio_model.settings')}</h2>
        <form id="model-settings" data-slug="${escapeHtml(model.slug)}" data-read-only="${readOnly ? 'true' : 'false'}">
          <label for="set-title">${t(l, 'upload.title')}</label>
          <input type="text" id="set-title" name="title" value="${escapeHtml(model.title)}" maxlength="120">
          <label for="set-description">${t(l, 'studio_model.description')}</label>
          <textarea id="set-description" name="description" maxlength="2000">${escapeHtml(model.description)}</textarea>
          <label for="set-category">${t(l, 'upload.category')}</label>
          <select id="set-category" name="category">
            ${['hard-surface', 'miniature', 'scan'].map(category => `<option value="${category}"${model.category === category ? ' selected' : ''}>${t(l, `facet.${category}`)}</option>`).join('')}
          </select>
          <label for="set-visibility">${t(l, 'studio_model.visibility')}</label>
          <select id="set-visibility" name="visibility">
            ${['public', 'unlisted', 'private', 'password'].map(visibility => `<option value="${visibility}"${model.visibility === visibility ? ' selected' : ''}>${t(l, `visibility.${visibility}`)}</option>`).join('')}
          </select>
          <label for="set-password">${t(l, 'studio_model.password')}</label>
          <input type="password" id="set-password" name="password" autocomplete="new-password">
          <fieldset>
            <legend>${t(l, 'studio_model.prices')}</legend>
            <label for="set-personal">${t(l, 'studio_model.personal_price')}</label>
            <input type="number" id="set-personal" name="personal_cents" min="1" max="1000" step="0.01" value="${(model.price_personal_cents / 100).toFixed(2)}">
            <label for="set-commercial">${t(l, 'studio_model.commercial_price')}</label>
            <input type="number" id="set-commercial" name="commercial_cents" min="1" max="1000" step="0.01" value="${model.price_commercial_cents === null ? '' : (model.price_commercial_cents / 100).toFixed(2)}">
            <label for="set-studio">${t(l, 'studio_model.studio_price')}</label>
            <input type="number" id="set-studio" name="studio_cents" min="1" max="1000" step="0.01" value="${model.price_studio_cents === null ? '' : (model.price_studio_cents / 100).toFixed(2)}">
            <label for="set-discount">${t(l, 'studio_model.discount')}</label>
            <input type="number" id="set-discount" name="discount_percent" min="0" max="90" step="1" value="${model.discount_percent}">
          </fieldset>
          <fieldset>
            <legend>${t(l, 'spec.edition')}</legend>
            <label for="set-edition-total">${t(l, 'studio_model.edition_total')}</label>
            <input type="number" id="set-edition-total" name="edition_total" min="1" max="500" value="${model.edition_total ?? ''}">
            <label for="set-edition-price">${t(l, 'studio_model.edition_price')}</label>
            <input type="number" id="set-edition-price" name="edition_price_cents" min="1" max="1000" step="0.01" value="${model.edition_price_cents === null ? '' : (model.edition_price_cents / 100).toFixed(2)}">
          </fieldset>
          <button type="submit"${readOnly ? ' disabled' : ''}>${t(l, 'studio_model.save_changes')}</button>
          <p class="form-alert" role="alert" hidden></p>
        </form>
      </section>
      <section aria-label="${t(l, 'studio_model.share_link')}">
        <h2>${t(l, 'studio_model.share_link')}</h2>
        <p>${share === null ? t(l, 'studio_model.share_hint') : `<span class="mono">${escapeHtml(share)}</span>`}</p>
        <button type="button" id="new-share-link"${model.visibility !== 'unlisted' || readOnly ? ' disabled' : ''}>${t(l, 'studio_model.new_share_link')}</button>
        <h3>${t(l, 'studio_model.embeds')}</h3>
        <ul class="embed-list">
${embeds.map(embed => `          <li><span class="mono">${escapeHtml(embed.url)}</span> <button type="button" class="remove-embed" data-token="${escapeHtml(embed.token)}">${t(l, 'studio_model.remove_embed')}</button></li>`).join('\n') || `          <li class="empty-state">${t(l, 'common.none')}</li>`}
        </ul>
        <button type="button" id="create-embed"${readOnly ? ' disabled' : ''}>${t(l, 'studio_model.create_embed')}</button>
      </section>
      <section aria-label="${t(l, 'studio_model.original')}">
        <h2>${t(l, 'studio_model.original')}</h2>
        <form id="replace-form" data-slug="${escapeHtml(model.slug)}">
          <label for="replace-file">${t(l, 'upload.model_file')}</label>
          <input type="file" id="replace-file" name="file" accept=".glb,.zip,.gltf">
          <label for="replace-unit">${t(l, 'upload.source_unit')}</label>
          <select id="replace-unit" name="source_unit">
            <option value="mm">${t(l, 'unit.mm')}</option><option value="cm">${t(l, 'unit.cm')}</option>
            <option value="m">${t(l, 'unit.m')}</option><option value="in">${t(l, 'unit.in')}</option>
          </select>
          <button type="submit"${readOnly ? ' disabled' : ''}>${t(l, 'studio_model.replace_source')}</button>
          <progress id="replace-progress" max="100" value="0" aria-label="${t(l, 'upload.progress')}"></progress>
        </form>
        <a href="/api/studio/models/${escapeHtml(model.slug)}/original">${t(l, 'studio_model.download_original')}</a>
      </section>
    </div>
  </div>
</div>`;
  return { html: layout(ctx, main), status: 200 };
}

export async function renderQueuePage(
  ctx: PageContext,
  request: RequestContext,
  area: 'studio' | 'contrib',
): Promise<{ html: string; status: number }> {
  const slug = request.params['slug'] ?? '';
  const model = await getModelBySlug(slug);
  if (model === null) throw new ApiError(404, 'not_found');
  if (area === 'contrib') {
    const { currentUser } = await import('../api/session.js');
    const user = await currentUser(request);
    if (user === null || model.owner_id !== user.id) throw new ApiError(404, 'not_found');
  }
  const l = ctx.locale;
  const lang = langParam(ctx);
  ctx.title = `${t(l, 'studio.queue')} · ${model.title}`;
  ctx.script = '/assets/queue.js';
  ctx.clientCopy = { ...ctx.clientCopy, ...studioCopy(l) };
  const latest = await one<{ ref: string }>(
    `SELECT u.ref FROM uploads u JOIN model_revisions r ON r.id = u.revision_id
     WHERE r.model_id = $1 AND r.revision_no = $2 ORDER BY u.created_at DESC LIMIT 1`,
    [model.id, model.revision_count],
  );
  const uploadRef = latest?.ref ?? '';
  const stages = STAGE_NAMES.map(
    name => `      <li data-stage="${name}">
        <span class="stage-name">${t(l, `stage.${name}`)}</span>
        <span class="stage-status mono" data-role="status">${t(l, 'stage_status.pending')}</span>
        <span class="stage-attempts mono" data-role="attempts"></span>
        <span class="stage-retry mono" data-role="retry"></span>
      </li>`,
  );
  const requeueButton = `<button type="button" id="requeue-button" data-upload="${escapeHtml(uploadRef)}"${model.state === 'draft' || true ? '' : ' disabled'}>${t(l, 'queue.requeue')}</button>`;
  const submitButton =
    area === 'contrib'
      ? `<button type="button" id="submit-review" data-slug="${escapeHtml(slug)}"${model.state === 'draft' ? '' : ' disabled'}>${t(l, 'studio_model.send_to_review')}</button>`
      : '';
  const main = `<div class="studio queue-page" data-page="queue" data-upload="${escapeHtml(uploadRef)}">
${area === 'studio' ? studioNav(l, 'queue', lang) : ''}
  <h1>${t(l, 'studio.queue')} · ${escapeHtml(model.title)}</h1>
  <p class="visually-hidden" role="status" id="queue-progress" aria-live="polite"></p>
  <ul class="queue-stages" aria-label="${t(l, 'queue.stages')}">
${stages.join('\n')}
  </ul>
  <div class="queue-actions">
    ${requeueButton}
    ${submitButton}
  </div>
</div>`;
  return { html: layout(ctx, main), status: 200 };
}
