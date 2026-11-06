import type { Staff } from '../../shared/types';
import { config, JSON_CONTENT_TYPE } from '../config';
import { withClient } from '../db/pool';
import { latestSeq } from '../domain/events';
import {
  createObject,
  getObject,
  listObjects,
  updateObject,
} from '../domain/objectService';
import { attachConditionPhoto, readConditionPhoto } from '../domain/photoService';
import {
  claimPlacement,
  hangPlacement,
  movePlacement,
  placeWork,
  releasePlacement,
  removePlacement,
  setWallLux,
  signOffPlacement,
  undoAction,
} from '../domain/placementService';
import {
  cancelPreviewSchedule,
  findSnapshotByToken,
  getPreview,
  schedulePreview,
  withdrawPreview,
} from '../domain/previewService';
import {
  countOverBudget,
  getExhibitionResponse,
  listPlacements,
  listStaff,
  rowToEvent,
} from '../domain/repository';
import { errors } from '../http/errors';
import { headerValue, jsonResult, parseJsonBody, type ApiResult, type Ctx } from '../http/http';
import { getStatus } from '../services/status';

export interface Route {
  method: string;
  segments: string[];
  needsStaff: boolean;
  needsDatabase: boolean;
  maxBytes: number;
  idempotent: boolean;
  handle: (ctx: Ctx, staff: Staff) => Promise<ApiResult>;
}

function route(
  method: string,
  path: string,
  handle: (ctx: Ctx, staff: Staff) => Promise<ApiResult>,
  options: Partial<Pick<Route, 'needsStaff' | 'needsDatabase' | 'maxBytes' | 'idempotent'>> = {},
): Route {
  return {
    method,
    segments: path.split('/').filter((segment) => segment !== ''),
    needsStaff: options.needsStaff ?? true,
    needsDatabase: options.needsDatabase ?? true,
    maxBytes: options.maxBytes ?? config.maxJsonBytes,
    idempotent: options.idempotent ?? false,
    handle,
  };
}

function singleQuery(ctx: Ctx, name: string): string | undefined {
  const value = ctx.query.get(name);
  return value === null ? undefined : value;
}

