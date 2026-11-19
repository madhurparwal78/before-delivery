import type { Db } from "./db.js";
import { isDesk, type PersonRow } from "./model.js";
import { officeInstant, officeMidnight } from "./office-time.js";

/** The instant an outside bookkeeper's term stops: 23:59 office time on its last day. */
export function termEndInstant(endsOn: string): Date {
  return officeInstant(endsOn, "23:59").at;
}

export function termRunning(person: PersonRow, at: Date): boolean {
  if (person.role !== "outside_bookkeeper" || !person.term_starts_on || !person.term_ends_on) return false;
  return officeMidnight(person.term_starts_on).getTime() <= at.getTime() && at.getTime() < termEndInstant(person.term_ends_on).getTime();
}

/**
 * The one decision of which vaults a person may see at an instant, in drawer order.
 * Every list, vault, login, reveal, copy and as-of answer asks this.
 */
export async function visibleVaultIds(db: Db, person: PersonRow, at: Date): Promise<string[]> {
  if (person.left_at) return [];
  if (isDesk(person.role)) return (await db.query<{ id: string }>("SELECT id FROM vaults ORDER BY ord")).map((row) => row.id);
  if (person.role === "outside_bookkeeper" && !termRunning(person, at)) return [];
  const travelling = await db.one<{ open: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM travel WHERE person_id = $1 AND starts_at <= $2 AND $2 < ends_at) AS open",
    [person.id, at],
  );
  const rows = await db.query<{ id: string }>(
    `SELECT v.id FROM vaults v JOIN person_vaults pv ON pv.vault_id = v.id
     WHERE pv.person_id = $1 AND NOT ($2 AND v.off_when_travelling) ORDER BY v.ord`,
    [person.id, travelling?.open ?? false],
  );
  return rows.map((row) => row.id);
}

export async function canSeeVault(db: Db, person: PersonRow, vaultId: string, at: Date): Promise<boolean> {
  return (await visibleVaultIds(db, person, at)).includes(vaultId);
}

/** Every vault a person holds a scope in, regardless of travel or term. */
export async function scopeVaultIds(db: Db, person: PersonRow): Promise<string[]> {
  if (isDesk(person.role)) return (await db.query<{ id: string }>("SELECT id FROM vaults ORDER BY ord")).map((row) => row.id);
  return (
    await db.query<{ id: string }>(
      "SELECT v.id FROM vaults v JOIN person_vaults pv ON pv.vault_id = v.id WHERE pv.person_id = $1 ORDER BY v.ord",
      [person.id],
    )
  ).map((row) => row.id);
}
