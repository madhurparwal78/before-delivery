import { daysBetween, isDate } from '../../shared/calendar.js';
import type { DocumentType } from '../../shared/format.js';
import { db, lock, transact } from '../db/pool.js';
import { expiryStatus } from '../domain/documents.js';
import { localDateOf } from '../domain/time.js';
import { requireRole, uploadFileLimit, type RequestContext, type SignedContext } from '../http/context.js';
import { errors, fieldCopy } from '../http/errors.js';
import { detectFileType, parseMultipart } from '../http/multipart.js';
import { json, sanitiseFileName, type Result } from '../http/respond.js';
import { documentObject } from '../api/shapes.js';
import { FieldErrors } from '../api/validate.js';
import { sendNoticesForMember } from '../api/notices.js';
import {
  approveDocument,
  insertDocument,
  listDocuments,
  loadDocument,
  memberDocumentsOfType,
  newDocumentId,
  supersedeOlderSubmitted,
} from '../store/documents.js';
import { loadMember, loadMembers } from '../store/kitchens.js';
import { deleteObject, documentKey, getObject, putObject, StorageUnavailable } from '../services/storage.js';

const documentTypes: DocumentType[] = ['insurance_certificate', 'food_handler_card'];

/** POST /api/documents */
export async function uploadDocument(context: RequestContext): Promise<Result> {
  const signedContext = requireRole(context, ['member']);
  const kitchen = signedContext.kitchen;
  const contentType = (signedContext.headers['content-type'] ?? '') as string;
  const parts = parseMultipart(signedContext.body, contentType);
  if (parts === null) throw errors.unsupportedMediaType();

  const fieldErrors = new FieldErrors();
  const allowed = new Set(['type', 'expiryDate', 'file']);
  for (const part of parts) {
    if (!allowed.has(part.name)) fieldErrors.add(part.name, fieldCopy.cannotBeSet);
  }
  fieldErrors.throwIfAny();

  const filePart = parts.find((part) => part.name === 'file');
  if (filePart && filePart.data.byteLength > uploadFileLimit) throw errors.payloadTooLarge();
  if (filePart) {
    const detected = detectFileType(filePart.data);
    if (detected === null) throw errors.unsupportedFileType();
  }

  const typeValue = parts.find((part) => part.name === 'type')?.data.toString('utf8');
  const expiryValue = parts.find((part) => part.name === 'expiryDate')?.data.toString('utf8');
  if (typeValue === undefined || !documentTypes.includes(typeValue as DocumentType)) {
    fieldErrors.add('type', fieldCopy.documentType);
  }
  const today = localDateOf(kitchen.timeZone, signedContext.nowMs);
  if (expiryValue === undefined || !isDate(expiryValue) || daysBetween(today, expiryValue) < 0) {
    fieldErrors.add('expiryDate', fieldCopy.expiryDate);
  }
  if (!filePart || filePart.data.byteLength === 0) fieldErrors.add('file', fieldCopy.file);
  fieldErrors.throwIfAny();

  const type = typeValue as DocumentType;
  const detected = detectFileType(filePart!.data)!;
  const memberId = signedContext.person.memberId!;
  const documentId = newDocumentId();

  try {
    await putObject(documentKey(kitchen.id, memberId, documentId), filePart!.data, detected);
  } catch (error) {
    if (error instanceof StorageUnavailable) throw errors.storageUnavailableUpload();
    throw error;
  }

  try {
    const document = await transact(async (client) => {
      await lock(client, 'memberDocumentType', `${memberId}:${type}`);
      const inserted = await insertDocument(client, {
        id: documentId,
        kitchenId: kitchen.id,
        memberId,
        type,
        expiryDate: expiryValue!,
        fileName: filePart!.fileName ?? 'upload',
        contentType: detected,
        sizeBytes: filePart!.data.byteLength,
        uploadedAtMs: signedContext.nowMs,
      });
      await supersedeOlderSubmitted(client, memberId, type, documentId);
      return inserted;
    });
    const siblings = await memberDocumentsOfType(db(), memberId, type);
    const member = (await loadMember(db(), kitchen.id, memberId))!;
    return json(201, {
      document: documentObject(
        document,
        siblings,
        member.businessName,
        kitchen.timeZone,
        signedContext.nowMs,
      ),
    });
  } catch (error) {
    await deleteObject(documentKey(kitchen.id, memberId, documentId)).catch(() => undefined);
    throw error;
  }
}

/** GET /api/documents */
export async function listDocumentRows(context: RequestContext): Promise<Result> {
  const signedContext = requireRole(context, ['member', 'operator', 'shift_lead']);
  const kitchen = signedContext.kitchen;
  const asked = signedContext.query.get('memberId');
  const memberId =
    signedContext.person.role === 'member' ? signedContext.person.memberId : asked ?? null;
  const documents = await listDocuments(db(), kitchen.id, memberId);
  const members = await loadMembers(db(), kitchen.id);
  const names = new Map(members.map((member) => [member.id, member.businessName]));
  const allOfMember = new Map<string, typeof documents>();
  for (const member of members) {
    allOfMember.set(member.id, await listDocuments(db(), kitchen.id, member.id));
  }
  return json(200, {
    documents: documents.map((document) =>
      documentObject(
        document,
        allOfMember.get(document.memberId) ?? [],
        names.get(document.memberId) ?? '',
        kitchen.timeZone,
        signedContext.nowMs,
      ),
    ),
  });
}

