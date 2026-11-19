import { readFileSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { ApiError, notFound } from '../http/errors.js';
import { send, sendJson } from '../http/respond.js';
import { guideAccess, viewerOf } from '../http/context.js';
import type { Route } from '../http/router.js';
import { isSampleName, publicDir, sampleBytes } from '../samples.js';
import { getModel, StorageUnreachable, storageAnswers } from '../storage/s3.js';
import { modelIsReadableBy } from '../domain/models.js';
import { loadParts, readableSnapshot } from '../domain/guides.js';
import { renderStill } from '../render/still.js';
import { pool } from '../db/index.js';

const STATIC_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
};

export const assetRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/health',
    body: 'none',
    handle: async (exchange) => {
      const [database, storage] = await Promise.all([
        pool
          .query('SELECT 1')
          .then(() => true)
          .catch(() => false),
        storageAnswers(),
      ]);
      sendJson(exchange.res, exchange.isEmbed, 200, {
        status: database && storage ? 'ok' : 'unavailable',
      });
    },
  },
  {
    method: 'GET',
    path: '/samples/:file',
    body: 'none',
    handle: (exchange) => {
      const file = exchange.params['file'] ?? '';
      const name = file.endsWith('.glb') ? file.slice(0, -4) : '';
      if (!isSampleName(name)) throw notFound();
      send(exchange.res, exchange.isEmbed, 200, 'model/gltf-binary', sampleBytes(name));
    },
  },
  {
    method: 'GET',
    path: '/api/models/:file',
    body: 'none',
    handle: async (exchange) => {
      const file = exchange.params['file'] ?? '';
      if (!file.endsWith('.glb')) throw notFound();
      const modelId = file.slice(0, -4);
      const viewer = await viewerOf(exchange);
      if (!(await modelIsReadableBy(modelId, viewer?.id ?? null))) throw notFound();
      try {
        const bytes = await getModel(modelId);
        if (bytes === null) throw notFound();
        send(exchange.res, exchange.isEmbed, 200, 'model/gltf-binary', bytes);
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
    path: '/api/guides/:id/stills/:n',
    body: 'none',
    handle: async (exchange) => {
      const viewer = await viewerOf(exchange);
      const { guide } = await guideAccess(exchange.params['id'] ?? '', viewer, 'see', {
        allowWithdrawn: true,
      });
      const readable = await readableSnapshot(guide, viewer);
      if (readable === null) throw notFound();
      const wanted = Number(exchange.params['n'] ?? '');
      const steps = readable.snapshot.steps;
      const step = steps.find((candidate) => candidate.number === wanted) ?? steps[steps.length - 1];
      if (!step) throw notFound();
      const svg = renderStill(
        step,
        readable.snapshot.parts,
        await loadParts(guide.id),
        readable.snapshot.model_scale,
        readable.snapshot.title,
      );
      send(exchange.res, exchange.isEmbed, 200, 'image/svg+xml; charset=utf-8', svg, {
        'Cache-Control': 'no-store',
      });
    },
  },
  {
    method: 'GET',
    path: '/assets/:file',
    body: 'none',
    handle: (exchange) => {
      const file = exchange.params['file'] ?? '';
      const extension = file.slice(file.lastIndexOf('.'));
      const contentType = STATIC_TYPES[extension];
      if (contentType === undefined || file.includes('..')) throw notFound();
      const path = normalize(join(publicDir, file));
      if (!path.startsWith(publicDir)) throw notFound();
      try {
        send(exchange.res, exchange.isEmbed, 200, contentType, readFileSync(path), {
          'Cache-Control': 'public, max-age=3600',
        });
      } catch {
        throw notFound();
      }
    },
  },
  {
    method: 'GET',
    path: '/assets/fonts/:file',
    body: 'none',
    handle: (exchange) => {
      const file = exchange.params['file'] ?? '';
      if (!file.endsWith('.woff2') || file.includes('..')) throw notFound();
      const path = normalize(join(publicDir, 'fonts', file));
      if (!path.startsWith(publicDir)) throw notFound();
      try {
        send(exchange.res, exchange.isEmbed, 200, 'font/woff2', readFileSync(path), {
          'Cache-Control': 'public, max-age=86400',
        });
      } catch {
        throw notFound();
      }
    },
  },
];
