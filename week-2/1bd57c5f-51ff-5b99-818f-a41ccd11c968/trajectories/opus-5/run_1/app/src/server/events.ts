import type { ServerResponse } from 'node:http';
import type { Trade } from '../shared/domain.js';
import { notifyJob, onJobNotice, type Queryable, db, withTransaction } from './db.js';
import { config } from './env.js';
import { computeCosts } from './costs.js';
import { projectJob } from './jobview.js';
import {
  jobProgress,
  loadItems,
  loadJob,
  loadMembers,
  loadNote,
  loadRooms,
  projectItem,
  projectNote,
  projectRoom,
  roomCounts,
  type ItemRecord,
  type Viewer,
} from './model.js';
import { allOccurrences, projectVisit } from './visits.js';
import { resolveSession } from './auth.js';

export type StoredEvent =
  | {
      type: 'item';
      item: Record<string, unknown>;
      trade: Trade | null;
      prev_trade: Trade | null;
    }
  | { type: 'item_deleted'; id: string; number: number; trade: Trade | null }
  | { type: 'room'; room_id: string }
  | { type: 'counts' }
  | { type: 'note'; item_id: string; note_id: string; item_trade: Trade | null; audience: 'crew' | 'everyone' }
  | { type: 'plan'; revision: number }
  | { type: 'visit'; visit_id: string; member_person_id: string }
  | { type: 'visit_deleted'; id: string; member_person_id: string }
  | { type: 'costs' }
  | { type: 'job' }
  | { type: 'role_ended'; person_id: string };

const OWNER_VIEWER: Viewer = {
  personId: '',
  role: 'owner',
  trade: null,
  memberId: null,
  name: '',
};

export function ownerViewer(): Viewer {
  return OWNER_VIEWER;
}

/** Every write that produces events locks the job row, so sequence numbers follow commit order. */
export async function lockJob(tx: Queryable, jobId: string): Promise<void> {
  await tx.query(`select id from jobs where id = $1 for update`, [jobId]);
}

export async function appendEvent(
  tx: Queryable,
  jobId: string,
  event: StoredEvent,
): Promise<number> {
  const { rows } = await tx.query(
    `update jobs set event_seq = event_seq + 1 where id = $1 returning event_seq`,
    [jobId],
  );
  const seq = Number(rows[0].event_seq);
  await tx.query(
    `insert into events (job_id, seq, type, payload, created_at) values ($1, $2, $3, $4, now())`,
    [jobId, seq, event.type, JSON.stringify(event)],
  );
  await tx.query(`delete from events where job_id = $1 and seq <= $2`, [
    jobId,
    seq - config.eventRetentionCount,
  ]);
  return seq;
}

export async function emitItem(
  tx: Queryable,
  jobId: string,
  item: ItemRecord,
  prevTrade: Trade | null,
): Promise<void> {
  await appendEvent(tx, jobId, {
    type: 'item',
    item: projectItem(item, OWNER_VIEWER),
    trade: item.trade,
    prev_trade: prevTrade,
  });
}

export async function emitItemDeleted(
  tx: Queryable,
  jobId: string,
  item: { id: string; number: number; trade: Trade | null },
): Promise<void> {
  await appendEvent(tx, jobId, {
    type: 'item_deleted',
    id: item.id,
    number: item.number,
    trade: item.trade,
  });
}

export async function emitRoom(tx: Queryable, jobId: string, roomId: string): Promise<void> {
  await appendEvent(tx, jobId, { type: 'room', room_id: roomId });
}

export async function emitPlan(tx: Queryable, jobId: string, revision: number): Promise<void> {
  await appendEvent(tx, jobId, { type: 'plan', revision });
}

export async function emitNote(
  tx: Queryable,
  jobId: string,
  itemId: string,
  noteId: string,
  itemTrade: Trade | null,
  audience: 'crew' | 'everyone',
): Promise<void> {
  await appendEvent(tx, jobId, {
    type: 'note',
    item_id: itemId,
    note_id: noteId,
    item_trade: itemTrade,
    audience,
  });
}

export async function emitVisit(
  tx: Queryable,
  jobId: string,
  visitId: string,
  memberPersonId: string,
): Promise<void> {
  await appendEvent(tx, jobId, { type: 'visit', visit_id: visitId, member_person_id: memberPersonId });
}

export async function emitVisitDeleted(
  tx: Queryable,
  jobId: string,
  visitId: string,
  memberPersonId: string,
): Promise<void> {
  await appendEvent(tx, jobId, {
    type: 'visit_deleted',
    id: visitId,
    member_person_id: memberPersonId,
  });
}

export async function emitJob(tx: Queryable, jobId: string): Promise<void> {
  await appendEvent(tx, jobId, { type: 'job' });
}

export async function emitRoleEnded(
  tx: Queryable,
  jobId: string,
  personId: string,
): Promise<void> {
  await appendEvent(tx, jobId, { type: 'role_ended', person_id: personId });
}

