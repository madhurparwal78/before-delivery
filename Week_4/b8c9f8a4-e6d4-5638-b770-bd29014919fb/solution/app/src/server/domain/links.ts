// Named links. A link's status is decided only by the server's clock.

import { randomBytes, randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { one, query, type Row } from '../db/pool.js';
import { fail } from '../http/errors.js';

type LinkRole = 'buyer' | 'inspector';
type LinkStatus = 'active' | 'revoked' | 'expired';

export interface LinkRow extends Row {
  id: string;
  car_id: string;
  role: LinkRole;
  name: string;
  token: string;
  revoked: boolean;
  issued_at: Date;
  expires_at: Date;
}

export function statusOf(link: LinkRow, now = new Date()): LinkStatus {
  if (link.revoked) return 'revoked';
  return link.expires_at.getTime() <= now.getTime() ? 'expired' : 'active';
}

export function secondsRemaining(link: LinkRow, now = new Date()): number {
  if (statusOf(link, now) !== 'active') return 0;
  return Math.max(0, Math.floor((link.expires_at.getTime() - now.getTime()) / 1000));
}

export function newToken(): string {
  return randomBytes(24).toString('base64url');
}

export async function insertLink(
  carId: string,
  role: LinkRole,
  name: string,
  token = newToken(),
  issuedAt = new Date(),
): Promise<LinkRow> {
  const row = await one<LinkRow>(
    `INSERT INTO link (id, car_id, role, name, token, issued_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [randomUUID(), carId, role, name, token, issuedAt, new Date(issuedAt.getTime() + config.linkTtlSeconds * 1000)],
  );
  return row as LinkRow;
}

export async function linkByToken(token: string): Promise<LinkRow | null> {
  // Postgres text cannot hold NUL, so such a token can never match: answer link_not_found, not 500.
  if (token.includes('\u0000')) return null;
  return one<LinkRow>('SELECT * FROM link WHERE token = $1', [token]);
}

export async function linksOfCar(carId: string): Promise<LinkRow[]> {
  return query<LinkRow>('SELECT * FROM link WHERE car_id = $1 ORDER BY issued_at ASC', [carId]);
}

/** Unknown, revoked and expired links are refused the same way everywhere. */
export function requireUsable(link: LinkRow | null): LinkRow {
  if (!link) fail(404, 'link_not_found', 'That link is not one of ours.');
  const status = statusOf(link);
  if (status === 'revoked') fail(410, 'link_revoked', 'That link has been revoked.');
  if (status === 'expired') fail(410, 'link_expired', 'That link has expired.');
  return link;
}

export function requireRole(link: LinkRow, role: LinkRole): void {
  if (link.role !== role) fail(403, 'wrong_role', 'That link cannot do this.');
}
