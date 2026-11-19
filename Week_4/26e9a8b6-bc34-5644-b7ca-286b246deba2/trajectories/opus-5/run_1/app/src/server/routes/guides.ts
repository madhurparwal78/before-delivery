import { config } from '../config.js';
import { execute, queryOne } from '../db/index.js';
import { ApiError, invalid, notFound, tooLong } from '../http/errors.js';
import { sendJson, sendNoContent } from '../http/respond.js';
import { guideAccess, requireConfirmed, requireSignedIn, viewerOf } from '../http/context.js';
import type { Exchange, Route } from '../http/router.js';
import { CURRENCIES, type Currency } from '../../shared/types.js';
import { codePointLength } from '../../shared/limits.js';
import {
  createGuide,
  forkCountOf,
  likeCountOf,
  loadSteps,
  readableSnapshot,
  readingJson,
  workingJson,
} from '../domain/guides.js';
import {
  addStep,
  commitField,
  deletePart,
  deleteStep,
  moveStep,
  restoreStep,
} from '../domain/working.js';
import { deleteGuide, forkGuide, publishGuide, withdrawGuide } from '../domain/publishing.js';
import { storeModel } from '../domain/models.js';
import { loadDashboard } from '../domain/engagement.js';
import { StorageUnreachable } from '../storage/s3.js';
import { guideTopic, live, userTopic } from '../live.js';
import { LIMIT_NAMES } from '../../shared/limits.js';

function readBody(exchange: Exchange): Record<string, unknown> {
  return exchange.json<Record<string, unknown>>();
}

function readString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string') throw invalid(field);
  return value;
}

async function broadcastModel(guideId: string, model: unknown): Promise<void> {
  live.publish({ kind: 'model', guide: guideId, model }, [guideTopic(guideId)]);
}

