import type { RequestContext } from '../http/types.js';
import { ApiError } from '../errors.js';
import { getModelBySlug, newestRevision, type ModelRow } from '../domain/models.js';
import {
  mediaAccess,
  assertMediaAllowed,
  embedAllowed,
  embedModelOf,
  isStudioSessionFor,
  type Viewer,
} from '../domain/access.js';
import { getObject, derivativeKey } from '../providers/storage.js';
import { sendRaw } from '../http/respond.js';
import { viewerContextOf, viewerForUser } from './public.js';
import { sessionSecret } from '../server-context.js';
import { currentUser } from './session.js';
import { one } from '../db/db.js';

/** Media serving: studio sessions get the newest revision early; others get the current revision. */
export async function serveModelFile(ctx: RequestContext, slug: string, file: 'preview.png' | 'view.glb'): Promise<void> {
  const model = await getModelBySlug(slug);
  if (model === null) throw new ApiError(404, 'not_found');
  const user = await currentUser(ctx);
  const viewer: Viewer = viewerForUser(user);
  const studio = isStudioSessionFor(model, viewer);
  const decision = await mediaAccess(model, viewerContextOf(ctx, viewer, slug), await sessionSecret());
  assertMediaAllowed(decision);

  const revisionNo = studio ? model.revision_count : model.revision;
  if (revisionNo === 0) throw new ApiError(404, 'not_found');
  if (studio) {
    const ready = await newestRevisionStageConfirmed(model.id, file === 'view.glb' ? 'transcode' : 'preview');
    if (!ready) throw new ApiError(409, 'derivatives_rebuilding');
  }
  const buffer = await getObject(derivativeKey(slug, revisionNo, file === 'preview.png' ? 'preview.png' : 'model.glb'));
  sendRaw(ctx, 200, buffer, file === 'preview.png' ? 'image/png' : 'model/gltf-binary');
}

async function newestRevisionStageConfirmed(
  modelId: number,
  stage: 'transcode' | 'preview',
): Promise<boolean> {
  const revision = await newestRevision(modelId);
  if (revision === null) return false;
  const row = await one<{ status: string }>(
    `SELECT us.status FROM upload_stages us JOIN uploads u ON u.ref = us.upload_ref
     WHERE u.revision_id = $1 AND us.name = $2`,
    [revision.id, stage],
  );
  return row?.status === 'confirmed';
}

/** Embed media: served only while the embed is entitled, using the embed token. */
export async function serveEmbedFile(ctx: RequestContext, token: string, file: 'preview.png' | 'view.glb'): Promise<void> {
  const model = await embedModelOf(token);
  if (model === null || !(await embedAllowed(model))) throw new ApiError(404, 'not_found');
  const user = await currentUser(ctx);
  const viewer = viewerForUser(user);
  const studio = isStudioSessionFor(model, viewer);
  const decision = await mediaAccess(model, { ...viewerContextOf(ctx, viewer, model.slug), accessToken: token }, await sessionSecret());
  assertMediaAllowed(decision);
  const revisionNo = studio ? model.revision_count : model.revision;
  if (revisionNo === 0) throw new ApiError(404, 'not_found');
  const buffer = await getObject(derivativeKey(model.slug, revisionNo, file === 'preview.png' ? 'preview.png' : 'model.glb'));
  sendRaw(ctx, 200, buffer, file === 'preview.png' ? 'image/png' : 'model/gltf-binary');
}
