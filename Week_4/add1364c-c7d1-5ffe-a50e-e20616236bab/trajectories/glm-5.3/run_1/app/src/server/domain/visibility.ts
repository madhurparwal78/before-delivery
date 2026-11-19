import type { Pool } from 'pg';
import { TZDate } from '@date-fns/tz';
import type { ServerClock } from '../clock.js';

export type Role = 'office_manager' | 'managing_partner' | 'staff_accountant' | 'outside_bookkeeper';

export interface PersonRow {
  id: string;
  full_name: string;
  email: string;
  handle: string;
  role: Role;
  status: string;
  aliases: string[];
  term_starts_on: string | null;
  term_ends_on: string | null;
  left_at: Date | null;
  first_signed_in_at: Date | null;
}

export interface TravelRow {
  id: string;
  starts_at: Date;
  ends_at: Date;
}

export interface VaultRow {
  id: string;
  name: string;
  formerly: string | null;
  off_when_travelling: boolean;
  position: number;
}

/**
 * The one place vault visibility is decided. Visibility is decided only on the
 * server, at the moment of each request.
 */
export async function visibleVaultIds(
  person: PersonRow,
  scopes: Set<string>,
  travels: TravelRow[],
  vaults: VaultRow[],
  now: Date
): Promise<string[]> {
  if (person.status === 'left' || person.left_at !== null) return [];
  if (person.role === 'office_manager' || person.role === 'managing_partner') {
    return vaults.map((vault) => vault.id);
  }
  const travelling = travels.some((travel) => travel.starts_at.getTime() <= now.getTime() && now.getTime() < travel.ends_at.getTime());
  const termOpen = person.role !== 'outside_bookkeeper' || termIsOpen(person, now);
  if (!termOpen) return [];
  const ids: string[] = [];
  for (const vault of vaults) {
    if (!scopes.has(vault.id)) continue;
    if (vault.off_when_travelling && travelling) continue;
    ids.push(vault.id);
  }
  return ids;
}

/** An engagement term runs to 23:59 office time on its end date. */
export function termIsOpen(person: PersonRow, now: Date): boolean {
  if (person.role !== 'outside_bookkeeper') return true;
  if (person.term_starts_on === null || person.term_ends_on === null) return false;
  const startIso = `${person.term_starts_on}T00:00:00`;
  const endIso = `${person.term_ends_on}T23:59:00`;
  const startLocal = officeLocalFromIso(startIso);
  const endLocal = officeLocalFromIso(endIso);
  return startLocal.getTime() <= now.getTime() && now.getTime() <= endLocal.getTime();
}

/** Office-local ISO `YYYY-MM-DDTHH:MM:SS` to a real instant (DST rules apply). */
export function officeLocalFromIso(localIso: string): Date {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(localIso);
  if (!dateMatch) return new Date(localIso);
  const [, y, m, d, hh, mm, ss] = dateMatch;
  return officeLocalPartsToInstant(Number(y), Number(m), Number(d), Number(hh), Number(mm), Number(ss ?? '0'));
}

/** Construct an office-local instant with DST handling (see officeTime.officeLocalInstant). */
export function officeLocalPartsToInstant(y: number, m: number, d: number, hh: number, mm: number, ss: number): Date {
  return new TZDate(y, m - 1, d, hh, mm, ss, 'America/Chicago');
}

/** Whether a person may see the rules surfaces (office manager and managing partner only). */
export function seesRules(role: Role): boolean {
  return role === 'office_manager' || role === 'managing_partner';
}