async function resolveDocument(context: RequestContext, documentId: string) {
  const signedContext = context as SignedContext;
  const document = await loadDocument(db(), signedContext.kitchen.id, documentId);
  if (!document) throw errors.notFound();
  if (
    signedContext.person.role === 'member' &&
    document.memberId !== signedContext.person.memberId
  ) {
    throw errors.notFound();
  }
  return document;
}

/** GET /api/documents/{id} */
export async function readDocument(context: RequestContext, documentId: string): Promise<Result> {
  const document = await resolveDocument(context, documentId);
  const signedContext = requireRole(context, ['member', 'operator', 'shift_lead']);
  const kitchen = signedContext.kitchen;
  const siblings = await listDocuments(db(), kitchen.id, document.memberId);
  const member = (await loadMember(db(), kitchen.id, document.memberId))!;
  return json(200, {
    document: documentObject(
      document,
      siblings,
      member.businessName,
      kitchen.timeZone,
      signedContext.nowMs,
    ),
  });
}

export function fileHeaders(fileName: string): Record<string, string> {
  return {
    'content-disposition': `attachment; filename="${sanitiseFileName(fileName)}"`,
    'x-content-type-options': 'nosniff',
    'content-security-policy': "sandbox; default-src 'none'",
  };
}

/** Streams a stored document, never as active content. */
export async function documentFileResult(document: {
  id: string;
  kitchenId: string;
  memberId: string;
  fileName: string;
  contentType: string;
  objectPending: boolean;
  type: DocumentType;
  expiryDate: string;
}): Promise<Result> {
  if (document.objectPending) throw errors.storageUnavailableDownload();
  let body: Buffer | null;
  try {
    body = await getObject(documentKey(document.kitchenId, document.memberId, document.id));
  } catch (error) {
    if (error instanceof StorageUnavailable) throw errors.storageUnavailableDownload();
    throw error;
  }
  if (body === null) throw errors.notFound();
  return {
    kind: 'binary',
    status: 200,
    body,
    contentType: document.contentType,
    headers: fileHeaders(document.fileName),
  };
}

/** GET /api/documents/{id}/file */
export async function readDocumentFile(
  context: RequestContext,
  documentId: string,
): Promise<Result> {
  const document = await resolveDocument(context, documentId);
  requireRole(context, ['member', 'operator', 'shift_lead']);
  return documentFileResult(document);
}

/** POST /api/documents/{id}/approve */
export async function approve(context: RequestContext, documentId: string): Promise<Result> {
  const document = await resolveDocument(context, documentId);
  const signedContext = requireRole(context, ['operator']);
  const kitchen = signedContext.kitchen;
  const body = (signedContext.json ?? {}) as Record<string, unknown>;
  const keys = Object.keys(body);
  const fieldErrors = new FieldErrors();
  for (const key of keys) if (key !== 'version') fieldErrors.add(key, fieldCopy.cannotBeSet);
  if (!('version' in body)) fieldErrors.add('version', fieldCopy.required);
  fieldErrors.throwIfAny();
  const version = body['version'];
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    throw errors.validationFailed({ version: fieldCopy.version });
  }

  const member = (await loadMember(db(), kitchen.id, document.memberId))!;
  const approved = await transact(async (client) => {
    await lock(client, 'memberDocumentType', `${document.memberId}:${document.type}`);
    const fresh = (await loadDocument(client, kitchen.id, documentId))!;
    const siblings = await memberDocumentsOfType(client, fresh.memberId, fresh.type);
    const shape = () =>
      documentObject(fresh, siblings, member.businessName, kitchen.timeZone, signedContext.nowMs);

    if (fresh.status === 'superseded') {
      const newest = siblings.reduce((latest, candidate) =>
        Number(candidate.seq) > Number(latest.seq) ? candidate : latest,
      );
      throw errors.documentSuperseded(fresh.type, member.businessName, shape(), newest.id);
    }
    if (fresh.version !== version) throw errors.staleVersionDocument(shape());
    if (fresh.status !== 'submitted') {
      throw errors.invalidTransitionDocument(
        fresh.status === 'approved'
          ? expiryStatus(fresh, localDateOf(kitchen.timeZone, signedContext.nowMs))
          : fresh.status,
        'approve',
        shape(),
      );
    }
    return approveDocument(client, fresh.id, signedContext.nowMs);
  });

  await sendNoticesForMember(kitchen, member);
  const siblings = await memberDocumentsOfType(db(), approved.memberId, approved.type);
  return json(200, {
    document: documentObject(
      approved,
      siblings,
      member.businessName,
      kitchen.timeZone,
      signedContext.nowMs,
    ),
  });
}
