import type { PoolClient } from 'pg';
import type { AuditWriter } from '../audit.js';
import { sendTo } from '../events.js';
import { endSessionsFor } from '../auth.js';
import { endUserSessions, setUserEnabled } from '../services/keycloak.js';
import { addLinesForScopeGain, closeLinesForScopeLoss, openReview } from './reviews.js';
import { createScopeLossTurns, dueByAfter, type TurnsDue } from './turns.js';
import { officeDate } from '../officeTime.js';
import { deskStaffIds } from './people.js';
import type { PersonRow, VaultRow } from '../types.js';

export type Actor = { personId: string; name: string } | 'Lockset';

export async function plannedTurns(
  client: PoolClient,
  vaultIds: readonly string[],
  at: Date,
): Promise<TurnsDue[]> {
  if (vaultIds.length === 0) return [];
  const dueBy = dueByAfter(officeDate(at));
  const rows = await client.query<{ id: string; label: string }>(
    'select id, label from credentials where vault_id = any($1::uuid[]) order by order_no asc',
    [[...vaultIds]],
  );
  return rows.rows.map((row) => ({ credential_id: row.id, label: row.label, due_by: dueBy }));
}

/**
 * The effects every lost scope has: the review line closes, the vault's logins
 * get a turn, and the loss is written to the audit trail.
 */
export async function applyScopeLoss(
  client: PoolClient,
  write: AuditWriter,
  options: {
    person: PersonRow;
    vaults: readonly VaultRow[];
    actor: Actor;
    confirmedBy: string | null;
    at: Date;
  },
): Promise<{ turnsDue: TurnsDue[]; reviewTouched: boolean }> {
  if (options.vaults.length === 0) return { turnsDue: [], reviewTouched: false };
  for (const vault of options.vaults) {
    await write({
      actor: options.actor,
      action: 'scope_removed',
      subject: { kind: 'person', id: options.person.id, name: options.person.full_name },
      details: { vault_id: vault.id, vault_name: vault.name },
    });
  }
  const review = await openReview();
  let closed = 0;
  if (review !== null) {
    closed = await closeLinesForScopeLoss(client, write, {
      review,
      personId: options.person.id,
      personName: options.person.full_name,
      vaultIds: options.vaults.map((vault) => vault.id),
      actor: options.actor,
    });
  }
  const turnsDue = await createScopeLossTurns(client, write, {
    vaultIds: options.vaults.map((vault) => vault.id),
    at: options.at,
    actor: options.actor,
    confirmedBy: options.confirmedBy,
  });
  return { turnsDue, reviewTouched: closed > 0 };
}

export async function applyScopeGain(
  client: PoolClient,
  write: AuditWriter,
  options: { person: PersonRow; vaultIds: readonly string[]; actor: Actor },
): Promise<boolean> {
  if (options.vaultIds.length === 0) return false;
  if (options.person.role !== 'staff_accountant' && options.person.role !== 'outside_bookkeeper') return false;
  const review = await openReview();
  if (review === null) return false;
  const added = await addLinesForScopeGain(client, write, {
    review,
    personId: options.person.id,
    personName: options.person.full_name,
    vaultIds: options.vaultIds,
    actor: options.actor,
  });
  return added > 0;
}

/** A leave and the end of an engagement term have the same effects. */
export async function applyLeave(
  client: PoolClient,
  write: AuditWriter,
  options: {
    person: PersonRow;
    vaults: readonly VaultRow[];
    actor: Actor;
    at: Date;
    cause: 'leave' | 'term_end';
  },
): Promise<{ turnsDue: TurnsDue[] }> {
  const { person, at } = options;
  if (person.keycloak_id !== null) {
    await setUserEnabled(person.keycloak_id, false);
    await endUserSessions(person.keycloak_id);
  }
  await client.query('update people set left_at = $2, keycloak_enabled = false where id = $1', [person.id, at]);
  await client.query('delete from person_vaults where person_id = $1', [person.id]);
  const confirmedBy = options.actor === 'Lockset' ? 'Lockset' : options.actor.name;
  await write({
    actor: options.actor,
    action: options.cause === 'leave' ? 'person_leave' : 'term_end',
    subject: { kind: 'person', id: person.id, name: person.full_name },
    details: {
      confirmed_by: confirmedBy,
      turns_due: await plannedTurns(client, options.vaults.map((vault) => vault.id), at),
    },
  });
  const outcome = await applyScopeLoss(client, write, {
    person,
    vaults: options.vaults,
    actor: options.actor,
    confirmedBy: options.actor === 'Lockset' ? null : options.actor.name,
    at,
  });
  return { turnsDue: outcome.turnsDue };
}

export async function announceLeave(person: PersonRow): Promise<void> {
  await endSessionsFor(person.id);
  sendTo(await deskStaffIds(), { name: 'billing-changed', data: {} });
}

export async function announceReviewChange(reviewId: string): Promise<void> {
  sendTo(await deskStaffIds(), { name: 'review-changed', data: { review_id: reviewId } });
}
