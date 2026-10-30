import { withTransaction } from '../db/pool.js';
import { fail, validation } from '../http/errors.js';
import { resolveWallTime } from '../../shared/studioClock.js';
import {
  applyEdit,
  applyMove,
  checkRevision,
  createMission,
  etagOf,
  listMissions,
  loadMission,
  loadMissionIn,
  missionBody,
  promoteDueMissions,
  readMissionFields,
  refuseIllegalMove,
  type MissionFields,
  type Move,
} from '../domain/missions.js';
import { boardDayNow, ensureBoardPosted, setStudioTimeZone, studioTimeZone } from '../domain/board.js';
import { onlineCouriers } from '../domain/presence.js';
import { isSignedIn } from '../domain/couriers.js';
import { residentIds } from '../domain/residents.js';
import type { AppRoute } from '../http/app.js';
import { published, readHeader, rawJson } from './shared.js';

const SCHEDULING_WINDOW_SECONDS = 366 * 86_400;
const LATE_ALLOWANCE_SECONDS = 60;

const MISSION_SPEC = {
  title: true,
  resident_id: true,
  reward_stamps: true,
  kind: true,
  rush_slots: true,
  dialogue: { offer: true, thanks: true },
} as const;

interface Resolved {
  instant: Date;
  publishNow: boolean;
}

/** Resolves a schedule body to its instant, in the order format, skipped time, then window. */
async function resolveGoLive(body: Record<string, unknown>, now: Date): Promise<Resolved> {
  const hasInstant = 'live_at' in body;
  const hasLocal = 'live_at_local' in body;
  if (hasInstant && hasLocal) throw validation({ live_at_local: 'invalid' });
  if (!hasInstant && !hasLocal) throw validation({ live_at: 'required' });

  let instant: Date;
  let publishNow = false;
  if (hasInstant) {
    const raw = body.live_at;
    if (raw === 'now') {
      instant = now;
      publishNow = true;
    } else {
      if (typeof raw !== 'string') throw validation({ live_at: 'invalid' });
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(raw)) {
        throw validation({ live_at: 'invalid' });
      }
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) throw validation({ live_at: 'invalid' });
      instant = parsed;
    }
  } else {
    const raw = body.live_at_local;
    if (typeof raw !== 'string') throw validation({ live_at_local: 'invalid' });
    const resolved = resolveWallTime(raw, await studioTimeZone());
    if ('fault' in resolved) throw validation({ live_at_local: resolved.fault });
    instant = resolved.instant;
  }

  const field = hasInstant ? 'live_at' : 'live_at_local';
  const offsetSeconds = (instant.getTime() - now.getTime()) / 1000;
  if (!publishNow) {
    if (offsetSeconds < -LATE_ALLOWANCE_SECONDS) throw validation({ [field]: 'in_past' });
    if (offsetSeconds > SCHEDULING_WINDOW_SECONDS) throw validation({ [field]: 'out_of_range' });
  }
  return { instant, publishNow: publishNow || offsetSeconds <= 0 };
}

async function moveMission(
  missionId: string,
  ifMatch: string | undefined,
  nominal: Move,
  decide: (now: Date) => Promise<{ instant: Date | null; actual: Move }>,
  now: Date,
): Promise<{ status: number; json: unknown; headers: Record<string, string> }> {
  await promoteDueMissions();
  const result = await withTransaction(async (tx) => {
    const mission = await loadMissionIn(tx, missionId, true);
    if (mission === null) throw fail('not_found');
    checkRevision(mission, ifMatch);
    refuseIllegalMove(mission, nominal);
    const decided = await decide(now);
    return applyMove(tx, mission, decided.actual, decided.instant);
  });
  if (result.status === 'live' && result.kind === 'rush') {
    await ensureBoardPosted(await boardDayNow(now));
  }
  return { status: 200, json: missionBody(result), headers: etagOf(result) };
}

