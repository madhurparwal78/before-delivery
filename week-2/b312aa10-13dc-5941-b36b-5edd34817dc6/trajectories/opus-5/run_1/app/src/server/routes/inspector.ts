import { addDays, isMonth } from '../../shared/calendar.js';
import { db, lock, transact } from '../db/pool.js';
import { currentDocument, expiryStatus } from '../domain/documents.js';
import { dayStartInstant, formatInstant, localDateOf } from '../domain/time.js';
import type { DocumentType } from '../domain/types.js';
import { requireRole, type RequestContext, type SignedContext } from '../http/context.js';
import { errors, fieldCopy } from '../http/errors.js';
import { json, type Result } from '../http/respond.js';
import { inspectorLinkObject, linkStatus, sanitationEntryObject } from '../api/shapes.js';
import { inspectorInvitationMessage, queueMail } from '../api/emails.js';
import { asString, exactBody, FieldErrors } from '../api/validate.js';
import { documentFileResult } from './documents.js';
import { sanitationFileResult } from './sanitation.js';
import { listDocuments, loadDocument } from '../store/documents.js';
import { loadKitchen, loadMembers } from '../store/kitchens.js';
import { entriesBetween, listReports } from '../store/sanitation.js';
import {
  addAccessRecord,
  createLink,
  listLinks,
  loadLink,
  loadLinkByToken,
  regenerateToken,
  revokeLink,
} from '../store/inspector.js';
import { flushMailNow } from '../services/outbox.js';

const documentTypes: DocumentType[] = ['insurance_certificate', 'food_handler_card'];
const maxDays = 30;

function expiresLabel(zone: string, instantMs: number): string {
  const text = formatInstant(zone, instantMs);
  return `${text.slice(0, 10)} ${text.slice(11, 16)}`;
}

/** POST /api/inspector-links */
export async function createInspectorLink(context: RequestContext): Promise<Result> {
  const signedContext = requireRole(context, ['operator']);
  const kitchen = signedContext.kitchen;
  const body = exactBody(signedContext.json, ['email', 'expiresAt']);
  const fieldErrors = new FieldErrors();
  const email = asString(body['email']);
  if (email === null || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    fieldErrors.add('email', fieldCopy.email);
  }
  const rawExpiry = asString(body['expiresAt']);
  const expiresAtMs = rawExpiry === null ? Number.NaN : Date.parse(rawExpiry);
  if (
    !Number.isFinite(expiresAtMs) ||
    expiresAtMs <= signedContext.nowMs ||
    expiresAtMs > signedContext.nowMs + maxDays * 86400000
  ) {
    fieldErrors.add('expiresAt', fieldCopy.expiresAt);
  }
  fieldErrors.throwIfAny();

  const link = await createLink(db(), kitchen.id, email!.trim(), expiresAtMs);
  const url = `${signedContext.origin}/inspect/${link.token}`;
  await queueMail(
    db(),
    inspectorInvitationMessage({
      to: link.email,
      kitchenName: kitchen.name,
      url,
      expiresLabel: expiresLabel(kitchen.timeZone, link.expiresAtMs),
    }),
  );
  void flushMailNow();
  return json(201, {
    link: inspectorLinkObject(link, kitchen.timeZone, signedContext.nowMs, url),
  });
}

/** GET /api/inspector-links */
export async function listInspectorLinks(context: RequestContext): Promise<Result> {
  const signedContext = requireRole(context, ['operator']);
  const links = await listLinks(db(), signedContext.kitchen.id);
  return json(200, {
    links: links.map((link) =>
      inspectorLinkObject(link, signedContext.kitchen.timeZone, signedContext.nowMs),
    ),
  });
}

/** POST /api/inspector-links/{id}/regenerate */
export async function regenerateInspectorLink(
  context: RequestContext,
  linkId: string,
): Promise<Result> {
  const signedContext = context as SignedContext;
  const kitchen = signedContext.kitchen;
  const existing = await loadLink(db(), kitchen.id, linkId);
  if (!existing) throw errors.notFound();
  requireRole(signedContext, ['operator']);
  exactBody(signedContext.json, []);

  const token = await transact(async (client) => {
    await lock(client, 'inspectorLink', existing.id);
    return regenerateToken(client, existing.id);
  });
  const link = (await loadLink(db(), kitchen.id, linkId))!;
  const url = `${signedContext.origin}/inspect/${token}`;
  await queueMail(
    db(),
    inspectorInvitationMessage({
      to: link.email,
      kitchenName: kitchen.name,
      url,
      expiresLabel: expiresLabel(kitchen.timeZone, link.expiresAtMs),
    }),
  );
  void flushMailNow();
  return json(200, {
    link: inspectorLinkObject(link, kitchen.timeZone, signedContext.nowMs, url),
  });
}

