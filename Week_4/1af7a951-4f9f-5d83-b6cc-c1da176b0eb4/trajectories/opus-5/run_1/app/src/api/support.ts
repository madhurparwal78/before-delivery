import { oneRow } from '../db/pool.js';
import { unauthenticated } from '../http/errors.js';
import type { RequestContext } from '../http/router.js';
import {
  captureWindowOpen,
  nightNumber,
  publishedNightKey,
  techniqueUnlocked,
  type NightSettings,
} from '../domain/night.js';
import type { DateKey } from '../domain/time.js';
import { findEnrollment, latestStoredNightKey, type EnrollmentRow } from '../store/enrollments.js';

export interface CoachRow {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly time_zone: string;
  readonly access_code: string;
}

export async function dreamerOf(ctx: RequestContext): Promise<EnrollmentRow> {
  const session = ctx.session;
  if (session === null || session.enrollmentId === null) throw unauthenticated();
  const enrollment = await findEnrollment(session.enrollmentId);
  if (enrollment === null || enrollment.status !== 'active') throw unauthenticated();
  return enrollment;
}

export async function coachOf(ctx: RequestContext): Promise<CoachRow> {
  const session = ctx.session;
  if (session === null || session.coachId === null) throw unauthenticated();
  const coach = await oneRow<CoachRow>(
    'select id, name, email, time_zone, access_code from coaches where id = $1',
    [session.coachId],
  );
  if (coach === null) throw unauthenticated();
  return coach;
}

export interface NightStatus {
  readonly settings: NightSettings;
  readonly night_key: DateKey;
  readonly night_number: number;
  readonly capture_window: 'open' | 'closed';
  readonly technique_unlocked: boolean;
}

export async function nightStatusOf(
  enrollment: EnrollmentRow,
  now: Date,
): Promise<NightStatus> {
  const settings: NightSettings = { homeTz: enrollment.home_tz, bedtime: enrollment.bedtime };
  const nightKey = publishedNightKey(settings, now, await latestStoredNightKey(enrollment.id));
  const number = nightNumber(nightKey, enrollment.first_night);
  return {
    settings,
    night_key: nightKey,
    night_number: number,
    capture_window: captureWindowOpen(nightKey, settings, now) ? 'open' : 'closed',
    technique_unlocked: techniqueUnlocked(number),
  };
}
