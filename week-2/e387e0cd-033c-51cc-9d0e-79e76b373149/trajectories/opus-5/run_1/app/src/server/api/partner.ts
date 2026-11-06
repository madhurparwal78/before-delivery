import { randomBytes } from 'node:crypto';
import { toInstant } from '../../shared/businesstime';
import { config } from '../config';
import { query, queryOne } from '../db/pool';
import { newId } from '../db/seed';
import { hashPartnerKey } from '../domain/password';
import { failure, rateLimited } from '../http/errors';
import { define, Registered, Role } from '../http/runtime';
import { codePoints, FieldCheck, readText } from '../http/validate';
import { createCase } from '../store/caseengine';
import { presentCase } from '../store/cases';
import { readCaseCreation } from './cases';

const OFFICER: readonly Role[] = ['compliance_officer'];
const CASE_ALLOWANCE = 30;

interface PartnerKeyRow {
  id: string;
  label: string;
  starts_with: string;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

function keyBody(row: PartnerKeyRow): Record<string, unknown> {
  return {
    id: row.id,
    label: row.label,
    startsWith: row.starts_with,
    createdAt: toInstant(row.created_at),
    lastUsedAt: row.last_used_at === null ? null : toInstant(row.last_used_at),
    revokedAt: row.revoked_at === null ? null : toInstant(row.revoked_at),
  };
}

export const partnerRoutes: readonly Registered[] = [
  define({
    kind: 'partner',
    method: 'POST',
    path: '/api/partner/v1/cases',
    content: 'json',
    rateLimit: async (context, partnerKeyId) => {
      const windowSeconds = config().timers.partnerRateWindowSeconds;
      const since = new Date(context.now.getTime() - windowSeconds * 1000);
      const rows = await query<{ at: Date }>(
        'SELECT at FROM partner_requests WHERE partner_key_id = $1 AND at > $2 ORDER BY at',
        [partnerKeyId, since],
      );
      if (rows.length >= CASE_ALLOWANCE) {
        const oldest = rows[0].at.getTime() + windowSeconds * 1000;
        throw rateLimited(Math.max(1, Math.ceil((oldest - context.now.getTime()) / 1000)));
      }
      await query('INSERT INTO partner_requests (partner_key_id, at) VALUES ($1,$2)', [
        partnerKeyId,
        context.now,
      ]);
    },
    handler: async (context) => {
      const requestKey = context.requestKey;
      if (requestKey === null || requestKey === '' || codePoints(requestKey) > 100) {
        throw failure('invalid', { requestKey: 'Send a Request-Key header.' });
      }
      const input = await readCaseCreation(context);
      const row = await createCase(
        context.workspace,
        { kind: 'partner_key', name: context.partnerKey.label },
        input,
        context.now,
      );
      const body = { case: await presentCase(row, 'compliance_officer', context.now) };
      return { status: 201, json: body };
    },
  }),
  define({
    kind: 'staff',
    method: 'GET',
    path: '/api/w/:slug/partner-keys',
    roles: OFFICER,
    handler: async (context) => {
      const rows = await query<PartnerKeyRow>(
        `SELECT id, label, starts_with, created_at, last_used_at, revoked_at FROM partner_keys
         WHERE workspace_slug = $1 ORDER BY created_at`,
        [context.workspace.slug],
      );
      return { status: 200, json: { keys: rows.map(keyBody) } };
    },
  }),
  define({
    kind: 'staff',
    method: 'POST',
    path: '/api/w/:slug/partner-keys',
    roles: OFFICER,
    content: 'json',
    handler: async (context) => {
      const label = readText(context.body, 'label');
      const check = new FieldCheck();
      if (label === null || codePoints(label) < 1 || codePoints(label) > 80) {
        check.add('label', 'Enter a label of 1 to 80 characters.');
      }
      check.settle();
      const secret = `lnlk_${randomBytes(16).toString('hex')}`;
      const id = newId('pk');
      await query(
        `INSERT INTO partner_keys (id, workspace_slug, label, starts_with, key_hash, created_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, context.workspace.slug, label, secret.slice(0, 9), hashPartnerKey(secret), context.now],
      );
      const row = await queryOne<PartnerKeyRow>(
        'SELECT id, label, starts_with, created_at, last_used_at, revoked_at FROM partner_keys WHERE id = $1',
        [id],
      );
      return { status: 201, json: { key: keyBody(row as PartnerKeyRow), secret } };
    },
  }),
  define({
    kind: 'staff',
    method: 'DELETE',
    path: '/api/w/:slug/partner-keys/:keyId',
    roles: OFFICER,
    load: async (context) => {
      const row = await queryOne<PartnerKeyRow>(
        `SELECT id, label, starts_with, created_at, last_used_at, revoked_at FROM partner_keys
         WHERE workspace_slug = $1 AND id = $2`,
        [context.workspace.slug, context.params.keyId],
      );
      if (row === null) throw failure('not_found');
      return row;
    },
    handler: async (context) => {
      if (context.loaded.revoked_at !== null) throw failure('key_revoked');
      await query('UPDATE partner_keys SET revoked_at = $2 WHERE id = $1', [
        context.loaded.id,
        context.now,
      ]);
      return {
        status: 200,
        json: { key: keyBody({ ...context.loaded, revoked_at: context.now }) },
      };
    },
  }),
];
