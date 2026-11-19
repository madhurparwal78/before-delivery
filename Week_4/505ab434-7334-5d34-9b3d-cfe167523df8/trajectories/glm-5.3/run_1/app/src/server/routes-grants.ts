import type { Ctx, Method, Principal } from './http';
import { requireSession } from './http';
import { withTransaction, query, type Tx } from './db';
import {
  forbidden,
  invalidBody,
  notFound,
  proofType,
  proofTooLarge,
  reasonRequired,
  storageProof,
  storageDownload,
  wrongStateGrant,
  wrongStateRequest,
  ApiError,
} from './errors';
import type { Config } from './config';
import { readClock } from './clock';
import { appendAudit } from './audit';
import { queueMail, revokedMail, decisionMail } from './mail';
import { notify } from './pglisten';
import { nextProofId } from './requests-core';
import { auditDenied } from './audit-denied';
import { created } from './created';
import { S3Client } from './s3client';
import { GRANT_STATUS_LABELS, PROOF_STATUS_LABELS, type ProofStatus } from '../shared/domain';
import { formatDay } from './datetime';
import { verifyPassword } from './crypto';

const PROOF_SIGNATURES: { magic: number[]; format: string }[] = [
  { magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], format: 'png' },
  { magic: [0xff, 0xd8, 0xff], format: 'jpeg' },
  { magic: [0x25, 0x50, 0x44, 0x46, 0x2d], format: 'pdf' },
];

function detectProofType(bytes: Buffer): 'png' | 'jpeg' | 'pdf' | null {
  for (const sig of PROOF_SIGNATURES) {
    if (sig.magic.every((b, i) => bytes[i] === b)) return sig.format as 'png' | 'jpeg' | 'pdf';
  }
  return null;
}

