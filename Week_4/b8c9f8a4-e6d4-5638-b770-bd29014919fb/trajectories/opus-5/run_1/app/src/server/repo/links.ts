import { randomBytes, randomUUID } from 'node:crypto';
import { config } from '../config';
import { query, queryOne, type Tx } from '../db';
import { heroOf, isMaterial, type Placed } from '../domain/findings';
import { effectiveStatus, secondsRemaining } from '../domain/offers';
import { refuse } from '../domain/errors';
import type { FindingDto, LinkDto, LinkRole, LinkStatus, OfferStatus } from '../../shared/types';
import { contentHashOfFrozen, loadVersion, type VersionRow } from './versions';

export interface LinkRow {
  id: string;
  car_id: string;
  role: LinkRole;
  name: string;
  token: string;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
}

const COLUMNS = 'id, car_id, role, name, token, expires_at, revoked_at, created_at';

/** A token holds at least 128 bits of randomness. */
export const newToken = (): string => randomBytes(24).toString('base64url');

export const expiryFromNow = (now: Date): Date => new Date(now.getTime() + config.linkTtlSeconds * 1000);

/** Status is decided only by the server's clock, and at the expiry instant the link has expired. */
export const linkStatusOf = (row: LinkRow, now: Date): LinkStatus => {
  if (row.revoked_at !== null) return 'revoked';
  return now.getTime() >= row.expires_at.getTime() ? 'expired' : 'active';
};

export const linkSecondsRemaining = (row: LinkRow, now: Date): number =>
  linkStatusOf(row, now) === 'active' ? Math.max(0, Math.floor((row.expires_at.getTime() - now.getTime()) / 1000)) : 0;

export const findLinkByToken = async (token: string): Promise<LinkRow | null> =>
  queryOne<LinkRow>(`SELECT ${COLUMNS} FROM named_link WHERE token = $1`, [token]);

export const findLinkByTokenIn = async (tx: Tx, token: string): Promise<LinkRow | null> =>
  tx.queryOne<LinkRow>(`SELECT ${COLUMNS} FROM named_link WHERE token = $1`, [token]);

export const findLinkById = async (id: string): Promise<LinkRow | null> =>
  queryOne<LinkRow>(`SELECT ${COLUMNS} FROM named_link WHERE id = $1`, [id]);

export const listLinks = async (carId: string): Promise<LinkRow[]> =>
  query<LinkRow>(`SELECT ${COLUMNS} FROM named_link WHERE car_id = $1 ORDER BY created_at ASC`, [carId]);