async function countsFingerprint(tx: Queryable, jobId: string): Promise<string> {
  const items = await loadItems(tx, jobId);
  const parts = items
    .map((item) => `${item.id}:${item.roomId}:${item.status}:${item.trade ?? '-'}`)
    .sort();
  return parts.join('|');
}

async function costsFingerprint(tx: Queryable, jobId: string): Promise<string> {
  return JSON.stringify(await computeCosts(tx, jobId, new Date()));
}

/**
 * One job write: the job row is locked, then the caller's own events are appended, and
 * finally a single `counts` and a single `costs` event when those figures moved.
 */
export async function jobWrite<T>(jobId: string, run: (tx: Queryable) => Promise<T>): Promise<T> {
  const result = await withTransaction(async (tx) => {
    await lockJob(tx, jobId);
    const countsBefore = await countsFingerprint(tx, jobId);
    const costsBefore = await costsFingerprint(tx, jobId);
    const value = await run(tx);
    const countsAfter = await countsFingerprint(tx, jobId);
    if (countsAfter !== countsBefore) await appendEvent(tx, jobId, { type: 'counts' });
    const costsAfter = await costsFingerprint(tx, jobId);
    if (costsAfter !== costsBefore) await appendEvent(tx, jobId, { type: 'costs' });
    await notifyJob(tx, jobId);
    return value;
  });
  return result;
}

/* --------------------------------------------------------------- delivery */

type Frame = { id: number; type: string; data: unknown };

function stripForRole(snapshot: Record<string, unknown>, viewer: Viewer): Record<string, unknown> {
  if (viewer.role === 'owner' || viewer.role === 'lead') return snapshot;
  const copy: Record<string, unknown> = { ...snapshot };
  delete copy.cost_note;
  delete copy.quantity;
  delete copy.unit_cost;
  delete copy.line_total;
  delete copy.conflicts;
  if (viewer.role === 'homeowner') {
    delete copy.sent_back_reason;
    const notes = Array.isArray(copy.notes) ? (copy.notes as Record<string, unknown>[]) : [];
    copy.notes = notes
      .filter((note) => note.audience === 'everyone')
      .map((note) => ({
        ...note,
        replies: Array.isArray(note.replies)
          ? (note.replies as Record<string, unknown>[]).filter(
              (reply) => reply.audience === 'everyone',
            )
          : [],
      }));
  }
  return copy;
}

async function projectStored(
  tx: Queryable,
  jobId: string,
  seq: number,
  stored: StoredEvent,
  viewer: Viewer,
  now: Date,
): Promise<Frame | null> {
  switch (stored.type) {
    case 'item': {
      const inScopeNow = viewer.role !== 'trade' || stored.trade === viewer.trade;
      if (inScopeNow) {
        return { id: seq, type: 'item', data: { item: stripForRole(stored.item, viewer) } };
      }
      const hadIt = viewer.role === 'trade' && stored.prev_trade === viewer.trade;
      if (!hadIt) return null;
      return {
        id: seq,
        type: 'item_deleted',
        data: { id: stored.item.id, number: stored.item.number },
      };
    }
    case 'item_deleted': {
      if (viewer.role === 'trade' && stored.trade !== viewer.trade) return null;
      return { id: seq, type: 'item_deleted', data: { id: stored.id, number: stored.number } };
    }
    case 'room': {
      const rooms = await loadRooms(tx, jobId);
      const room = rooms.find((candidate) => candidate.id === stored.room_id);
      if (!room) return null;
      const items = await loadItems(tx, jobId);
      return {
        id: seq,
        type: 'room',
        data: { room: projectRoom(room, roomCounts(items, viewer, room.id)) },
      };
    }
    case 'counts': {
      const rooms = await loadRooms(tx, jobId);
      const items = await loadItems(tx, jobId);
      return {
        id: seq,
        type: 'counts',
        data: {
          progress: jobProgress(items, viewer),
          rooms: rooms.map((room) => ({ id: room.id, counts: roomCounts(items, viewer, room.id) })),
        },
      };
    }
    case 'note': {
      if (viewer.role === 'trade' && stored.item_trade !== viewer.trade) return null;
      if (viewer.role === 'homeowner' && stored.audience === 'crew') return null;
      const note = await loadNote(tx, jobId, stored.note_id);
      if (note === null) return null;
      const items = await loadItems(tx, jobId, [stored.item_id]);
      const replies =
        note.parentId === null
          ? (items[0]?.notes ?? []).filter((candidate) => candidate.parentId === note.id)
          : null;
      return {
        id: seq,
        type: 'note',
        data: { item_id: stored.item_id, note: projectNote(note, replies) },
      };
    }
    case 'plan':
      return {
        id: seq,
        type: 'plan',
        data: { revision: stored.revision, plan_url: `/api/jobs/${jobId}/plan` },
      };
    case 'visit': {
      if (viewer.role === 'homeowner') return null;
      if (viewer.role === 'trade' && stored.member_person_id !== viewer.personId) return null;
      const job = await loadJob(tx, jobId);
      if (job === null) return null;
      const entries = await allOccurrences(tx, job);
      const entry = entries.find((candidate) => candidate.visit.id === stored.visit_id);
      if (!entry) return null;
      const members = await loadMembers(tx, jobId, true);
      const member = members.find((candidate) => candidate.id === entry.visit.memberId);
      return {
        id: seq,
        type: 'visit',
        data: {
          visit: projectVisit(entry.visit, entry.occurrences, member?.name ?? '', job, now),
        },
      };
    }
    case 'visit_deleted': {
      if (viewer.role === 'homeowner') return null;
      if (viewer.role === 'trade' && stored.member_person_id !== viewer.personId) return null;
      return { id: seq, type: 'visit_deleted', data: { id: stored.id } };
    }
    case 'costs': {
      if (viewer.role !== 'owner' && viewer.role !== 'lead') return null;
      return { id: seq, type: 'costs', data: await computeCosts(tx, jobId, now) };
    }
    case 'job': {
      const job = await loadJob(tx, jobId);
      if (job === null) return null;
      return { id: seq, type: 'job', data: { job: await projectJob(tx, job, viewer, now) } };
    }
    case 'role_ended':
      if (stored.person_id !== viewer.personId) return null;
      return { id: seq, type: 'role_ended', data: {} };
  }
}

