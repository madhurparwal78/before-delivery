import type { IncomingMessage, ServerResponse } from 'node:http';
import { FIELD_COPY } from '../../shared/copy.js';
import { nowIso, nowMs } from '../domain/clock.js';
import { ApiError, validationError } from '../domain/errors.js';
import {
  validatePaper,
  validateReelName,
  validateUnitBody,
  validateVersion,
  validateZone,
} from '../domain/validation.js';
import { dailyPull } from '../db/dailyPull.js';
import {
  fingerprintOf,
  recordSuccess,
  releaseHold,
  requireKey,
  takeHold,
} from '../db/idempotency.js';
import { pool } from '../db/pool.js';
import { appendStop, createReel, listReels, loadReel, reorderStops } from '../db/reels.js';
import { loadSettings, saveHomeZone, saveUnit, toSettingsJson } from '../db/settings.js';
import {
  listSheets,
  loadSheet,
  requestSheet,
  retrySheet,
  toSheetJson,
} from '../db/sheets.js';
import { assertSheetReady } from '../domain/states.js';
import {
  readJsonBody,
  readMultipartBody,
} from '../http/request.js';
import { sendBytes, sendJson } from '../http/respond.js';
import { currentServices, storageUsable } from '../services/status.js';
import { StorageUnreachable, getObject, sheetKey } from '../services/storage.js';
import {
  captureReference,
  library,
  patchFacts,
  readDisplay,
  readOriginal,
  readReference,
  resetSwatch,
  restoreReference,
  setSwatchFromPoint,
  trashList,
  trashReference,
} from './references.js';
import { MAX_QUERY_LENGTH, searchReferences } from './search.js';

interface Route {
  method: string;
  pattern: string[];
  handle: (context: RouteContext) => Promise<void>;
}

interface RouteContext {
  request: IncomingMessage;
  response: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  path: string;
}

