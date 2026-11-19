import type { PoolClient } from 'pg';
import { pool, type Queryable } from '../db/pool.js';
import { AppError } from '../errors.js';
import { config } from '../config.js';
import type { WorkshopStatus } from '../domain/states.js';
import type { TemplateCode } from '../domain/templates.js';
import type { StoredCluster, StoredConnector, StoredFrame, StoredNote } from '../domain/views.js';
import type { DotLedgerEntry } from '../domain/counts.js';
import { publishBoardChange } from './events.js';

export interface WorkshopRow {
  readonly id: string;
  readonly facilitatorId: string;
  readonly facilitatorName: string;
  readonly timeZone: string;
  readonly title: string;
  readonly template: TemplateCode;
  readonly status: WorkshopStatus;
  readonly scheduledStart: string;
  readonly scheduledEnd: string;
  readonly startAtMs: number;
  readonly endAtMs: number;
  readonly sponsorEmail: string;
  readonly fee: string;
  readonly version: number;
  readonly roundNumber: number;
  readonly roundsUsed: number;
  readonly roundEndsAtMs: number | null;
  readonly dotBudget: number | null;
  readonly votingEndsAtMs: number | null;
}

const WORKSHOP_COLUMNS = `
  w.id, w.facilitator_id, f.name AS facilitator_name, f.time_zone, w.title, w.template, w.status,
  w.scheduled_start, w.scheduled_end, w.start_at, w.end_at, w.sponsor_email, w.fee, w.version,
  w.round_number, w.rounds_used, w.round_ends_at, w.dot_budget, w.voting_ends_at`;

interface RawWorkshop {
  id: string;
  facilitator_id: string;
  facilitator_name: string;
  time_zone: string;
  title: string;
  template: TemplateCode;
  status: WorkshopStatus;
  scheduled_start: string;
  scheduled_end: string;
  start_at: Date;
  end_at: Date;
  sponsor_email: string;
  fee: string;
  version: number;
  round_number: number;
  rounds_used: number;
  round_ends_at: Date | null;
  dot_budget: number | null;
  voting_ends_at: Date | null;
}

function toWorkshop(row: RawWorkshop): WorkshopRow {
  return {
    id: row.id,
    facilitatorId: row.facilitator_id,
    facilitatorName: row.facilitator_name,
    timeZone: row.time_zone,
    title: row.title,
    template: row.template,
    status: row.status,
    scheduledStart: row.scheduled_start,
    scheduledEnd: row.scheduled_end,
    startAtMs: row.start_at.getTime(),
    endAtMs: row.end_at.getTime(),
    sponsorEmail: row.sponsor_email,
    fee: row.fee,
    version: row.version,
    roundNumber: row.round_number,
    roundsUsed: row.rounds_used,
    roundEndsAtMs: row.round_ends_at?.getTime() ?? null,
    dotBudget: row.dot_budget,
    votingEndsAtMs: row.voting_ends_at?.getTime() ?? null,
  };
}

export async function findWorkshop(executor: Queryable, workshopId: string): Promise<WorkshopRow | null> {
  const result = await executor.query<RawWorkshop>(
    `SELECT ${WORKSHOP_COLUMNS} FROM workshops w JOIN facilitators f ON f.id = w.facilitator_id WHERE w.id = $1`,
    [workshopId],
  );
  const row = result.rows[0];
  return row ? toWorkshop(row) : null;
}

/** Locks the workshop row so transitions, reveals and dot spends serialise on it. */
export async function lockWorkshop(client: PoolClient, workshopId: string): Promise<WorkshopRow> {
  const locked = await client.query<{ id: string }>('SELECT id FROM workshops WHERE id = $1 FOR UPDATE', [
    workshopId,
  ]);
  if (locked.rowCount === 0) throw new AppError('not_found');
  const workshop = await findWorkshop(client, workshopId);
  if (!workshop) throw new AppError('not_found');
  return workshop;
}

export async function listWorkshopsForFacilitator(facilitatorId: string): Promise<WorkshopRow[]> {
  const result = await pool.query<RawWorkshop>(
    `SELECT ${WORKSHOP_COLUMNS} FROM workshops w JOIN facilitators f ON f.id = w.facilitator_id
      WHERE w.facilitator_id = $1 ORDER BY w.start_at DESC`,
    [facilitatorId],
  );
  return result.rows.map(toWorkshop);
}

/** `joinLinkExpiresAt` is the resolved instant of the scheduled end plus the grace period. */
export function joinLinkExpiresAtMs(workshop: WorkshopRow): number {
  return workshop.endAtMs + config.joinLinkGraceSeconds * 1000;
}

export interface BoardData {
  readonly frames: readonly StoredFrame[];
  readonly notes: readonly StoredNote[];
  readonly clusters: readonly StoredCluster[];
  readonly connectors: readonly StoredConnector[];
  readonly ledger: readonly DotLedgerEntry[];
}

