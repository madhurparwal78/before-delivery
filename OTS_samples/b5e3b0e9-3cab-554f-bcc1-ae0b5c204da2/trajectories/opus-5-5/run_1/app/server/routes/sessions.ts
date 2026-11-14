import { timers } from '../config.js';
import { requireInstructor, requireUser, schoolOf, type User } from '../auth.js';
import { one, query } from '../db.js';
import { ApiError, type Ctx, fieldErrors, notFound, ok, parseRefusal, type Router, str } from '../http.js';
import { createSession, type LiveSession, POSITIONS, requireSession } from '../live.js';
import { sendMail } from '../mail.js';
import { buildCsv, buildReportPdf } from '../reports.js';
import { EVENT_KINDS, type EventKind, type Scenario } from '../sim/model.js';
import type { StripActionResult } from '../sim/engine.js';
import type { Debrief } from '../sim/score.js';
import { stripViews } from '../sim/view.js';
import { getObject, putObject, STORAGE_MESSAGES, StorageError, storageUnavailable } from '../storage.js';
import { aerodromeFor } from './library.js';
import type { Position } from '../../shared/types.js';

interface Access {
  user: User;
  session: LiveSession;
  instructor: boolean;
}

/** Signed in, and a member of the session's school: its instructor or a student of one of its classes. */
async function sessionAccess(ctx: Ctx): Promise<Access> {
  const user = await requireUser(ctx);
  const session = await requireSession(ctx.params.id!);
  const school = await schoolOf(user.id);
  if (school?.id === session.schoolId) return { user, session, instructor: true };
  const member = await one(
    'SELECT 1 FROM class_students cs JOIN classes c ON c.id = cs.class_id WHERE cs.user_id = $1 AND c.school_id = $2',
    [user.id, session.schoolId],
  );
  if (!member) throw notFound();
  return { user, session, instructor: false };
}

async function instructorAccess(ctx: Ctx): Promise<Access> {
  const access = await sessionAccess(ctx);
  if (!access.instructor) throw notFound();
  return access;
}

async function seatAccess(ctx: Ctx): Promise<Access & { position: Position }> {
  const access = await sessionAccess(ctx);
  const position = access.session.positionOf(access.user.id);
  if (!position) throw notFound();
  return { ...access, position };
}

/** The instructor and every student who held a seat in the session. */
async function debriefAccess(ctx: Ctx): Promise<Access> {
  const access = await sessionAccess(ctx);
  if (access.instructor) return access;
  const seated = await one('SELECT 1 FROM session_participants WHERE session_id = $1 AND user_id = $2', [
    access.session.id,
    access.user.id,
  ]);
  if (!seated) throw notFound();
  return access;
}

const pausedError = () => new ApiError(409, { error: 'paused', message: 'The exercise is paused.' });
const endedError = () => new ApiError(409, { error: 'ended', message: 'The exercise has ended.' });

function requireRunning(session: LiveSession): void {
  if (session.engine.state.status === 'ended') throw endedError();
  if (session.engine.state.status === 'paused') throw pausedError();
}

function requireNotEnded(session: LiveSession): void {
  if (session.engine.state.status === 'ended') throw endedError();
}

function rateLimit(session: LiveSession, position: Position): void {
  const now = Date.now();
  const recent = session.commandTimes[position].filter((at) => now - at < 60_000);
  if (recent.length >= timers.commandsPerMinute) {
    session.commandTimes[position] = recent;
    throw new ApiError(429, { error: 'rate_limited', message: 'Too many commands. Wait a moment.' });
  }
  recent.push(now);
  session.commandTimes[position] = recent;
}

function stripCopies(session: LiveSession, callsign: string) {
  return stripViews(session.engine).filter((strip) => strip.callsign === callsign);
}

/** The answer to a strip move or edit: the strip's copies as the server now has them, also on a version conflict. */
function stripReply(session: LiveSession, callsign: string, result: StripActionResult) {
  const strips = stripCopies(session, callsign);
  if (!result.ok) {
    if (result.conflict) throw new ApiError(409, { error: 'version_conflict', message: result.message, strips });
    throw parseRefusal(result.message);
  }
  return ok({ strip: strips.find((copy) => copy.state !== 'transferred') ?? null, strips });
}

