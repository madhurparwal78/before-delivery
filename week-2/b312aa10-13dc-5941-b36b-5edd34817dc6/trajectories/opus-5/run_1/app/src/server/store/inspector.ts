import { randomBytes, randomUUID } from 'node:crypto';
import type { Queryable } from '../db/pool.js';
import type { InspectorAccessRecord, InspectorLink } from '../domain/types.js';

type LinkRow = {
  id: string;
  kitchen_id: string;
  email: string;
  token: string;
  expires_at: Date;
  revoked_at: Date | null;
};

type AccessRow = { at: Date; action: 'view' | 'document' | 'report'; target: string | null };

async function records(client: Queryable, linkId: string): Promise<InspectorAccessRecord[]> {
  const result = await client.query<AccessRow>(
    `select at, action, target from inspector_access where link_id = $1 order by seq desc`,
    [linkId],
  );
  return result.rows.map((row) => ({
    atMs: row.at.getTime(),
    action: row.action,
    target: row.target,
  }));
}

async function toLink(client: Queryable, row: LinkRow): Promise<InspectorLink> {
  return {
    id: row.id,
    kitchenId: row.kitchen_id,
    email: row.email,
    token: row.token,
    expiresAtMs: row.expires_at.getTime(),
    revokedAtMs: row.revoked_at ? row.revoked_at.getTime() : null,
    records: await records(client, row.id),
  };
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function createLink(
  client: Queryable,
  kitchenId: string,
  email: string,
  expiresAtMs: number,
): Promise<InspectorLink> {
  const result = await client.query<LinkRow>(
    `insert into inspector_links (id, kitchen_id, email, token, expires_at)
     values ($1,$2,$3,$4,$5)
     returning id, kitchen_id, email, token, expires_at, revoked_at`,
    [`ilk_${randomUUID()}`, kitchenId, email, newToken(), new Date(expiresAtMs).toISOString()],
  );
  return toLink(client, result.rows[0]!);
}

export async function listLinks(
  client: Queryable,
  kitchenId: string,
): Promise<InspectorLink[]> {
  const result = await client.query<LinkRow>(
    `select id, kitchen_id, email, token, expires_at, revoked_at from inspector_links
      where kitchen_id = $1 order by seq desc`,
    [kitchenId],
  );
  const links: InspectorLink[] = [];
  for (const row of result.rows) {
    links.push(await toLink(client, row));
  }
  return links;
}

export async function loadLink(
  client: Queryable,
  kitchenId: string,
  linkId: string,
): Promise<InspectorLink | null> {
  const result = await client.query<LinkRow>(
    `select id, kitchen_id, email, token, expires_at, revoked_at from inspector_links
      where id = $1 and kitchen_id = $2`,
    [linkId, kitchenId],
  );
  const row = result.rows[0];
  return row ? toLink(client, row) : null;
}

export async function loadLinkByToken(
  client: Queryable,
  token: string,
): Promise<InspectorLink | null> {
  const result = await client.query<LinkRow>(
    `select id, kitchen_id, email, token, expires_at, revoked_at from inspector_links
      where token = $1`,
    [token],
  );
  const row = result.rows[0];
  return row ? toLink(client, row) : null;
}

export async function revokeLink(client: Queryable, linkId: string, atMs: number): Promise<void> {
  await client.query(
    `update inspector_links set revoked_at = coalesce(revoked_at, $2) where id = $1`,
    [linkId, new Date(atMs).toISOString()],
  );
}

export async function regenerateToken(client: Queryable, linkId: string): Promise<string> {
  const token = newToken();
  await client.query(`update inspector_links set token = $2, revoked_at = null where id = $1`, [
    linkId,
    token,
  ]);
  return token;
}

export async function addAccessRecord(
  client: Queryable,
  linkId: string,
  atMs: number,
  action: 'view' | 'document' | 'report',
  target: string | null,
): Promise<void> {
  await client.query(
    `insert into inspector_access (id, link_id, at, action, target) values ($1,$2,$3,$4,$5)`,
    [`iac_${randomUUID()}`, linkId, new Date(atMs).toISOString(), action, target],
  );
}
