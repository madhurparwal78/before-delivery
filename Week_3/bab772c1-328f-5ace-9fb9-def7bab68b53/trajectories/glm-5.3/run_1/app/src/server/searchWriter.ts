// Search writes: a pin answers 201 and a pass becomes parsed only after the
// engine confirms the write or the documents are recorded as pending.

import type { PoolClient } from "pg";
import { DependencyError } from "./deps.js";
import {
  deleteDocumentsByPassId,
  upsertDocuments,
  type SearchDocument,
} from "./search.js";

export type SearchOutcome = { confirmed: boolean; pendingIds: number[] };

export async function writeSearchDocuments(
  client: PoolClient,
  documents: SearchDocument[],
  pendingIds: number[],
): Promise<SearchOutcome> {
  if (documents.length === 0 && pendingIds.length === 0) return { confirmed: true, pendingIds: [] };
  try {
    const outcome = await upsertDocuments(documents);
    if (outcome.confirmed) {
      await clearPending(client, pendingIds);
      return { confirmed: true, pendingIds: [] };
    }
    return { confirmed: false, pendingIds };
  } catch (err) {
    if (err instanceof DependencyError) {
      return { confirmed: false, pendingIds };
    }
    throw err;
  }
}

export async function removePassDocuments(
  client: PoolClient,
  passId: string,
): Promise<SearchOutcome> {
  try {
    const outcome = await deleteDocumentsByPassId(passId);
    if (outcome.confirmed) return { confirmed: true, pendingIds: [] };
    return { confirmed: false, pendingIds: [] };
  } catch (err) {
    if (err instanceof DependencyError) {
      return { confirmed: false, pendingIds: [] };
    }
    throw err;
  }
}

export async function recordPendingWrite(
  client: PoolClient,
  missionId: string,
  kind: "line" | "event" | "delete",
  entityId: string,
  payload: Record<string, unknown>,
): Promise<number> {
  const result = await client.query(
    `INSERT INTO pending_search_writes (mission_id, kind, entity_id, payload, created_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [missionId, kind, entityId, JSON.stringify(payload), new Date().toISOString()],
  );
  return Number(result.rows[0].id);
}

export async function clearPending(client: PoolClient, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await client.query("DELETE FROM pending_search_writes WHERE id = ANY($1)", [ids]);
}

// Catch-up: retried every retry interval and before every search. Never
// indexes a document whose line or event no longer exists.
export async function catchUpPendingWrites(
  client: PoolClient,
): Promise<{ attempted: boolean }> {
  const rows = await client.query(
    `SELECT id, mission_id, kind, entity_id, payload FROM pending_search_writes ORDER BY id LIMIT 500`,
  );
  if (rows.rows.length === 0) return { attempted: false };
  const documents: SearchDocument[] = [];
  const deletes: string[] = [];
  const doneIds: number[] = [];
  for (const row of rows.rows) {
    if (row.kind === "delete") {
      deletes.push(row.entity_id);
      doneIds.push(Number(row.id));
      continue;
    }
    const exists = await entityExists(client, row.kind, row.entity_id);
    if (!exists) {
      doneIds.push(Number(row.id));
      continue;
    }
    const payload = row.payload as Record<string, unknown>;
    const missionId = await missionOfEntity(client, row.kind, row.entity_id);
    if (missionId === null) {
      doneIds.push(Number(row.id));
      continue;
    }
    if (row.kind === "line") {
      documents.push({
        id: `line-${row.entity_id}`,
        mission_id: missionId,
        pass_id: String(payload.pass_id),
        kind: "line",
        met: Number(payload.met),
        speaker: String(payload.speaker),
        text: String(payload.text),
      });
    } else {
      documents.push({
        id: `event-${row.entity_id}`,
        mission_id: missionId,
        pass_id: String(payload.pass_id),
        kind: "event",
        met: Number(payload.met),
        speaker: null,
        text: String(payload.text),
      });
    }
    doneIds.push(Number(row.id));
  }
  let allConfirmed = true;
  try {
    if (documents.length > 0) {
      const outcome = await upsertDocuments(documents);
      allConfirmed = outcome.confirmed;
    }
    for (const passId of deletes) {
      const outcome = await deleteDocumentsByPassId(passId);
      if (!outcome.confirmed) allConfirmed = false;
    }
  } catch (err) {
    if (!(err instanceof DependencyError)) throw err;
    return { attempted: true };
  }
  if (allConfirmed) {
    await clearPending(client, doneIds);
  } else {
    console.error("search catch-up not confirmed; will retry");
  }
  return { attempted: true };
}

async function entityExists(
  client: PoolClient,
  kind: string,
  entityId: string,
): Promise<boolean> {
  if (kind === "line") {
    const result = await client.query(
      `SELECT 1 FROM transcript_lines l JOIN passes p ON p.id = l.pass_id
       WHERE l.id = $1 AND p.deleted = FALSE`,
      [entityId],
    );
    return result.rows.length > 0;
  }
  const result = await client.query(
    `SELECT 1 FROM events e JOIN passes p ON p.id = e.pass_id
     WHERE e.id = $1 AND p.deleted = FALSE`,
    [entityId],
  );
  return result.rows.length > 0;
}

async function missionOfEntity(
  client: PoolClient,
  kind: string,
  entityId: string,
): Promise<string | null> {
  if (kind === "line") {
    const result = await client.query("SELECT mission_id FROM transcript_lines WHERE id = $1", [
      entityId,
    ]);
    return result.rows.length > 0 ? result.rows[0].mission_id : null;
  }
  const result = await client.query("SELECT mission_id FROM events WHERE id = $1", [entityId]);
  return result.rows.length > 0 ? result.rows[0].mission_id : null;
}
