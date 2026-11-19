import { db } from "./db.js";
import { connected, send, closePerson } from "./events.js";
import type { PersonRow } from "./model.js";
import { now } from "./clock.js";
import { visibleVaultIds } from "./visibility.js";

/** Tells a person's open pages which vaults they can see now; `change` is a mover change, `boundary` a time boundary. */
export async function syncAccess(personId: string, cause: "change" | "boundary"): Promise<void> {
  const mine = [...connected()].filter((connection) => connection.personId === personId);
  if (mine.length === 0) return;
  const person = await db.one<PersonRow>("SELECT * FROM people WHERE id = $1", [personId]);
  if (!person) return;
  const visible = await visibleVaultIds(db, person, now());
  const names = new Map((await db.query<{ id: string; name: string }>("SELECT id, name FROM vaults")).map((vault) => [vault.id, vault.name]));
  for (const connection of mine) {
    const ended = [...connection.known].filter((id) => !visible.includes(id));
    const changed = ended.length > 0 || visible.some((id) => !connection.known.has(id));
    connection.known = new Set(visible);
    if (!changed) continue;
    send(connection, "access-changed", {
      vault_ids: visible,
      ended: ended.map((id) => ({ vault_id: id, name: names.get(id) ?? "" })),
      cause,
    });
  }
  if (person.left_at) closePerson(personId);
}

/** Time boundaries (a travel window opens or closes, a term starts) reach open pages within seconds. */
export async function sweepBoundaries(): Promise<void> {
  const people = new Set([...connected()].map((connection) => connection.personId));
  for (const personId of people) await syncAccess(personId, "boundary");
}
