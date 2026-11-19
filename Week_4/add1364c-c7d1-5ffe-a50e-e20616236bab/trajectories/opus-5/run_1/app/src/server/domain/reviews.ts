import type { PoolClient } from 'pg';
import { query } from '../db.js';
import type { AuditWriter } from '../audit.js';
import { newId } from '../secretStore.js';
import type { Decision, ReviewStatus } from '../types.js';

export const REVIEW_OVERDUE_BUSINESS_DAY = 11;

export type ReviewRow = {
  id: string;
  year: number;
  quarter: number;
  opened_on: string;
  overdue_from: string;
  status: ReviewStatus;
  signed_off_by: string | null;
  signed_off_at: Date | null;
};

export type ReviewLineRow = {
  id: string;
  review_id: string;
  person_id: string;
  person_name: string;
  person_order: number;
  vault_id: string;
  vault_name: string;
  vault_formerly: string | null;
  drawer_order: number;
  decision: Decision;
  decided_by: string | null;
  decided_via: 'review' | 'scope_change' | null;
  created_at: Date;
};

export const REVIEWED_ROLES = ['staff_accountant', 'outside_bookkeeper'] as const;

export async function loadReviews(): Promise<ReviewRow[]> {
  return query<ReviewRow>('select * from reviews order by year desc, quarter desc');
}

export async function loadReview(id: string): Promise<ReviewRow | null> {
  const rows = await query<ReviewRow>('select * from reviews where id = $1', [id]);
  return rows[0] ?? null;
}

export async function openReview(): Promise<ReviewRow | null> {
  const rows = await query<ReviewRow>(
    "select * from reviews where status in ('open','overdue') order by year desc, quarter desc limit 1",
  );
  return rows[0] ?? null;
}

const LINE_SELECT = `
  select rl.*, p.full_name as person_name, p.order_no as person_order,
         v.name as vault_name, v.formerly as vault_formerly, v.drawer_order
    from review_lines rl
    join people p on p.id = rl.person_id
    join vaults v on v.id = rl.vault_id
   where rl.review_id = $1
   order by p.order_no asc, v.drawer_order asc, rl.created_at asc`;

export async function loadReviewLines(reviewId: string): Promise<ReviewLineRow[]> {
  return query<ReviewLineRow>(LINE_SELECT, [reviewId]);
}

export function reviewProgress(lines: readonly ReviewLineRow[]): { decided: number; total: number } {
  return { decided: lines.filter((line) => line.decision !== 'undecided').length, total: lines.length };
}

/** A lost scope closes that pair's undecided line as removed by the scope change. */
export async function closeLinesForScopeLoss(
  client: PoolClient,
  write: AuditWriter,
  options: {
    review: ReviewRow;
    personId: string;
    personName: string;
    vaultIds: readonly string[];
    actor: { personId: string; name: string } | 'Lockset';
  },
): Promise<number> {
  if (options.vaultIds.length === 0) return 0;
  const closed = await client.query<{ id: string; vault_name: string }>(
    `update review_lines rl
        set decision = 'removed', decided_by = null, decided_via = 'scope_change'
      where rl.review_id = $1 and rl.person_id = $2 and rl.vault_id = any($3::uuid[]) and rl.decision = 'undecided'
      returning rl.id, (select name from vaults where id = rl.vault_id) as vault_name`,
    [options.review.id, options.personId, [...options.vaultIds]],
  );
  for (const line of closed.rows) {
    await write({
      actor: options.actor,
      action: 'review_decision',
      subject: { kind: 'review_line', id: line.id, name: `${options.personName} on ${line.vault_name}` },
      details: { decided_via: 'scope_change', decision: 'removed' },
    });
  }
  return closed.rowCount ?? 0;
}

/** A gained scope adds an undecided line, unless the pair already has one. */
export async function addLinesForScopeGain(
  client: PoolClient,
  write: AuditWriter,
  options: {
    review: ReviewRow;
    personId: string;
    personName: string;
    vaultIds: readonly string[];
    actor: { personId: string; name: string } | 'Lockset';
  },
): Promise<number> {
  let added = 0;
  for (const vaultId of options.vaultIds) {
    const inserted = await client.query<{ id: string; vault_name: string }>(
      `insert into review_lines (id, review_id, person_id, vault_id, decision)
       values ($1,$2,$3,$4,'undecided')
       on conflict do nothing
       returning id, (select name from vaults where id = $4) as vault_name`,
      [newId(), options.review.id, options.personId, vaultId],
    );
    const line = inserted.rows[0];
    if (line === undefined) continue;
    added += 1;
    await write({
      actor: options.actor,
      action: 'review_line_added',
      subject: { kind: 'review_line', id: line.id, name: `${options.personName} on ${line.vault_name}` },
      details: {},
    });
  }
  return added;
}
