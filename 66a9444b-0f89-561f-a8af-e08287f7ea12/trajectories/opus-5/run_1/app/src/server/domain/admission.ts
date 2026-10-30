import { many, one, type Queryable } from '../db/pool.js';
import { newId } from '../lib/codes.js';
import {
  festivalDayEnd,
  festivalDayLengthHours,
  festivalDayOf,
  festivalDayStart,
  toUtcIso,
} from '../lib/time.js';
import { loadSession } from './programme.js';

const PLANETARIUM = 'planetarium-dome';

export type RefusalReason =
  | 'already_admitted'
  | 'pass_transferred'
  | 'pass_refunded'
  | 'pass_voided'
  | 'not_entitled'
  | 'session_cancelled';

export interface Admitted {
  result: 'admitted';
  pass_code: string;
  holder_name: string;
  item_title: string;
  session_id: string;
  festival_day: string;
  scanned_at: string;
}

export interface Refused {
  result: 'refused';
  reason: RefusalReason;
  first_admitted_at: string | null;
}

export type ScanOutcome = Admitted | Refused;

interface PassLookup {
  code: string;
  status: string;
  holder_name: string;
  line_id: string;
  kind: 'seat' | 'full_festival' | 'day';
  line_session_id: string | null;
  festival_day: string | null;
  title: string;
  line_state: string;
}

export async function loadPass(db: Queryable, code: string): Promise<PassLookup | null> {
  return one<PassLookup>(
    db,
    `SELECT p.code, p.status, p.holder_name, p.line_id, l.kind, l.session_id AS line_session_id,
            l.festival_day::text AS festival_day, l.title, l.state AS line_state
     FROM passes p JOIN order_lines l ON l.id = p.line_id WHERE p.code = $1`,
    [code],
  );
}

/** Decides one door scan and logs it, admitted or refused. */
export async function scan(
  db: Queryable,
  pass: PassLookup,
  sessionId: string,
  actor: string,
): Promise<ScanOutcome> {
  const session = await loadSession(db, sessionId);
  if (session === null) throw new Error('session missing for scan');
  const sessionDay = festivalDayOf(session.starts_at);

  const statusRefusal = statusReason(pass.status);
  if (statusRefusal !== null) {
    return logRefusal(db, pass.code, sessionId, sessionDay, statusRefusal, actor);
  }
  if (session.effective_status === 'cancelled') {
    return logRefusal(db, pass.code, sessionId, sessionDay, 'session_cancelled', actor);
  }
  if (!entitled(pass, session.id, session.admission, session.venue_id, sessionDay)) {
    return logRefusal(db, pass.code, sessionId, sessionDay, 'not_entitled', actor);
  }

  const earlier = await earlierAdmission(db, pass, sessionId, sessionDay);
  if (earlier !== null) {
    return logRefusal(db, pass.code, sessionId, sessionDay, 'already_admitted', actor, earlier);
  }

  const scannedAt = new Date();
  await db.query(
    `INSERT INTO scans (id, pass_code, session_id, result, festival_day, at, actor)
     VALUES ($1, $2, $3, 'admitted', $4, $5, $6)`,
    [newId(), pass.code, sessionId, sessionDay, scannedAt, actor],
  );
  return {
    result: 'admitted',
    pass_code: pass.code,
    holder_name: pass.holder_name,
    item_title: pass.title,
    session_id: sessionId,
    festival_day: sessionDay,
    scanned_at: toUtcIso(scannedAt),
  };
}

function statusReason(status: string): RefusalReason | null {
  if (status === 'transferred') return 'pass_transferred';
  if (status === 'refunded') return 'pass_refunded';
  if (status === 'voided') return 'pass_voided';
  return null;
}

/**
 * A full-festival pass admits to any pass session, a day pass to that day's pass sessions outside
 * the Planetarium Dome, and a seat pass only to its own session.
 */
function entitled(
  pass: PassLookup,
  sessionId: string,
  admission: 'pass' | 'seat',
  venueId: string,
  sessionDay: string,
): boolean {
  if (pass.kind === 'seat') return pass.line_session_id === sessionId;
  if (admission !== 'pass') return false;
  if (pass.kind === 'full_festival') return true;
  return pass.festival_day === sessionDay && venueId !== PLANETARIUM;
}

async function earlierAdmission(
  db: Queryable,
  pass: PassLookup,
  sessionId: string,
  sessionDay: string,
): Promise<Date | null> {
  const row =
    pass.kind === 'day'
      ? await one<{ at: Date }>(
          db,
          `SELECT at FROM scans WHERE pass_code = $1 AND result = 'admitted' AND festival_day = $2
           ORDER BY at LIMIT 1`,
          [pass.code, sessionDay],
        )
      : await one<{ at: Date }>(
          db,
          `SELECT at FROM scans WHERE pass_code = $1 AND result = 'admitted' AND session_id = $2
           ORDER BY at LIMIT 1`,
          [pass.code, sessionId],
        );
  return row?.at ?? null;
}

async function logRefusal(
  db: Queryable,
  passCode: string,
  sessionId: string,
  festivalDay: string,
  reason: RefusalReason,
  actor: string,
  firstAdmittedAt: Date | null = null,
): Promise<Refused> {
  await db.query(
    `INSERT INTO scans (id, pass_code, session_id, result, reason, festival_day, at, actor)
     VALUES ($1, $2, $3, 'refused', $4, $5, now(), $6)`,
    [newId(), passCode, sessionId, reason, festivalDay, actor],
  );
  return {
    result: 'refused',
    reason,
    first_admitted_at: firstAdmittedAt === null ? null : toUtcIso(firstAdmittedAt),
  };
}

export interface AdmissionsReport {
  festival_day: string;
  starts_at: string;
  ends_at: string;
  length_hours: number;
  venues: Array<{ venue_id: string; name: string; admissions: number }>;
  total: number;
}

export async function admissionsReport(
  db: Queryable,
  festivalDay: string,
): Promise<AdmissionsReport> {
  const venues = await many<{ venue_id: string; name: string; admissions: number }>(
    db,
    `SELECT v.id AS venue_id, v.name,
            COALESCE(COUNT(sc.id), 0)::int AS admissions
     FROM venues v
     LEFT JOIN programme_sessions s ON s.venue_id = v.id
     LEFT JOIN scans sc ON sc.session_id = s.id AND sc.result = 'admitted'
          AND sc.festival_day = $1::date
     GROUP BY v.id, v.name, v.position ORDER BY v.position, v.id`,
    [festivalDay],
  );
  return {
    festival_day: festivalDay,
    starts_at: toUtcIso(festivalDayStart(festivalDay)),
    ends_at: toUtcIso(festivalDayEnd(festivalDay)),
    length_hours: festivalDayLengthHours(festivalDay),
    venues,
    total: venues.reduce((sum, venue) => sum + venue.admissions, 0),
  };
}
