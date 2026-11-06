/**
 * Compliance links and the public share page.
 *
 * A link is live while it is not revoked and the clock is strictly before its
 * expiry. A live link shows only each renter's latest current approved
 * document of each kind, and never a balance, ledger, contact name, email or
 * phone number.
 */

import { randomBytes } from 'node:crypto';
import { db } from '../db.js';
import * as errors from '../http/errors.js';
import {
  json,
  redirect,
  type PublicContext,
  type Route,
  type RouteResult,
  type SessionContext,
} from '../http/router.js';
import { requireResolved } from '../http/resolve.js';
import { Validator } from '../http/validate.js';
import { kitchenToday, nowMs } from '../domain/clock.js';
import { currentApprovedByKind } from '../domain/compliance.js';
import { DOCUMENT_LABELS } from '../../shared/copy.js';
import {
  StorageUnavailable,
  assertStorageReachable,
  presignGetUrl,
} from '../services/storage.js';
import { presentLink } from './present.js';
import type { ComplianceLinkRow } from '../rows.js';
import type { DocumentKind, ShareDocument } from '../../shared/types.js';

const MIN_EXPIRES_IN_SECONDS = 30;
const MAX_EXPIRES_IN_SECONDS = 2_592_000;

/** Tokens are at least 32 random URL-safe characters. */
function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function isLive(link: ComplianceLinkRow, atMs: number): boolean {
  return link.revoked_at === null && atMs < link.expires_at.getTime();
}

async function liveLinkByToken(token: string): Promise<ComplianceLinkRow> {
  const link = await db.maybeOne<ComplianceLinkRow>(
    `SELECT id, label, token, expires_in_seconds, expires_at, revoked_at, created_at
       FROM compliance_links WHERE token = $1`,
    [token],
  );
  if (!link || !isLive(link, nowMs())) throw errors.notFound();
  return link;
}

interface ShareDocumentRow {
  id: string;
  renter_id: string;
  business_name: string;
  kind: DocumentKind;
  expires_on: string | null;
  status: 'pending_review' | 'approved' | 'rejected';
  object_key: string;
  seq: number;
}

interface ShareRenter {
  business_name: string;
  documents: ShareDocument[];
}

/** The renters and documents a live token exposes. */
async function shareContents(token: string): Promise<{
  renters: ShareRenter[];
  objectKeys: Map<string, string>;
}> {
  const rows = await db.query<ShareDocumentRow>(
    `SELECT d.id, d.renter_id, r.business_name, d.kind, d.expires_on, d.status, d.object_key,
            d.seq::int AS seq
       FROM documents d
       JOIN renters r ON r.id = d.renter_id
      WHERE r.status IN ('active','suspended')
      ORDER BY r.business_name, d.seq`,
    [],
  );
  const today = kitchenToday();
  const byRenter = new Map<string, ShareDocumentRow[]>();
  for (const row of rows) {
    const list = byRenter.get(row.renter_id) ?? [];
    list.push(row);
    byRenter.set(row.renter_id, list);
  }

  const renters: ShareRenter[] = [];
  const objectKeys = new Map<string, string>();
  for (const documents of byRenter.values()) {
    const current = currentApprovedByKind(documents, today);
    if (current.length === 0) continue;
    for (const document of current) objectKeys.set(document.id, document.object_key);
    renters.push({
      business_name: documents[0].business_name,
      documents: current.map(
        (document): ShareDocument => ({
          id: document.id,
          kind: document.kind,
          label: DOCUMENT_LABELS[document.kind],
          expires_on: document.expires_on,
          file_url: `/api/share/${token}/documents/${document.id}`,
        }),
      ),
    });
  }
  renters.sort((a, b) => (a.business_name < b.business_name ? -1 : 1));
  return { renters, objectKeys };
}

export const linkRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/compliance-links',
    auth: 'session',
    roles: ['operator'],
    body: 'json',
    async handle(context) {
      const validator = new Validator(context.body);
      const label = validator.text('label', 1, 80);
      const expiresIn = validator.integer(
        'expires_in_seconds',
        MIN_EXPIRES_IN_SECONDS,
        MAX_EXPIRES_IN_SECONDS,
      );
      validator.done();

      const link = await db.one<ComplianceLinkRow>(
        `INSERT INTO compliance_links (label, token, expires_in_seconds, expires_at)
         VALUES ($1, $2, $3::int, now() + make_interval(secs => $3::int))
         RETURNING id, label, token, expires_in_seconds, expires_at, revoked_at, created_at`,
        [label, newToken(), expiresIn],
      );
      return json(201, { link: presentLink(link) });
    },
  },
  {
    method: 'GET',
    path: '/api/compliance-links',
    auth: 'session',
    roles: ['operator'],
    async handle() {
      const links = await db.query<ComplianceLinkRow>(
        `SELECT id, label, token, expires_in_seconds, expires_at, revoked_at, created_at
           FROM compliance_links ORDER BY created_at DESC`,
      );
      return json(200, { links: links.map(presentLink) });
    },
  },
  {
    method: 'POST',
    path: '/api/compliance-links/:link_id/revoke',
    auth: 'session',
    roles: ['operator'],
    body: 'json',
    resolve: ['link'],
    async handle(context) {
      const link = requireResolved(context.resolved, 'link');
      if (link.revoked_at !== null) throw errors.alreadyRevoked();
      const updated = await db.one<ComplianceLinkRow>(
        `UPDATE compliance_links SET revoked_at = now() WHERE id = $1
         RETURNING id, label, token, expires_in_seconds, expires_at, revoked_at, created_at`,
        [link.id],
      );
      return json(200, { link: presentLink(updated) });
    },
  },
  {
    method: 'POST',
    path: '/api/compliance-links/:link_id/regenerate',
    auth: 'session',
    roles: ['operator'],
    body: 'json',
    resolve: ['link'],
    async handle(context) {
      const link = requireResolved(context.resolved, 'link');
      if (link.revoked_at !== null) throw errors.alreadyRevoked();
      const updated = await db.one<ComplianceLinkRow>(
        `UPDATE compliance_links
            SET token = $2,
                expires_at = now() + make_interval(secs => expires_in_seconds::double precision)
          WHERE id = $1
         RETURNING id, label, token, expires_in_seconds, expires_at, revoked_at, created_at`,
        [link.id, newToken()],
      );
      return json(200, { link: presentLink(updated) });
    },
  },
  {
    method: 'GET',
    path: '/api/share/:token',
    auth: 'none',
    async handle(context): Promise<RouteResult> {
      const link = await liveLinkByToken(context.params['token']);
      const kitchen = await db.one<{ name: string; address: string }>(
        'SELECT name, address FROM kitchen WHERE singleton',
      );
      const { renters } = await shareContents(link.token);
      return json(200, { kitchen, renters });
    },
  },
  {
    method: 'GET',
    path: '/api/share/:token/documents/:document_id',
    auth: 'none',
    async handle(context): Promise<RouteResult> {
      const link = await liveLinkByToken(context.params['token']);
      const { objectKeys } = await shareContents(link.token);
      const objectKey = objectKeys.get(context.params['document_id']);
      if (objectKey === undefined) throw errors.notFound();
      try {
        await assertStorageReachable(objectKey);
      } catch (error) {
        if (error instanceof StorageUnavailable) throw errors.storageUnavailable();
        throw error;
      }
      return redirect(presignGetUrl(objectKey));
    },
  },
];
