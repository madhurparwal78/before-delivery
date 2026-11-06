import pg from 'pg';
import { rows, tx } from './db.js';
import { sha256Hex } from './crypto.js';

export const AUDIT_ACTIONS = [
  'session.signed_in', 'session.sign_in_failed', 'password.changed',
  'two_step.enabled', 'two_step.disabled', 'member.role_changed', 'member.removed',
  'invite.created', 'invite.accepted', 'access_key.created', 'access_key.rotated',
  'access_key.disabled', 'access_key.deleted', 'legal_hold.changed', 'encryption.rotated',
  'workspace.suspended', 'workspace.reinstated', 'permission.denied',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

function utcSecond(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** The canonical hash input: seven lines joined by line feeds. */
export function auditHash(seq: number, at: Date, actor: string, action: string, target: string, detail: string, prevHash: string): string {
  return sha256Hex([String(seq), utcSecond(at), actor, action, target, detail, prevHash].join('\n'));
}

/** Appends one entry to a workspace's chain, inside the caller's transaction.
 *  The head row's lock keeps concurrent appends gapless. */
export async function auditAppend(
  client: pg.PoolClient, ws: string, actor: string, action: AuditAction, target: string, detail: string, at = new Date(),
): Promise<void> {
  await client.query(
    `INSERT INTO audit_heads (workspace_slug, last_seq, last_hash) VALUES ($1, 0, $2)
     ON CONFLICT (workspace_slug) DO NOTHING`, [ws, '0'.repeat(64)]
  );
  const head = await client.query<{ last_seq: string; last_hash: string }>(
    `SELECT last_seq::text AS last_seq, last_hash FROM audit_heads WHERE workspace_slug = $1 FOR UPDATE`, [ws]
  );
  const prevSeq = Number(head.rows[0].last_seq);
  const seq = prevSeq + 1;
  const prevHash = head.rows[0].last_hash;
  const hash = auditHash(seq, at, actor, action, target, detail, prevHash);
  await client.query(
    `INSERT INTO audit_entries (workspace_slug, seq, at, actor, action, target, detail, prev_hash, hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [ws, seq, at, actor, action, target, detail, prevHash, hash]
  );
  await client.query(
    `UPDATE audit_heads SET last_seq = $1, last_hash = $2 WHERE workspace_slug = $3`,
    [seq, hash, ws]
  );
}

/** Standalone append for actions outside an existing transaction. */
export async function audit(ws: string, actor: string, action: AuditAction, target: string, detail: string): Promise<void> {
  await tx(async client => auditAppend(client, ws, actor, action, target, detail));
}

/** Writes a user-account action to every workspace the user belongs to. */
export async function auditUserAction(userId: string, actor: string, action: AuditAction, target: string, detail: string): Promise<void> {
  const r = await rows<{ workspace_slug: string }>(
    `SELECT workspace_slug FROM members WHERE user_id = $1`, [userId]
  );
  for (const row of r) await audit(row.workspace_slug, actor, action, target, detail);
}

/** CSV neutralisation: formula leads get a single quote. */
export function neutralise(value: string): string {
  const first = value[0];
  if (first === '=' || first === '+' || first === '-' || first === '@' || first === '\t' || first === '\r') {
    return "'" + value;
  }
  return value;
}

/** RFC 4180 quoting applied after neutralisation. */
export function csvField(value: string): string {
  const n = neutralise(value);
  if (/[",\r\n]/.test(n)) return '"' + n.replace(/"/g, '""') + '"';
  return n;
}

/** Verifies a workspace chain and names the first broken entry. */
export async function verifyChain(ws: string): Promise<{ ok: boolean; entries: number; first_broken_seq: number | null }> {
  const entries = await rows<{
    seq_text: string; at: Date; actor: string; action: string; target: string; detail: string; prev_hash: string; hash: string;
  }>(`SELECT seq::text AS seq_text, at, actor, action, target, detail, prev_hash, hash
      FROM audit_entries WHERE workspace_slug = $1 ORDER BY audit_entries.seq ASC`, [ws]);
  let firstBroken: number | null = null;
  let expected: number | null = null;
  let prevHash = '0'.repeat(64);
  let prevSeq = 0;
  for (const e of entries) {
    const seq = Number(e.seq_text);
    if (expected === null) expected = 1;
    if (seq !== expected && firstBroken === null) firstBroken = seq > expected ? expected : seq;
    if (e.prev_hash !== prevHash && firstBroken === null) firstBroken = seq;
    const recomputed = auditHash(seq, e.at, e.actor, e.action, e.target, e.detail, e.prev_hash);
    if (e.hash !== recomputed && firstBroken === null) firstBroken = seq;
    prevHash = e.hash;
    prevSeq = seq;
    expected = seq + 1;
  }
  void prevSeq;
  return { ok: firstBroken === null, entries: entries.length, first_broken_seq: firstBroken };
}
