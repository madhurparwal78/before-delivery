import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { clientQuery, query } from '../db.js';
import { ApiError } from '../errors.js';

export type LinkKind = 'confirm' | 'signin';

const LIFETIME_MILLIS = 15 * 60 * 1000;

export function newToken(): string {
  return randomBytes(24).toString('base64url');
}

export async function issueLink(
  client: PoolClient,
  input: { email: string; kind: LinkKind; draftId: string | null },
  at: Date,
): Promise<string> {
  const token = newToken();
  await clientQuery(
    client,
    'insert into links (token, email, kind, draft_id, issued_at) values ($1, $2, $3, $4, $5)',
    [token, input.email, input.kind, input.draftId, at],
  );
  return token;
}

export interface VerifiedLink {
  email: string;
  kind: LinkKind;
  draftId: string | null;
}

interface LinkRow {
  email: string;
  kind: LinkKind;
  draft_id: string | null;
  sent_at: Date | null;
  used_at: Date | null;
}

/**
 * Spends an emailed link. A link works once and dies 15 minutes after its email was
 * handed to the mail service; used takes precedence over expired.
 */
export async function verifyLink(token: string, at: Date): Promise<VerifiedLink> {
  const found = await query<LinkRow>('select email, kind, draft_id, sent_at, used_at from links where token = $1', [
    token,
  ]);
  const link = found.rows[0];
  if (!link) throw new ApiError('link_unknown');
  if (link.used_at) throw new ApiError('link_used');
  if (link.sent_at && at.getTime() >= link.sent_at.getTime() + LIFETIME_MILLIS) throw new ApiError('link_expired');
  const spent = await query('update links set used_at = $2 where token = $1 and used_at is null', [token, at]);
  if (spent.rowCount === 0) throw new ApiError('link_used');
  return { email: link.email, kind: link.kind, draftId: link.draft_id };
}