type StreamState = {
  res: ServerResponse;
  jobId: string;
  personId: string;
  sessionId: string;
  lastSeq: number;
  flushing: boolean;
  closed: boolean;
};

const openStreams = new Set<StreamState>();

function writeFrame(state: StreamState, frame: Frame): void {
  state.res.write(`id: ${frame.id}\nevent: ${frame.type}\ndata: ${JSON.stringify(frame.data)}\n\n`);
}

async function flush(state: StreamState): Promise<void> {
  if (state.flushing || state.closed) return;
  state.flushing = true;
  try {
    const account = await resolveSession(state.sessionId, false);
    if (account === null) {
      closeStream(state);
      return;
    }
    const members = await loadMembers(db, state.jobId, true);
    const membership = members.find((member) => member.personId === state.personId);
    if (membership === undefined) {
      closeStream(state);
      return;
    }
    const viewer: Viewer = {
      personId: membership.personId,
      role: membership.role,
      trade: membership.trade,
      memberId: membership.id,
      name: membership.name,
    };
    const { rows } = await db.query(
      `select seq, payload from events where job_id = $1 and seq > $2 order by seq`,
      [state.jobId, state.lastSeq],
    );
    const now = new Date();
    for (const row of rows) {
      if (state.closed) return;
      const seq = Number(row.seq);
      const stored = row.payload as StoredEvent;
      const frame = await projectStored(db, state.jobId, seq, stored, viewer, now);
      state.lastSeq = seq;
      if (frame === null) continue;
      writeFrame(state, frame);
      if (frame.type === 'role_ended') {
        closeStream(state);
        return;
      }
    }
    if (!membership.active) {
      writeFrame(state, { id: state.lastSeq, type: 'role_ended', data: {} });
      closeStream(state);
    }
  } catch {
    // A transient database error leaves the stream open; the next tick retries.
  } finally {
    state.flushing = false;
  }
}

function closeStream(state: StreamState): void {
  if (state.closed) return;
  state.closed = true;
  openStreams.delete(state);
  state.res.end();
}

export async function startEventStream(
  res: ServerResponse,
  jobId: string,
  personId: string,
  sessionId: string,
  resumeFrom: number | null,
): Promise<void> {
  const latestRow = await db.query(`select event_seq from jobs where id = $1`, [jobId]);
  const latest = Number(latestRow.rows[0].event_seq);
  const keptRow = await db.query(`select min(seq) as low from events where job_id = $1`, [jobId]);
  const lowest = keptRow.rows[0].low === null ? latest + 1 : Number(keptRow.rows[0].low);

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });

  const state: StreamState = {
    res,
    jobId,
    personId,
    sessionId,
    lastSeq: latest,
    flushing: false,
    closed: false,
  };
  openStreams.add(state);

  if (resumeFrom !== null) {
    const servable = resumeFrom <= latest && resumeFrom >= lowest - 1;
    if (servable) {
      state.lastSeq = resumeFrom;
    } else {
      writeFrame(state, { id: latest, type: 'reset', data: {} });
    }
  }

  const keepAlive = setInterval(() => {
    if (!state.closed) res.write(': keep-alive\n\n');
  }, 15_000);
  const ticker = setInterval(() => void flush(state), 1000);
  const unsubscribe = onJobNotice((noticeJobId) => {
    if (noticeJobId === jobId) void flush(state);
  });

  const stop = (): void => {
    clearInterval(keepAlive);
    clearInterval(ticker);
    unsubscribe();
    closeStream(state);
  };
  res.on('close', stop);
  res.on('error', stop);

  void flush(state);
}
