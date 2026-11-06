import { randomBytes } from 'node:crypto';
import { config } from './config';
import type { Queryable } from './db/queryable';

export type LinkStatus = 'live' | 'expired' | 'revoked';

export interface RegulatorLink {
  readonly id: string;
  readonly figureId: string;
  readonly token: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly revokedAtMs: number | null;
}

interface LinkRow {
  id: string;
  figure_id: string;
  token: string;
  issued_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
}

function toLink(row: LinkRow): RegulatorLink {
  return {
    id: row.id,
    figureId: row.figure_id,
    token: row.token,
    issuedAtMs: row.issued_at.getTime(),
    expiresAtMs: row.expires_at.getTime(),
    revokedAtMs: row.revoked_at === null ? null : row.revoked_at.getTime(),
  };
}

/** The one place a link's status is decided, always from a single read of the server clock. */
export function linkStatus(link: RegulatorLink, nowMs: number): LinkStatus {
  if (link.revokedAtMs !== null) return 'revoked';
  return nowMs >= link.expiresAtMs ? 'expired' : 'live';
}

export function linkUrl(token: string): string {
  return `${config.appPublicUrl}/r/${token}`;
}

export interface ClockedLinks {
  readonly links: readonly RegulatorLink[];
  readonly nowMs: number;
}

async function clockedQuery(
  executor: Queryable,
  sql: string,
  params: readonly unknown[],
): Promise<ClockedLinks> {
  const result = await executor.query<LinkRow & { server_now: Date }>(sql, params);
  const first = result.rows[0];
  return {
    links: result.rows.map(toLink),
    nowMs: first === undefined ? Date.now() : first.server_now.getTime(),
  };
}

export async function linkByToken(executor: Queryable, token: string): Promise<ClockedLinks> {
  return clockedQuery(
    executor,
    `select id, figure_id, token, issued_at, expires_at, revoked_at,
            clock_timestamp() as server_now
     from regulator_links where token = $1`,
    [token],
  );
}

export async function linkById(executor: Queryable, id: string): Promise<ClockedLinks> {
  return clockedQuery(
    executor,
    `select id, figure_id, token, issued_at, expires_at, revoked_at,
            clock_timestamp() as server_now
     from regulator_links where id = $1`,
    [id],
  );
}

export async function linksForFigure(executor: Queryable, figureId: string): Promise<ClockedLinks> {
  return clockedQuery(
    executor,
    `select id, figure_id, token, issued_at, expires_at, revoked_at,
            clock_timestamp() as server_now
     from regulator_links where figure_id = $1 order by issued_at, id`,
    [figureId],
  );
}

export async function issueLink(
  executor: Queryable,
  figureId: string,
): Promise<RegulatorLink> {
  const token = randomBytes(24).toString('base64url');
  const result = await executor.query<LinkRow>(
    `insert into regulator_links (id, figure_id, token, issued_at, expires_at)
     values ($1, $2, $3, date_trunc('second', clock_timestamp()),
             date_trunc('second', clock_timestamp()) + make_interval(secs => $4))
     returning id, figure_id, token, issued_at, expires_at, revoked_at`,
    [`link-${randomBytes(6).toString('hex')}`, figureId, token, config.linkTtlSeconds],
  );
  return toLink(result.rows[0]!);
}

export async function markRevoked(executor: Queryable, id: string): Promise<RegulatorLink> {
  const result = await executor.query<LinkRow>(
    `update regulator_links set revoked_at = date_trunc('second', clock_timestamp())
     where id = $1
     returning id, figure_id, token, issued_at, expires_at, revoked_at`,
    [id],
  );
  return toLink(result.rows[0]!);
}

/** The Date header comes from the same clock read that decided the status. */
export function dateHeader(nowMs: number): string {
  return new Date(Math.floor(nowMs / 1000) * 1000).toUTCString();
}