export const founderRoutes: AppRoute[] = [
  {
    method: 'GET',
    pattern: '/api/founder/missions',
    auth: 'founder',
    bodyKind: 'none',
    handler: async () => {
      await promoteDueMissions();
      return { status: 200, json: { missions: (await listMissions()).map(missionBody) } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/founder/missions',
    auth: 'founder',
    bodyKind: 'json',
    handler: async (context) => {
      const body = published(context, MISSION_SPEC);
      const fields = readMissionFields(body, await residentIds(), { mode: 'create' });
      const mission = await createMission(fields as MissionFields);
      return { status: 201, json: missionBody(mission), headers: etagOf(mission) };
    },
  },
  {
    method: 'GET',
    pattern: '/api/founder/missions/:mission_id',
    auth: 'founder',
    bodyKind: 'none',
    handler: async (context) => {
      await promoteDueMissions();
      const mission = await loadMission(context.params.mission_id!);
      if (mission === null) throw fail('not_found');
      return { status: 200, json: missionBody(mission), headers: etagOf(mission) };
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/founder/missions/:mission_id',
    auth: 'founder',
    bodyKind: 'json',
    handler: async (context) => {
      await promoteDueMissions();
      const ifMatch = readHeader(context, 'If-Match');
      const seeded = await residentIds();
      const result = await withTransaction(async (tx) => {
        const mission = await loadMissionIn(tx, context.params.mission_id!, true);
        if (mission === null) throw fail('not_found');
        checkRevision(mission, ifMatch);
        if (mission.status === 'retired') throw fail('mission_retired');
        const body = published(context, MISSION_SPEC);
        const changes = readMissionFields(body, seeded, {
          mode: 'edit',
          storedKind: mission.kind,
        });
        return applyEdit(tx, mission, changes);
      });
      return { status: 200, json: missionBody(result), headers: etagOf(result) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/founder/missions/:mission_id/schedule',
    auth: 'founder',
    bodyKind: 'json',
    handler: async (context) => {
      const ifMatch = readHeader(context, 'If-Match');
      const body = rawJson(context);
      published(context, { live_at: true, live_at_local: true });
      return moveMission(
        context.params.mission_id!,
        ifMatch,
        body.live_at === 'now' ? 'publish' : 'schedule',
        async (now) => {
          const resolved = await resolveGoLive(body, now);
          return {
            instant: resolved.instant,
            actual: resolved.publishNow ? 'publish' : 'schedule',
          };
        },
        context.now,
      );
    },
  },
  {
    method: 'POST',
    pattern: '/api/founder/missions/:mission_id/unschedule',
    auth: 'founder',
    bodyKind: 'json',
    handler: async (context) => {
      const ifMatch = readHeader(context, 'If-Match');
      published(context, {});
      return moveMission(
        context.params.mission_id!,
        ifMatch,
        'unschedule',
        async () => ({ instant: null, actual: 'unschedule' }),
        context.now,
      );
    },
  },
  {
    method: 'POST',
    pattern: '/api/founder/missions/:mission_id/retire',
    auth: 'founder',
    bodyKind: 'json',
    handler: async (context) => {
      const ifMatch = readHeader(context, 'If-Match');
      published(context, {});
      return moveMission(
        context.params.mission_id!,
        ifMatch,
        'retire',
        async () => ({ instant: null, actual: 'retire' }),
        context.now,
      );
    },
  },
  {
    method: 'GET',
    pattern: '/api/founder/studio',
    auth: 'founder',
    bodyKind: 'none',
    handler: async (context) => ({ status: 200, json: await boardDayNow(context.now) }),
  },
  {
    method: 'PATCH',
    pattern: '/api/founder/studio',
    auth: 'founder',
    bodyKind: 'json',
    handler: async (context) => {
      const body = published(context, { time_zone: true });
      return { status: 200, json: await setStudioTimeZone(body.time_zone) };
    },
  },
  {
    method: 'GET',
    pattern: '/api/founder/online',
    auth: 'founder',
    bodyKind: 'none',
    handler: async (context) => {
      const couriers = await onlineCouriers(context.now);
      const signedIn = couriers.filter((courier) => isSignedIn(courier.role)).length;
      return {
        status: 200,
        json: {
          online: couriers.length,
          guests: couriers.length - signedIn,
          signed_in: signedIn,
        },
      };
    },
  },
];
