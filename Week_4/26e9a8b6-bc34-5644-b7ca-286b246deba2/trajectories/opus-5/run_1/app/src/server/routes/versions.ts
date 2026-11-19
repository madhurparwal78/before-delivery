import { invalid, notFound } from '../http/errors.js';
import { sendJson } from '../http/respond.js';
import { cursorOf, guideAccess, pageLimit, requireConfirmed, viewerOf } from '../http/context.js';
import type { Route } from '../http/router.js';
import {
  compareVersions,
  listVersions,
  restoreVersion,
  saveVersion,
  versionDetail,
} from '../domain/versions.js';
import { latestVersionNumber } from '../domain/guides.js';
import { guideTopic, live } from '../live.js';

function wholeNumber(raw: string | null, field: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) throw invalid(field);
  return parsed;
}

export const versionRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/guides/:id/versions',
    body: 'json',
    handle: async (exchange) => {
      const viewer = await viewerOf(exchange);
      const { guide } = await guideAccess(exchange.params['id'] ?? '', viewer, 'edit', {
        allowWithdrawn: true,
      });
      const user = requireConfirmed(viewer);
      const body = exchange.json<Record<string, unknown>>();
      const base = body['base_version'];
      if (base !== null && typeof base !== 'number') throw invalid('base_version');
      const saved = await saveVersion(guide, base, user.id);
      live.publish(
        {
          kind: 'version',
          guide: guide.id,
          number: saved.number,
          saved_by: user.name,
          restored_from: null,
        },
        [guideTopic(guide.id)],
      );
      sendJson(exchange.res, exchange.isEmbed, 201, { number: saved.number });
    },
  },
  {
    method: 'GET',
    path: '/api/guides/:id/versions',
    body: 'none',
    handle: async (exchange) => {
      const viewer = await viewerOf(exchange);
      const { guide } = await guideAccess(exchange.params['id'] ?? '', viewer, 'see', {
        allowWithdrawn: true,
      });
      sendJson(
        exchange.res,
        exchange.isEmbed,
        200,
        await listVersions(guide, cursorOf(exchange.url), pageLimit(exchange.url)),
      );
    },
  },
  {
    method: 'GET',
    path: '/api/guides/:id/versions/compare',
    body: 'none',
    handle: async (exchange) => {
      const viewer = await viewerOf(exchange);
      const { guide } = await guideAccess(exchange.params['id'] ?? '', viewer, 'see', {
        allowWithdrawn: true,
      });
      const older = wholeNumber(exchange.url.searchParams.get('older'), 'older');
      const newer = wholeNumber(exchange.url.searchParams.get('newer'), 'newer');
      sendJson(exchange.res, exchange.isEmbed, 200, await compareVersions(guide.id, older, newer));
    },
  },
  {
    method: 'GET',
    path: '/api/guides/:id/versions/:n',
    body: 'none',
    handle: async (exchange) => {
      const viewer = await viewerOf(exchange);
      const { guide } = await guideAccess(exchange.params['id'] ?? '', viewer, 'see', {
        allowWithdrawn: true,
      });
      const number = wholeNumber(exchange.params['n'] ?? null, 'n');
      sendJson(exchange.res, exchange.isEmbed, 200, await versionDetail(guide.id, number));
    },
  },
  {
    method: 'POST',
    path: '/api/guides/:id/versions/:n/restore',
    body: 'json',
    handle: async (exchange) => {
      const viewer = await viewerOf(exchange);
      const { guide } = await guideAccess(exchange.params['id'] ?? '', viewer, 'edit', {
        allowWithdrawn: true,
      });
      const user = requireConfirmed(viewer);
      const number = wholeNumber(exchange.params['n'] ?? null, 'n');
      if ((await latestVersionNumber(guide.id)) === null) throw notFound();
      const restored = await restoreVersion(guide, number, user.id);
      live.publish(
        {
          kind: 'version',
          guide: guide.id,
          number: restored.number,
          saved_by: user.name,
          restored_from: restored.restored_from,
        },
        [guideTopic(guide.id)],
      );
      sendJson(exchange.res, exchange.isEmbed, 201, restored);
    },
  },
];
