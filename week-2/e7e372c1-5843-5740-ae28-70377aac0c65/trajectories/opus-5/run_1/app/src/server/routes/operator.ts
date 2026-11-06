/** Operator endpoints: the tick tape, the rehearsal clock and the tick key. */
import { ApiResponse, RequestContext, readJsonBody } from '../http';
import { fail } from '../errors';
import { parseIsoInstant, toIso } from '../../shared/nytime';
import { isRehearsalClock, marketClockNow, setRehearsalClock } from '../marketClock';
import { readTapeState, writeTapeState } from '../tape';
import { getTickKey } from '../secrets';
import { processDueSessionCloses } from '../sessionClose';
import { requireUser } from './staff';

async function requireOperator(context: RequestContext): Promise<void> {
  const user = await requireUser(context);
  if (!user.roles.includes('operator')) throw fail('forbidden');
}

export async function getTape(context: RequestContext): Promise<ApiResponse> {
  await requireOperator(context);
  return { status: 200, json: await readTapeState() };
}

export async function putTape(context: RequestContext): Promise<ApiResponse> {
  const body = await readJsonBody(context);
  await requireOperator(context);
  const state = body.state;
  if (state !== 'playing' && state !== 'paused') {
    throw fail('validation_failed', { fields: { state: 'Enter playing or paused.' } });
  }
  return { status: 200, json: await writeTapeState(state) };
}

export async function putClock(context: RequestContext): Promise<ApiResponse> {
  const body = await readJsonBody(context);
  await requireOperator(context);
  if (!('at' in body)) {
    throw fail('validation_failed', { fields: { at: 'Enter an instant, or null for real time.' } });
  }
  const at = body.at;
  if (at === null) {
    await setRehearsalClock(null);
  } else {
    const instant = typeof at === 'string' ? parseIsoInstant(at) : null;
    if (instant === null) {
      throw fail('validation_failed', { fields: { at: 'Enter an instant, or null for real time.' } });
    }
    await setRehearsalClock(instant);
  }
  await processDueSessionCloses();
  const nowMs = await marketClockNow();
  return { status: 200, json: { now: toIso(nowMs), rehearsal: await isRehearsalClock() } };
}

export async function getTickKeyEndpoint(context: RequestContext): Promise<ApiResponse> {
  await requireOperator(context);
  return { status: 200, json: { key: getTickKey() } };
}
