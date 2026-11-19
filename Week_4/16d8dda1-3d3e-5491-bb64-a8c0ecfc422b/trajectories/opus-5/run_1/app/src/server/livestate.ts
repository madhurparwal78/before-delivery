import type {
  SessionSnapshot,
  SnapshotBreakout,
  SnapshotPoll,
  SnapshotSeat,
  ViewerRole
} from '../shared/types.js';
import { compareSeatIds } from '../shared/rules.js';
import type { ClassRecord, SessionRecord } from './access.js';
import { config } from './config.js';
import { query, queryOne } from './db.js';
import { ApiError, errors } from './http.js';
import { derivePlan } from './domain/layout.js';
import { worldNow } from './clock.js';
import { bus, claimSeat, keys, raiseHand, sessionKeys } from './valkey.js';
import { toUtcIso } from './timezone.js';

export interface BreakoutRound {
  roundId: string;
  tables: number;
  deadline: Date;
  lengthSeconds: number;
  warning: boolean;
  members: Map<string, string>;
}

export interface LiveState {
  seats: Map<string, string>;
  slide: number;
  hands: string[];
  locked: boolean;
  spotlight: string | null;
  breakout: BreakoutRound | null;
  pollCounts: Map<string, number[]>;
  live: boolean;
}

export interface PollRecord {
  id: string;
  session_id: string;
  question: string;
  options: string[];
  state: 'open' | 'closed';
  total: number | null;
}

const lastSeen = new Map<string, LiveState>();

export async function liveOp<Result>(run: () => Promise<Result>): Promise<Result> {
  if (!bus.available()) throw errors.livePaused();
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (!bus.available()) throw errors.livePaused();
    throw error;
  }
}

export function requireLiveBus(): void {
  if (!bus.available()) throw errors.livePaused();
}

async function runningRound(sessionId: string): Promise<{
  id: string;
  tables: number;
  deadline: Date;
  length_seconds: number;
  warned: boolean;
} | null> {
  return queryOne(
    `SELECT id, tables, deadline, length_seconds, warned
       FROM breakout_rounds
      WHERE session_id = $1 AND ended_at IS NULL
      ORDER BY started_at DESC LIMIT 1`,
    [sessionId]
  );
}

async function durableState(session: SessionRecord): Promise<LiveState> {
  const seatRows = await query<{ seat_id: string; learner_id: string }>(
    'SELECT seat_id, learner_id FROM session_seats WHERE session_id = $1',
    [session.id]
  );
  const handRows = await query<{ learner_id: string }>(
    'SELECT learner_id FROM session_hands WHERE session_id = $1 ORDER BY raised_at ASC',
    [session.id]
  );
  const round = await runningRound(session.id);
  let breakout: BreakoutRound | null = null;
  if (round !== null) {
    const members = await query<{ learner_id: string; table_id: string }>(
      'SELECT learner_id, table_id FROM breakout_members WHERE round_id = $1',
      [round.id]
    );
    breakout = {
      roundId: round.id,
      tables: round.tables,
      deadline: round.deadline,
      lengthSeconds: round.length_seconds,
      warning: round.warned,
      members: new Map(members.map((row) => [row.learner_id, row.table_id]))
    };
  }
  const pollCounts = new Map<string, number[]>();
  const polls = await query<{ id: string; options: string[] }>('SELECT id, options FROM polls WHERE session_id = $1', [
    session.id
  ]);
  for (const poll of polls) {
    const answers = await query<{ option: number; count: number }>(
      'SELECT option, COUNT(*)::int AS count FROM poll_answers WHERE poll_id = $1 GROUP BY option',
      [poll.id]
    );
    const counts = poll.options.map(() => 0);
    for (const row of answers) counts[row.option - 1] = row.count;
    pollCounts.set(poll.id, counts);
  }
  return {
    seats: new Map(seatRows.map((row) => [row.seat_id, row.learner_id])),
    slide: session.current_slide,
    hands: handRows.map((row) => row.learner_id),
    locked: session.locked,
    spotlight: session.spotlight,
    breakout,
    pollCounts,
    live: true
  };
}