/** DELETE /api/inspector-links/{id} */
export async function deleteInspectorLink(
  context: RequestContext,
  linkId: string,
): Promise<Result> {
  const signedContext = context as SignedContext;
  const kitchen = signedContext.kitchen;
  const existing = await loadLink(db(), kitchen.id, linkId);
  if (!existing) throw errors.notFound();
  requireRole(signedContext, ['operator']);
  await transact(async (client) => {
    await lock(client, 'inspectorLink', existing.id);
    await revokeLink(client, existing.id, signedContext.nowMs);
  });
  const link = (await loadLink(db(), kitchen.id, linkId))!;
  return json(200, { link: inspectorLinkObject(link, kitchen.timeZone, signedContext.nowMs) });
}

async function openLink(token: string, nowMs: number) {
  const link = await loadLinkByToken(db(), token);
  if (!link) throw errors.notFound();
  const status = linkStatus(link, nowMs);
  if (status === 'revoked') throw errors.linkRevoked();
  if (status === 'expired') throw errors.linkExpired();
  return link;
}

/** GET /api/inspect/{token} */
export async function inspectorView(context: RequestContext, token: string): Promise<Result> {
  const link = await openLink(token, context.nowMs);
  const kitchen = await loadKitchen(db(), link.kitchenId);
  const zone = kitchen.timeZone;
  const today = localDateOf(zone, context.nowMs);
  const from = dayStartInstant(zone, addDays(today, -89));
  const entries = await entriesBetween(db(), kitchen.id, from, context.nowMs + 1000);
  const reports = (await listReports(db(), kitchen.id)).filter(
    (report) => report.status === 'stored',
  );

  const members = await loadMembers(db(), kitchen.id);
  const certificates: Array<Record<string, unknown>> = [];
  for (const member of members) {
    const documents = await listDocuments(db(), kitchen.id, member.id);
    for (const type of documentTypes) {
      const current = currentDocument(documents, type);
      if (!current) continue;
      certificates.push({
        documentId: current.id,
        businessName: member.businessName,
        type: current.type,
        expiryDate: current.expiryDate,
        status: expiryStatus(current, today),
      });
    }
  }

  await addAccessRecord(db(), link.id, context.nowMs, 'view', null);
  return json(200, {
    kitchen: { name: kitchen.name, timeZone: zone },
    expiresAt: formatInstant(zone, link.expiresAtMs),
    sanitationEntries: entries.map((entry) => sanitationEntryObject(entry, zone)),
    sanitationReports: reports.map((report) => ({ month: report.month })),
    certificates,
  });
}

/** GET /api/inspect/{token}/documents/{documentId}/file */
export async function inspectorDocumentFile(
  context: RequestContext,
  token: string,
  documentId: string,
): Promise<Result> {
  const link = await openLink(token, context.nowMs);
  const document = await loadDocument(db(), link.kitchenId, documentId);
  if (!document) throw errors.notFound();
  const siblings = await listDocuments(db(), link.kitchenId, document.memberId);
  if (currentDocument(siblings, document.type)?.id !== document.id) throw errors.notFound();
  const result = await documentFileResult(document);
  await addAccessRecord(db(), link.id, context.nowMs, 'document', document.id);
  return result;
}

/** GET /api/inspect/{token}/sanitation-reports/{month}/file */
export async function inspectorReportFile(
  context: RequestContext,
  token: string,
  month: string,
): Promise<Result> {
  const link = await openLink(token, context.nowMs);
  if (!isMonth(month)) throw errors.notFound();
  const reports = await listReports(db(), link.kitchenId);
  const report = reports.find((candidate) => candidate.month === month);
  if (!report || report.status !== 'stored') throw errors.notFound();
  const result = await sanitationFileResult(link.kitchenId, month);
  await addAccessRecord(db(), link.id, context.nowMs, 'report', month);
  return result;
}
