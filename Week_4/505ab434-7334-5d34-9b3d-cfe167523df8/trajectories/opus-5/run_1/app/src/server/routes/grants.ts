import { GRANT_STATUS_LABELS, PROOF_STATUS_LABELS } from '../../shared/labels.js';
import type { GrantView } from '../../shared/types.js';
import { appendAudit } from '../audit.js';
import { config } from '../config.js';
import { db, nextCounter, paddedId, withTransaction, type Queryable } from '../db.js';
import { effectiveGrantStatus } from '../domain/availability.js';
import type { GrantRecord, PrincipalRecord } from '../domain/records.js';
import { wrongGrantState } from '../domain/transitions.js';
import { errors } from '../errors.js';
import { detectFormat } from '../images.js';
import { jsonBody, parseMultipart, requireSignedIn, type Ctx } from '../http/context.js';
import { sendJson } from '../http/respond.js';
import { EVERYONE, REVIEWERS, publish } from '../live.js';
import { enqueueMail } from '../mail.js';
import { repo } from '../repo.js';
import { loadCard } from '../services/library.js';
import { notices } from '../services/notices.js';
import { publishRequestChange } from '../services/requests.js';
import { businessDate } from '../time.js';
import { proofKey, storage, StorageUnavailable } from '../storage.js';

async function projectGrant(grant: GrantRecord, now: Date, source: Queryable = db): Promise<GrantView> {
  const card = await loadCard(grant.assetId, grant.variantId, source);
  const conditions = await repo.conditionsOfGrant(grant.id, source);
  const status = effectiveGrantStatus(grant, now);
  const holderPrincipal = grant.holderPrincipalId ? await repo.principal(grant.holderPrincipalId, source) : null;
  const holderGroup = grant.holderGroupId ? await repo.group(grant.holderGroupId, source) : null;
  return {
    id: grant.id,
    status,
    statusLabel: GRANT_STATUS_LABELS[status],
    holder: {
      type: holderGroup ? 'group' : 'principal',
      id: holderGroup?.id ?? holderPrincipal?.id ?? '',
      displayName: holderGroup?.name ?? holderPrincipal?.displayName ?? '',
    },
    cardName: card?.cardName ?? '',
    requestId: grant.requestId,
    notBefore: grant.notBefore,
    notAfter: grant.notAfter,
    cap: grant.cap,
    conditions: conditions.map((condition) => ({ kind: condition.kind, text: condition.text })),
    revokedReason: grant.revokedReason,
  };
}

function holdsGrant(principal: PrincipalRecord, grant: GrantRecord, groupIds: string[]): boolean {
  if (grant.holderPrincipalId === principal.id) return true;
  return grant.holderGroupId !== null && groupIds.includes(grant.holderGroupId);
}

async function canSeeGrant(principal: PrincipalRecord, grant: GrantRecord): Promise<boolean> {
  if (principal.role === 'owner' || principal.role === 'legal_reviewer') return true;
  const groupIds = await repo.groupIdsFor(principal.id);
  return holdsGrant(principal, grant, groupIds);
}

async function canSeeProofOf(principal: PrincipalRecord, grant: GrantRecord): Promise<boolean> {
  if (principal.role === 'brand_reviewer') return true;
  return canSeeGrant(principal, grant);
}

export async function listGrants(ctx: Ctx): Promise<void> {
  const principal = requireSignedIn(ctx);
  const all = await repo.grants();
  const groupIds = await repo.groupIdsFor(principal.id);
  const visible =
    principal.role === 'owner' || principal.role === 'legal_reviewer'
      ? all
      : all.filter((grant) => holdsGrant(principal, grant, groupIds));
  const grants: GrantView[] = [];
  for (const grant of visible) grants.push(await projectGrant(grant, ctx.now));
  sendJson(ctx.res, 200, { grants });
}

export async function readGrant(ctx: Ctx): Promise<void> {
  const principal = requireSignedIn(ctx);
  const grant = await repo.grant(ctx.params['id'] ?? '');
  if (!grant || !(await canSeeGrant(principal, grant))) throw errors.notFound();
  sendJson(ctx.res, 200, await projectGrant(grant, ctx.now));
}

