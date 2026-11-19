import type { Sql } from '../providers/db.ts';
import { db } from '../providers/db.ts';
import { invalid, notFound } from '../http/errors.ts';
import { isValidCommandId } from '../http/precedence.ts';
import { badRequest } from '../http/errors.ts';
import type { AppSession } from '../session.ts';
import type { Holder, Party, Role } from '../../shared/types.ts';

/** A desk is visible to the dealer and counterpart of that namespace only. */
export async function namespaceExists(ns: string): Promise<boolean> {
  const sql = await db();
  const found = await sql.query('SELECT 1 FROM namespaces WHERE ns = $1', [ns]);
  return found.rowCount === 1;
}

export function viewerParty(session: AppSession): Party | null {
  if (session.role === 'dealer') return 'dealer';
  if (session.role === 'counterpart') return 'counterpart';
  return null;
}

/**
 * An outsider gets 404 on every desk route, and anyone outside the namespace
 * sees nothing of it.
 */
export async function deskVisibleTo(session: AppSession | null, ns: string): Promise<boolean> {
  if (!session) return false;
  if (session.ns !== ns) return false;
  if (session.role === 'outsider') return false;
  return namespaceExists(ns);
}

export function requireCommandId(body: Record<string, unknown>): string {
  const value = body['command_id'];
  if (!isValidCommandId(value)) throw badRequest();
  return value;
}

export function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string') throw invalid({ [field]: 'Check the highlighted fields.' });
  return value;
}

export function optionalString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  return typeof value === 'string' ? value : '';
}

export function requireInteger(body: Record<string, unknown>, field: string): number {
  const value = body[field];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw invalid({ [field]: 'Check the highlighted fields.' });
  }
  return value;
}

export function requireStringList(body: Record<string, unknown>, field: string): string[] {
  const value = body[field];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw invalid({ [field]: 'Check the highlighted fields.' });
  }
  return value as string[];
}

/** `expected_version` is required on every change to an existing record. */
export function requireExpectedVersion(body: Record<string, unknown>): number {
  const value = body['expected_version'];
  if (typeof value !== 'number' || !Number.isInteger(value)) throw badRequest();
  return value;
}

export function parseLimit(raw: string | null, max: number, copy: string): number {
  if (raw === null || raw === '') return max;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > max) {
    throw invalid({ limit: copy });
  }
  return parsed;
}

/* -- row readers used across command modules ----------------------------- */

export interface SpecimenRecord {
  key: string;
  display_label: string;
  owner: Role;
  version: number;
  holder: Holder;
  attribution: {
    reference: string | null;
    mintmark: string | null;
    revision: number | null;
    certainty: 'certain' | 'uncertain';
    note: string | null;
    correction: string | null;
    register: 'stored' | 'pending';
  };
  quarantined: boolean;
  missing: boolean;
}

export async function lockSpecimen(
  sql: Sql,
  ns: string,
  key: string,
): Promise<SpecimenRecord | null> {
  const found = await sql.query<SpecimenRecord>(
    `SELECT key, display_label, owner, version, holder, attribution, quarantined, missing
       FROM specimens WHERE ns = $1 AND key = $2 FOR UPDATE`,
    [ns, key],
  );
  return found.rows[0] ?? null;
}

export async function specimenExists(ns: string, key: string): Promise<boolean> {
  const sql = await db();
  const found = await sql.query('SELECT 1 FROM specimens WHERE ns = $1 AND key = $2', [ns, key]);
  return found.rowCount === 1;
}

/** Whether a specimen is currently reserved, held or outbound. */
export async function reservationOf(
  sql: Sql,
  ns: string,
  key: string,
): Promise<{ reserved: boolean; outbound: boolean }> {
  const offers = await sql.query<{ status: string }>(
    `SELECT status FROM offers
      WHERE ns = $1 AND (dealer_items @> $2::jsonb OR counterpart_items @> $2::jsonb)`,
    [ns, JSON.stringify([key])],
  );
  const holds = await sql.query('SELECT 1 FROM offer_holds WHERE ns = $1 AND specimen = $2', [
    ns,
    key,
  ]);

  let reserved = (holds.rowCount ?? 0) > 0;
  let outbound = false;
  for (const row of offers.rows) {
    const status = row.status;
    if (
      status === 'sent' ||
      status === 'countered' ||
      status === 'accepted' ||
      status === 'dispatched' ||
      status === 'received' ||
      status === 'disputed'
    ) {
      reserved = true;
    }
    if (
      status === 'accepted' ||
      status === 'dispatched' ||
      status === 'received' ||
      status === 'disputed'
    ) {
      outbound = true;
    }
  }
  return { reserved, outbound };
}

export const assertFound = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw notFound();
  return value;
};
