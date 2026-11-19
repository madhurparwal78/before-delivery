import { query } from "../db/pool.ts";
import { entryOfClient, entryOfMaterial, entryOfPiece, rebuildIfOutOfStep, type SearchEntry } from "../providers/meili.ts";
import { every2s } from "./loop.ts";

async function entriesInDatabase(): Promise<SearchEntry[]> {
  const materials = await query<{ desk_id: string; code: string; name: string }>("SELECT desk_id, code, name FROM materials");
  const clients = await query<{ desk_id: string; id: string; name: string }>("SELECT desk_id, id, name FROM clients WHERE state IN ('active', 'closing')");
  const pieces = await query<{ desk_id: string; id: string; title: string }>(
    "SELECT p.desk_id, p.id, p.title FROM pieces p JOIN clients c ON c.id = p.client_id WHERE c.state IN ('active', 'closing')",
  );
  return [
    ...materials.map((row) => entryOfMaterial(row.desk_id, row)),
    ...clients.map((row) => entryOfClient(row.desk_id, row)),
    ...pieces.map((row) => entryOfPiece(row.desk_id, row)),
  ];
}

/** On start the index is built from the database, whatever the engine holds, and keeps trying while the engine is down. */
export function startSearchRebuild(): void {
  every2s("search rebuild", () => rebuildIfOutOfStep(entriesInDatabase));
}
