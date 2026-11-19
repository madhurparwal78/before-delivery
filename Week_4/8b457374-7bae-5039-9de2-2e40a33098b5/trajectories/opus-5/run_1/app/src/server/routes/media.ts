import { pool } from '../data/db.js';
import {
  countSpreads,
  deleteMedia,
  findCover,
  findMedia,
  insertMedia,
  setMediaStatus,
} from '../data/media.js';
import { newId } from '../domain/ids.js';
import { rejectUnlessDraft } from '../domain/transitions.js';
import { conflict, invalid, notFound, storageUnavailable } from '../http/errors.js';
import {
  binary,
  empty,
  IMAGE_TYPES,
  json,
  requirePerson,
  type Router,
} from '../http/router.js';
import { deleteObject, getObject, putObjectConfirmed } from '../services/storage.js';
import { ServiceDownError } from '../services/health.js';
import { loadVisibleCampaign } from '../operations/pledgeOps.js';
import { loadOwnCampaign } from './helpers.js';

const MAX_SPREADS = 6;

function mediaKey(campaignId: string, mediaId: string, contentType: string): string {
  return `campaigns/${campaignId}/media/${mediaId}.${IMAGE_TYPES[contentType] as string}`;
}

export function registerMediaRoutes(router: Router): void {
  router.add({
    method: 'POST',
    pattern: '/api/campaigns/{id}/media',
    auth: 'required',
    body: 'image',
    handle: async (ctx) => {
      const person = requirePerson(ctx);
      const campaign = await loadOwnCampaign(ctx.params['id'] as string, person);
      const rejection = rejectUnlessDraft(campaign.status);
      if (rejection !== null) throw conflict(rejection);

      const kind = ctx.url.searchParams.get('kind');
      if (kind !== 'cover' && kind !== 'spread') {
        throw invalid({ media: 'Give kind=cover or kind=spread.' });
      }
      if (ctx.raw.length === 0) throw invalid({ media: 'Send the image bytes as the body.' });
      if (kind === 'spread' && (await countSpreads(pool, campaign.id)) >= MAX_SPREADS) {
        throw invalid({ media: 'A campaign holds up to 6 spread previews.' });
      }

      const previousCover = kind === 'cover' ? await findCover(pool, campaign.id) : null;
      const contentType = ctx.headers['content-type'] as string;
      const baseType = (contentType.split(';')[0] as string).trim().toLowerCase();
      const filenameHeader = ctx.headers['x-filename'];
      const mediaId = newId('med');
      const row = await insertMedia(pool, {
        id: mediaId,
        campaign_id: campaign.id,
        kind,
        content_type: baseType,
        bytes: ctx.raw.length,
        object_key: mediaKey(campaign.id, mediaId, baseType),
        filename: typeof filenameHeader === 'string' ? filenameHeader : null,
      });

      let confirmed = false;
      try {
        confirmed = await putObjectConfirmed(row.object_key, ctx.raw, baseType);
      } catch (error) {
        if (!(error instanceof ServiceDownError)) throw error;
        await setMediaStatus(pool, row.id, 'failed');
        throw storageUnavailable();
      }
      if (!confirmed) {
        await setMediaStatus(pool, row.id, 'failed');
        throw storageUnavailable();
      }

      const stored = await setMediaStatus(pool, row.id, 'stored');
      if (previousCover !== null) {
        await deleteMedia(pool, previousCover.id);
        try {
          await deleteObject(previousCover.object_key);
        } catch (error) {
          if (!(error instanceof ServiceDownError)) throw error;
        }
      }
      return json(201, {
        id: row.id,
        kind,
        status: 'stored',
        content_type: baseType,
        bytes: stored?.bytes ?? row.bytes,
      });
    },
  });

  router.add({
    method: 'DELETE',
    pattern: '/api/media/{id}',
    auth: 'required',
    body: 'none',
    handle: async (ctx) => {
      const person = requirePerson(ctx);
      const row = await findMedia(pool, ctx.params['id'] as string);
      if (row === null) throw notFound();
      const campaign = await loadOwnCampaign(row.campaign_id, person);
      const rejection = rejectUnlessDraft(campaign.status);
      if (rejection !== null) throw conflict(rejection);
      await deleteMedia(pool, row.id);
      if (row.status === 'stored') {
        try {
          await deleteObject(row.object_key);
        } catch (error) {
          if (!(error instanceof ServiceDownError)) throw error;
        }
      }
      return empty(204);
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/media/{id}',
    auth: 'optional',
    body: 'none',
    handle: async (ctx) => {
      const row = await findMedia(pool, ctx.params['id'] as string);
      if (row === null || row.status !== 'stored') throw notFound();
      await loadVisibleCampaign(row.campaign_id, ctx.person);
      const bytes = await getObject(row.object_key);
      if (bytes === null) throw notFound();
      return binary(row.content_type, bytes);
    },
  });
}
