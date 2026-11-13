import { Postgres } from './services/postgres.js';
import {
  Clef,
  CollaboratorStatus,
  PartStatus,
  Role,
  TimeSignature,
  Transpose,
} from '../domain/values.js';
import { Operation, ScoreModel, StoredEvent } from '../domain/scoremodel.js';

export interface StaffRow {
  id: string;
  scoreId: string;
  name: string;
  clef: Clef;
  transpose: Transpose;
  partId: string;
  order: number;
}

export interface CollaboratorRow {
  id: string;
  scoreId: string;
  name: string;
  role: Role;
  status: CollaboratorStatus;
  staffIds: string[];
  seatToken: string | null;
}

export interface PartRow {
  id: string;
  scoreId: string;
  name: string;
  status: PartStatus;
  revision: number;
  extractedAtLamport: number | null;
  stale: boolean;
  pageCount: number | null;
  layout: { systemBreaks: number[]; pageBreaks: number[] };
  lastError: string | null;
}

export interface BankRow {
  id: string;
  scoreId: string;
  fileName: string;
  kind: 'wav' | 'sfz';
  bytes: number;
  staffId: string;
  rootPitch: string | null;
  status: string;
  createdAt: string;
}

export interface RecordedOp {
  seq: number;
  lamport: number;
  site: string;
  authorId: string;
  op: Operation;
  recordedAt: Date;
}

/**
 * Every persistent read and write for a score. Postgres is the single source
 * of truth; the in-memory models are rebuilt from these rows at boot and kept
 * in sync as operations are recorded.
 */
export class ScoreRepository {
  constructor(private db: Postgres) {}

  async scoreExists(scoreId: string): Promise<boolean> {
    const res = await this.db.query('SELECT id FROM scores WHERE id = $1', [scoreId]);
    return res.rows.length > 0;
  }

  async scoreRow(scoreId: string): Promise<{
    id: string;
    title: string;
    measureCount: number;
    lamport: number;
    lastSeq: number;
    timeSignatures: TimeSignature[];
    tempos: { measure: number; bpm: number }[];
  } | null> {
    const res = await this.db.query(
      'SELECT id, title, measure_count, lamport, last_seq, time_signatures, tempos FROM scores WHERE id = $1',
      [scoreId],
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      title: r.title,
      measureCount: r.measure_count,
      lamport: Postgres.bigIntToNumber(r.lamport),
      lastSeq: Postgres.bigIntToNumber(r.last_seq),
      timeSignatures: r.time_signatures,
      tempos: r.tempos,
    };
  }

