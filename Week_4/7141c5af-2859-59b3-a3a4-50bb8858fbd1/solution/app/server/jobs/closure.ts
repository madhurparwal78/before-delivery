import { query, tx } from "../db/pool.ts";
import { ERASED_CLIENT_NAME } from "../domain/copy.ts";
import { ProviderDown } from "../providers/call.ts";
import { clientEntryId, pieceEntryId, removeEntries } from "../providers/meili.ts";
import { deleteObject, listKeys } from "../providers/s3.ts";
import { every2s } from "./loop.ts";

interface Erasing {
  id: string;
  desk_id: string;
}

/** Both providers are asked for every client, with or without files; a client leaves `erasing` only once both have confirmed. */
async function erase(client: Erasing): Promise<void> {
  const pieces = await query<{ id: string }>("SELECT id FROM pieces WHERE client_id = $1", [client.id]);
  const prefixes = pieces.flatMap((piece) => ["photographs", "labels", "dossiers"].map((folder) => `${folder}/${client.desk_id}/${piece.id}/`));
  const files = await Promise.all([`photographs/${client.desk_id}/${client.id}/`, ...prefixes].map(listKeys));
  await Promise.all(files.flat().map(deleteObject));
  await removeEntries([clientEntryId(client.desk_id, client.id), ...pieces.map((piece) => pieceEntryId(client.desk_id, piece.id))]);
  await tx(async (database) => {
    await database.query("DELETE FROM mail_outbox WHERE client_id = $1", [client.id]);
    await database.query("DELETE FROM pieces WHERE client_id = $1", [client.id]);
    await database.query(
      "UPDATE clients SET state = 'erased', name = $2, town = '', language = '', email = NULL, closes_at = NULL WHERE id = $1",
      [client.id, ERASED_CLIENT_NAME],
    );
  });
}

async function pass(): Promise<void> {
  await query("UPDATE clients SET state = 'erasing' WHERE state = 'closing' AND closes_at <= now()");
  for (const client of await query<Erasing>("SELECT id, desk_id FROM clients WHERE state = 'erasing'")) {
    try {
      await erase(client);
    } catch (error) {
      if (!(error instanceof ProviderDown)) throw error;
    }
  }
}

export function startClosureJob(): void {
  every2s("closure", pass);
}
