import { query } from '../db.js';
import type { PersonRow, VaultRow } from '../types.js';
import { scopeIds, termRunningAt, travelOpenAt, travelWindows } from './people.js';

export async function allVaults(): Promise<VaultRow[]> {
  return query<VaultRow>('select * from vaults order by drawer_order asc');
}

export function seesEveryVault(person: PersonRow): boolean {
  return person.role === 'office_manager' || person.role === 'managing_partner';
}

/**
 * The one place that decides which vaults a caller may see, at the moment of a
 * request: a leaver sees nothing, an outside bookkeeper sees nothing outside
 * the engagement term, and a vault marked off when travelling is withheld
 * while one of that person's travel windows is open.
 */
export async function visibleVaults(person: PersonRow, at: Date): Promise<VaultRow[]> {
  if (person.left_at !== null) return [];
  const vaults = await allVaults();
  if (seesEveryVault(person)) return vaults;
  if (person.role === 'outside_bookkeeper' && !termRunningAt(person, at)) return [];
  const scopes = new Set(await scopeIds(person.id));
  const travelling = travelOpenAt(await travelWindows(person.id), at);
  return vaults.filter((vault) => scopes.has(vault.id) && !(travelling && vault.off_when_travelling));
}

export async function visibleVaultIds(person: PersonRow, at: Date): Promise<string[]> {
  return (await visibleVaults(person, at)).map((vault) => vault.id);
}

export async function canSeeVault(person: PersonRow, vaultId: string, at: Date): Promise<boolean> {
  return (await visibleVaultIds(person, at)).includes(vaultId);
}