interface RawFrame {
  id: string;
  workshop_id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  position: number;
}

interface RawNote {
  id: string;
  workshop_id: string;
  frame_id: string;
  cluster_id: string | null;
  cluster_index: number | null;
  kind: 'text' | 'image';
  text: string | null;
  image_id: string | null;
  x: number;
  y: number;
  revealed: boolean;
  facilitator_only: boolean;
  author_kind: 'facilitator' | 'participant';
  author_participant_id: string | null;
  author_name: string;
  round_number: number;
  created_seq: number;
}

/**
 * Frames that are in trash, or at or past their purge time, are left out of every read path,
 * whether or not a worker has deleted them yet.
 */
const LIVE_FRAME_CONDITION = 'f.trashed_at IS NULL AND f.purged_at IS NULL';

export async function loadBoard(executor: Queryable, workshopId: string): Promise<BoardData> {
  const [frames, notes, clusters, connectors, ledger] = await Promise.all([
    executor.query<RawFrame>(
      `SELECT f.id, f.workshop_id, f.title, f.x, f.y, f.width, f.height, f.position
         FROM frames f WHERE f.workshop_id = $1 AND ${LIVE_FRAME_CONDITION} ORDER BY f.position`,
      [workshopId],
    ),
    executor.query<RawNote>(
      `SELECT n.id, n.workshop_id, n.frame_id, n.cluster_id, n.cluster_index, n.kind, n.text, n.image_id,
              n.x, n.y, n.revealed, n.facilitator_only, n.author_kind, n.author_participant_id,
              n.author_name, n.round_number, n.created_seq
         FROM notes n JOIN frames f ON f.id = n.frame_id
        WHERE n.workshop_id = $1 AND ${LIVE_FRAME_CONDITION}
        ORDER BY n.created_seq`,
      [workshopId],
    ),
    executor.query<StoredCluster & { frame_id: string; workshop_id: string }>(
      `SELECT c.id, c.workshop_id, c.frame_id, c.title, c.x, c.y
         FROM clusters c JOIN frames f ON f.id = c.frame_id
        WHERE c.workshop_id = $1 AND ${LIVE_FRAME_CONDITION}
        ORDER BY c.created_at`,
      [workshopId],
    ),
    executor.query<{ id: string; workshop_id: string; from_note_id: string; to_note_id: string }>(
      `SELECT co.id, co.workshop_id, co.from_note_id, co.to_note_id
         FROM connectors co
         JOIN notes nf ON nf.id = co.from_note_id JOIN frames ff ON ff.id = nf.frame_id
         JOIN notes nt ON nt.id = co.to_note_id   JOIN frames ft ON ft.id = nt.frame_id
        WHERE co.workshop_id = $1
          AND ff.trashed_at IS NULL AND ff.purged_at IS NULL
          AND ft.trashed_at IS NULL AND ft.purged_at IS NULL`,
      [workshopId],
    ),
    loadLedgerQuery(executor, workshopId),
  ]);

  return {
    frames: frames.rows.map((row) => ({
      id: row.id,
      workshopId: row.workshop_id,
      title: row.title,
      x: Number(row.x),
      y: Number(row.y),
      width: Number(row.width),
      height: Number(row.height),
      position: row.position,
    })),
    notes: notes.rows.map(toStoredNote),
    clusters: clusters.rows.map((row) => ({
      id: row.id,
      workshopId: row.workshop_id,
      frameId: row.frame_id,
      title: row.title,
      x: Number(row.x),
      y: Number(row.y),
    })),
    connectors: connectors.rows.map((row) => ({
      id: row.id,
      workshopId: row.workshop_id,
      fromNoteId: row.from_note_id,
      toNoteId: row.to_note_id,
    })),
    ledger: ledger,
  };
}

function toStoredNote(row: RawNote): StoredNote {
  return {
    id: row.id,
    workshopId: row.workshop_id,
    frameId: row.frame_id,
    clusterId: row.cluster_id,
    clusterIndex: row.cluster_index,
    kind: row.kind,
    text: row.text,
    imageId: row.image_id,
    x: Number(row.x),
    y: Number(row.y),
    revealed: row.revealed,
    facilitatorOnly: row.facilitator_only,
    authorKind: row.author_kind,
    authorParticipantId: row.author_participant_id,
    authorName: row.author_name,
    roundNumber: row.round_number,
    createdAt: Number(row.created_seq),
  };
}

/**
 * The dot ledger is read whole for the workshop, including entries on clusters inside a
 * trashed or purged frame, because those dots still count against their spenders' budgets.
 */
