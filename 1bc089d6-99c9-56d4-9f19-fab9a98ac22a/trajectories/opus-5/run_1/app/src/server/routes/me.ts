import { now } from '../clock.js';
import { ApiError } from '../errors.js';
import { json, noContent, type Reply, type RequestContext } from '../http.js';
import { deleteEverything, findHour, patchHour, toPlan, type HourRecord } from '../domain/hours.js';
import { readPlanInput } from '../domain/planRules.js';
import { createShareLink, removeShareLink } from '../domain/share.js';
import { clearedCookie, requireEmail } from './session.js';

async function signedInHour(ctx: RequestContext, at: Date): Promise<HourRecord> {
  const email = await requireEmail(ctx, at);
  const hour = await findHour(email);
  if (!hour) throw new ApiError('no_plan');
  return hour;
}

export async function readMyPlan(ctx: RequestContext): Promise<Reply> {
  const at = await now();
  const hour = await signedInHour(ctx, at);
  return json(200, { plan: await toPlan(hour, at) });
}

function expectedVersion(ctx: RequestContext): number {
  const header = ctx.header('if-match');
  if (header === undefined) throw new ApiError('version_required');
  const bare = header.trim().replace(/^"(.*)"$/, '$1');
  const value = Number(bare);
  return bare === '' || Number.isNaN(value) ? -1 : value;
}

export async function editMyPlan(ctx: RequestContext): Promise<Reply> {
  const at = await now();
  const hour = await signedInHour(ctx, at);
  const version = expectedVersion(ctx);
  if (version !== hour.version) {
    throw new ApiError('version_conflict', { current: await toPlan(hour, at) });
  }
  const body = ctx.body ?? {};
  if (Object.keys(body).length === 0) throw new ApiError('invalid');
  const values = readPlanInput('edit', body);
  const updated = await patchHour(hour, values, at);
  return json(200, { plan: await toPlan(updated, at) });
}

export async function createMyShare(ctx: RequestContext): Promise<Reply> {
  const at = await now();
  const hour = await signedInHour(ctx, at);
  return json(201, { share: await createShareLink(hour.email, at) });
}

export async function removeMyShare(ctx: RequestContext): Promise<Reply> {
  const at = await now();
  const hour = await signedInHour(ctx, at);
  await removeShareLink(hour.email);
  return noContent;
}

export async function deleteMe(ctx: RequestContext): Promise<Reply> {
  const at = await now();
  const email = await requireEmail(ctx, at);
  await deleteEverything(email);
  return { ...noContent, setCookie: clearedCookie };
}
