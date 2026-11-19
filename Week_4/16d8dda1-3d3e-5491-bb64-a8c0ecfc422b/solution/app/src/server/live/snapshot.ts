// The session snapshot: one shared base per push, personalised for each viewer.
import { isRunningState } from '../../shared/states';
import type { PollResult, PollView, Role, SessionSnapshot, SeatView } from '../../shared/wire';
import { one, pool, rows } from '../db';
import { remainingSeconds } from '../domain/breakout';
import { boardColumn, derivePlaces, tableIdOf } from '../domain/layout';
import { countsFrom } from '../domain/poll';
import { loadSession, type SessionRow } from '../records';
import { worldNow } from '../world';
import { isUp, readLive, type LiveData } from './valkey';

export interface Viewer {
  role: Role;
  learnerId: string | null;
}

interface PollRecord {
  id: string;
  question: string;
  options: string[];
  state: 'open' | 'closed';
  counts: number[] | null;
  results: PollResult[] | null;
  total: number | null;
}

export interface Base {
  session: SessionRow;
  live: LiveData;
  busUp: boolean;
  slides: string[];
  modelFileId: string | null;
  names: Map<string, string>;
  poll: PollRecord | null;
  nowMs: number;
}

const names = new Map<string, string>();
const lastSeen = new Map<string, Base>();

async function nameOf(ids: string[]): Promise<Map<string, string>> {
  const missing = ids.filter((id) => !names.has(id));
  if (missing.length > 0) {
    const found = await rows<{ id: string; display_name: string }>(pool, 'SELECT id, display_name FROM learners WHERE id = ANY($1)', [missing]);
    for (const learner of found) names.set(learner.id, learner.display_name);
  }
  return names;
}

function idleLive(session: SessionRow): LiveData {
  return {
    seats: session.state === 'ended' ? (session.final_seats ?? {}) : {},
    slide: session.current_slide,
    hands: [],
    locked: session.state === 'ended' ? false : session.locked,
    spotlight: null,
    breakout: null,
    pollCounts: {},
    answers: {},
  };
}

async function latestPoll(sessionId: string): Promise<PollRecord | null> {
  return one<PollRecord>(
    pool,
    `SELECT id, question, options, state, counts, results, total FROM polls
      WHERE session_id = $1 ORDER BY (state = 'open') DESC, created_seq DESC LIMIT 1`,
    [sessionId],
  );
}

export async function buildBase(sessionId: string): Promise<Base> {
  const session = await loadSession(sessionId);
  const [files, poll, nowMs] = await Promise.all([
    rows<{ id: string; kind: string }>(
      pool,
      "SELECT id, kind FROM lesson_files WHERE lesson_id = $1 AND status = 'confirmed' ORDER BY position, id",
      [session.lesson_id],
    ),
    latestPoll(sessionId),
    worldNow(session.world_id),
  ]);
  const slides = files.filter((file) => file.kind === 'slide').map((file) => file.id);
  const modelFileId = files.find((file) => file.kind === 'model')?.id ?? null;
  const running = isRunningState(session.state);

  let live = idleLive(session);
  let busUp = true;
  if (running) {
    if (isUp()) {
      try {
        live = await readLive(sessionId, poll?.state === 'open' ? poll.id : null);
      } catch {
        busUp = false;
      }
    } else {
      busUp = false;
    }
  }
  if (poll?.state === 'closed') {
    const answered = await rows<{ learner_id: string; option: number }>(pool, 'SELECT learner_id, option FROM poll_answers WHERE poll_id = $1', [poll.id]);
    live = { ...live, answers: Object.fromEntries(answered.map((row) => [row.learner_id, String(row.option)])) };
  }
  if (running && !busUp) {
    const seen = lastSeen.get(sessionId);
    if (seen) return { ...seen, busUp: false };
  }
  const ids = [...Object.values(live.seats), ...live.hands, ...Object.keys(live.breakout?.members ?? {})];
  if (live.spotlight) ids.push(live.spotlight);
  const base: Base = { session, live, busUp, slides, modelFileId, names: await nameOf(ids), poll, nowMs };
  if (running && busUp) lastSeen.set(sessionId, base);
  if (!running) lastSeen.delete(sessionId);
  return base;
}