export const guideRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/limits',
    body: 'none',
    handle: (exchange) => {
      const out: Record<string, number> = {};
      for (const name of LIMIT_NAMES) out[name] = config.limits[name];
      sendJson(exchange.res, exchange.isEmbed, 200, out);
    },
  },
  {
    method: 'POST',
    path: '/api/guides',
    body: 'json',
    handle: async (exchange) => {
      const user = requireConfirmed(await viewerOf(exchange));
      const body = readBody(exchange);
      const title = readString(body, 'title');
      const currency = readString(body, 'currency');
      if (codePointLength(title) > config.limits.guide_title_max) {
        throw tooLong('title', config.limits.guide_title_max);
      }
      if (!CURRENCIES.includes(currency as Currency)) throw invalid('currency');
      const guide = await createGuide(user.id, title, currency as Currency);
      sendJson(exchange.res, exchange.isEmbed, 201, { id: guide.id, slug: guide.slug });
    },
  },
  {
    method: 'GET',
    path: '/api/guides/:id',
    body: 'none',
    handle: async (exchange) => {
      const viewer = await viewerOf(exchange);
      const id = exchange.params['id'] ?? '';
      const { guide } = await guideAccess(id, viewer, 'see');
      const readable = await readableSnapshot(guide, viewer);
      if (readable === null) throw notFound();
      sendJson(exchange.res, exchange.isEmbed, 200, await readingJson(guide, readable.snapshot));
    },
  },
  {
    method: 'DELETE',
    path: '/api/guides/:id',
    body: 'none',
    handle: async (exchange) => {
      const viewer = await viewerOf(exchange);
      const { guide } = await guideAccess(exchange.params['id'] ?? '', viewer, 'own', {
        allowWithdrawn: true,
      });
      requireConfirmed(viewer);
      await deleteGuide(guide.id);
      sendNoContent(exchange.res, exchange.isEmbed);
    },
  },
  {
    method: 'GET',
    path: '/api/guides/:id/working',
    body: 'none',
    handle: async (exchange) => {
      const viewer = await viewerOf(exchange);
      const { guide } = await guideAccess(exchange.params['id'] ?? '', viewer, 'edit', {
        allowWithdrawn: true,
      });
      sendJson(exchange.res, exchange.isEmbed, 200, await workingJson(guide));
    },
  },
  {
    method: 'PATCH',
    path: '/api/guides/:id/working',
    body: 'json',
    handle: async (exchange) => {
      const viewer = await viewerOf(exchange);
      const { guide, owner } = await guideAccess(exchange.params['id'] ?? '', viewer, 'edit', {
        allowWithdrawn: true,
      });
      const user = requireConfirmed(viewer);
      const body = readBody(exchange);
      const field = readString(body, 'field');
      const basedOn = body['based_on'];
      if (typeof basedOn !== 'number' || !Number.isInteger(basedOn) || basedOn < 0) {
        throw invalid('based_on');
      }
      const result = await commitField(guide, field, body['value'], basedOn, user, owner);
      const working = await workingJson({ ...guide, revision: result.revision });
      const reply = {
        revision: result.revision,
        field_revision: result.fieldRevision,
        guide_total: working.guide_total,
        guide_total_text: working.guide_total_text,
      };
      live.publish(
        {
          kind: 'field',
          guide: guide.id,
          field,
          value: result.value,
          revision: result.revision,
          field_revision: result.fieldRevision,
          guide_total: working.guide_total,
          guide_total_text: working.guide_total_text,
          by: user.name,
          by_id: user.id,
        },
        [guideTopic(guide.id)],
      );
      sendJson(exchange.res, exchange.isEmbed, 200, reply);
    },
  },
  {
    method: 'POST',
    path: '/api/guides/:id/steps',
    body: 'json',
    handle: async (exchange) => {
      const viewer = await viewerOf(exchange);
      const { guide } = await guideAccess(exchange.params['id'] ?? '', viewer, 'edit', {
        allowWithdrawn: true,
      });
      const user = requireConfirmed(viewer);
      const body = readBody(exchange);
      /* `restore` brings a deleted step back with its id, as undoing a delete must. */
      const added =
        body['restore'] === undefined
          ? await addStep(guide, readString(body, 'title'))
          : await restoreStep(guide, body['restore']);
      live.publish(
        { kind: 'step_added', guide: guide.id, step: { id: added.id, number: added.number }, by_id: user.id },
        [guideTopic(guide.id)],
      );
      sendJson(exchange.res, exchange.isEmbed, 201, added);
    },
  },
  {
    method: 'DELETE',
    path: '/api/guides/:id/steps/:stepId',
    body: 'none',
    handle: async (exchange) => {
      const viewer = await viewerOf(exchange);
      const { guide } = await guideAccess(exchange.params['id'] ?? '', viewer, 'edit', {
        allowWithdrawn: true,
      });
      const user = requireConfirmed(viewer);
      const stepId = exchange.params['stepId'] ?? '';
      const before = (await loadSteps(guide.id)).find((step) => step.id === stepId);
      if (!before) throw notFound();
      const revision = await deleteStep(guide, stepId);
      live.publish(
        { kind: 'step_deleted', guide: guide.id, step_id: stepId, number: before.position, by_id: user.id },
        [guideTopic(guide.id)],
      );
      sendJson(exchange.res, exchange.isEmbed, 200, { revision });
    },
  },
  {
    method: 'POST',
    path: '/api/guides/:id/steps/:stepId/move',
    body: 'json',
    handle: async (exchange) => {
      const viewer = await viewerOf(exchange);
      const { guide } = await guideAccess(exchange.params['id'] ?? '', viewer, 'edit', {
        allowWithdrawn: true,
      });
      const user = requireConfirmed(viewer);
      const stepId = exchange.params['stepId'] ?? '';
      const body = readBody(exchange);
      const position = body['position'];
      if (typeof position !== 'number') throw invalid('position');
      const before = (await loadSteps(guide.id)).find((step) => step.id === stepId);
      if (!before) throw notFound();
      const moved = await moveStep(guide, stepId, position);
      live.publish(
        {
          kind: 'step_moved',
          guide: guide.id,
          order: moved.order,
          from: before.position,
          to: position,
          by_id: user.id,
        },
        [guideTopic(guide.id)],
      );
      sendJson(exchange.res, exchange.isEmbed, 200, { revision: moved.revision, order: moved.order });
    },
  },
  {
    method: 'DELETE',
    path: '/api/guides/:id/parts/:partId',
    body: 'none',
    handle: async (exchange) => {
      const viewer = await viewerOf(exchange);
      const { guide } = await guideAccess(exchange.params['id'] ?? '', viewer, 'edit', {
        allowWithdrawn: true,
      });
      const user = requireConfirmed(viewer);
      const partId = exchange.params['partId'] ?? '';
      const revision = await deletePart(guide, partId);
      live.publish({ kind: 'part_deleted', guide: guide.id, part_id: partId, by_id: user.id }, [
        guideTopic(guide.id),
      ]);
      sendJson(exchange.res, exchange.isEmbed, 200, { revision });
    },
  },
  {
    method: 'POST',
    path: '/api/guides/:id/coauthors',
    body: 'json',
    handle: async (exchange) => {
      const viewer = await viewerOf(exchange);
      const { guide } = await guideAccess(exchange.params['id'] ?? '', viewer, 'own', {
        allowWithdrawn: true,
      });
      requireConfirmed(viewer);
      const body = readBody(exchange);
      const email = readString(body, 'email');
      const invited = await queryOne<{ id: string; name: string }>(
        'SELECT id, name FROM users WHERE lower(email) = lower($1)',
        [email],
      );
      if (invited === null) throw notFound();
      await execute(
        'INSERT INTO guide_coauthors (guide_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [guide.id, invited.id],
      );
      sendJson(exchange.res, exchange.isEmbed, 201, invited);
    },
  },
  {
    method: 'DELETE',
    path: '/api/guides/:id/coauthors/:userId',
    body: 'none',
    handle: async (exchange) => {
      const viewer = await viewerOf(exchange);
      const { guide } = await guideAccess(exchange.params['id'] ?? '', viewer, 'own', {
        allowWithdrawn: true,
      });
      requireConfirmed(viewer);
      await execute('DELETE FROM guide_coauthors WHERE guide_id = $1 AND user_id = $2', [
        guide.id,
        exchange.params['userId'] ?? '',
      ]);
      sendNoContent(exchange.res, exchange.isEmbed);
    },
  },
  {
    method: 'POST',
    path: '/api/guides/:id/publish',
    body: 'json',
    handle: async (exchange) => {
      const viewer = await viewerOf(exchange);
      const { guide } = await guideAccess(exchange.params['id'] ?? '', viewer, 'own', {
        allowWithdrawn: true,
      });
      requireConfirmed(viewer);
      const body = readBody(exchange);
      const requested = body['version'];
      if (requested !== undefined && typeof requested !== 'number') throw invalid('version');
      const outcome = await publishGuide(guide, typeof requested === 'number' ? requested : null);
      live.publish(
        {
          kind: 'guide_state',
          guide: guide.id,
          state: outcome.state,
          published_version: outcome.published_version,
        },
        [guideTopic(guide.id)],
      );
      sendJson(exchange.res, exchange.isEmbed, 200, outcome);
    },
  },
  {
    method: 'POST',
    path: '/api/guides/:id/withdraw',
    body: 'json',
    handle: async (exchange) => {
      const viewer = await viewerOf(exchange);
      const { guide } = await guideAccess(exchange.params['id'] ?? '', viewer, 'own', {
        allowWithdrawn: true,
      });
      requireConfirmed(viewer);
      const outcome = await withdrawGuide(guide);
      live.publish(
        { kind: 'guide_state', guide: guide.id, state: outcome.state, published_version: guide.published_version },
        [guideTopic(guide.id)],
      );
      sendJson(exchange.res, exchange.isEmbed, 200, outcome);
    },
  },
  {
    method: 'PUT',
    path: '/api/guides/:id/like',
    body: 'json',
    handle: async (exchange) => {
      const viewer = await viewerOf(exchange);
      const { guide } = await guideAccess(exchange.params['id'] ?? '', viewer, 'session');
      const user = requireConfirmed(viewer);
      await execute(
        'INSERT INTO likes (guide_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [guide.id, user.id],
      );
      const count = await likeCountOf(guide.id);
      live.publish({ kind: 'like', guide: guide.id, like_count: count }, [guideTopic(guide.id)]);
      sendJson(exchange.res, exchange.isEmbed, 200, { liked: true, like_count: count });
    },
  },
  {
    method: 'DELETE',
    path: '/api/guides/:id/like',
    body: 'none',
    handle: async (exchange) => {
      const viewer = await viewerOf(exchange);
      const { guide } = await guideAccess(exchange.params['id'] ?? '', viewer, 'session');
      const user = requireConfirmed(viewer);
      await execute('DELETE FROM likes WHERE guide_id = $1 AND user_id = $2', [guide.id, user.id]);
      const count = await likeCountOf(guide.id);
      live.publish({ kind: 'like', guide: guide.id, like_count: count }, [guideTopic(guide.id)]);
      sendJson(exchange.res, exchange.isEmbed, 200, { liked: false, like_count: count });
    },
  },
  {
    method: 'POST',
    path: '/api/guides/:id/forks',
    body: 'json',
    handle: async (exchange) => {
      const viewer = await viewerOf(exchange);
      const { guide } = await guideAccess(exchange.params['id'] ?? '', viewer, 'session');
      const user = requireConfirmed(viewer);
      const fork = await forkGuide(guide, user.id);
      const count = await forkCountOf(guide.id);
      live.publish({ kind: 'fork', guide: guide.id, fork_count: count }, [guideTopic(guide.id)]);
      live.publish({ kind: 'fork', guide: fork.id, fork_count: 0 }, [userTopic(user.id)]);
      sendJson(exchange.res, exchange.isEmbed, 201, fork);
    },
  },
  {
    method: 'POST',
    path: '/api/guides/:id/model',
    body: 'bytes',
    handle: async (exchange) => {
      const viewer = await viewerOf(exchange);
      const { guide } = await guideAccess(exchange.params['id'] ?? '', viewer, 'edit', {
        allowWithdrawn: true,
      });
      requireConfirmed(viewer);
      try {
        const stored = await storeModel(guide, exchange.raw);
        await broadcastModel(guide.id, stored.model);
        sendJson(exchange.res, exchange.isEmbed, 201, stored);
      } catch (error) {
        if (error instanceof StorageUnreachable) {
          throw new ApiError(503, { error: 'storage_unavailable' });
        }
        throw error;
      }
    },
  },
  {
    method: 'GET',
    path: '/api/dashboard',
    body: 'none',
    handle: async (exchange) => {
      const user = requireSignedIn(await viewerOf(exchange));
      sendJson(exchange.res, exchange.isEmbed, 200, await loadDashboard(user.id));
    },
  },
];
