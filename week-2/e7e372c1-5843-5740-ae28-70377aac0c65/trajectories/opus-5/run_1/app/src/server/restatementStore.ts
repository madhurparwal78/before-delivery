/** Reading restatements, their share events and their audit trail. */
import { Transaction, query } from './db';
import { RestatementState, RowKey, ShareEventKind } from '../shared/labels';
import { toIso } from '../shared/nytime';

export interface ShareEventRecord {
  id: string;
  kind: ShareEventKind;
  shares: string;
  effectiveDate: string;
  position: number;
}

export interface ExhibitRecord {
  status: 'verified' | 'rejected';
  sha256: string;
  bytes: number;
  key: string | null;
}

export interface StaffReference {
  id: string;
  name: string;
}

export interface RestatementRecord {
  id: string;
  version: number;
  weekEnding: string;
  state: RestatementState;
  supersedes: string | null;
  correctionReason: string | null;
  rows: Readonly<Record<RowKey, string | null>>;
  accession: string | null;
  exhibitPage: number | null;
  exhibit: ExhibitRecord | null;
  preparedBy: StaffReference;
  clearedBy: StaffReference | null;
  releasedBy: StaffReference | null;
  returnNote: string | null;
  releaseAtMs: number | null;
  publishedAtMs: number | null;
  supersededBy: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  shareEvents: ShareEventRecord[];
}

interface RestatementRow {
  id: string;
  version: number;
  week_ending: string;
  state: string;
  supersedes: string | null;
  correction_reason: string | null;
  row_beginning_balance: string | null;
  row_eth_acquired: string | null;
  row_staking_rewards: string | null;
  row_ending_balance: string | null;
  row_cumulative_staking_rewards: string | null;
  row_diluted_shares: string | null;
  accession: string | null;
  exhibit_page: number | null;
  exhibit_status: string | null;
  exhibit_sha256: string | null;
  exhibit_bytes: number | null;
  exhibit_key: string | null;
  prepared_by: string;
  prepared_name: string;
  cleared_by: string | null;
  cleared_name: string | null;
  released_by: string | null;
  released_name: string | null;
  return_note: string | null;
  release_at: Date | null;
  published_at: Date | null;
  superseded_by: string | null;
  created_at: Date;
  updated_at: Date;
}

interface ShareEventRow {
  id: string;
  restatement_id: string;
  position: number;
  kind: string;
  shares: string;
  effective_date: string;
}

const RESTATEMENT_SELECT = `
  SELECT r.id, r.version, r.week_ending, r.state, r.supersedes, r.correction_reason,
         r.row_beginning_balance, r.row_eth_acquired, r.row_staking_rewards,
         r.row_ending_balance, r.row_cumulative_staking_rewards, r.row_diluted_shares,
         r.accession, r.exhibit_page, r.exhibit_status, r.exhibit_sha256, r.exhibit_bytes,
         r.exhibit_key, r.prepared_by, p.name AS prepared_name,
         r.cleared_by, c.name AS cleared_name, r.released_by, l.name AS released_name,
         r.return_note, r.release_at, r.published_at, r.superseded_by, r.created_at, r.updated_at
    FROM restatement r
    JOIN staff_user p ON p.id = r.prepared_by
    LEFT JOIN staff_user c ON c.id = r.cleared_by
    LEFT JOIN staff_user l ON l.id = r.released_by`;

function toRecord(row: RestatementRow, shareEvents: ShareEventRecord[]): RestatementRecord {
  return {
    id: row.id,
    version: row.version,
    weekEnding: row.week_ending,
    state: row.state as RestatementState,
    supersedes: row.supersedes,
    correctionReason: row.correction_reason,
    rows: {
      'beginning-balance': row.row_beginning_balance,
      'eth-acquired': row.row_eth_acquired,
      'staking-rewards': row.row_staking_rewards,
      'ending-balance': row.row_ending_balance,
      'cumulative-staking-rewards': row.row_cumulative_staking_rewards,
      'diluted-shares': row.row_diluted_shares,
    },
    accession: row.accession,
    exhibitPage: row.exhibit_page,
    exhibit:
      row.exhibit_status === null || row.exhibit_sha256 === null
        ? null
        : {
            status: row.exhibit_status as 'verified' | 'rejected',
            sha256: row.exhibit_sha256,
            bytes: row.exhibit_bytes ?? 0,
            key: row.exhibit_key,
          },
    preparedBy: { id: row.prepared_by, name: row.prepared_name },
    clearedBy:
      row.cleared_by === null || row.cleared_name === null
        ? null
        : { id: row.cleared_by, name: row.cleared_name },
    releasedBy:
      row.released_by === null || row.released_name === null
        ? null
        : { id: row.released_by, name: row.released_name },
    returnNote: row.return_note,
    releaseAtMs: row.release_at ? row.release_at.getTime() : null,
    publishedAtMs: row.published_at ? row.published_at.getTime() : null,
    supersededBy: row.superseded_by,
    createdAtMs: row.created_at.getTime(),
    updatedAtMs: row.updated_at.getTime(),
    shareEvents,
  };
}

