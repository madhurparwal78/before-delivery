import type { PoolClient } from '../db';
import { one, query, row } from '../db';
import { RateLimited, apiError } from '../errors';
import { isoSecond } from '../format';
import { hashToken, randomId, randomToken } from '../crypto/seal';
import { nowSecond } from '../http/core';

export interface ShareLinkRecord {
  id: string;
  workspace_slug: string;
  bucket: string;
  object_key: string;
  version_id: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  state: string;
}

const columns = 'id, workspace_slug, bucket, object_key, version_id, created_by, created_at, expires_at, state';

export const expiryMessage = 'Pick an expiry between one second and seven days.';

export function validateExpiry(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 604800) {
    throw apiError('validation_failed', 'Some fields need fixing.', { errors: { expires_in_seconds: expiryMessage } });
  }
  return value;
}

export async function createLink(
  client: PoolClient,
  options: { slug: string; bucket: string; key: string; versionId: string; createdBy: string; expiresInSeconds: number },
): Promise<{ link: ShareLinkRecord; token: string }> {
  const token = randomToken();
  const at = nowSecond();
  const created = await row<ShareLinkRecord>(
    client,
    `insert into share_links (id, workspace_slug, bucket, object_key, version_id, token_hash, created_by, created_at, expires_at, state)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active') returning ${columns}`,
    [
      randomId('lnk'),
      options.slug,
      options.bucket,
      options.key,
      options.versionId,
      hashToken(token),
      options.createdBy,
      at.toISOString(),
      new Date(at.getTime() + options.expiresInSeconds * 1000).toISOString(),
    ],
  );
  return { link: created as ShareLinkRecord, token };
}

export function linkJson(link: ShareLinkRecord, at: Date = new Date()): Record<string, unknown> {
  return {
    id: link.id,
    bucket: link.bucket,
    key: link.object_key,
    version_id: link.version_id,
    created_by: link.created_by,
    created_at: isoSecond(link.created_at),
    expires_at: isoSecond(link.expires_at),
    state: linkState(link, at),
  };
}

/** A link is expired by time and revoked by request, delete, removal or version removal. */
export function linkState(link: ShareLinkRecord, at: Date = new Date()): 'active' | 'expired' | 'revoked' {
  if (link.state === 'revoked') return 'revoked';
  return at.getTime() >= new Date(link.expires_at).getTime() ? 'expired' : 'active';
}

export async function listLinks(slug: string): Promise<ShareLinkRecord[]> {
  return query<ShareLinkRecord>(`select ${columns} from share_links where workspace_slug = $1 order by created_at desc`, [slug]);
}

export async function findLinkById(client: PoolClient, slug: string, id: string): Promise<ShareLinkRecord | null> {
  return row<ShareLinkRecord>(client, `select ${columns} from share_links where id = $1 and workspace_slug = $2 for update`, [id, slug]);
}

export async function findLinkByToken(token: string): Promise<ShareLinkRecord | null> {
  return one<ShareLinkRecord>(`select ${columns} from share_links where token_hash = $1`, [hashToken(token)]) as Promise<
    ShareLinkRecord | null
  >;
}

export async function revokeLink(client: PoolClient, link: ShareLinkRecord): Promise<ShareLinkRecord> {
  const state = linkState(link);
  if (state !== 'active') {
    throw apiError('invalid_transition', "That change isn't allowed from the current state.", { from: state, to: 'revoked' });
  }
  const updated = await row<ShareLinkRecord>(
    client,
    `update share_links set state = 'revoked' where id = $1 returning ${columns}`,
    [link.id],
  );
  return updated as ShareLinkRecord;
}

export async function revokeLinksByCreator(client: PoolClient, slug: string, userId: string): Promise<void> {
  await client.query(`update share_links set state = 'revoked' where workspace_slug = $1 and created_by = $2 and state = 'active'`, [
    slug,
    userId,
  ]);
}

/** Each link allows 30 requests in any rolling 60 seconds. */
export async function checkLinkRate(linkId: string): Promise<void> {
  const found = await query<{ at: string }>(
    "select at from link_requests where link_id = $1 and at > now() - interval '60 seconds' order by at",
    [linkId],
  );
  if (found.length >= 30) {
    const oldest = new Date(found[0].at).getTime();
    const retryAfter = Math.max(1, Math.ceil((oldest + 60000 - Date.now()) / 1000));
    throw new RateLimited(retryAfter, `Too many downloads right now. Try again in ${retryAfter} seconds.`);
  }
  await query('insert into link_requests (link_id, at) values ($1, now())', [linkId]);
}