async function hydrate(session: SessionRecord, state: LiveState): Promise<void> {
  const client = bus.client();
  const fresh = await client.set(keys.ready(session.id), '1', 'NX');
  if (fresh !== 'OK') return;
  const pipeline = client.multi();
  pipeline.set(keys.slide(session.id), String(state.slide));
  pipeline.hset(keys.flags(session.id), { locked: state.locked ? '1' : '0', spotlight: state.spotlight ?? '' });
  if (state.seats.size > 0) {
    const seats: Record<string, string> = {};
    const seatOf: Record<string, string> = {};
    for (const [seatId, learnerId] of state.seats) {
      seats[seatId] = learnerId;
      seatOf[learnerId] = seatId;
    }
    pipeline.hset(keys.seats(session.id), seats);
    pipeline.hset(keys.seatOf(session.id), seatOf);
  }
  if (state.hands.length > 0) pipeline.rpush(keys.hands(session.id), ...state.hands);
  if (state.breakout !== null) {
    pipeline.hset(keys.breakout(session.id), {
      deadline: state.breakout.deadline.toISOString(),
      tables: String(state.breakout.tables)
    });
    if (state.breakout.members.size > 0) {
      pipeline.hset(keys.breakoutMembers(session.id), Object.fromEntries(state.breakout.members));
    }
  }
  for (const [pollId, counts] of state.pollCounts) {
    const hash: Record<string, string> = {};
    counts.forEach((count, index) => {
      hash[String(index + 1)] = String(count);
    });
    pipeline.hset(keys.poll(session.id, pollId), hash);
  }
  await pipeline.exec();
}

/** Valkey holds the live state; a session's keys are filled from the record on first touch. */
export async function ensureHydrated(session: SessionRecord): Promise<void> {
  if (!bus.available()) return;
  await hydrate(session, await durableState(session));
}

export async function readLive(session: SessionRecord): Promise<LiveState> {
  if (session.state === 'ended') return { ...(await durableState(session)), live: bus.available() };
  if (!bus.available()) {
    const cached = lastSeen.get(session.id);
    if (cached !== undefined) return { ...cached, live: false };
    return { ...(await durableState(session)), live: false };
  }
  const durable = await durableState(session);
  await hydrate(session, durable);
  const client = bus.client();
  const pollIds = [...durable.pollCounts.keys()];
  const pipeline = client.multi();
  pipeline.hgetall(keys.seats(session.id));
  pipeline.get(keys.slide(session.id));
  pipeline.lrange(keys.hands(session.id), 0, -1);
  pipeline.hgetall(keys.flags(session.id));
  pipeline.hgetall(keys.breakoutMembers(session.id));
  for (const pollId of pollIds) pipeline.hgetall(keys.poll(session.id, pollId));
  const results = await pipeline.exec();
  if (results === null) return { ...durable, live: true };
  const value = <Value>(index: number): Value | null => {
    const entry = results[index];
    if (entry === undefined || entry[0] !== null) return null;
    return entry[1] as Value;
  };
  const seatsHash = value<Record<string, string>>(0) ?? {};
  const slide = value<string | null>(1);
  const hands = value<string[]>(2) ?? [];
  const flags = value<Record<string, string>>(3) ?? {};
  const members = value<Record<string, string>>(4) ?? {};
  const pollCounts = new Map<string, number[]>();
  pollIds.forEach((pollId, index) => {
    const hash = value<Record<string, string>>(5 + index) ?? {};
    const options = durable.pollCounts.get(pollId) ?? [];
    pollCounts.set(
      pollId,
      options.map((fallback, optionIndex) => {
        const raw = hash[String(optionIndex + 1)];
        return raw === undefined ? fallback : Number(raw);
      })
    );
  });
  const state: LiveState = {
    seats: new Map(Object.entries(seatsHash)),
    slide: slide === null ? durable.slide : Number(slide),
    hands,
    locked: flags.locked === '1',
    spotlight: flags.spotlight === undefined || flags.spotlight === '' ? null : flags.spotlight,
    breakout:
      durable.breakout === null
        ? null
        : { ...durable.breakout, members: new Map(Object.entries(members)) },
    pollCounts,
    live: true
  };
  lastSeen.set(session.id, state);
  return state;
}

export interface SnapshotContext {
  session: SessionRecord;
  cls: ClassRecord;
  state: LiveState;
  names: Map<string, string>;
  slideIds: string[];
  modelFileId: string | null;
  poll: PollRecord | null;
  answers: Map<string, number>;
  now: Date;
}