function requireStrip(session: LiveSession, callsign: string): string {
  const upper = callsign.toUpperCase();
  if (!session.engine.state.strips[upper]) throw notFound();
  return upper;
}

async function history(sessionId: string, position: Position): Promise<string[]> {
  const rows = await query<{ text: string }>(
    'SELECT text FROM command_history WHERE session_id = $1 AND position = $2 ORDER BY id DESC LIMIT 50',
    [sessionId, position],
  );
  return rows.map((row) => row.text).reverse();
}

function requireEnded(session: LiveSession): void {
  if (session.engine.state.status !== 'ended') {
    throw new ApiError(409, { error: 'running', message: 'Debrief is ready when the exercise ends.' });
  }
}

export async function takeSeat(session: LiveSession, user: User, position: Position): Promise<void> {
  session.seats[position] = { userId: user.id, name: user.name };
  session.markSeatTaken(position);
  await query(
    `INSERT INTO session_participants (session_id, user_id, position) VALUES ($1, $2, $3)
     ON CONFLICT (session_id, user_id) DO UPDATE SET position = EXCLUDED.position`,
    [session.id, user.id, position],
  );
}

export async function resolveScenario(schoolId: string, scenarioId: string, assignmentId: string | null) {
  const row = await one<{ id: string; data: Scenario }>('SELECT id, data FROM scenarios WHERE id = $1 AND school_id = $2', [
    scenarioId,
    schoolId,
  ]);
  if (!row) throw notFound();
  if (assignmentId) {
    const assignment = await one(
      'SELECT 1 FROM assignments a JOIN classes c ON c.id = a.class_id WHERE a.id = $1 AND c.school_id = $2',
      [assignmentId, schoolId],
    );
    if (!assignment) throw notFound();
  }
  const aerodrome = await aerodromeFor(schoolId, row.data.aerodrome);
  return { scenario: row.data, aerodrome };
}

const REPORT_KINDS = { csv: { type: 'text/csv; charset=utf-8', label: 'CSV' }, pdf: { type: 'application/pdf', label: 'PDF' } };

const reportLocks = new Map<string, Promise<unknown>>();

async function exportReport(ctx: Ctx, kind: 'csv' | 'pdf') {
  const { user, session } = await debriefAccess(ctx);
  requireEnded(session);
  const lockKey = `${session.id}:${kind}`;
  const previous = reportLocks.get(lockKey) ?? Promise.resolve();
  const work = previous.catch(() => undefined).then(async () => {
    const key = `reports/${session.id}/report.${kind}`;
    const existing = await one('SELECT 1 FROM reports WHERE session_id = $1 AND kind = $2', [session.id, kind]);
    try {
      if (existing) {
        const stored = await getObject(key);
        if (stored) return { bytes: stored, notice: 'repeat' };
      }
      const bytes = kind === 'csv' ? buildCsv(session) : buildReportPdf(session);
      await putObject(key, bytes);
      if (existing) return { bytes, notice: 'repeat' };
      await query('INSERT INTO reports (session_id, kind, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [
        session.id,
        kind,
        user.id,
      ]);
      let notice = 'sent';
      try {
        await sendMail(
          user.email,
          `Report ready: ${session.row.scenario.name}`,
          `Your ${REPORT_KINDS[kind].label} report for ${session.row.scenario.name} is saved and ready to download.\n`,
        );
      } catch {
        notice = 'not-sent';
      }
      return { bytes, notice };
    } catch (error) {
      if (error instanceof StorageError) throw storageUnavailable(STORAGE_MESSAGES.report);
      throw error;
    }
  });
  reportLocks.set(lockKey, work);
  const { bytes, notice } = await work;
  return {
    status: 200,
    body: bytes,
    headers: {
      'Content-Type': REPORT_KINDS[kind].type,
      'Content-Disposition': `attachment; filename="report.${kind}"`,
      'X-Report-Notice': notice,
    },
  };
}