function toShareEvent(row: ShareEventRow): ShareEventRecord {
  return {
    id: row.id,
    kind: row.kind as ShareEventKind,
    shares: row.shares,
    effectiveDate: row.effective_date,
    position: row.position,
  };
}

export async function loadRestatement(
  tx: Transaction,
  id: string,
): Promise<RestatementRecord | null> {
  const rows = await tx.query<RestatementRow>(`${RESTATEMENT_SELECT} WHERE r.id = $1`, [id]);
  const row = rows[0];
  if (!row) return null;
  const events = await tx.query<ShareEventRow>(
    'SELECT id, restatement_id, position, kind, shares, effective_date FROM share_event WHERE restatement_id = $1 ORDER BY position',
    [id],
  );
  return toRecord(row, events.map(toShareEvent));
}

export async function loadAllRestatements(tx: Transaction): Promise<RestatementRecord[]> {
  const rows = await tx.query<RestatementRow>(
    `${RESTATEMENT_SELECT} ORDER BY r.week_ending DESC, r.created_at DESC, r.seq DESC`,
  );
  const events = await tx.query<ShareEventRow>(
    'SELECT id, restatement_id, position, kind, shares, effective_date FROM share_event ORDER BY position',
  );
  const byRestatement = new Map<string, ShareEventRecord[]>();
  for (const event of events) {
    const list = byRestatement.get(event.restatement_id) ?? [];
    list.push(toShareEvent(event));
    byRestatement.set(event.restatement_id, list);
  }
  return rows.map((row) => toRecord(row, byRestatement.get(row.id) ?? []));
}

export interface LatestPublished {
  id: string;
  weekEnding: string;
  rows: Readonly<Record<RowKey, string | null>>;
  publishedAtMs: number;
}

export async function latestPublishedRestatement(tx: Transaction): Promise<LatestPublished | null> {
  const rows = await tx.query<RestatementRow>(
    `${RESTATEMENT_SELECT} WHERE r.state = 'published' ORDER BY r.week_ending DESC LIMIT 1`,
  );
  const row = rows[0];
  if (!row || row.published_at === null) return null;
  const record = toRecord(row, []);
  return {
    id: record.id,
    weekEnding: record.weekEnding,
    rows: record.rows,
    publishedAtMs: row.published_at.getTime(),
  };
}

/** The current restatement of a week: the published one, else the newest row. */
export async function currentRestatementForWeek(
  tx: Transaction,
  weekEnding: string,
): Promise<RestatementRecord | null> {
  const rows = await tx.query<RestatementRow>(
    `${RESTATEMENT_SELECT} WHERE r.week_ending = $1
       ORDER BY (r.state = 'published') DESC, r.published_at DESC NULLS LAST, r.seq DESC LIMIT 1`,
    [weekEnding],
  );
  const row = rows[0];
  return row ? toRecord(row, []) : null;
}

export interface AuditEntryPayload {
  version: number;
  action: string;
  actor: StaffReference | null;
  at: string;
  from_state: RestatementState | null;
  to_state: RestatementState;
  note: string | null;
}

interface AuditRow {
  version: number;
  action: string;
  actor_id: string | null;
  actor_name: string | null;
  at: Date;
  from_state: string | null;
  to_state: string;
  note: string | null;
}

export async function loadAuditTrail(
  tx: Transaction,
  restatementId: string,
): Promise<AuditEntryPayload[]> {
  const rows = await tx.query<AuditRow>(
    `SELECT a.version, a.action, a.actor_id, u.name AS actor_name, a.at, a.from_state, a.to_state, a.note
       FROM restatement_audit a
       LEFT JOIN staff_user u ON u.id = a.actor_id
      WHERE a.restatement_id = $1
      ORDER BY a.version`,
    [restatementId],
  );
  return rows.map((row) => ({
    version: row.version,
    action: row.action,
    actor: row.actor_id === null || row.actor_name === null ? null : { id: row.actor_id, name: row.actor_name },
    at: toIso(row.at.getTime()),
    from_state: row.from_state as RestatementState | null,
    to_state: row.to_state as RestatementState,
    note: row.note,
  }));
}

export interface ExhibitVisibility {
  sha256: string;
  accession: string;
  key: string;
  bytes: number;
  publiclyVisible: boolean;
}

/** Every verified exhibit that cites this hash, with its publication status. */
export async function exhibitsForHash(sha256: string): Promise<ExhibitVisibility[]> {
  const rows = await query<{
    accession: string;
    exhibit_key: string;
    exhibit_bytes: number;
    state: string;
  }>(
    `SELECT accession, exhibit_key, exhibit_bytes, state FROM restatement
      WHERE exhibit_sha256 = $1 AND exhibit_status = 'verified' AND exhibit_key IS NOT NULL
      ORDER BY (state IN ('published','superseded')) DESC, seq DESC`,
    [sha256],
  );
  return rows.map((row) => ({
    sha256,
    accession: row.accession,
    key: row.exhibit_key,
    bytes: row.exhibit_bytes,
    publiclyVisible: row.state === 'published' || row.state === 'superseded',
  }));
}