export async function prepareSnapshot(session: SessionRecord, cls: ClassRecord): Promise<SnapshotContext> {
  const state = await readLive(session);
  const now = await worldNow(session.world_id);
  const files = await query<{ id: string; kind: string }>(
    `SELECT id, kind FROM lesson_files
      WHERE lesson_id = $1 AND status = 'confirmed'
      ORDER BY kind DESC, position ASC, created_at ASC`,
    [session.lesson_id]
  );
  const slideIds = files.filter((file) => file.kind === 'slide').map((file) => file.id);
  const modelFileId = files.find((file) => file.kind === 'model')?.id ?? null;
  const poll = await queryOne<PollRecord>(
    `SELECT id, session_id, question, options, state, total FROM polls
      WHERE session_id = $1
      ORDER BY (state = 'open') DESC, position DESC LIMIT 1`,
    [session.id]
  );
  const answers = new Map<string, number>();
  if (poll !== null) {
    const rows = await query<{ learner_id: string; option: number }>(
      'SELECT learner_id, option FROM poll_answers WHERE poll_id = $1',
      [poll.id]
    );
    for (const row of rows) answers.set(row.learner_id, row.option);
  }
  const rosterNames = await query<{ id: string; display_name: string }>(
    `SELECT l.id, l.display_name FROM learners l
       JOIN session_learners sl ON sl.learner_id = l.id
      WHERE sl.session_id = $1`,
    [session.id]
  );
  return {
    session,
    cls,
    state,
    names: new Map(rosterNames.map((row) => [row.id, row.display_name])),
    slideIds,
    modelFileId,
    poll,
    answers,
    now
  };
}

export function remainingSeconds(round: BreakoutRound, now: Date): number {
  return Math.max(0, Math.ceil((round.deadline.getTime() - now.getTime()) / 1_000));
}

export function renderSnapshot(context: SnapshotContext, viewer: { role: ViewerRole; learnerId: string | null }): SessionSnapshot {
  const { session, cls, state } = context;
  const plan = derivePlan(cls.layout);
  const seatOf = new Map<string, string>();
  for (const [seatId, learnerId] of state.seats) seatOf.set(learnerId, seatId);
  const handSet = new Set(state.hands);

  const seats: SnapshotSeat[] = plan.seats
    .map((seat) => {
      const learnerId = state.seats.get(seat.seatId) ?? null;
      return {
        ...seat,
        learnerId,
        displayName: learnerId === null ? null : context.names.get(learnerId) ?? null,
        hand: learnerId !== null && handSet.has(learnerId) ? ('raised' as const) : ('down' as const),
        breakoutTable: learnerId === null ? null : state.breakout?.members.get(learnerId) ?? null
      };
    })
    .sort((a, b) => compareSeatIds(a.seatId, b.seatId));

  const total = context.slideIds.length;
  const current = total === 0 ? 0 : Math.min(Math.max(1, state.slide), total);
  const fileId = current === 0 ? null : context.slideIds[current - 1] ?? null;

  let poll: SnapshotPoll | null = null;
  if (context.poll !== null) {
    const counts = state.pollCounts.get(context.poll.id) ?? context.poll.options.map(() => 0);
    const open = context.poll.state === 'open';
    poll = {
      pollId: context.poll.id,
      question: context.poll.question,
      options: context.poll.options,
      state: context.poll.state,
      counts: open && viewer.role === 'learner' ? null : counts,
      yourAnswer: viewer.learnerId === null ? null : context.answers.get(viewer.learnerId) ?? null
    };
  }

  let breakout: SnapshotBreakout | null = null;
  if (session.state === 'breakouts' && state.breakout !== null) {
    const round = state.breakout;
    const tables: { tableId: string; learnerIds: string[] }[] = [];
    for (let index = 0; index < round.tables; index += 1) tables.push({ tableId: `T${index + 1}`, learnerIds: [] });
    const dealt = [...round.members.entries()].sort((a, b) => {
      const seatA = seatOf.get(a[0]) ?? '';
      const seatB = seatOf.get(b[0]) ?? '';
      return compareSeatIds(seatA, seatB);
    });
    for (const [learnerId, tableId] of dealt) {
      tables.find((table) => table.tableId === tableId)?.learnerIds.push(learnerId);
    }
    breakout = {
      tables,
      remainingSeconds: remainingSeconds(round, context.now),
      warning: round.warning,
      lengthSeconds: round.lengthSeconds
    };
  }

  return {
    id: session.id,
    classId: cls.id,
    classTitle: cls.title,
    lessonId: session.lesson_id,
    state: session.state,
    timeZone: cls.time_zone,
    startsAt: session.starts_at_local,
    endsAt: session.ends_at_local,
    startsAtUtc: toUtcIso(session.starts_at),
    endsAtUtc: toUtcIso(session.ends_at),
    slide: { current, total, fileId },
    modelFileId: context.modelFileId,
    locked: state.locked,
    spotlight: state.spotlight,
    seats,
    tables: plan.tables,
    hands: state.hands.map((learnerId) => ({
      learnerId,
      displayName: context.names.get(learnerId) ?? ''
    })),
    poll,
    breakout,
    you: { role: viewer.role, learnerId: viewer.learnerId },
    live: state.live
  };
}