async function loadLedgerQuery(executor: Queryable, workshopId: string): Promise<DotLedgerEntry[]> {
  const result = await executor.query<{ cluster_id: string; participant_id: string; cancelled: boolean }>(
    `SELECT spend.cluster_id, spend.participant_id, (ret.id IS NOT NULL) AS cancelled
       FROM dot_entries spend
       LEFT JOIN dot_entries ret ON ret.cancels_entry_id = spend.id
      WHERE spend.workshop_id = $1 AND spend.kind = 'spend'`,
    [workshopId],
  );
  return result.rows.map((row) => ({
    clusterId: row.cluster_id,
    participantId: row.participant_id,
    cancelled: row.cancelled,
  }));
}

export async function findNoteById(executor: Queryable, noteId: string): Promise<StoredNote | null> {
  const result = await executor.query<RawNote>(
    `SELECT n.id, n.workshop_id, n.frame_id, n.cluster_id, n.cluster_index, n.kind, n.text, n.image_id,
            n.x, n.y, n.revealed, n.facilitator_only, n.author_kind, n.author_participant_id,
            n.author_name, n.round_number, n.created_seq
       FROM notes n JOIN frames f ON f.id = n.frame_id
      WHERE n.id = $1 AND ${LIVE_FRAME_CONDITION}`,
    [noteId],
  );
  const row = result.rows[0];
  return row ? toStoredNote(row) : null;
}

export interface ParticipantRow {
  readonly id: string;
  readonly displayName: string;
  readonly cursorId: string;
  readonly hue: number;
  readonly active: boolean;
}

export async function loadParticipants(
  executor: Queryable,
  workshop: WorkshopRow,
  nowMs: number,
): Promise<ParticipantRow[]> {
  const expired = nowMs >= joinLinkExpiresAtMs(workshop);
  const result = await executor.query<{
    id: string;
    display_name: string;
    cursor_id: string;
    hue: number;
    revoked_at: Date | null;
  }>(
    `SELECT p.id, p.display_name, p.cursor_id, p.hue, jl.revoked_at
       FROM participants p JOIN join_links jl ON jl.id = p.join_link_id
      WHERE p.workshop_id = $1 ORDER BY p.created_at`,
    [workshop.id],
  );
  return result.rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    cursorId: row.cursor_id,
    hue: row.hue,
    active: row.revoked_at === null && !expired,
  }));
}

export async function countActiveParticipants(
  executor: Queryable,
  workshop: WorkshopRow,
  nowMs: number,
): Promise<number> {
  if (nowMs >= joinLinkExpiresAtMs(workshop)) return 0;
  const result = await executor.query<{ total: number }>(
    `SELECT count(*)::bigint AS total
       FROM participants p JOIN join_links jl ON jl.id = p.join_link_id
      WHERE p.workshop_id = $1 AND jl.revoked_at IS NULL`,
    [workshop.id],
  );
  return result.rows[0]?.total ?? 0;
}

const SNAPSHOT_INTERVAL = 50;

export type VersionReason = 'auto' | 'close' | 'before_restore';

/**
 * Raises the workshop version by exactly one, writes any snapshot the new version calls for,
 * and announces the change. Called inside the committing transaction.
 */
export async function bumpVersion(client: PoolClient, workshopId: string): Promise<number> {
  const result = await client.query<{ version: number }>(
    'UPDATE workshops SET version = version + 1 WHERE id = $1 RETURNING version',
    [workshopId],
  );
  const version = result.rows[0]?.version;
  if (version === undefined) throw new AppError('not_found');
  if (version % SNAPSHOT_INTERVAL === 0) await writeSnapshot(client, workshopId, version, 'auto');
  await publishBoardChange(client, { workshopId, version });
  return version;
}

export interface BoardSnapshot {
  readonly frames: ReadonlyArray<Record<string, unknown>>;
  readonly clusters: ReadonlyArray<Record<string, unknown>>;
  readonly notes: ReadonlyArray<Record<string, unknown>>;
  readonly connectors: ReadonlyArray<Record<string, unknown>>;
}

/** A snapshot holds the frames not in trash, their notes with every field and flag, clusters with their order, and connectors. */
export async function writeSnapshot(
  client: PoolClient,
  workshopId: string,
  version: number,
  reason: VersionReason,
): Promise<string> {
  const board = await loadBoard(client, workshopId);
  const snapshot: BoardSnapshot = {
    frames: board.frames.map((frame) => ({ ...frame })),
    clusters: board.clusters.map((cluster) => ({ ...cluster })),
    notes: board.notes.map((note) => ({ ...note })),
    connectors: board.connectors.map((connector) => ({ ...connector })),
  };
  const noteCount = board.notes.filter((note) => !note.facilitatorOnly).length;
  const id = `bv_${workshopId}_${version}_${reason}`;
  await client.query(
    `INSERT INTO board_versions (id, workshop_id, version, reason, snapshot, note_count)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT (id) DO NOTHING`,
    [id, workshopId, version, reason, JSON.stringify(snapshot), noteCount],
  );
  return id;
}