function pollView(base: Base, viewer: Viewer): PollView | null {
  const { poll, live } = base;
  if (!poll) return null;
  const teaching = viewer.role !== 'learner';
  const yourAnswer = viewer.learnerId ? Number(live.answers[viewer.learnerId] ?? 0) || null : null;
  if (poll.state === 'closed') {
    return { pollId: poll.id, question: poll.question, options: poll.options, state: 'closed', counts: poll.counts, yourAnswer, results: poll.results, total: poll.total };
  }
  const counts = countsFrom(poll.options.length, live.pollCounts);
  return { pollId: poll.id, question: poll.question, options: poll.options, state: 'open', counts: teaching ? counts : null, yourAnswer, results: null, total: null };
}

export function snapshotFor(base: Base, viewer: Viewer): SessionSnapshot {
  const { session, live, slides } = base;
  const places = derivePlaces(session.layout);
  const raised = new Set(live.hands);
  const breakout = session.state === 'breakouts' ? live.breakout : null;
  const nameFor = (id: string): string => base.names.get(id) ?? '';
  const seats: SeatView[] = places.seats.map((seat) => {
    const learnerId = live.seats[seat.seatId] ?? null;
    return {
      seatId: seat.seatId,
      table: seat.table,
      row: seat.row,
      column: seat.column,
      learnerId,
      displayName: learnerId ? nameFor(learnerId) : null,
      hand: learnerId && raised.has(learnerId) ? 'raised' : 'down',
      breakoutTable: breakout && learnerId ? (breakout.members[learnerId] ?? null) : null,
    };
  });
  const total = slides.length;
  const current = total === 0 ? 0 : Math.min(Math.max(live.slide ?? session.current_slide, 1), total);
  const seatIndex = new Map(places.seats.map((seat, index) => [live.seats[seat.seatId] ?? '', index]));
  return {
    id: session.id,
    classId: session.class_id,
    lessonId: session.lesson_id,
    classTitle: session.title,
    state: session.state,
    timeZone: session.time_zone,
    startsAt: session.starts_local,
    endsAt: session.ends_local,
    startsAtUtc: new Date(session.starts_ms).toISOString(),
    endsAtUtc: new Date(session.ends_ms).toISOString(),
    slide: { current, total, fileId: slides[current - 1] ?? null },
    modelFileId: base.modelFileId,
    locked: live.locked,
    spotlight: live.spotlight,
    room: { columns: session.layout.columns, rows: session.layout.rows, boardColumn: boardColumn(session.layout) },
    seats,
    tables: places.tables.map((table) => ({ tableId: table.tableId, row: table.row, column: table.column })),
    hands: live.hands.map((learnerId) => ({ learnerId, displayName: nameFor(learnerId) })),
    poll: pollView(base, viewer),
    breakout: breakout
      ? {
          tables: Array.from({ length: breakout.tables }, (_, index) => {
            const tableId = tableIdOf(index);
            const learnerIds = Object.entries(breakout.members)
              .filter(([, table]) => table === tableId)
              .map(([learnerId]) => learnerId)
              .sort((a, b) => (seatIndex.get(a) ?? 0) - (seatIndex.get(b) ?? 0));
            return { tableId, learnerIds };
          }),
          remainingSeconds: remainingSeconds(breakout.deadlineMs, base.nowMs),
          warning: breakout.warning,
          totalSeconds: breakout.lengthSeconds,
        }
      : null,
    you: { role: viewer.role, learnerId: viewer.learnerId },
    live: base.busUp,
  };
}

export async function buildSnapshot(sessionId: string, viewer: Viewer): Promise<SessionSnapshot> {
  return snapshotFor(await buildBase(sessionId), viewer);
}