export async function snapshotFor(
  session: SessionRecord,
  cls: ClassRecord,
  viewer: { role: ViewerRole; learnerId: string | null }
): Promise<SessionSnapshot> {
  const context = await prepareSnapshot(session, cls);
  return renderSnapshot(context, viewer);
}

/* Live writes: Valkey decides, Postgres keeps the durable record. */

export async function setSlide(session: SessionRecord, slide: number): Promise<void> {
  await liveOp(async () => {
    await bus.client().set(keys.slide(session.id), String(slide));
  });
  await query('UPDATE sessions SET current_slide = $2 WHERE id = $1', [session.id, slide]);
}

export async function takeSeat(
  session: SessionRecord,
  learnerId: string,
  seatId: string
): Promise<{ won: boolean; holder: string | null }> {
  await liveOp(() => ensureHydrated(session));
  const result = await liveOp(() => claimSeat(session.id, seatId, learnerId));
  if (!result.won) return { won: false, holder: result.holder };
  await query('DELETE FROM session_seats WHERE session_id = $1 AND learner_id = $2', [session.id, learnerId]);
  await query(
    `INSERT INTO session_seats (session_id, seat_id, learner_id) VALUES ($1, $2, $3)
       ON CONFLICT (session_id, seat_id) DO UPDATE SET learner_id = $3`,
    [session.id, seatId, learnerId]
  );
  return { won: true, holder: learnerId };
}

export async function leaveSeat(session: SessionRecord, learnerId: string): Promise<void> {
  await liveOp(() => ensureHydrated(session));
  await liveOp(async () => {
    const client = bus.client();
    const seatId = await client.hget(keys.seatOf(session.id), learnerId);
    const pipeline = client.multi();
    if (seatId !== null) pipeline.hdel(keys.seats(session.id), seatId);
    pipeline.hdel(keys.seatOf(session.id), learnerId);
    await pipeline.exec();
  });
  await query('DELETE FROM session_seats WHERE session_id = $1 AND learner_id = $2', [session.id, learnerId]);
}

export async function setHand(session: SessionRecord, learnerId: string, raised: boolean): Promise<boolean> {
  await liveOp(() => ensureHydrated(session));
  if (raised) {
    const added = await liveOp(() => raiseHand(session.id, learnerId));
    if (!added) return false;
    await query(
      `INSERT INTO session_hands (session_id, learner_id, raised_at) VALUES ($1, $2, $3)
         ON CONFLICT (session_id, learner_id) DO NOTHING`,
      [session.id, learnerId, Date.now()]
    );
    return true;
  }
  const removed = await liveOp(async () => bus.client().lrem(keys.hands(session.id), 0, learnerId));
  await query('DELETE FROM session_hands WHERE session_id = $1 AND learner_id = $2', [session.id, learnerId]);
  return removed > 0;
}

export async function takeNextHand(session: SessionRecord): Promise<string | null> {
  await liveOp(() => ensureHydrated(session));
  const learnerId = await liveOp(async () => bus.client().lpop(keys.hands(session.id)));
  if (learnerId === null) return null;
  await query('DELETE FROM session_hands WHERE session_id = $1 AND learner_id = $2', [session.id, learnerId]);
  await query('UPDATE sessions SET hands_taken = hands_taken + 1 WHERE id = $1', [session.id]);
  return learnerId;
}

