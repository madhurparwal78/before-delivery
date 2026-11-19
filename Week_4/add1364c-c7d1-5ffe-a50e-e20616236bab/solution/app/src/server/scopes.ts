import type { Tx } from "./db.js";
import { record, type Actor } from "./audit.js";
import type { PersonRow, VaultRow } from "./model.js";
import { addLines, closeLines } from "./review-lines.js";
import { createScopeLossTurns, type TurnDue } from "./turns.js";

async function vaultsInOrder(tx: Tx, ids: string[]): Promise<VaultRow[]> {
  return tx.query<VaultRow>("SELECT * FROM vaults WHERE id = ANY($1) ORDER BY ord", [ids]);
}

/**
 * A person lost vault scopes. For each vault in drawer order: the scope_removed entry, the review lines
 * it closes, and a turn due for every login in it.
 */
export async function dropScopes(tx: Tx, person: PersonRow, vaultIds: string[], actor: Actor, at: Date): Promise<TurnDue[]> {
  const turns: TurnDue[] = [];
  for (const vault of await vaultsInOrder(tx, vaultIds)) {
    await tx.query("DELETE FROM person_vaults WHERE person_id = $1 AND vault_id = $2", [person.id, vault.id]);
    await record(tx, actor, "scope_removed", { kind: "person", id: person.id, name: person.full_name }, { vault_id: vault.id, vault: vault.name }, at);
    await closeLines(tx, person, vault.id, vault.name, actor, at);
    turns.push(...(await createScopeLossTurns(tx, vault, actor, at)));
  }
  return turns;
}

export async function gainScopes(tx: Tx, person: PersonRow, vaultIds: string[], actor: Actor, at: Date): Promise<void> {
  const vaults = await vaultsInOrder(tx, vaultIds);
  for (const vault of vaults) {
    await tx.query("INSERT INTO person_vaults (person_id, vault_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [person.id, vault.id]);
  }
  await addLines(tx, person, vaults, actor, at);
}
