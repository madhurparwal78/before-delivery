import { randomUUID } from 'node:crypto';
import { errors } from '../http/errors.js';
import type { SessionUser } from '../http/context.js';
import { withTransaction } from '../db/pool.js';
import {
  findDocument,
  insertDocument,
  listDocuments,
  setDocumentReview,
} from '../db/repo/documents.js';
import { queueEmail } from '../db/repo/outbox.js';
import { recordStateChange } from '../db/repo/audit.js';
import { setTenantStatus } from '../db/repo/tenants.js';
import { DOCUMENT_KINDS, DOCUMENT_SIZE_CAP_BYTES } from '../domain/constants.js';
import { detectContentType, extensionFor, sanitiseFileName } from '../domain/documents.js';
import { isValidDate, kitchenToday } from '../domain/time.js';
import * as storage from '../providers/storage.js';
import type { DocumentRecord } from '../domain/types.js';
import { approvalEmail, rejectionEmail } from './emails.js';
import { requireTenant } from './tenants.js';

export interface UploadInput {
  tenantId: string;
  kind: string | null;
  expiresOn: string | null;
  holderName: string | null;
  fileName: string | null;
  bytes: Buffer | null;
}

export async function uploadDocument(
  actor: SessionUser,
  input: UploadInput,
): Promise<DocumentRecord> {
  const tenant = await requireTenant(input.tenantId);
  const today = kitchenToday();
  const failures: Record<string, string> = {};

  const kind = DOCUMENT_KINDS.find((candidate) => candidate === input.kind) ?? null;
  if (kind === null) failures['kind'] = 'Choose a document type.';
  if (input.expiresOn === null || !isValidDate(input.expiresOn)) {
    failures['expires_on'] = 'Give an expiry date as YYYY-MM-DD.';
  } else if (input.expiresOn < today) {
    failures['expires_on'] = 'The expiry date must be today or later.';
  }
  const holderName = (input.holderName ?? '').trim();
  if (kind === 'food_handler_card') {
    if (holderName.length === 0) failures['holder_name'] = 'Give the name on the card.';
    else if (holderName.length > 120) failures['holder_name'] = 'Use at most 120 characters.';
  }
  if (input.bytes === null || input.bytes.length === 0) {
    failures['file'] = 'Attach a document file.';
  }
  if (Object.keys(failures).length > 0) throw errors.validation(failures);

  const bytes = input.bytes!;
  if (bytes.length > DOCUMENT_SIZE_CAP_BYTES) throw errors.fileTooLarge();
  const contentType = detectContentType(bytes);
  if (contentType === null) throw errors.unsupportedFileType();

  const id = randomUUID();
  const storageKey = `tenants/${tenant.id}/documents/${id}.${extensionFor(contentType)}`;
  await storage.putObject(storageKey, bytes, contentType);

  const document: DocumentRecord = {
    id,
    tenantId: tenant.id,
    kind: kind!,
    holderName: kind === 'food_handler_card' ? holderName : null,
    expiresOn: input.expiresOn!,
    status: 'pending_review',
    fileName: sanitiseFileName(input.fileName ?? ''),
    contentType,
    sizeBytes: bytes.length,
    storageKey,
    uploadedAt: new Date(),
    reviewedAt: null,
    rejectionReason: null,
  };

  await withTransaction(async (tx) => {
    await insertDocument(document, tx);
    if (tenant.storedStatus === 'applied') {
      await setTenantStatus(tenant.id, 'documents_review', tx);
      await recordStateChange(tx, {
        actorUserId: actor.id,
        entity: 'tenant',
        entityId: tenant.id,
        fromState: 'applied',
        toState: 'documents_review',
      });
    }
    await recordStateChange(tx, {
      actorUserId: actor.id,
      entity: 'document',
      entityId: id,
      fromState: null,
      toState: 'pending_review',
      detail: { kind: document.kind },
    });
  });
  return document;
}

export async function requireDocument(id: string, actor: SessionUser): Promise<DocumentRecord> {
  const document = await findDocument(id);
  if (!document) throw errors.notFound();
  if (actor.tenantId !== null && document.tenantId !== actor.tenantId) throw errors.notFound();
  return document;
}

export async function documentsFor(
  actor: SessionUser,
  tenantFilter: string | null,
): Promise<DocumentRecord[]> {
  if (actor.role === 'operator') return listDocuments(tenantFilter);
  return listDocuments(actor.tenantId);
}

export async function documentFile(document: DocumentRecord): Promise<storage.StoredObject> {
  const object = await storage.getObject(document.storageKey);
  if (!object) throw errors.notFound();
  return object;
}

export async function approveDocument(
  actor: SessionUser,
  id: string,
): Promise<DocumentRecord> {
  const document = await requireDocument(id, actor);
  if (document.status !== 'pending_review') {
    throw errors.conflict('invalid_transition', 'This document is not awaiting review.');
  }
  const stored = await storage.getObject(document.storageKey);
  if (!stored || stored.size !== document.sizeBytes) {
    throw errors.conflict('file_missing', 'The stored file cannot be read.');
  }
  const tenant = await requireTenant(document.tenantId);
  const at = new Date();
  await withTransaction(async (tx) => {
    await setDocumentReview(document.id, 'approved', at, null, tx);
    await recordStateChange(tx, {
      actorUserId: actor.id,
      entity: 'document',
      entityId: document.id,
      fromState: 'pending_review',
      toState: 'approved',
    });
    await queueEmail(tx, approvalEmail(tenant, document.kind, document.expiresOn));
  });
  return (await findDocument(document.id))!;
}

export async function rejectDocument(
  actor: SessionUser,
  id: string,
  reason: string,
): Promise<DocumentRecord> {
  const document = await requireDocument(id, actor);
  const trimmed = reason.trim();
  if (trimmed.length < 1 || trimmed.length > 500) {
    throw errors.validation({ reason: 'Give a reason for the tenant.' });
  }
  if (document.status !== 'pending_review') {
    throw errors.conflict('invalid_transition', 'This document is not awaiting review.');
  }
  const tenant = await requireTenant(document.tenantId);
  const at = new Date();
  await withTransaction(async (tx) => {
    await setDocumentReview(document.id, 'rejected', at, trimmed, tx);
    await recordStateChange(tx, {
      actorUserId: actor.id,
      entity: 'document',
      entityId: document.id,
      fromState: 'pending_review',
      toState: 'rejected',
      detail: { reason: trimmed },
    });
    await queueEmail(tx, rejectionEmail(tenant, document.kind, trimmed));
  });
  return (await findDocument(document.id))!;
}