export function routeGrants(
  router: { add: (m: Method, p: string, h: (ctx: Ctx) => Promise<unknown>) => void },
  cfg: Config,
  s3: S3Client,
): void {
  router.add('GET', '/grants', async (ctx) => {
    const principal = requireSession(ctx);
    const rows =
      principal.role === 'owner' || principal.role === 'legal_reviewer'
        ? await query<{ id: string }>('SELECT id FROM grants ORDER BY created_at, id', [])
        : await query<{ id: string }>(
            `SELECT g.id FROM grants g
              WHERE (g.holder_type = 'principal' AND g.holder_principal_id = $1)
                 OR (g.holder_type = 'group' AND g.holder_group_id IN (SELECT group_id FROM group_members WHERE principal_id = $1))
              ORDER BY g.created_at, g.id`,
            [principal.id],
          );
    const grants = [];
    for (const row of rows) {
      grants.push(await grantDetail(row.id, principal, cfg));
    }
    return { grants };
  });

  router.add('GET', '/grants/:id', async (ctx) => {
    const principal = requireSession(ctx);
    return grantDetail(ctx.params.id, principal, cfg);
  });

  router.add('POST', '/grants/:id/revoke', async (ctx) => {
    const principal = requireSession(ctx);
    if (principal.role !== 'owner' && principal.role !== 'legal_reviewer') {
      const grant = await loadGrant(ctx.params.id);
      if (!(await canSeeGrantAsync(principal, grant))) throw notFound();
      await auditDenied(
        {
          actorId: principal.id,
          actorRole: principal.role,
          action: 'grant.revoked',
          resourceType: 'grant',
          resourceId: grant.id,
          requestId: grant.request_id,
        },
        await readClock(cfg),
      );
      throw forbidden();
    }
    const body = asRecord(ctx.body.json);
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length === 0) throw reasonRequired();
    const now = await readClock(cfg);
    const grant = await loadGrant(ctx.params.id);
    if (!(await canSeeGrantAsync(principal, grant))) throw notFound();
    if (grant.status !== 'active' && grant.status !== 'pending_proof') {
      throw wrongStateGrant(grant.id, GRANT_STATUS_LABELS[grant.status as keyof typeof GRANT_STATUS_LABELS]);
    }
    await withTransaction(async (tx) => {
      await tx.query('SELECT id FROM grants WHERE id = $1 FOR UPDATE', [grant.id]);
      const fresh = await loadGrantTx(tx, grant.id);
      if (fresh.status !== 'active' && fresh.status !== 'pending_proof') {
        throw wrongStateGrant(grant.id, GRANT_STATUS_LABELS[fresh.status as keyof typeof GRANT_STATUS_LABELS]);
      }
      await tx.query(`UPDATE grants SET status = 'revoked', revoked_reason = $2 WHERE id = $1`, [grant.id, reason]);
      await appendAudit(tx, {
        occurredAt: now,
        actorId: principal.id,
        actorRole: principal.role,
        action: 'grant.revoked',
        resourceType: 'grant',
        resourceId: grant.id,
        requestId: fresh.request_id,
        before: { status: fresh.status },
        after: { reason, status: 'revoked' },
        outcome: 'success',
      });
      await sendRevokedMails(tx, grant.id, reason, now);
      await notifyAll(tx);
    });
    return grantDetail(grant.id, principal, cfg);
  });

  router.add('POST', '/grants/:id/proofs', async (ctx) => {
    const principal = requireSession(ctx);
    const now = await readClock(cfg);
    const grant = await loadGrant(ctx.params.id);
    if (grant.holder_type !== 'principal' || grant.holder_principal_id !== principal.id) throw notFound();
    if (grant.status !== 'pending_proof') {
      throw wrongStateGrant(grant.id, GRANT_STATUS_LABELS[grant.status as keyof typeof GRANT_STATUS_LABELS]);
    }
    if (!ctx.body.file) throw proofType();
    const bytes = ctx.body.file.bytes;
    if (detectProofType(bytes) === null) throw proofType();
    if (bytes.length > cfg.proofMaxBytes) {
      throw proofTooLarge(printMb(cfg.proofMaxBytes));
    }
    const existing = await query<{ id: string }>(
      `SELECT id FROM proofs WHERE grant_id = $1 AND status = 'pending_review'`,
      [grant.id],
    );
    if (existing.length > 0) throw wrongStateRequest(grant.id, 'Pending proof');
    const storageOk = await storageReachable(s3);
    if (!storageOk) throw storageProof();
    const proofId = await withTransaction(async (tx) => {
      const id = await nextProofId(tx);
      const objectKey = `proofs/${grant.id}/${id}`;
      await s3.put(objectKey, bytes, 'application/octet-stream');
      await tx.query(
        `INSERT INTO proofs (id, grant_id, file_name, status, uploaded_at) VALUES ($1,$2,$3,'pending_review',$4)`,
        [id, grant.id, ctx.body.file!.fileName, now],
      );
      await appendAudit(tx, {
        occurredAt: now,
        actorId: principal.id,
        actorRole: principal.role,
        action: 'proof.uploaded',
        resourceType: 'proof',
        resourceId: id,
        requestId: grant.request_id,
        before: null,
        after: { fileName: ctx.body.file!.fileName, status: 'pending_review' },
        outcome: 'success',
      });
      await notifyAll(tx);
      return id;
    });
    return created({ id: proofId, fileName: ctx.body.file.fileName, status: 'pending_review', uploadedAt: now.toISOString() });
  });

  router.add('GET', '/proofs/:id/content', async (ctx) => {
    const principal = requireSession(ctx);
    const proof = await loadProof(ctx.params.id);
    if (!canSeeProof(principal, proof)) throw notFound();
    const ok = await storageReachable(s3);
    if (!ok) throw storageDownload();
    const bytes = await s3.get(`proofs/${proof.grant_id}/${proof.id}`);
    if (!bytes) throw notFound();
    return { __bytes: bytes, fileName: proof.file_name };
  });

  router.add('POST', '/proofs/:id/accept', async (ctx) => {
    const principal = requireSession(ctx);
    if (!['brand_reviewer', 'legal_reviewer', 'owner'].includes(principal.role)) throw forbidden();
    const now = await readClock(cfg);
    const proof = await loadProof(ctx.params.id);
    const grant = await loadGrant(proof.grant_id);
    if (!canSeeProof(principal, proof)) throw notFound();
    if (proof.status !== 'pending_review') {
      throw wrongStateRequest(proof.id, PROOF_STATUS_LABELS[proof.status as keyof typeof PROOF_STATUS_LABELS]);
    }
    const approvalDate = localDate(now, cfg);
    await withTransaction(async (tx) => {
      await tx.query('SELECT id FROM proofs WHERE id = $1 FOR UPDATE', [proof.id]);
      const freshProof = await loadProofTx(tx, proof.id);
      if (freshProof.status !== 'pending_review') {
        throw wrongStateRequest(proof.id, PROOF_STATUS_LABELS[freshProof.status as keyof typeof PROOF_STATUS_LABELS]);
      }
      await tx.query(`UPDATE proofs SET status = 'accepted' WHERE id = $1`, [proof.id]);
      await tx.query(`UPDATE grants SET status = 'active', not_before = $2 WHERE id = $1`, [
        grant.id,
        approvalDate,
      ]);
      await appendAudit(tx, {
        occurredAt: now,
        actorId: principal.id,
        actorRole: principal.role,
        action: 'proof.accepted',
        resourceType: 'proof',
        resourceId: proof.id,
        requestId: grant.request_id,
        before: { status: 'pending_review' },
        after: { status: 'accepted' },
        outcome: 'success',
      });
      await appendAudit(tx, {
        occurredAt: now,
        actorId: principal.id,
        actorRole: principal.role,
        action: 'grant.activated',
        resourceType: 'grant',
        resourceId: grant.id,
        requestId: grant.request_id,
        before: { status: 'pending_proof' },
        after: { notBefore: approvalDate, status: 'active' },
        outcome: 'success',
      });
      await notifyAll(tx);
    });
    return grantDetail(grant.id, principal, cfg);
  });

  router.add('POST', '/proofs/:id/reject', async (ctx) => {
    const principal = requireSession(ctx);
    if (!['brand_reviewer', 'legal_reviewer', 'owner'].includes(principal.role)) throw forbidden();
    const body = asRecord(ctx.body.json);
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length === 0) throw reasonRequired();
    const now = await readClock(cfg);
    const proof = await loadProof(ctx.params.id);
    const grant = await loadGrant(proof.grant_id);
    if (!canSeeProof(principal, proof)) throw notFound();
    if (proof.status !== 'pending_review') {
      throw wrongStateRequest(proof.id, PROOF_STATUS_LABELS[proof.status as keyof typeof PROOF_STATUS_LABELS]);
    }
    await withTransaction(async (tx) => {
      await tx.query('SELECT id FROM proofs WHERE id = $1 FOR UPDATE', [proof.id]);
      const freshProof = await loadProofTx(tx, proof.id);
      if (freshProof.status !== 'pending_review') {
        throw wrongStateRequest(proof.id, PROOF_STATUS_LABELS[freshProof.status as keyof typeof PROOF_STATUS_LABELS]);
      }
      await tx.query(`UPDATE proofs SET status = 'rejected', reason = $2 WHERE id = $1`, [proof.id, reason]);
      await appendAudit(tx, {
        occurredAt: now,
        actorId: principal.id,
        actorRole: principal.role,
        action: 'proof.rejected',
        resourceType: 'proof',
        resourceId: proof.id,
        requestId: grant.request_id,
        before: { status: 'pending_review' },
        after: { reason, status: 'rejected' },
        outcome: 'success',
      });
      if (grant.request_id) {
        const requester = await txRows<{ email: string }>(
          tx,
          'SELECT p.email FROM requests r JOIN principals p ON p.id = r.requester_id WHERE r.id = $1',
          [grant.request_id],
        );
        if (requester[0]) {
          await queueMail(tx, decisionMail(cfg, grant.request_id, 'Rejected', reason, requester[0].email), now);
        }
      }
      await notifyAll(tx);
    });
    return grantDetail(grant.id, principal, cfg);
  });
}