  async staves(scoreId: string): Promise<StaffRow[]> {
    const res = await this.db.query('SELECT id, name, clef, transpose, part_id, "order" FROM staves WHERE score_id = $1 ORDER BY "order"', [scoreId]);
    return res.rows.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      scoreId,
      name: r.name as string,
      clef: r.clef as Clef,
      transpose: r.transpose as Transpose,
      partId: r.part_id as string,
      order: r.order as number,
    }));
  }

  async parts(scoreId: string): Promise<PartRow[]> {
    const res = await this.db.query(
      'SELECT id, name, status, revision, extracted_at_lamport, stale, page_count, layout, last_error FROM parts WHERE score_id = $1',
      [scoreId],
    );
    return res.rows.map(partFromRow);
  }

  async collaborators(scoreId: string): Promise<CollaboratorRow[]> {
    const res = await this.db.query(
      'SELECT id, name, role, status, staff_ids, seat_token FROM collaborators WHERE score_id = $1',
      [scoreId],
    );
    return res.rows.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      scoreId,
      name: r.name as string,
      role: r.role as Role,
      status: r.status as CollaboratorStatus,
      staffIds: r.staff_ids as string[],
      seatToken: (r.seat_token as string) ?? null,
    }));
  }

  async collaboratorBySeat(seatToken: string): Promise<CollaboratorRow | null> {
    const res = await this.db.query(
      'SELECT id, score_id, name, role, status, staff_ids, seat_token FROM collaborators WHERE seat_token = $1',
      [seatToken],
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      scoreId: r.score_id,
      name: r.name,
      role: r.role,
      status: r.status,
      staffIds: r.staff_ids,
      seatToken: r.seat_token,
    };
  }

  async collaboratorById(scoreId: string, id: string): Promise<CollaboratorRow | null> {
    const res = await this.db.query(
      'SELECT id, score_id, name, role, status, staff_ids, seat_token FROM collaborators WHERE score_id = $1 AND id = $2',
      [scoreId, id],
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      scoreId: r.score_id,
      name: r.name,
      role: r.role,
      status: r.status,
      staffIds: r.staff_ids,
      seatToken: r.seat_token,
    };
  }

  async inviteRow(token: string): Promise<{ token: string; scoreId: string; collaboratorId: string } | null> {
    const res = await this.db.query('SELECT token, score_id, collaborator_id FROM invites WHERE token = $1', [token]);
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return { token: r.token, scoreId: r.score_id, collaboratorId: r.collaborator_id };
  }

  async operationsAfter(scoreId: string, afterSeq: number, limit: number): Promise<RecordedOp[]> {
    const res = await this.db.query(
      'SELECT seq, lamport, site, author_id, op, recorded_at FROM operations WHERE score_id = $1 AND seq > $2 ORDER BY seq ASC LIMIT $3',
      [scoreId, afterSeq, limit],
    );
    return res.rows.map(opFromRow);
  }

  async allOperations(scoreId: string): Promise<RecordedOp[]> {
    const res = await this.db.query(
      'SELECT seq, lamport, site, author_id, op, recorded_at FROM operations WHERE score_id = $1 ORDER BY seq ASC',
      [scoreId],
    );
    return res.rows.map(opFromRow);
  }

  async ackOf(scoreId: string, collaboratorId: string): Promise<number> {
    const res = await this.db.query(
      'SELECT seen FROM acks WHERE score_id = $1 AND collaborator_id = $2',
      [scoreId, collaboratorId],
    );
    if (res.rows.length === 0) return 0;
    return Postgres.bigIntToNumber(res.rows[0].seen);
  }

  async acksFor(scoreId: string): Promise<{ collaboratorId: string; seen: number }[]> {
    const res = await this.db.query('SELECT collaborator_id, seen FROM acks WHERE score_id = $1', [scoreId]);
    return res.rows.map((r: Record<string, unknown>) => ({
      collaboratorId: r.collaborator_id as string,
      seen: Postgres.bigIntToNumber(r.seen as string | number),
    }));
  }

  async banks(scoreId: string): Promise<BankRow[]> {
    const res = await this.db.query(
      'SELECT id, file_name, kind, bytes, staff_id, root_pitch, status, created_at FROM banks WHERE score_id = $1 ORDER BY created_at DESC',
      [scoreId],
    );
    return res.rows.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      scoreId,
      fileName: r.file_name as string,
      kind: r.kind as 'wav' | 'sfz',
      bytes: Postgres.bigIntToNumber(r.bytes as string | number),
      staffId: r.staff_id as string,
      rootPitch: (r.root_pitch as string) ?? null,
      status: r.status as string,
      createdAt: new Date(r.created_at as string).toISOString(),
    }));
  }

  /** Rebuilds the in-memory model from persisted rows. */
  async buildModel(scoreId: string, ops: RecordedOp[]): Promise<ScoreModel> {
    const score = await this.scoreRow(scoreId);
    if (!score) throw new Error(`unknown score ${scoreId}`);
    const staves = await this.staves(scoreId);
    const parts = await this.parts(scoreId);
    const events = eventsFromOps(ops);
    const model = new ScoreModel(
      {
        id: score.id,
        title: score.title,
        measureCount: score.measureCount,
        timeSignatures: score.timeSignatures,
        tempos: score.tempos,
        staves: staves.map((s) => ({ id: s.id, name: s.name, clef: s.clef, transpose: s.transpose, partId: s.partId, order: s.order })),
        parts: parts.map((p) => ({ id: p.id, name: p.name, staffIds: staffIdsOf(parts, p.id, staves) })),
        lamport: score.lamport,
        lastSeq: score.lastSeq,
      },
      events,
    );
    for (const op of ops) model.applyRecorded(op.op);
    return model;
  }
}

function staffIdsOf(parts: PartRow[], partId: string, staves: StaffRow[]): string[] {
  void parts;
  return staves.filter((s) => s.partId === partId).map((s) => s.id);
}

function partFromRow(r: Record<string, unknown>): PartRow {
  return {
    id: r.id as string,
    scoreId: '',
    name: r.name as string,
    status: r.status as PartStatus,
    revision: r.revision as number,
    extractedAtLamport: r.extracted_at_lamport === null ? null : Postgres.bigIntToNumber(r.extracted_at_lamport as string | number),
    stale: r.stale as boolean,
    pageCount: r.page_count as number | null,
    layout: r.layout as { systemBreaks: number[]; pageBreaks: number[] },
    lastError: (r.last_error as string) ?? null,
  };
}

function opFromRow(r: Record<string, unknown>): RecordedOp {
  return {
    seq: Postgres.bigIntToNumber(r.seq as string | number),
    lamport: Postgres.bigIntToNumber(r.lamport as string | number),
    site: r.site as string,
    authorId: r.author_id as string,
    op: r.op as Operation,
    recordedAt: r.recorded_at as Date,
  };
}

function eventsFromOps(ops: RecordedOp[]): StoredEvent[] {
  const events = new Map<string, StoredEvent>();
  const key = (id: { lamport: number; site: string }) => `${id.lamport}@${id.site}`;
  for (const rec of ops) {
    const op = rec.op;
    if (op.type === 'insert') {
      events.set(key(op.id), {
        id: op.id,
        staffId: op.staffId,
        voice: op.voice,
        kind: op.event.kind,
        pitch: op.event.kind === 'note' ? op.event.pitch ?? null : null,
        duration: op.event.duration,
        dots: op.event.dots,
        tie: false,
        dynamic: null,
        dynamicPlacement: 'below',
        text: null,
        deleted: false,
        after: op.after,
        deletedAt: null,
        sets: {},
      });
    }
  }
  return [...events.values()];
}
