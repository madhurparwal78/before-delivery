import { query } from '../db/pool.js';
import { notFound } from '../http/errors.js';
import type { Caller } from '../http/session.js';
import { findCommission, isUuid, type CommissionRow, type FunderRow, type MilestoneRow } from './commissions.js';
import type { DocumentRow } from './documents.js';

/**
 * Object-level access. Every id, including ids inside request bodies, is
 * resolved through this module, and anything outside the caller's reach is
 * answered as if it did not exist.
 */

function isProducer(caller: Caller): boolean {
  return caller.user.roles.includes('producer');
}

/** A commission the caller may read: its client owner, or the producer. */
export async function commissionFor(id: string, caller: Caller): Promise<CommissionRow> {
  const commission = await findCommission(id);
  if (!commission) throw notFound();
  if (isProducer(caller)) return commission;
  if (commission.client_id === caller.user.id) return commission;
  throw notFound();
}

/**
 * A commission the caller may move along. Besides the client owner and the
 * producer, a crew lead assigned to its install day reaches it, because the
 * move to installed is theirs to make.
 */
export async function commissionForTransition(
  id: string,
  caller: Caller,
): Promise<CommissionRow> {
  const commission = await findCommission(id);
  if (!commission) throw notFound();
  if (isProducer(caller)) return commission;
  if (commission.client_id === caller.user.id) return commission;
  if (caller.user.roles.includes('crew')) {
    const assigned = await query<{ id: string }>(
      'SELECT id FROM install_days WHERE commission_id = $1 AND $2 = ANY(crew_user_ids)',
      [commission.id, caller.user.id],
    );
    if (assigned.rows[0]) return commission;
  }
  throw notFound();
}

/** A commission the caller owns as the client. */
export async function ownedCommissionFor(id: string, caller: Caller): Promise<CommissionRow> {
  const commission = await findCommission(id);
  if (!commission || commission.client_id !== caller.user.id) throw notFound();
  return commission;
}

export interface MilestoneWithCommission {
  milestone: MilestoneRow;
  commission: CommissionRow;
}

/** A milestone of a commission the caller owns, or any for the producer. */
export async function milestoneFor(
  id: string,
  caller: Caller,
): Promise<MilestoneWithCommission> {
  if (!isUuid(id)) throw notFound();
  const result = await query<MilestoneRow>('SELECT * FROM milestones WHERE id = $1', [id]);
  const milestone = result.rows[0];
  if (!milestone) throw notFound();
  const commission = await commissionFor(milestone.commission_id, caller);
  return { milestone, commission };
}

export interface FunderWithCommission {
  funder: FunderRow;
  commission: CommissionRow;
}

/** A funder row, reachable by the producer or by the sponsor bound to it. */
export async function funderFor(id: string, caller: Caller): Promise<FunderWithCommission> {
  if (!isUuid(id)) throw notFound();
  const result = await query<FunderRow>('SELECT * FROM funders WHERE id = $1', [id]);
  const funder = result.rows[0];
  if (!funder) throw notFound();
  const commission = await findCommission(funder.commission_id);
  if (!commission) throw notFound();
  if (isProducer(caller)) return { funder, commission };
  if (funder.accepted_user_id === caller.user.id) return { funder, commission };
  throw notFound();
}

/** The sponsor's own share of a commission. */
export async function shareFor(
  commissionId: string,
  caller: Caller,
): Promise<FunderWithCommission> {
  if (!isUuid(commissionId)) throw notFound();
  const result = await query<FunderRow>(
    `SELECT * FROM funders
      WHERE commission_id = $1 AND accepted_user_id = $2 AND kind = 'sponsor'`,
    [commissionId, caller.user.id],
  );
  const funder = result.rows[0];
  if (!funder) throw notFound();
  const commission = await findCommission(commissionId);
  if (!commission) throw notFound();
  return { funder, commission };
}

export interface FileRow {
  id: string;
  commission_id: string;
  kind: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  object_key: string;
  status: string;
  created_at: Date;
}

export async function fileFor(id: string, caller: Caller): Promise<FileRow> {
  if (!isUuid(id)) throw notFound();
  const result = await query<FileRow>('SELECT * FROM files WHERE id = $1', [id]);
  const file = result.rows[0];
  if (!file) throw notFound();
  await commissionFor(file.commission_id, caller);
  return file;
}

export interface RenderRow {
  id: string;
  commission_id: string;
  venue_photo_file_id: string;
  reference_image_url: string | null;
  state: string;
  progress: number;
  provider_job_id: string | null;
  failure_reason: string | null;
  preview_sha256: string | null;
  preview_object_key: string | null;
}

export async function renderFor(id: string, caller: Caller): Promise<RenderRow> {
  if (!isUuid(id)) throw notFound();
  const result = await query<RenderRow>('SELECT * FROM renders WHERE id = $1', [id]);
  const render = result.rows[0];
  if (!render) throw notFound();
  await commissionFor(render.commission_id, caller);
  return render;
}

/**
 * A document the caller may read: the client owner and producer see all of a
 * commission's documents; a sponsor sees only their own invoice.
 */
export async function documentFor(id: string, caller: Caller): Promise<DocumentRow> {
  if (!isUuid(id)) throw notFound();
  const result = await query<DocumentRow>('SELECT * FROM documents WHERE id = $1', [id]);
  const document = result.rows[0];
  if (!document) throw notFound();
  if (isProducer(caller)) return document;
  const commission = await findCommission(document.commission_id);
  if (!commission) throw notFound();
  if (commission.client_id === caller.user.id) return document;
  if (document.payer_funder_id) {
    const funder = await query<{ id: string }>(
      'SELECT id FROM funders WHERE id = $1 AND accepted_user_id = $2',
      [document.payer_funder_id, caller.user.id],
    );
    if (funder.rows[0]) return document;
  }
  throw notFound();
}

export interface InstallDayRecord {
  id: string;
  commission_id: string;
  venue_id: string;
  install_date: string;
  starts_at: Date;
  ends_at: Date;
  crew_user_ids: string[];
  confirmed_at: Date | null;
}

/** A crew lead reaches only the install days they are assigned to. */
export async function installDayFor(id: string, caller: Caller): Promise<InstallDayRecord> {
  if (!isUuid(id)) throw notFound();
  const result = await query<InstallDayRecord>('SELECT * FROM install_days WHERE id = $1', [id]);
  const day = result.rows[0];
  if (!day) throw notFound();
  if (isProducer(caller)) return day;
  if (caller.user.roles.includes('crew') && day.crew_user_ids.includes(caller.user.id)) return day;
  const commission = await findCommission(day.commission_id);
  if (commission && commission.client_id === caller.user.id) return day;
  throw notFound();
}

export interface BriefRow {
  id: string;
  client_id: string;
  answers: Record<string, unknown>;
  answered_through: number;
  commission_id: string | null;
}

export async function briefFor(id: string, caller: Caller): Promise<BriefRow> {
  if (!isUuid(id)) throw notFound();
  const result = await query<BriefRow>('SELECT * FROM briefs WHERE id = $1', [id]);
  const brief = result.rows[0];
  if (!brief) throw notFound();
  if (brief.client_id !== caller.user.id && !isProducer(caller)) throw notFound();
  return brief;
}
