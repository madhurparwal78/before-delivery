import type { RequestContext } from '../http/types.js';
import type { PageContext } from './render.js';
import { layout, escapeHtml } from './render.js';
import { t } from '../locales.js';
import { query } from '../db/db.js';
import type { ModelRow } from '../domain/models.js';
import { currentUser } from '../api/session.js';
import { ApiError } from '../errors.js';

export async function renderContribute(ctx: PageContext, request: RequestContext): Promise<string> {
  const l = ctx.locale;
  const user = await currentUser(request);
  if (user === null) throw new ApiError(401, 'unauthenticated');
  ctx.title = t(l, 'contrib.heading');
  ctx.script = '/assets/studio.js';
  ctx.clientCopy = {
    ...ctx.clientCopy,
    'studio.saving': t(l, 'studio.saving'),
    'studio.saved': t(l, 'studio.saved'),
    'studio.texture_set': t(l, 'studio.texture_set'),
    'studio.notices': t(l, 'studio.notices'),
    'error.summary_title': t(l, 'error.summary_title'),
    'upload.received': t(l, 'upload.received'),
    'upload.sending': t(l, 'upload.sending'),
  };
  const rows = await query<ModelRow>('SELECT * FROM models WHERE owner_id = $1 ORDER BY created_at DESC', [user.id]);
  const drafts = rows.rows.filter(model => model.state === 'draft');
  const models = rows.rows.map(
    model => `      <tr>
        <td><a href="/contribute/models/${escapeHtml(model.slug)}">${escapeHtml(model.title)}</a></td>
        <td>${t(l, `state.${model.state}`)}</td>
      </tr>`,
  );
  const main = `<div class="contribute">
  <h1>${t(l, 'contrib.heading')}</h1>
  <p class="visually-hidden" role="status" id="studio-notices" aria-live="polite"></p>
  <section aria-labelledby="contrib-upload-heading">
    <h2 id="contrib-upload-heading">${t(l, 'studio.upload')}</h2>
    <form id="upload-form">
      <label for="upload-file">${t(l, 'upload.model_file')}</label>
      <input type="file" id="upload-file" name="file" accept=".glb,.zip,.gltf">
      <label for="upload-title">${t(l, 'upload.title')}</label>
      <input type="text" id="upload-title" name="title" maxlength="120">
      <label for="upload-unit">${t(l, 'upload.source_unit')}</label>
      <select id="upload-unit" name="source_unit">
        <option value="mm">${t(l, 'unit.mm')}</option><option value="cm">${t(l, 'unit.cm')}</option>
        <option value="m">${t(l, 'unit.m')}</option><option value="in">${t(l, 'unit.in')}</option>
      </select>
      <label for="upload-category">${t(l, 'upload.category')}</label>
      <select id="upload-category" name="category">
        <option value="hard-surface">${t(l, 'facet.hard-surface')}</option>
        <option value="miniature">${t(l, 'facet.miniature')}</option>
        <option value="scan">${t(l, 'facet.scan')}</option>
      </select>
      <button type="submit">${t(l, 'upload.submit')}</button>
      <p class="visually-hidden" role="status" aria-live="polite" id="upload-progress-label"></p>
      <progress id="upload-progress" max="100" value="0" aria-label="${t(l, 'upload.progress')}"></progress>
      <p class="form-alert" role="alert" hidden></p>
    </form>
  </section>
  <section aria-labelledby="contrib-texture-heading">
    <h2 id="contrib-texture-heading">${t(l, 'contrib.texture_archive')}</h2>
    <form id="texture-form">
      <label for="texture-model">${t(l, 'contrib.draft')}</label>
      <select id="texture-model" name="model">
        ${drafts.map(draft => `<option value="${escapeHtml(draft.slug)}">${escapeHtml(draft.title)}</option>`).join('') || `<option value="">${t(l, 'common.none')}</option>`}
      </select>
      <label for="texture-name">${t(l, 'contrib.texture_name')}</label>
      <input type="text" id="texture-name" name="name" maxlength="60" required>
      <label for="texture-file">${t(l, 'contrib.texture_archive')}</label>
      <input type="file" id="texture-file" name="file" accept=".zip">
      <button type="submit">${t(l, 'contrib.submit_texture')}</button>
      <p class="form-alert" role="alert" hidden></p>
    </form>
  </section>
  <section aria-labelledby="contrib-models-heading">
    <h2 id="contrib-models-heading">${t(l, 'contrib.models')}</h2>
    <table class="data-table" aria-label="${t(l, 'contrib.models')}">
      <thead><tr><th scope="col">${t(l, 'dashboard.model.title')}</th><th scope="col">${t(l, 'dashboard.model.state')}</th></tr></thead>
      <tbody>
${models.join('\n') || `        <tr><td colspan="2">${t(l, 'common.none')}</td></tr>`}
      </tbody>
    </table>
  </section>
</div>`;
  return layout(ctx, main);
}