export function registerSessionRoutes(router: Router): void {
  router.add('POST', '/api/sessions', async (ctx) => {
    const { school } = await requireInstructor(ctx);
    const body = await ctx.json();
    const assignmentId = str(body, 'assignment') || null;
    const { scenario, aerodrome } = await resolveScenario(school.id, str(body, 'scenario'), assignmentId);
    const session = await createSession({
      schoolId: school.id,
      scenarioId: str(body, 'scenario'),
      assignmentId,
      scenario,
      aerodromeName: aerodrome.name,
      layout: aerodrome.layout,
      firstTime: null,
    });
    return ok({ id: session.id }, 201);
  });

  router.add('GET', '/api/sessions/:id/state', async (ctx) => {
    const { user, session, instructor } = await sessionAccess(ctx);
    const position = session.positionOf(user.id);
    const state = await session.run(() => session.view(), 'none');
    return ok({
      ...state,
      you: { id: user.id, instructor, position },
      history: position ? await history(session.id, position) : [],
    });
  });

  router.add('POST', '/api/sessions/:id/seats', async (ctx) => {
    const { user, session } = await sessionAccess(ctx);
    const body = await ctx.json();
    return session.run(async () => {
      requireNotEnded(session);
      const position = str(body, 'position') as Position;
      if (!POSITIONS.includes(position)) throw fieldErrors({ position: 'Position must be GND or TWR.' });
      const held = session.positionOf(user.id);
      if (held && held !== position) {
        throw new ApiError(409, { error: 'seat_held', message: 'You already hold a seat in this exercise.' });
      }
      if (held === position) return ok({ position });
      if (session.seats[position]) throw new ApiError(409, { error: 'seat_taken', message: 'This seat is taken.' });
      await takeSeat(session, user, position);
      return ok({ position });
    });
  });

  router.add('DELETE', '/api/sessions/:id/seats/:position', async (ctx) => {
    const { session } = await instructorAccess(ctx);
    const position = ctx.params.position as Position;
    if (!POSITIONS.includes(position)) throw notFound();
    return session.run(() => {
      requireNotEnded(session);
      const seat = session.seatView(position);
      if (!seat) return { status: 204 };
      if (!seat.graceEnded) throw new ApiError(409, { error: 'seat_in_use', message: 'This seat is still in use.' });
      session.seats[position] = null;
      return { status: 204 };
    });
  });

  router.add('POST', '/api/sessions/:id/commands', async (ctx) => {
    const { session, position } = await seatAccess(ctx);
    const body = await ctx.json();
    const text = str(body, 'text');
    if (text.trim()) {
      await query('INSERT INTO command_history (session_id, position, text) VALUES ($1, $2, $3)', [session.id, position, text]);
    }
    rateLimit(session, position);
    return session.run(() => {
      requireRunning(session);
      const result = session.engine.command(position, text);
      if (!result.ok) throw parseRefusal(result.message);
      return ok({ readback: result.readback, alerts: result.alerts, strips: stripCopies(session, result.callsign) });
    });
  });

  router.add('POST', '/api/sessions/:id/preview', async (ctx) => {
    const { session, position } = await seatAccess(ctx);
    const text = str(await ctx.json(), 'text');
    return session.run(() => ok(session.engine.preview(position, text)), 'none');
  });

  router.add('POST', '/api/sessions/:id/strips/:callsign/move', async (ctx) => {
    const { session, position } = await seatAccess(ctx);
    const callsign = requireStrip(session, ctx.params.callsign!);
    rateLimit(session, position);
    const body = await ctx.json();
    return session.run(() => {
      requireRunning(session);
      const errors: Record<string, string> = {};
      if (typeof body.to !== 'string') errors.to = 'Choose a bay.';
      if (!Number.isInteger(body.version)) errors.version = 'Version is required.';
      if (Object.keys(errors).length > 0) throw fieldErrors(errors);
      return stripReply(session, callsign, session.engine.move(position, callsign, body.to as string, body.version as number));
    });
  });

  router.add('PATCH', '/api/sessions/:id/strips/:callsign', async (ctx) => {
    const { session, position } = await seatAccess(ctx);
    const callsign = requireStrip(session, ctx.params.callsign!);
    const body = await ctx.json();
    return session.run(() => {
      requireRunning(session);
      const errors: Record<string, string> = {};
      if (typeof body.holdingPoint !== 'string') errors.holdingPoint = 'Enter a holding point.';
      if (typeof body.remarks !== 'string') errors.remarks = 'Enter remarks.';
      if (!Number.isInteger(body.version)) errors.version = 'Version is required.';
      if (Object.keys(errors).length > 0) throw fieldErrors(errors);
      const result = session.engine.edit(position, callsign, body.holdingPoint as string, body.remarks as string, body.version as number);
      return stripReply(session, callsign, result);
    });
  });

  router.add('POST', '/api/sessions/:id/events', async (ctx) => {
    const { session } = await instructorAccess(ctx);
    const body = await ctx.json();
    return session.run(() => {
      requireNotEnded(session);
      const kind = str(body, 'kind') as EventKind;
      if (!EVENT_KINDS.includes(kind)) throw fieldErrors({ kind: 'Choose an event.' });
      if (kind === 'wind') {
        const errors: Record<string, string> = {};
        const dir = body.windDir;
        const kt = body.windKt;
        if (typeof dir !== 'number' || !Number.isInteger(dir) || dir < 0 || dir > 360) errors.windDir = 'Wind direction must be 0 to 360.';
        if (typeof kt !== 'number' || !Number.isInteger(kt) || kt < 0) errors.windKt = 'Wind speed must be a whole number of knots.';
        if (Object.keys(errors).length > 0) throw fieldErrors(errors);
      }
      const result = session.engine.inject({
        kind,
        callsign: str(body, 'callsign'),
        windDir: body.windDir as number,
        windKt: body.windKt as number,
      });
      if (!result.ok) throw new ApiError(422, { error: result.error, message: result.message });
      return ok({ ok: true });
    });
  });

  const clockControl = (path: string, change: (session: LiveSession, body: Record<string, unknown>) => void) => {
    router.add('POST', `/api/sessions/:id/${path}`, async (ctx) => {
      const { session } = await instructorAccess(ctx);
      const body = await ctx.json();
      return session.run(() => {
        requireNotEnded(session);
        change(session, body);
        return ok({ status: session.engine.state.status, speed: session.engine.state.speed });
      });
    });
  };
  clockControl('pause', (session) => {
    session.engine.state.status = 'paused';
  });
  clockControl('resume', (session) => {
    session.engine.state.status = 'running';
  });
  clockControl('speed', (session, body) => {
    const speed = body.speed;
    if (speed !== 1 && speed !== 2 && speed !== 4) throw fieldErrors({ speed: 'Speed must be 1, 2 or 4.' });
    session.engine.state.speed = speed;
  });

  router.add('POST', '/api/sessions/:id/end', async (ctx) => {
    const { session } = await instructorAccess(ctx);
    return session.run(() => {
      session.engine.end();
      return ok({ status: 'ended' });
    });
  });

  router.add('POST', '/api/sessions/:id/notes', async (ctx) => {
    const { session } = await instructorAccess(ctx);
    const body = await ctx.json();
    return session.run(() => {
      requireNotEnded(session);
      const text = str(body, 'text').trim();
      if (!text) throw fieldErrors({ text: 'Enter a note.' });
      session.engine.log('INS', 'note', text, null);
      return ok({ ok: true }, 201);
    });
  });

  router.add('GET', '/api/sessions/:id/debrief', async (ctx) => {
    const { session } = await debriefAccess(ctx);
    requireEnded(session);
    const row = await one<{ debrief: Debrief }>('SELECT debrief FROM sim_sessions WHERE id = $1', [session.id]);
    const state = session.engine.state;
    return ok({
      ...row!.debrief,
      scenarioName: session.row.scenario.name,
      aerodromeName: session.row.aerodrome_name,
      length: (state.endTime ?? state.now) - state.firstTime,
      firstTime: state.firstTime,
      layout: session.row.layout,
    });
  });

  router.add('GET', '/api/sessions/:id/replay', async (ctx) => {
    const { session } = await debriefAccess(ctx);
    requireEnded(session);
    const state = session.engine.state;
    const length = (state.endTime ?? state.now) - state.firstTime;
    const requested = Number(ctx.query.get('t') ?? '0');
    const t = Number.isFinite(requested) ? Math.max(0, Math.min(length, Math.floor(requested))) : 0;
    const row = await one<{ snapshot: unknown }>(
      'SELECT snapshot FROM session_seconds WHERE session_id = $1 AND t <= $2 ORDER BY t DESC LIMIT 1',
      [session.id, t],
    );
    return ok(row!.snapshot);
  });

  router.add('GET', '/api/sessions/:id/report.csv', (ctx) => exportReport(ctx, 'csv'));
  router.add('GET', '/api/sessions/:id/report.pdf', (ctx) => exportReport(ctx, 'pdf'));
}