export async function grantDetail(grantId: string, principal: Principal, cfg: Config): Promise<unknown> {
  void cfg;
  const grant = await loadGrant(grantId);
  if (!(await canSeeGrantAsync(principal, grant))) throw notFound();
  const conditions = await query<{ kind: string; text: string }>(
    `SELECT kind, text FROM conditions WHERE request_id = $1 ORDER BY position`,
    [grant.request_id],
  );
  const asset = await query<{ name: string; variant_label: string | null }>(
    `SELECT a.name, v.label AS variant_label FROM assets a LEFT JOIN variants v ON v.id = $2 WHERE a.id = $1`,
    [grant.asset_id, grant.variant_id],
  );
  const holderName =
    grant.holder_type === 'principal'
      ? (await query<{ display_name: string }>('SELECT display_name FROM principals WHERE id = $1', [
          grant.holder_principal_id,
        ]))[0]?.display_name ?? ''
      : (await query<{ name: string }>('SELECT name FROM groups WHERE id = $1', [grant.holder_group_id]))[0]?.name ?? '';
  return {
    id: grant.id,
    status: grant.status,
    statusLabel: GRANT_STATUS_LABELS[grant.status as keyof typeof GRANT_STATUS_LABELS],
    holder: { type: grant.holder_type, id: grant.holder_type === 'principal' ? grant.holder_principal_id : grant.holder_group_id, displayName: holderName },
    cardName: grant.variant_id ? `${asset[0]?.name} — ${asset[0]?.variant_label}` : asset[0]?.name,
    requestId: grant.request_id,
    notBefore: grant.not_before,
    notAfter: grant.not_after,
    cap: grant.cap,
    conditions,
    revokedReason: grant.revoked_reason,
  };
}