function segmentsOf(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

function filtersFrom(query: URLSearchParams): {
  colour_family?: string;
  material?: string;
  finish?: string;
} {
  const filters: { colour_family?: string; material?: string; finish?: string } = {};
  const colourFamily = query.get('colour_family');
  const material = query.get('material');
  const finish = query.get('finish');
  if (colourFamily) filters.colour_family = colourFamily;
  if (material) filters.material = material;
  if (finish) filters.finish = finish;
  return filters;
}

/** Runs a write under its idempotency key, recording only its success. */
async function underIdempotencyKey(
  context: RouteContext,
  fingerprintParts: Array<string | Buffer>,
  successStatus: number,
  run: () => Promise<unknown>,
): Promise<void> {
  const method = context.request.method ?? 'POST';
  const key = requireKey(
    typeof context.request.headers['idempotency-key'] === 'string'
      ? context.request.headers['idempotency-key']
      : undefined,
  );
  const fingerprint = fingerprintOf(fingerprintParts);
  const replay = await takeHold(method, context.path, key, fingerprint);
  if (replay) {
    sendJson(context.response, replay.status, replay.body, { 'Idempotent-Replay': 'true' });
    return;
  }
  let body: unknown;
  try {
    body = await run();
  } catch (error) {
    await releaseHold(method, context.path, key);
    throw error;
  }
  await recordSuccess(method, context.path, key, fingerprint, successStatus, body);
  sendJson(context.response, successStatus, body);
}

async function requireReel(id: string): Promise<void> {
  const exists = await pool.query('select 1 from reel where id = $1', [id]);
  if (exists.rowCount === 0) throw new ApiError('not_found');
}

export const ROUTES: Route[] = [
  {
    method: 'GET',
    pattern: ['api', 'health'],
    handle: async ({ response }) => {
      sendJson(response, 200, { status: 'ok' });
    },
  },
  {
    method: 'GET',
    pattern: ['api', 'status'],
    handle: async ({ response }) => {
      sendJson(response, 200, { server_now: nowIso(), services: currentServices() });
    },
  },
  {
    method: 'POST',
    pattern: ['api', 'references'],
    handle: async (context) => {
      const { fields, file } = await readMultipartBody(context.request);
      const canonical = Object.keys(fields)
        .sort()
        .map((name) => `${name}=${fields[name]}`)
        .join('\n');
      await underIdempotencyKey(
        context,
        [file?.bytes ?? Buffer.alloc(0), canonical],
        201,
        () => captureReference(fields, file),
      );
    },
  },
  {
    method: 'GET',
    pattern: ['api', 'references'],
    handle: async ({ response, query }) => {
      sendJson(response, 200, await library(filtersFrom(query)));
    },
  },
  {
    method: 'GET',
    pattern: ['api', 'references', ':id'],
    handle: async ({ response, params }) => {
      sendJson(response, 200, await readReference(params.id!));
    },
  },
  {
    method: 'PATCH',
    pattern: ['api', 'references', ':id'],
    handle: async ({ request, response, params }) => {
      const body = await readJsonBody(request);
      sendJson(response, 200, await patchFacts(params.id!, body));
    },
  },
  {
    method: 'DELETE',
    pattern: ['api', 'references', ':id'],
    handle: async ({ response, params }) => {
      sendJson(response, 200, await trashReference(params.id!));
    },
  },
  {
    method: 'GET',
    pattern: ['api', 'references', ':id', 'original'],
    handle: async ({ response, params }) => {
      const { bytes, contentType } = await readOriginal(params.id!);
      sendBytes(response, 200, bytes, contentType, { 'cache-control': 'no-store' });
    },
  },
  {
    method: 'GET',
    pattern: ['api', 'references', ':id', 'display'],
    handle: async ({ response, params }) => {
      sendBytes(response, 200, await readDisplay(params.id!), 'image/jpeg', {
        'cache-control': 'no-store',
      });
    },
  },
  {
    method: 'POST',
    pattern: ['api', 'references', ':id', 'swatch'],
    handle: async ({ request, response, params }) => {
      const body = await readJsonBody(request);
      sendJson(response, 200, await setSwatchFromPoint(params.id!, body));
    },
  },
  {
    method: 'DELETE',
    pattern: ['api', 'references', ':id', 'swatch'],
    handle: async ({ response, params }) => {
      sendJson(response, 200, await resetSwatch(params.id!));
    },
  },
  {
    method: 'POST',
    pattern: ['api', 'references', ':id', 'restore'],
    handle: async ({ response, params }) => {
      sendJson(response, 200, await restoreReference(params.id!));
    },
  },
  {
    method: 'GET',
    pattern: ['api', 'trash'],
    handle: async ({ response }) => {
      sendJson(response, 200, await trashList());
    },
  },
  {
    method: 'GET',
    pattern: ['api', 'search'],
    handle: async ({ response, query }) => {
      const q = (query.get('q') ?? '').slice(0, MAX_QUERY_LENGTH);
      sendJson(response, 200, await searchReferences(q, filtersFrom(query)));
    },
  },
  {
    method: 'GET',
    pattern: ['api', 'reels'],
    handle: async ({ response }) => {
      sendJson(response, 200, { reels: await listReels() });
    },
  },
  {
    method: 'POST',
    pattern: ['api', 'reels'],
    handle: async ({ request, response }) => {
      const body = await readJsonBody(request);
      sendJson(response, 201, await createReel(validateReelName(body.name as never)));
    },
  },
  {
    method: 'GET',
    pattern: ['api', 'reels', ':id'],
    handle: async ({ response, params }) => {
      const reel = await loadReel(pool, params.id!);
      if (!reel) throw new ApiError('not_found');
      sendJson(response, 200, reel);
    },
  },
  {
    method: 'POST',
    pattern: ['api', 'reels', ':id', 'stops'],
    handle: async ({ request, response, params }) => {
      const body = await readJsonBody(request);
      const referenceId = body.reference_id;
      if (typeof referenceId !== 'string' || referenceId.length === 0) {
        throw validationError({ reference_id: FIELD_COPY.reference_id });
      }
      const reel = await appendStop(params.id!, referenceId);
      if (!reel) throw new ApiError('not_found');
      sendJson(response, 200, reel);
    },
  },
  {
    method: 'PUT',
    pattern: ['api', 'reels', ':id', 'stops'],
    handle: async ({ request, response, params }) => {
      const body = await readJsonBody(request);
      const version = validateVersion(body.version as never, 'reel');
      const ids = body.reference_ids;
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
        throw validationError({ reference_ids: FIELD_COPY.reference_ids });
      }
      const reel = await reorderStops(params.id!, version, ids as string[]);
      if (!reel) throw new ApiError('not_found');
      sendJson(response, 200, reel);
    },
  },
  {
    method: 'POST',
    pattern: ['api', 'reels', ':id', 'sheets'],
    handle: async (context) => {
      const body = await readJsonBody(context.request);
      await requireReel(context.params.id!);
      await underIdempotencyKey(context, [JSON.stringify(body)], 202, async () => {
        const paper = validatePaper(body.paper as never);
        const unit = validateUnitBody(body.unit as never);
        const sheet = await requestSheet(context.params.id!, paper, unit);
        if (!sheet) throw new ApiError('not_found');
        return toSheetJson(sheet);
      });
    },
  },
  {
    method: 'GET',
    pattern: ['api', 'reels', ':id', 'sheets'],
    handle: async ({ response, params }) => {
      await requireReel(params.id!);
      const sheets = await listSheets(params.id!);
      sendJson(response, 200, { sheets: sheets.map(toSheetJson) });
    },
  },
  {
    method: 'GET',
    pattern: ['api', 'sheets', ':id'],
    handle: async ({ response, params }) => {
      const sheet = await loadSheet(params.id!);
      if (!sheet) throw new ApiError('not_found');
      sendJson(response, 200, toSheetJson(sheet));
    },
  },
  {
    method: 'POST',
    pattern: ['api', 'sheets', ':id', 'retry'],
    handle: async ({ response, params }) => {
      const sheet = await retrySheet(params.id!);
      if (!sheet) throw new ApiError('not_found');
      sendJson(response, 202, toSheetJson(sheet));
    },
  },
  {
    method: 'GET',
    pattern: ['api', 'sheets', ':id', 'pdf'],
    handle: async ({ response, params }) => {
      const sheet = await loadSheet(params.id!);
      if (!sheet) throw new ApiError('not_found');
      assertSheetReady(sheet.state);
      if (!storageUsable()) throw new ApiError('storage_unavailable');
      const bytes = await getObject(sheetKey(sheet.id)).catch((error) => {
        if (error instanceof StorageUnreachable) throw new ApiError('storage_unavailable');
        throw error;
      });
      if (!bytes) throw new ApiError('storage_unavailable');
      sendBytes(response, 200, bytes, 'application/pdf', {
        'content-disposition': `attachment; filename="contact-sheet.pdf"`,
        'cache-control': 'no-store',
      });
    },
  },
  {
    method: 'GET',
    pattern: ['api', 'daily-pull'],
    handle: async ({ response }) => {
      sendJson(response, 200, await dailyPull());
    },
  },
  {
    method: 'GET',
    pattern: ['api', 'settings'],
    handle: async ({ response }) => {
      sendJson(response, 200, toSettingsJson(await loadSettings(), nowMs()));
    },
  },
  {
    method: 'PUT',
    pattern: ['api', 'settings', 'home-zone'],
    handle: async ({ request, response }) => {
      const body = await readJsonBody(request);
      await saveHomeZone(validateZone(body.zone as never));
      sendJson(response, 200, toSettingsJson(await loadSettings(), nowMs()));
    },
  },
  {
    method: 'PUT',
    pattern: ['api', 'settings', 'unit'],
    handle: async ({ request, response }) => {
      const body = await readJsonBody(request);
      await saveUnit(validateUnitBody(body.unit as never));
      sendJson(response, 200, toSettingsJson(await loadSettings(), nowMs()));
    },
  },
];

export function matchRoute(
  method: string,
  path: string,
): { route: Route; params: Record<string, string> } | null {
  const segments = segmentsOf(path);
  for (const route of ROUTES) {
    if (route.pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (const [index, part] of route.pattern.entries()) {
      const segment = segments[index]!;
      if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(segment);
      else if (part !== segment) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    if (route.method !== method) continue;
    return { route, params };
  }
  return null;
}

export async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  // A HEAD request is answered like its GET; the runtime drops the body.
  const method = request.method === 'HEAD' ? 'GET' : (request.method ?? 'GET');
  const match = matchRoute(method, url.pathname);
  if (!match) throw new ApiError('not_found');
  await match.route.handle({
    request,
    response,
    params: match.params,
    query: url.searchParams,
    path: url.pathname,
  });
}