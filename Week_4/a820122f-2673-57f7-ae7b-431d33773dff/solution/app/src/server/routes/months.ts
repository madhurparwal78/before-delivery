import { ValidationError, fail } from '../http/errors.js';
import { requireOwner, requireVisibleCrew, route, sendJson, sendPdf } from '../http/router.js';
import * as store from '../db/store.js';
import { isMonth } from '../domain/time.js';
import { archiveStatus } from '../services/archive.js';
import { getObject } from '../services/object-store.js';
import {
  monthPayload,
  monthReadiness,
  trySealMonth,
} from '../services/sealing.js';

function requireMonthParam(value: string): string {
  if (!isMonth(value)) {
    throw new ValidationError({ month: 'A month needs the form 2026-09.' });
  }
  return value;
}

async function sendArchivedPdf(
  res: Parameters<typeof sendPdf>[0],
  key: string,
  filename: string,
): Promise<void> {
  let body: Buffer;
  try {
    body = await getObject(key);
  } catch {
    fail(503, 'archive_unreachable');
  }
  sendPdf(res, body, filename);
}

export function registerMonthRoutes(): void {
  route('GET', '/api/crew/:crewId/months/:month', 'session', async (context) => {
    const crew = await requireVisibleCrew(context);
    const month = requireMonthParam(context.params['month'] as string);
    const vessel = (await store.findVesselById(crew.vesselId)) as store.Vessel;
    const clock = await store.loadVesselClock(vessel);
    sendJson(context.res, 200, await monthPayload(crew, clock, month, context.nowMs));
  });

  route('POST', '/api/crew/:crewId/months/:month/seal', 'session', async (context) => {
    const crew = await requireVisibleCrew(context);
    requireOwner(context);
    const month = requireMonthParam(context.params['month'] as string);
    const vessel = (await store.findVesselById(crew.vesselId)) as store.Vessel;
    const clock = await store.loadVesselClock(vessel);
    const current = await store.findMonth(crew.id, month);
    if (current.state === 'sealed') {
      sendJson(context.res, 200, await monthPayload(crew, clock, month, context.nowMs));
      return;
    }
    if (current.state === 'open') {
      const readiness = await monthReadiness(crew, clock, month, context.nowMs);
      if (!readiness.ready) {
        fail(409, 'month_not_ready', { blocking_dates: readiness.blockingDates });
      }
      await store.startAwaitingArchive(crew.id, month);
    }
    void trySealMonth(crew.id, month).catch(() => undefined);
    sendJson(context.res, 202, await monthPayload(crew, clock, month, context.nowMs));
  });

  route('GET', '/api/crew/:crewId/months/:month/record.pdf', 'session', async (context) => {
    const crew = await requireVisibleCrew(context);
    const month = requireMonthParam(context.params['month'] as string);
    const state = await store.findMonth(crew.id, month);
    if (state.state !== 'sealed' || state.recordKey === null) fail(409, 'month_not_sealed');
    if (archiveStatus().archive === 'unreachable') fail(503, 'archive_unreachable');
    await sendArchivedPdf(context.res, state.recordKey, `record-${month}.pdf`);
  });

  route('GET', '/api/crew/:crewId/months/:month/copy.pdf', 'session', async (context) => {
    const crew = await requireVisibleCrew(context);
    const month = requireMonthParam(context.params['month'] as string);
    const state = await store.findMonth(crew.id, month);
    if (state.state !== 'sealed' || state.copyKey === null) fail(409, 'month_not_sealed');
    if (archiveStatus().archive === 'unreachable') fail(503, 'archive_unreachable');
    await sendArchivedPdf(context.res, state.copyKey, `seafarer-copy-${month}.pdf`);
  });

  route('GET', '/api/archive-status', 'session', async (context) => {
    requireOwner(context);
    sendJson(context.res, 200, archiveStatus());
  });
}