export const apiRoutes: Route[] = [
  route('GET', '/api/health', async () => jsonResult(200, { status: 'ok' }), {
    needsStaff: false,
    needsDatabase: false,
  }),
  route('GET', '/api/status', async () => jsonResult(200, getStatus()), {
    needsStaff: false,
    needsDatabase: false,
  }),
  route('GET', '/api/staff', async () => jsonResult(200, { staff: await listStaff() }), {
    needsStaff: false,
  }),
  route('GET', '/api/exhibition', async () => jsonResult(200, await getExhibitionResponse())),
  route('GET', '/api/events', async (ctx) => {
    const after = singleQuery(ctx, 'after');
    if (after !== undefined && !/^\d+$/.test(after)) {
      throw errors.validationFailed({ after: 'Ask for events after a whole number.' });
    }
    return withClient(async (client) => {
      const seq = await latestSeq(client);
      if (after === undefined) return jsonResult(200, { events: [], latestSeq: seq });
      const rows = (
        await client.query(
          `select e.*, s.name as actor_name from events e
           left join staff s on s.id = e.actor_id
           where e.seq > $1 order by e.seq limit 200`,
          [Number(after)],
        )
      ).rows;
      return jsonResult(200, { events: rows.map(rowToEvent), latestSeq: seq });
    });
  }),
  route('PATCH', '/api/walls/:id', async (ctx, staff) => {
    const body = parseJsonBody(ctx.body);
    const result = await setWallLux(staff, ctx.params['id'] as string, body['plannedLux']);
    return jsonResult(200, result);
  }),
  route('GET', '/api/objects', async (ctx) => {
    const objects = await listObjects({
      q: singleQuery(ctx, 'q'),
      lender: singleQuery(ctx, 'lender'),
      sort: singleQuery(ctx, 'sort'),
      dir: singleQuery(ctx, 'dir'),
    });
    return jsonResult(200, { objects });
  }),
  route('POST', '/api/objects', async (ctx, staff) => {
    const result = await createObject(staff, parseJsonBody(ctx.body));
    return jsonResult(201, result);
  }),
  route('GET', '/api/objects/:id', async (ctx) => {
    const object = await getObject(ctx.params['id'] as string);
    if (!object) throw errors.notFound();
    return jsonResult(200, { object });
  }),
  route('PATCH', '/api/objects/:id', async (ctx, staff) => {
    const result = await updateObject(staff, ctx.params['id'] as string, parseJsonBody(ctx.body));
    return jsonResult(200, result);
  }),
  route(
    'POST',
    '/api/objects/:id/photos',
    async (ctx, staff) => {
      const result = await attachConditionPhoto(
        staff,
        ctx.params['id'] as string,
        headerValue(ctx, 'content-type'),
        ctx.body,
      );
      return jsonResult(201, result);
    },
    { maxBytes: config.maxPhotoBytes, idempotent: true },
  ),
  route('GET', '/api/objects/:id/photos/:photoId', async (ctx) => {
    const photo = await readConditionPhoto(
      ctx.params['id'] as string,
      ctx.params['photoId'] as string,
    );
    if (!photo) throw errors.notFound();
    return { status: 200, bytes: photo.bytes, contentType: photo.contentType };
  }),
  route('GET', '/api/placements', async () =>
    withClient(async (client) =>
      jsonResult(200, {
        placements: await listPlacements(client),
        overBudgetCount: await countOverBudget(client),
      }),
    ),
  ),
  route(
    'POST',
    '/api/placements',
    async (ctx, staff) => {
      const body = parseJsonBody(ctx.body);
      const result = await placeWork(staff, {
        objectId: body['objectId'],
        wallId: body['wallId'],
        offsetMm: body['offsetMm'],
        centreHeightMm: body['centreHeightMm'],
        heightOverride: body['heightOverride'],
      });
      return jsonResult(201, result);
    },
    { idempotent: true },
  ),
  route('PATCH', '/api/placements/:id', async (ctx, staff) => {
    const body = parseJsonBody(ctx.body);
    const result = await movePlacement(staff, ctx.params['id'] as string, {
      version: body['version'],
      ...('offsetMm' in body ? { offsetMm: body['offsetMm'] } : {}),
      ...('centreHeightMm' in body ? { centreHeightMm: body['centreHeightMm'] } : {}),
      ...('heightOverride' in body ? { heightOverride: body['heightOverride'] } : {}),
      ...('wallId' in body ? { wallId: body['wallId'] } : {}),
    });
    return jsonResult(200, result);
  }),
  route('DELETE', '/api/placements/:id', async (ctx, staff) =>
    jsonResult(200, await removePlacement(staff, ctx.params['id'] as string)),
  ),
  route('POST', '/api/placements/:id/claim', async (ctx, staff) => {
    const result = await claimPlacement(staff, ctx.params['id'] as string);
    return jsonResult(
      200,
      result.seq === null
        ? { placement: result.placement }
        : { placement: result.placement, seq: result.seq },
    );
  }),
  route('POST', '/api/placements/:id/release', async (ctx, staff) =>
    jsonResult(200, await releasePlacement(staff, ctx.params['id'] as string)),
  ),
  route('POST', '/api/placements/:id/hang', async (ctx, staff) =>
    jsonResult(200, await hangPlacement(staff, ctx.params['id'] as string)),
  ),
  route('POST', '/api/placements/:id/sign-off', async (ctx, staff) =>
    jsonResult(200, await signOffPlacement(staff, ctx.params['id'] as string)),
  ),
  route('POST', '/api/undo/:actionId', async (ctx, staff) =>
    jsonResult(200, await undoAction(staff, ctx.params['actionId'] as string)),
  ),
  route('GET', '/api/preview', async () => jsonResult(200, { preview: await getPreview() })),
  route('POST', '/api/preview/schedule', async (ctx, staff) => {
    const body = parseJsonBody(ctx.body);
    return jsonResult(200, await schedulePreview(staff, body['date']));
  }),
  route('POST', '/api/preview/cancel', async (_ctx, staff) =>
    jsonResult(200, await cancelPreviewSchedule(staff)),
  ),
  route('POST', '/api/preview/withdraw', async (_ctx, staff) =>
    jsonResult(200, await withdrawPreview(staff)),
  ),
  route(
    'GET',
    '/api/p/:token',
    async (ctx) => {
      const snapshot = await findSnapshotByToken(ctx.params['token'] as string);
      if (!snapshot) throw errors.notFound();
      if (snapshot.status === 'withdrawn') throw errors.linkWithdrawn();
      return { status: 200, bytes: snapshot.json, contentType: JSON_CONTENT_TYPE };
    },
    { needsStaff: false },
  ),
  route(
    'GET',
    '/api/p/:token/snapshot.png',
    async (ctx) => {
      const snapshot = await findSnapshotByToken(ctx.params['token'] as string);
      if (!snapshot) throw errors.notFound();
      if (snapshot.status === 'withdrawn') throw errors.linkWithdrawn();
      return { status: 200, bytes: snapshot.png, contentType: 'image/png' };
    },
    { needsStaff: false },
  ),
];

export function matchRoute(
  method: string,
  segments: string[],
): { route: Route; params: Record<string, string> } | null {
  for (const candidate of apiRoutes) {
    if (candidate.segments.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (const [index, part] of candidate.segments.entries()) {
      const actual = segments[index] as string;
      if (part.startsWith(':')) {
        params[part.slice(1)] = decodeURIComponent(actual);
      } else if (part !== actual) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    if (candidate.method !== method) continue;
    return { route: candidate, params };
  }
  return null;
}

export function routeKey(route: Route): string {
  return `${route.method} /${route.segments.join('/')}`;
}