export interface GrantFull {
  id: string;
  holder_type: 'principal' | 'group';
  holder_principal_id: string | null;
  holder_group_id: string | null;
  asset_id: string;
  variant_id: string | null;
  request_id: string | null;
  status: string;
  not_before: string | null;
  not_after: string;
  cap: string | null;
  revoked_reason: string | null;
}

export async function loadGrant(id: string): Promise<GrantFull> {
  const rows = await query<GrantFull & { not_before: string | null }>(
    `SELECT id, holder_type, holder_principal_id, holder_group_id, asset_id, variant_id,
            request_id, status, not_before::text, not_after::text, cap, revoked_reason
       FROM grants WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) throw notFound();
  return rows[0];
}

async function loadGrantTx(tx: Tx, id: string): Promise<GrantFull> {
  const rows = await tx.query<GrantFull & { not_before: string | null }>(
    `SELECT id, holder_type, holder_principal_id, holder_group_id, asset_id, variant_id,
            request_id, status, not_before::text, not_after::text, cap, revoked_reason
       FROM grants WHERE id = $1`,
    [id],
  );
  if (rows.rows.length === 0) throw notFound();
  return rows.rows[0];
}

/** Group-held grants are visible to the holder's members; resolved async by callers. */
export async function canSeeGrantAsync(principal: Principal, grant: GrantFull): Promise<boolean> {
  if (principal.role === 'owner' || principal.role === 'legal_reviewer') return true;
  if (grant.holder_type === 'principal') return grant.holder_principal_id === principal.id;
  if (grant.holder_group_id) {
    const rows = await query<{ c: string }>(
      'SELECT COUNT(*)::text AS c FROM group_members WHERE group_id = $1 AND principal_id = $2',
      [grant.holder_group_id, principal.id],
    );
    return Number(rows[0]?.c ?? 0) > 0;
  }
  return false;
}

export interface ProofFull {
  id: string;
  grant_id: string;
  file_name: string;
  status: string;
  reason: string | null;
}

async function loadProof(id: string): Promise<ProofFull> {
  const rows = await query<ProofFull>('SELECT id, grant_id, file_name, status, reason FROM proofs WHERE id = $1', [id]);
  if (rows.length === 0) throw notFound();
  return rows[0];
}

async function loadProofTx(tx: Tx, id: string): Promise<ProofFull> {
  const rows = await tx.query<ProofFull>('SELECT id, grant_id, file_name, status, reason FROM proofs WHERE id = $1', [id]);
  if (rows.rows.length === 0) throw notFound();
  return rows.rows[0];
}

function canSeeProof(principal: Principal, proof: ProofFull): boolean {
  if (['brand_reviewer', 'legal_reviewer', 'owner'].includes(principal.role)) return true;
  return false;
}

async function sendRevokedMails(tx: Tx, grantId: string, reason: string, now: Date): Promise<void> {
  const grant = await loadGrantTx(tx, grantId);
  if (grant.holder_type === 'principal' && grant.holder_principal_id) {
    const holder = await txRows<{ email: string }>(tx, 'SELECT email FROM principals WHERE id = $1', [
      grant.holder_principal_id,
    ]);
    for (const h of holder) await queueMail(tx, revokedMail(grantId, reason, h.email), now);
  } else if (grant.holder_group_id) {
    const members = await txRows<{ email: string }>(
      tx,
      'SELECT p.email FROM group_members gm JOIN principals p ON p.id = gm.principal_id WHERE gm.group_id = $1',
      [grant.holder_group_id],
    );
    for (const m of members) await queueMail(tx, revokedMail(grantId, reason, m.email), now);
  }
}

async function txRows<T extends Record<string, unknown>>(tx: Tx, sql: string, params: readonly unknown[]): Promise<T[]> {
  const res = await tx.query(sql, params as unknown[]);
  return res.rows as T[];
}

async function notifyAll(tx: Tx): Promise<void> {
  await notify(tx, JSON.stringify({ type: 'library.updated' }));
  await notify(tx, JSON.stringify({ type: 'grant.updated' }));
}

export async function storageReachable(s3: S3Client): Promise<boolean> {
  const ep = (process.env.S3_ENDPOINT ?? '').replace(/\/+$/, '');
  try {
    const res = await fetch(`${ep}/minio/health/live`, { signal: AbortSignal.timeout(900) });
    return res.ok;
  } catch {
    return false;
  }
}

export function printMb(bytes: number): string {
  const mb = bytes / 1048576;
  return String(Number.isInteger(mb) ? mb : Number(mb.toFixed(6)));
}

function localDate(now: Date, cfg: Config): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: cfg.appTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(now);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export { formatDay, verifyPassword, ApiError };
