import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { officeDateString, officeTimeString, offsetAbbreviation, secondBusinessDayAfter } from '../officeTime.js';
import type { Store } from '../store.js';
import type { Actor, AuditEntryDraft } from '../domain/audit.js';

export interface ScopeLossInput {
  personId: string;
  personName: string;
  vaultIds: string[];
  confirmedBy: string | null;
  cause: 'leave' | 'mover' | 'review' | 'term';
}

/**
 * The one place scope loss and turn creation happen. Each login in a lost vault
 * gets a `scope_loss` turn due two office business days later; undecided review
 * lines for the pair close as removed by scope change.
 */
export async function applyScopeLoss(
  store: Store,
  client: PoolClient,
  input: ScopeLossInput,
  actor: Actor
): Promise<Array<{ credential_id: string; label: string; due_by: string }>> {
  const now = store.clock.now();
  const today = officeDateString(now);
  const drafts: Array<Omit<AuditEntryDraft, 'actor'>> = [];
  const turnsDue: Array<{ credential_id: string; label: string; due_by: string }> = [];
  const credentials = await client.query(
    'SELECT id, label FROM credentials WHERE vault_id = ANY($1::text[]) ORDER BY created_seq, id',
    [input.vaultIds]
  );
  for (const credential of credentials.rows) {
    const dueBy = secondBusinessDayAfter(today);
    await client.query(
      `INSERT INTO turns (id, credential_id, rotation_id, kind, due_by, at, state, shifted, became_due_at, confirmed_by, created_seq, office_date, office_time, offset_abbrev)
       VALUES ($1, $2, NULL, 'scope_loss', $3, NULL, 'due', false, $4, $5, nextval('row_seq_seq'::regclass), $6, $7, $8)`,
      [newTurnId(), String(credential.id), dueBy, now, input.confirmedBy, today, officeTimeNow(now), offsetNow(now)]
    );
    turnsDue.push({ credential_id: String(credential.id), label: String(credential.label), due_by: dueBy });
    drafts.push({
      action: 'turn_due',
      subject: { kind: 'credential', id: String(credential.id), name: String(credential.label) },
      details: input.confirmedBy ? { confirmed_by: input.confirmedBy } : {}
    });
  }
  for (const vaultId of input.vaultIds) {
    drafts.push({
      action: 'scope_removed',
      subject: { kind: 'person', id: input.personId, name: input.personName },
      details: { vault_id: vaultId }
    });
  }
  // Close undecided review lines for the lost scopes while a review is open or overdue.
  const review = await openReview(client);
  if (review) {
    const lines = await client.query(
      `SELECT rl.id, rl.person_id, rl.vault_id, p.full_name AS person_name, v.name AS vault_name
       FROM review_lines rl
       JOIN people p ON p.id = rl.person_id
       JOIN vaults v ON v.id = rl.vault_id
       WHERE rl.review_id = $1 AND rl.person_id = $2 AND rl.decision = 'undecided'
         AND rl.vault_id = ANY($3::text[])`,
      [review.id, input.personId, input.vaultIds]
    );
    for (const line of lines.rows) {
      await client.query(
        `UPDATE review_lines SET decision = 'removed', decided_by = NULL, decided_via = 'scope_change' WHERE id = $1`,
        [String(line.id)]
      );
      drafts.push({
        action: 'review_decision',
        subject: { kind: 'person', id: String(line.person_id), name: String(line.person_name) },
        details: { vault_id: String(line.vault_id), decision: 'removed', decided_via: 'scope_change' }
      });
    }
  }
  await store.writeAudit(client, actor, drafts);
  return turnsDue;
}

/** Add undecided review lines for scopes gained while a review is open or overdue. */
export async function addReviewLinesForScopes(
  store: Store,
  client: PoolClient,
  personId: string,
  vaultIds: string[]
): Promise<string[]> {
  const review = await openReview(client);
  if (!review) return [];
  const added: string[] = [];
  for (const vaultId of vaultIds) {
    const existing = await client.query(
      'SELECT id FROM review_lines WHERE review_id = $1 AND person_id = $2 AND vault_id = $3',
      [review.id, personId, vaultId]
    );
    if (existing.rows.length > 0) continue;
    const position = await linePosition(client, review.id, personId, vaultId);
    const id = newLineId();
    await client.query(
      'INSERT INTO review_lines (id, review_id, person_id, vault_id, decision, decided_by, decided_via, position) VALUES ($1,$2,$3,$4,\'undecided\',NULL,NULL,$5)',
      [id, review.id, personId, vaultId, position]
    );
    added.push(id);
  }
  return added;
}

/** The line order: People order (seed order, then join order), within each person drawer order. */
async function linePosition(client: PoolClient, reviewId: string, personId: string, vaultId: string): Promise<number> {
  const rows = await client.query(
    `SELECT p.id AS person_id, v.id AS vault_id, p.created_seq AS person_seq
     FROM people p CROSS JOIN vaults v
     WHERE p.status <> 'left' AND p.role IN ('staff_accountant','outside_bookkeeper')
     ORDER BY p.created_seq, v.position`
  );
  const target = rows.rows.findIndex((row) => row.person_id === personId && row.vault_id === vaultId);
  return target >= 0 ? target + 1 : 10000;
}

async function openReview(client: PoolClient): Promise<{ id: string } | null> {
  const rows = await client.query(
    `SELECT id FROM reviews WHERE status IN ('open','overdue') ORDER BY opened_on DESC LIMIT 1`
  );
  return rows.rows.length > 0 ? { id: String(rows.rows[0].id) } : null;
}

/** End every Lockset session a person holds, so their cookie answers signed_out. */
export async function closePersonSessions(client: PoolClient, personId: string): Promise<void> {
  await client.query('UPDATE sessions SET ended_reason = $2 WHERE person_id = $1 AND ended_reason IS NULL', [
    personId,
    'signed_out'
  ]);
}

function newTurnId(): string {
  return `t-${randomUUID()}`;
}

function newLineId(): string {
  return `rl-${randomUUID()}`;
}

function officeTimeNow(now: Date): string {
  return officeTimeString(now);
}

function offsetNow(now: Date): string {
  return offsetAbbreviation(now);
}
