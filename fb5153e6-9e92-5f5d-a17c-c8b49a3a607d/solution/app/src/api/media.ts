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
import { halvePng } from '../media/png.js';
import { embedIsLive, hasValidUnlock } from './access.js';
import { hasStudioSession } from './guards.js';

type MediaKind = 'glb' | 'preview';

const FILES: Readonly<Record<string, { kind: MediaKind; type: string; half?: true }>> = {
  'view.glb': { kind: 'glb', type: 'model/gltf-binary' },
  'preview.png': { kind: 'preview', type: 'image/png' },
  // The 512 px preview for cards, halved from the stored render on first request.
  'preview-512.png': { kind: 'preview', type: 'image/png', half: true },
};

/** Halved previews by object key and size, so a re-rendered preview under the same key is halved again. */
const HALVED = new Map<string, Buffer>();
const HALVED_MAX = 200;

function halved(objectKey: string, body: Buffer): Buffer {
  const key = `${objectKey}:${body.length}`;
  const hit = HALVED.get(key);
  if (hit !== undefined) return hit;
  const small = halvePng(body) ?? body;
  if (HALVED.size >= HALVED_MAX) {
    const oldest = HALVED.keys().next().value;
    if (oldest !== undefined) HALVED.delete(oldest);
  }
  HALVED.set(key, small);
  return small;
}

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
  // A contributor is a studio session only for their own models; for anyone
  // else's they are an ordinary caller and see what the public sees.
  const session = ctx.session;
  const studio =
    hasStudioSession(ctx) && !(session?.role === 'contributor' && model.ownerUserId !== session.userId);
  if (!studio && !(await visibleWithoutStudio(ctx, model, access))) throw notFound();

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
  return bytes(200, wanted.type, wanted.half === true ? halved(key, body) : body, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