export async function revokeGrant(ctx: Ctx): Promise<void> {
  const principal = requireSignedIn(ctx);
  const grant = await repo.grant(ctx.params['id'] ?? '');
  if (!grant || !(await canSeeGrant(principal, grant))) throw errors.notFound();

  if (principal.role !== 'owner' && principal.role !== 'legal_reviewer') {
    await withTransaction(async (tx) => {
      await appendAudit(tx, {
        occurredAt: ctx.now,
        actorId: principal.id,
        actorRole: principal.role,
        action: 'grant.revoked',
        resourceType: 'grant',
        resourceId: grant.id,
        requestId: grant.requestId,
        before: null,
        after: null,
        outcome: 'denied',
      });
    });
    throw errors.forbidden();
  }

  const body = jsonBody<{ reason?: string }>(ctx);
  const reason = (body.reason ?? '').trim();

  const view = await withTransaction(async (tx) => {
    const current = (await repo.grant(grant.id, tx))!;
    const status = effectiveGrantStatus(current, ctx.now);
    if (status !== 'active' && status !== 'pending_proof') wrongGrantState(current.id, status);
    if (reason === '') throw errors.reasonRequired();

    await tx.query('update grants set status = $1, revoked_reason = $2 where id = $3', [
      'revoked',
      reason,
      current.id,
    ]);
    await appendAudit(tx, {
      occurredAt: ctx.now,
      actorId: principal.id,
      actorRole: principal.role,
      action: 'grant.revoked',
      resourceType: 'grant',
      resourceId: current.id,
      requestId: current.requestId,
      before: { status: current.status },
      after: { reason, status: 'revoked' },
      outcome: 'success',
    });

    const recipients = current.holderGroupId
      ? await repo.groupMembers(current.holderGroupId, tx)
      : current.holderPrincipalId
        ? [(await repo.principal(current.holderPrincipalId, tx))!]
        : [];
    for (const recipient of recipients) {
      await enqueueMail(tx, notices.grantRevoked(recipient.email, current.id, reason, current.requestId), ctx.now);
    }

    await publish(tx, { type: 'grant.updated', grantId: current.id }, {
      principalIds: recipients.map((recipient) => recipient.id),
      roles: ['owner', 'legal_reviewer'],
    });
    await publish(tx, { type: 'library.updated' }, EVERYONE);
    if (current.requestId) {
      const request = await repo.request(current.requestId, tx);
      if (request) await publishRequestChange(tx, request);
    }

    return projectGrant((await repo.grant(current.id, tx))!, ctx.now, tx);
  });

  sendJson(ctx.res, 200, view);
}

export async function uploadProof(ctx: Ctx): Promise<void> {
  const principal = requireSignedIn(ctx);
  const grant = await repo.grant(ctx.params['id'] ?? '');
  if (!grant || !(await canSeeProofOf(principal, grant))) throw errors.notFound();
  if (grant.holderPrincipalId !== principal.id) throw errors.forbidden();

  const multipart = parseMultipart(ctx);
  const file = multipart.file;
  const proofs = await repo.proofsOfGrant(grant.id);
  const status = effectiveGrantStatus(grant, ctx.now);
  if (status !== 'pending_proof' || proofs.some((proof) => proof.status === 'pending_review')) {
    wrongGrantState(grant.id, status);
  }
  if (!file) throw errors.proofType();

  const format = detectFormat(file.bytes);
  if (format !== 'png' && format !== 'jpeg' && format !== 'pdf') throw errors.proofType();
  if (multipart.truncated || file.bytes.length > config.proofMaxBytes) throw errors.proofTooLarge();

  const proofId = await withTransaction(async (tx) => paddedId('PRF', await nextCounter(tx, 'proofs')));
  const objectKey = proofKey(grant.id, proofId);
  try {
    await storage.putObject(objectKey, file.bytes, file.contentType);
  } catch (error) {
    if (error instanceof StorageUnavailable) throw errors.storageProof();
    throw error;
  }

  const created = await withTransaction(async (tx) => {
    const sort = await nextCounter(tx, 'proof_sort');
    await tx.query(
      `insert into proofs (id, grant_id, file_name, status, uploaded_at, object_key, content_type, sort)
       values ($1,$2,$3,'pending_review',$4,$5,$6,$7)`,
      [proofId, grant.id, file.fileName, ctx.now, objectKey, file.contentType, sort],
    );
    await appendAudit(tx, {
      occurredAt: ctx.now,
      actorId: principal.id,
      actorRole: principal.role,
      action: 'proof.uploaded',
      resourceType: 'proof',
      resourceId: proofId,
      requestId: grant.requestId,
      before: null,
      after: { fileName: file.fileName, status: 'pending_review' },
      outcome: 'success',
    });
    await publish(tx, { type: 'grant.updated', grantId: grant.id }, {
      principalIds: [principal.id],
      roles: REVIEWERS,
    });
    if (grant.requestId) {
      const request = await repo.request(grant.requestId, tx);
      if (request) await publishRequestChange(tx, request);
    }
    return {
      id: proofId,
      fileName: file.fileName,
      status: 'pending_review' as const,
      uploadedAt: ctx.now.toISOString(),
    };
  });

  sendJson(ctx.res, 201, created);
}

async function loadVisibleProof(ctx: Ctx): Promise<{ principal: PrincipalRecord; grant: GrantRecord; proofId: string }> {
  const principal = requireSignedIn(ctx);
  const proof = await repo.proof(ctx.params['id'] ?? '');
  if (!proof) throw errors.notFound();
  const grant = await repo.grant(proof.grantId);
  if (!grant || !(await canSeeProofOf(principal, grant))) throw errors.notFound();
  return { principal, grant, proofId: proof.id };
}