export async function setLocked(session: SessionRecord, locked: boolean): Promise<void> {
  await liveOp(async () => {
    await bus.client().hset(keys.flags(session.id), 'locked', locked ? '1' : '0');
  });
  await query('UPDATE sessions SET locked = $2 WHERE id = $1', [session.id, locked]);
}

export async function setSpotlight(session: SessionRecord, learnerId: string | null): Promise<void> {
  await liveOp(async () => {
    await bus.client().hset(keys.flags(session.id), 'spotlight', learnerId ?? '');
  });
  await query('UPDATE sessions SET spotlight = $2 WHERE id = $1', [session.id, learnerId]);
}

export async function writeBreakoutKeys(
  sessionId: string,
  deadline: Date,
  tables: number,
  members: Map<string, string>
): Promise<void> {
  await liveOp(async () => {
    const client = bus.client();
    const pipeline = client.multi();
    pipeline.hset(keys.breakout(sessionId), { deadline: deadline.toISOString(), tables: String(tables) });
    pipeline.del(keys.breakoutMembers(sessionId));
    if (members.size > 0) pipeline.hset(keys.breakoutMembers(sessionId), Object.fromEntries(members));
    await pipeline.exec();
  });
}

export async function clearBreakoutKeys(sessionId: string): Promise<void> {
  await liveOp(async () => {
    const pipeline = bus.client().multi();
    pipeline.del(keys.breakout(sessionId));
    pipeline.del(keys.breakoutMembers(sessionId));
    await pipeline.exec();
  });
}

export async function setBreakoutDeadline(sessionId: string, deadline: Date): Promise<void> {
  await liveOp(async () => {
    await bus.client().hset(keys.breakout(sessionId), 'deadline', deadline.toISOString());
  });
}

export async function applyPollAnswer(
  session: SessionRecord,
  pollId: string,
  option: number,
  previous: number | null
): Promise<void> {
  await liveOp(() => ensureHydrated(session));
  await liveOp(async () => {
    const pipeline = bus.client().multi();
    pipeline.hincrby(keys.poll(session.id, pollId), String(option), 1);
    if (previous !== null && previous !== option) {
      pipeline.hincrby(keys.poll(session.id, pollId), String(previous), -1);
    }
    await pipeline.exec();
  });
}

export async function initPollCounts(session: SessionRecord, pollId: string, options: number): Promise<void> {
  await liveOp(async () => {
    const hash: Record<string, string> = {};
    for (let index = 1; index <= options; index += 1) hash[String(index)] = '0';
    await bus.client().hset(keys.poll(session.id, pollId), hash);
  });
}

export async function readPollCounts(session: SessionRecord, pollId: string, options: number): Promise<number[]> {
  const hash = await liveOp(async () => bus.client().hgetall(keys.poll(session.id, pollId)));
  const counts: number[] = [];
  for (let index = 1; index <= options; index += 1) counts.push(Number(hash[String(index)] ?? '0'));
  return counts;
}

export async function markOnline(sessionId: string, learnerId: string, online: boolean): Promise<void> {
  if (!bus.available()) return;
  try {
    const client = bus.client();
    if (online) await client.sadd(keys.online(sessionId), learnerId);
    else await client.srem(keys.online(sessionId), learnerId);
  } catch {
    /* the bus is down; presence stays in Postgres until it returns */
  }
}

export async function beatHeartbeat(sessionId: string): Promise<void> {
  if (!bus.available()) return;
  try {
    await bus.client().set(keys.heartbeat(sessionId, config.instanceName), '1', 'EX', 30);
  } catch {
    /* the bus is down; the heartbeat resumes when it returns */
  }
}

export async function dropSessionKeys(sessionId: string): Promise<void> {
  lastSeen.delete(sessionId);
  if (!bus.available()) return;
  const polls = await query<{ id: string }>('SELECT id FROM polls WHERE session_id = $1', [sessionId]);
  try {
    await bus.client().del(...sessionKeys(sessionId, polls.map((poll) => poll.id)));
  } catch {
    /* the keys expire with the bus's own recovery */
  }
}
