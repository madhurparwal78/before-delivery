import { clearTestClock, setTestClock } from '../clock.js';
import { ApiError } from '../errors.js';
import { json, noContent, type Reply, type RequestContext } from '../http.js';
import { liveCount } from '../domain/hours.js';
import { FIELD_MESSAGES } from '../domain/planRules.js';
import { runDueReminders } from '../domain/reminders.js';
import { findSharedPlan } from '../domain/share.js';

export function health(): Reply {
  return json(200, { status: 'ok' });
}

export async function tonight(): Promise<Reply> {
  return json(200, { keeping: await liveCount() });
}

export async function readSharedPlan(ctx: RequestContext): Promise<Reply> {
  const token = ctx.path.slice('/api/share/'.length);
  const plan = token ? await findSharedPlan(decodeURIComponent(token)) : null;
  if (!plan) throw new ApiError('not_found');
  return json(200, { plan });
}

const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:?\d{2})$/;

export async function putTestClock(ctx: RequestContext): Promise<Reply> {
  const value = ctx.body?.['now'];
  if (typeof value !== 'string' || !ISO_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ApiError('invalid', { fields: { now: FIELD_MESSAGES.now } });
  }
  const instant = new Date(value);
  await setTestClock(instant);
  await runDueReminders();
  return json(200, { now: instant.toISOString() });
}

export async function deleteTestClock(): Promise<Reply> {
  await clearTestClock();
  await runDueReminders();
  return noContent;
}
