import { createHmac, timingSafeEqual } from 'node:crypto';
import type { LibraryCard } from '../../shared/types.js';
import { appendAudit } from '../audit.js';
import { config } from '../config.js';
import { withTransaction } from '../db.js';
import { errors } from '../errors.js';
import { fieldCellPage } from '../http/pages.js';
import { requireViewer, type Ctx } from '../http/context.js';
import { sendJson, sendText } from '../http/respond.js';
import { repo } from '../repo.js';
import { decideAllCards, decideOneCard, matchesFilters, projectLibraryCard } from '../services/library.js';
import { storage, StorageUnavailable } from '../storage.js';

interface LinkPayload {
  d: string;
  p: string;
  g: string;
  e: number;
}

function sign(payload: string): string {
  return createHmac('sha256', config.linkSigningSecret).update(payload).digest('base64url');
}

export function mintLinkToken(payload: LinkPayload): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${sign(body)}`;
}

export function readLinkToken(token: string): LinkPayload | null {
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = Buffer.from(sign(body), 'utf8');
  const given = Buffer.from(signature, 'utf8');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as LinkPayload;
  } catch {
    return null;
  }
}

export async function listLibrary(ctx: Ctx): Promise<void> {
  const viewer = requireViewer(ctx);
  const decisions = await decideAllCards(viewer, ctx.now);
  const filters = {
    assetClass: ctx.url.searchParams.get('class'),
    badges: ctx.url.searchParams.getAll('availability'),
    query: ctx.url.searchParams.get('q'),
  };

  const cards: LibraryCard[] = [];
  for (const entry of decisions) {
    const card = await projectLibraryCard(entry, viewer, ctx.now);
    if (matchesFilters(card, entry.card.asset.assetClass, filters)) cards.push(card);
  }

  sendJson(ctx.res, 200, { count: cards.length, cards });
}

export async function issueLink(ctx: Ctx): Promise<void> {
  const viewer = requireViewer(ctx);
  const derivative = await repo.derivative(ctx.params['id'] ?? '');
  if (!derivative) throw errors.notFound();

  const entry = await decideOneCard(viewer, ctx.now, derivative.assetId, derivative.variantId);
  if (!entry) throw errors.notFound();

  if (entry.decision.badge !== 'Available') {
    const reason = entry.decision.reason ?? 'Request use to download.';
    await withTransaction(async (tx) => {
      await appendAudit(tx, {
        occurredAt: ctx.now,
        actorId: viewer.principal.id,
        actorRole: viewer.principal.role,
        action: 'link.issued',
        resourceType: 'derivative',
        resourceId: derivative.id,
        requestId: null,
        before: null,
        after: null,
        outcome: 'denied',
      });
    });
    throw errors.downloadNotAllowed(reason);
  }

  try {
    await storage.headObject(derivative.objectKey);
  } catch (error) {
    if (error instanceof StorageUnavailable) throw errors.storageDownload();
    throw error;
  }

  const expiresAt = new Date(ctx.now.getTime() + config.downloadLinkTtlSeconds * 1000);
  const grantId = entry.decision.grant?.id ?? 'implicit';
  const token = mintLinkToken({ d: derivative.id, p: viewer.principal.id, g: grantId, e: expiresAt.getTime() });

  await withTransaction(async (tx) => {
    await appendAudit(tx, {
      occurredAt: ctx.now,
      actorId: viewer.principal.id,
      actorRole: viewer.principal.role,
      action: 'link.issued',
      resourceType: 'derivative',
      resourceId: derivative.id,
      requestId: null,
      before: null,
      after: { expiresAt: expiresAt.toISOString(), grant: grantId },
      outcome: 'success',
    });
  });

  sendJson(ctx.res, 201, { url: `/dl/${token}`, expiresAt: expiresAt.toISOString() });
}

export async function download(ctx: Ctx): Promise<void> {
  const payload = readLinkToken(ctx.params['token'] ?? '');
  if (!payload) {
    sendText(ctx.res, 404, 'text/html; charset=utf-8', fieldCellPage('Not found'));
    return;
  }

  const derivative = await repo.derivative(payload.d);
  const principal = await repo.principal(payload.p);
  if (!derivative || !principal) {
    sendText(ctx.res, 404, 'text/html; charset=utf-8', fieldCellPage('Not found'));
    return;
  }

  const viewer = await repo.viewer(principal);
  const entry = await decideOneCard(viewer, ctx.now, derivative.assetId, derivative.variantId);
  if (!entry || entry.decision.badge !== 'Available') {
    sendText(ctx.res, 404, 'text/html; charset=utf-8', fieldCellPage('Not found'));
    return;
  }

  if (ctx.now.getTime() > payload.e) {
    sendText(ctx.res, 410, 'text/html; charset=utf-8', fieldCellPage('This link has expired.'));
    return;
  }

  let bytes: Buffer | null;
  try {
    bytes = await storage.getObject(derivative.objectKey);
  } catch (error) {
    if (error instanceof StorageUnavailable) {
      sendText(ctx.res, 503, 'text/html; charset=utf-8', fieldCellPage('Downloads are unavailable right now.'));
      return;
    }
    throw error;
  }

  if (!bytes) {
    sendText(ctx.res, 404, 'text/html; charset=utf-8', fieldCellPage('Not found'));
    return;
  }

  ctx.res.writeHead(200, {
    'content-type': derivative.format === 'png' ? 'image/png' : 'image/svg+xml',
    'content-length': bytes.length,
    'content-disposition': `attachment; filename="${derivative.fileName}"`,
    'cache-control': 'no-store',
  });
  ctx.res.end(bytes);
}