export async function readProofContent(ctx: Ctx): Promise<void> {
  const { proofId } = await loadVisibleProof(ctx);
  const proof = (await repo.proof(proofId))!;
  let bytes: Buffer | null;
  try {
    bytes = await storage.getObject(proof.objectKey);
  } catch (error) {
    if (error instanceof StorageUnavailable) throw errors.storageDownload();
    throw error;
  }
  if (!bytes) throw errors.notFound();
  ctx.res.writeHead(200, {
    'content-type': proof.contentType,
    'content-length': bytes.length,
    'cache-control': 'no-store',
  });
  ctx.res.end(bytes);
}

async function requireProofReviewer(ctx: Ctx, principal: PrincipalRecord, proofId: string, action: string): Promise<void> {
  if (principal.role === 'brand_reviewer' || principal.role === 'legal_reviewer' || principal.role === 'owner') return;
  await withTransaction(async (tx) => {
    await appendAudit(tx, {
      occurredAt: ctx.now,
      actorId: principal.id,
      actorRole: principal.role,
      action,
      resourceType: 'proof',
      resourceId: proofId,
      requestId: null,
      before: null,
      after: null,
      outcome: 'denied',
    });
  });
  throw errors.forbidden();
}

export async function acceptProof(ctx: Ctx): Promise<void> {
  const { principal, grant, proofId } = await loadVisibleProof(ctx);
  await requireProofReviewer(ctx, principal, proofId, 'proof.accepted');

  const view = await withTransaction(async (tx) => {
    const proof = (await repo.proof(proofId, tx))!;
    const current = (await repo.grant(grant.id, tx))!;
    if (proof.status !== 'pending_review') {
      throw errors.wrongState(`${proof.id} is ${PROOF_STATUS_LABELS[proof.status]}.`);
    }
    const notBefore = businessDate(ctx.now);
    await tx.query(`update proofs set status = 'accepted' where id = $1`, [proof.id]);
    await tx.query(`update grants set status = 'active', not_before = $1 where id = $2`, [notBefore, current.id]);
    await appendAudit(tx, {
      occurredAt: ctx.now,
      actorId: principal.id,
      actorRole: principal.role,
      action: 'proof.accepted',
      resourceType: 'proof',
      resourceId: proof.id,
      requestId: current.requestId,
      before: { status: 'pending_review' },
      after: { status: 'accepted' },
      outcome: 'success',
    });
    await appendAudit(tx, {
      occurredAt: ctx.now,
      actorId: principal.id,
      actorRole: principal.role,
      action: 'grant.activated',
      resourceType: 'grant',
      resourceId: current.id,
      requestId: current.requestId,
      before: { status: 'pending_proof' },
      after: { notBefore, status: 'active' },
      outcome: 'success',
    });
    await publish(tx, { type: 'grant.updated', grantId: current.id }, {
      principalIds: current.holderPrincipalId ? [current.holderPrincipalId] : [],
      roles: REVIEWERS,
    });
    await publish(tx, { type: 'library.updated' }, EVERYONE);
    if (current.requestId) {
      const request = await repo.request(current.requestId, tx);
      if (request) await publishRequestChange(tx, request);
    }
    return projectGrant((await repo.grant(current.id, tx))!, ctx.now, tx);
  });

  sendJson(ctx.res, 200, view);
}

export async function rejectProof(ctx: Ctx): Promise<void> {
  const { principal, grant, proofId } = await loadVisibleProof(ctx);
  await requireProofReviewer(ctx, principal, proofId, 'proof.rejected');
  const body = jsonBody<{ reason?: string }>(ctx);
  const reason = (body.reason ?? '').trim();

  const view = await withTransaction(async (tx) => {
    const proof = (await repo.proof(proofId, tx))!;
    if (proof.status !== 'pending_review') {
      throw errors.wrongState(`${proof.id} is ${PROOF_STATUS_LABELS[proof.status]}.`);
    }
    if (reason === '') throw errors.reasonRequired();
    await tx.query(`update proofs set status = 'rejected', reason = $1 where id = $2`, [reason, proof.id]);
    await appendAudit(tx, {
      occurredAt: ctx.now,
      actorId: principal.id,
      actorRole: principal.role,
      action: 'proof.rejected',
      resourceType: 'proof',
      resourceId: proof.id,
      requestId: grant.requestId,
      before: { status: 'pending_review' },
      after: { reason, status: 'rejected' },
      outcome: 'success',
    });
    await publish(tx, { type: 'grant.updated', grantId: grant.id }, {
      principalIds: grant.holderPrincipalId ? [grant.holderPrincipalId] : [],
      roles: REVIEWERS,
    });
    if (grant.requestId) {
      const request = await repo.request(grant.requestId, tx);
      if (request) await publishRequestChange(tx, request);
    }
    return projectGrant((await repo.grant(grant.id, tx))!, ctx.now, tx);
  });

  sendJson(ctx.res, 200, view);
}
