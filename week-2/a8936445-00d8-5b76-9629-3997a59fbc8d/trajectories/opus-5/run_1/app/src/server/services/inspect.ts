import { randomBytes, randomUUID } from 'node:crypto';
import { errors } from '../http/errors.js';
import { listDocuments } from '../db/repo/documents.js';
import {
  findInspectionLinkByToken,
  liveInspectionLink,
  replaceInspectionLink,
  revokeInspectionLinks,
} from '../db/repo/links.js';
import { findTenant } from '../db/repo/tenants.js';
import { recordStateChange } from '../db/repo/audit.js';
import { pool } from '../db/pool.js';
import { KITCHEN } from '../domain/constants.js';
import { isApprovedAndValid } from '../domain/documents.js';
import { kitchenToday, toKitchenIso } from '../domain/time.js';
import * as storage from '../providers/storage.js';
import type { DocumentRecord } from '../domain/types.js';

const MIN_LINK_SECONDS = 10;
const MAX_LINK_SECONDS = 604_800;

export interface IssuedLink {
  url: string;
  expires_at: string;
}

export async function issueInspectionLink(
  actorUserId: string,
  tenantId: string,
  expiresInSeconds: number,
): Promise<IssuedLink> {
  if (
    !Number.isInteger(expiresInSeconds) ||
    expiresInSeconds < MIN_LINK_SECONDS ||
    expiresInSeconds > MAX_LINK_SECONDS
  ) {
    throw errors.validation({ expires_in_seconds: 'Choose how long the link lasts.' });
  }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresInSeconds * 1000);
  const token = randomBytes(32).toString('base64url');
  await replaceInspectionLink(randomUUID(), tenantId, token, expiresAt, now);
  await recordStateChange(pool, {
    actorUserId,
    entity: 'inspection_link',
    entityId: tenantId,
    fromState: null,
    toState: 'issued',
    detail: { expires_at: toKitchenIso(expiresAt) },
  });
  return { url: `/inspect/${token}`, expires_at: toKitchenIso(expiresAt) };
}

export async function currentInspectionLink(tenantId: string): Promise<IssuedLink> {
  const link = await liveInspectionLink(tenantId, new Date());
  if (!link) throw errors.notFound();
  return { url: `/inspect/${link.token}`, expires_at: toKitchenIso(link.expiresAt) };
}

export async function revokeInspectionLink(actorUserId: string, tenantId: string): Promise<void> {
  const revoked = await revokeInspectionLinks(tenantId, new Date());
  if (revoked === 0) throw errors.notFound();
  await recordStateChange(pool, {
    actorUserId,
    entity: 'inspection_link',
    entityId: tenantId,
    fromState: 'issued',
    toState: 'revoked',
  });
}

/** The latest-expiring valid certificate, permit and one card per holder. */
export function currentDocumentsFor(
  documents: readonly DocumentRecord[],
  today: string,
): DocumentRecord[] {
  const valid = documents.filter((document) => isApprovedAndValid(document, today));
  const chosen = new Map<string, DocumentRecord>();
  for (const document of valid) {
    const key =
      document.kind === 'food_handler_card'
        ? `food_handler_card:${document.holderName ?? ''}`
        : document.kind;
    const existing = chosen.get(key);
    if (!existing || document.expiresOn > existing.expiresOn) chosen.set(key, document);
  }
  return [...chosen.values()].sort((a, b) =>
    a.kind === b.kind ? (a.holderName ?? '').localeCompare(b.holderName ?? '') : a.kind.localeCompare(b.kind),
  );
}

export interface InspectionView {
  kitchen_name: string;
  business_name: string;
  expires_at: string;
  documents: {
    id: string;
    kind: string;
    holder_name: string | null;
    expires_on: string;
    file_url: string;
  }[];
}

async function liveLinkByToken(token: string) {
  const link = await findInspectionLinkByToken(token);
  if (!link) throw errors.notFound();
  if (link.revokedAt !== null || link.expiresAt.getTime() <= Date.now()) {
    throw errors.gone('link_expired', 'This inspection link is no longer valid.');
  }
  return link;
}

export async function inspectionView(token: string): Promise<InspectionView> {
  const link = await liveLinkByToken(token);
  const tenant = await findTenant(link.tenantId);
  if (!tenant) throw errors.notFound();
  const today = kitchenToday();
  const documents = currentDocumentsFor(await listDocuments(tenant.id), today);
  return {
    kitchen_name: KITCHEN.name,
    business_name: tenant.businessName,
    expires_at: toKitchenIso(link.expiresAt),
    documents: documents.map((document) => ({
      id: document.id,
      kind: document.kind,
      holder_name: document.holderName,
      expires_on: document.expiresOn,
      file_url: `/api/inspect/${token}/documents/${document.id}/file`,
    })),
  };
}

export async function inspectionFile(
  token: string,
  documentId: string,
): Promise<{ bytes: Buffer; contentType: string; fileName: string }> {
  const link = await liveLinkByToken(token);
  const today = kitchenToday();
  const listed = currentDocumentsFor(await listDocuments(link.tenantId), today);
  const document = listed.find((candidate) => candidate.id === documentId);
  if (!document) throw errors.notFound();
  const object = await storage.getObject(document.storageKey);
  if (!object) throw errors.notFound();
  return { bytes: object.body, contentType: document.contentType, fileName: document.fileName };
}
