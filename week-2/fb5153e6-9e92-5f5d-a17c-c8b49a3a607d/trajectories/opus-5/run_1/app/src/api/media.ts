import type { Reply, RequestContext } from '../http/router.js';
import { bytes } from '../http/router.js';
import { ApiError, notFound } from '../http/errors.js';
import type { ModelRecord } from '../db/models.js';
import {
  currentRevision,
  derivativeKey,
  findModelByEmbedToken,
  findModelBySlug,
  newestRevision,
} from '../db/models.js';
import { activePlan } from '../db/plan.js';
import { getObject } from '../services/s3.js';
import { embedIsLive, hasValidUnlock } from './access.js';
import { hasStudioSession } from './guards.js';

type MediaKind = 'glb' | 'preview';

const FILES: Readonly<Record<string, { kind: MediaKind; type: string }>> = {
  'view.glb': { kind: 'glb', type: 'model/gltf-binary' },
  'preview.png': { kind: 'preview', type: 'image/png' },
};

/** The stage whose confirmation a studio session waits on for each file. */
const PRODUCING_STAGE: Readonly<Record<MediaKind, 'glb' | 'preview'>> = {
  glb: 'glb',
  preview: 'preview',
};

async function visibleWithoutStudio(
  ctx: RequestContext,
  model: ModelRecord,
  access: string | null,
): Promise<boolean> {
  if (model.state !== 'published' || !model.withinPlan) return false;
  switch (model.visibility) {
    case 'public':
      return true;
    case 'unlisted':
      if (access !== null && access === model.shareToken) return true;
      return accessIsLiveEmbed(model, access);
    case 'password':
      return hasValidUnlock(ctx, model);
    case 'private':
      return false;
  }
}

async function accessIsLiveEmbed(model: ModelRecord, access: string | null): Promise<boolean> {
  if (access === null) return false;
  const embedded = await findModelByEmbedToken(access, await activePlan());
  if (embedded === null || embedded.id !== model.id) return false;
  return embedIsLive(model);
}

export async function mediaHandler(ctx: RequestContext): Promise<Reply> {
  const wanted = FILES[ctx.params.file ?? ''];
  if (wanted === undefined) throw notFound();
  const model = await findModelBySlug(ctx.params.slug ?? '', await activePlan());
  if (model === null) throw notFound();

  const access = ctx.query.get('access');
  const studio = hasStudioSession(ctx);
  if (studio) {
    const session = ctx.session;
    // A contributor is a studio session only for their own models.
    if (session?.role === 'contributor' && model.ownerUserId !== session.userId) throw notFound();
  } else if (!(await visibleWithoutStudio(ctx, model, access))) {
    throw notFound();
  }

  /*
   * A studio session gets the newest revision as soon as the file's own stage
   * confirms. Every other caller gets the current revision, and nothing at all
   * while a replaced source is still rebuilding.
   */
  const revision = studio ? await newestRevision(model.id) : await currentRevision(model.id);
  if (revision === null) throw new ApiError('derivatives_rebuilding');
  if (!studio) {
    const newest = await newestRevision(model.id);
    if (newest !== null && newest.publishedAt === null) {
      throw new ApiError('derivatives_rebuilding');
    }
  }

  const key = await derivativeKey(revision.id, PRODUCING_STAGE[wanted.kind]);
  if (key === null) throw new ApiError('derivatives_rebuilding');
  const body = await getObject(key);
  if (body === null) throw new ApiError('derivatives_rebuilding');
  return bytes(200, wanted.type, body, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