export const insertLink = async (
  tx: Tx,
  carId: string,
  role: LinkRole,
  name: string,
  now: Date,
  token = newToken(),
): Promise<LinkRow> => {
  const row = await tx.queryOne<LinkRow>(
    `INSERT INTO named_link (id, car_id, role, name, token, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
    [randomUUID(), carId, role, name, token, expiryFromNow(now)],
  );
  if (row === null) throw new Error('The link insert returned no row');
  return row;
};

/** A link reaching a route it has no business with. */
export const refuseLink = (status: LinkStatus): never => {
  if (status === 'revoked') throw refuse(410, 'link_revoked', 'This link has ended');
  throw refuse(410, 'link_expired', 'This link has ended');
};

export const wrongRole = (): never => {
  throw refuse(403, 'wrong_role', 'This link cannot do that');
};

export interface SeenRow {
  finding_id: string;
  content_hash: string;
  version_number: number;
  seen_at: Date;
}

export const loadSeenRows = async (linkId: string): Promise<SeenRow[]> =>
  query<SeenRow>('SELECT finding_id, content_hash, version_number, seen_at FROM seen_record WHERE link_id = $1', [
    linkId,
  ]);

export interface SeenState {
  /** Seen findings of the current version, by finding id, with the date first stamped. */
  seenAt: Map<string, string>;
  changedSinceSeen: Set<string>;
  seen: number;
  total: number;
  materialUnseen: number;
  lastSeenAt: string | null;
  versionsRead: number[];
}

/** A finding is seen when its current frozen content has a seen record from that link. */
export const seenStateOf = (version: VersionRow | null, rows: readonly SeenRow[]): SeenState => {
  const findings = version?.findings ?? [];
  const byFinding = new Map<string, SeenRow[]>();
  for (const row of rows) {
    const list = byFinding.get(row.finding_id);
    if (list === undefined) byFinding.set(row.finding_id, [row]);
    else list.push(row);
  }

  const seenAt = new Map<string, string>();
  const changedSinceSeen = new Set<string>();
  let materialUnseen = 0;

  for (const finding of findings) {
    const hash = contentHashOfFrozen(finding);
    const history = byFinding.get(finding.id) ?? [];
    const match = history.find((row) => row.content_hash === hash);
    if (match !== undefined) {
      seenAt.set(finding.id, match.seen_at.toISOString());
      continue;
    }
    if (history.length > 0) changedSinceSeen.add(finding.id);
    if (isMaterial(finding.severity)) materialUnseen += 1;
  }

  const stamps = rows.map((row) => row.seen_at.getTime());
  return {
    seenAt,
    changedSinceSeen,
    seen: seenAt.size,
    total: findings.length,
    materialUnseen,
    lastSeenAt: stamps.length === 0 ? null : new Date(Math.max(...stamps)).toISOString(),
    versionsRead: [...new Set(rows.map((row) => row.version_number))].sort((a, b) => a - b),
  };
};

export interface LinkOfferSummary {
  id: string;
  amount_pounds: number;
  status: OfferStatus;
  stamped_at: Date;
  lapses_at: Date;
}

export const loadNewestOffer = async (linkId: string): Promise<LinkOfferSummary | null> =>
  queryOne<LinkOfferSummary>(
    'SELECT id, amount_pounds, status, stamped_at, lapses_at FROM offer WHERE link_id = $1 ORDER BY stamped_at DESC, id DESC LIMIT 1',
    [linkId],
  );

export const buildLinkDto = async (row: LinkRow, currentVersion: number | null, now: Date): Promise<LinkDto> => {
  const status = linkStatusOf(row, now);
  if (row.role === 'inspector') {
    return {
      id: row.id,
      role: row.role,
      name: row.name,
      status,
      expiresAt: row.expires_at.toISOString(),
      secondsRemaining: linkSecondsRemaining(row, now),
      seen: 0,
      total: 0,
      materialUnseen: 0,
      lastSeenAt: null,
      offerStatus: null,
    };
  }

  const [version, seenRows, offer] = await Promise.all([
    currentVersion === null ? Promise.resolve(null) : loadVersion(row.car_id, currentVersion),
    loadSeenRows(row.id),
    loadNewestOffer(row.id),
  ]);
  const state = seenStateOf(version, seenRows);

  return {
    id: row.id,
    role: row.role,
    name: row.name,
    status,
    expiresAt: row.expires_at.toISOString(),
    secondsRemaining: linkSecondsRemaining(row, now),
    seen: state.seen,
    total: state.total,
    materialUnseen: state.materialUnseen,
    lastSeenAt: state.lastSeenAt,
    offerStatus: offer === null ? null : effectiveStatus(offer.status, offer.lapses_at, now),
  };
};

export const offerDtoOf = (offer: LinkOfferSummary, now: Date) => {
  const status = effectiveStatus(offer.status, offer.lapses_at, now);
  return {
    id: offer.id,
    amountPounds: offer.amount_pounds,
    status,
    stampedAt: offer.stamped_at.toISOString(),
    lapsesAt: offer.lapses_at.toISOString(),
    secondsRemaining: secondsRemaining(offer.lapses_at, now, status),
  };
};

/** The hero of a frozen version, by the same rule as the working set. */
export const heroOfVersion = (version: VersionRow | null): FindingDto | null => {
  if (version === null) return null;
  const key = (finding: FindingDto): Placed => ({
    panelId: finding.panelId,
    createdSeq: finding.position,
    severity: finding.severity,
  });
  return heroOf(version.findings, key);
};
