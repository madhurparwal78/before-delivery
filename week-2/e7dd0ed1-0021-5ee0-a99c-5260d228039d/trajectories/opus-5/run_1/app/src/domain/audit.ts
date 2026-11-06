import type { PoolClient } from '../db';
import { row, rows } from '../db';
import { isoSecond } from '../format';
import { sha256Hex } from '../crypto/seal';
import { nowSecond } from '../http/core';

export const auditActions = [
  'session.signed_in',
  'session.sign_in_failed',
  'password.changed',
  'two_step.enabled',
  'two_step.disabled',
  'member.role_changed',
  'member.removed',
  'invite.created',
  'invite.accepted',
  'access_key.created',
  'access_key.rotated',
  'access_key.disabled',
  'access_key.deleted',
  'legal_hold.changed',
  'encryption.rotated',
  'workspace.suspended',
  'workspace.reinstated',
  'permission.denied',
] as const;

export type AuditAction = (typeof auditActions)[number];

export interface AuditEntryInput {
  actor: string;
  action: AuditAction;
  target: string;
  detail: string;
  at?: Date;
}

const zeroHash = '0'.repeat(64);

export function chainHash(entry: { seq: number | string; at: Date; actor: string; action: string; target: string; detail: string; prevHash: string }): string {
  return sha256Hex(
    [String(entry.seq), isoSecond(entry.at), entry.actor, entry.action, entry.target, entry.detail, entry.prevHash].join('\n'),
  );
}

/** The one audit append: gapless per workspace, hash-chained, in the caller's transaction. */
export async function appendAudit(client: PoolClient, workspaceSlug: string, entry: AuditEntryInput): Promise<void> {
  const workspace = await row<{ audit_seq: string }>(client, 'select audit_seq from workspaces where slug = $1 for update', [
    workspaceSlug,
  ]);
  if (!workspace) return;
  const seq = Number(workspace.audit_seq) + 1;
  const previous = await row<{ hash: string }>(client, 'select hash from audit_entries where workspace_slug = $1 and seq = $2', [
    workspaceSlug,
    seq - 1,
  ]);
  const prevHash = previous?.hash ?? zeroHash;
  const at = nowSecond(entry.at ?? new Date());
  const hash = chainHash({ seq, at, actor: entry.actor, action: entry.action, target: entry.target, detail: entry.detail, prevHash });
  await client.query(
    `insert into audit_entries (workspace_slug, seq, at, actor, action, target, detail, prev_hash, hash)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [workspaceSlug, seq, at.toISOString(), entry.actor, entry.action, entry.target, entry.detail, prevHash, hash],
  );
  await client.query('update workspaces set audit_seq = $2 where slug = $1', [workspaceSlug, seq]);
}

/** Sign-in, password and two-step actions are written to every workspace the user belongs to. */
export async function appendAuditForUser(client: PoolClient, userId: string, entry: AuditEntryInput): Promise<void> {
  const memberships = await rows<{ workspace_slug: string }>(client, 'select workspace_slug from memberships where user_id = $1 order by workspace_slug', [
    userId,
  ]);
  for (const membership of memberships) await appendAudit(client, membership.workspace_slug, entry);
}

export interface AuditRow {
  seq: string;
  at: string;
  actor: string;
  action: string;
  target: string;
  detail: string;
  prev_hash: string;
  hash: string;
}

export async function verifyChain(client: PoolClient, workspaceSlug: string): Promise<{ ok: boolean; entries: number; firstBrokenSeq: number | null }> {
  const stored = await rows<AuditRow>(
    client,
    'select seq, at, actor, action, target, detail, prev_hash, hash from audit_entries where workspace_slug = $1 order by seq',
    [workspaceSlug],
  );
  let firstBroken: number | null = null;
  let expectedSeq = 1;
  let previousHash = zeroHash;
  for (const entry of stored) {
    const seq = Number(entry.seq);
    if (seq !== expectedSeq && firstBroken === null) firstBroken = expectedSeq;
    if (firstBroken !== null) break;
    const recomputed = chainHash({
      seq,
      at: new Date(entry.at),
      actor: entry.actor,
      action: entry.action,
      target: entry.target,
      detail: entry.detail,
      prevHash: entry.prev_hash,
    });
    if (entry.prev_hash !== previousHash || recomputed !== entry.hash) {
      firstBroken = seq;
      break;
    }
    previousHash = entry.hash;
    expectedSeq = seq + 1;
  }
  return { ok: firstBroken === null, entries: stored.length, firstBrokenSeq: firstBroken };
}
