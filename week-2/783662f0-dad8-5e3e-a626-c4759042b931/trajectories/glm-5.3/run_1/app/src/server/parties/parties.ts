/** Parties and leadership succession: the rule lives only here. */

import type { Pool, Queryer } from "../db/pool.js";
import { newId } from "../db/seed.js";
import { Chapter } from "../../shared/data.js";
import { publish } from "../api/events.js";
import { isoInstant } from "../time.js";

export interface PartyRow {
  id: string;
  server_id: string;
  world_id: string;
  name: string;
  state: "open" | "closed";
  leader_id: string;
  created_at: Date;
}

export interface PartyView {
  id: string;
  name: string;
  state: "open" | "closed";
  leader_id: string;
  members: { character_id: string; name: string; joined_at: string }[];
  run_id: string | null;
}

export async function partyView(client: Queryer, partyId: string): Promise<PartyView | null> {
  const party = (await client.query<PartyRow>("SELECT * FROM parties WHERE id = $1", [partyId])).rows[0];
  if (party === undefined) return null;
  const members = await client.query<{ character_id: string; name: string; joined_at: Date }>(
    "SELECT m.character_id, c.name, m.joined_at FROM party_members m JOIN characters c ON c.id = m.character_id WHERE m.party_id = $1 ORDER BY m.joined_at",
    [partyId]
  );
  const run = (await client.query<{ id: string }>("SELECT id FROM chapter_runs WHERE party_id = $1 AND state IN ('in_progress','paused') LIMIT 1", [partyId])).rows[0];
  return {
    id: party.id,
    name: party.name,
    state: party.state,
    leader_id: party.leader_id,
    members: members.rows.map((m) => ({ character_id: m.character_id, name: m.name, joined_at: isoInstant(m.joined_at) })),
    run_id: run?.id ?? null,
  };
}

export async function publishParty(pool: Pool, partyId: string): Promise<void> {
  const view = await partyView(pool, partyId);
  if (view === null) return;
  await publish(pool, (await serverOfParty(pool, partyId)), [{ kind: "party", payload: view }]);
}

async function serverOfParty(pool: Pool, partyId: string): Promise<string> {
  const res = await pool.query<{ server_id: string }>("SELECT server_id FROM parties WHERE id = $1", [partyId]);
  return res.rows[0]?.server_id ?? "";
}

export async function openParties(pool: Pool, serverId: string): Promise<PartyView[]> {
  const rows = await pool.query<{ id: string }>("SELECT id FROM parties WHERE server_id = $1 AND state = 'open' ORDER BY created_at", [serverId]);
  const views: PartyView[] = [];
  for (const row of rows.rows) {
    const view = await partyView(pool, row.id);
    if (view !== null) views.push(view);
  }
  return views;
}

export async function createParty(pool: Pool, input: { serverId: string; worldId: string; characterId: string; name: string }): Promise<{ ok: boolean; error?: "already_in_party"; party?: PartyView }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`party:${input.characterId}`]);
    const existing = (await client.query("SELECT 1 FROM party_members m JOIN parties p ON p.id = m.party_id WHERE m.character_id = $1 AND p.state = 'open'", [input.characterId])).rows;
    if (existing.length > 0) {
      await client.query("ROLLBACK");
      return { ok: false, error: "already_in_party" };
    }
    const id = newId();
    await client.query("INSERT INTO parties (id, server_id, world_id, name, state, leader_id) VALUES ($1,$2,$3,$4,'open',$5)", [
      id,
      input.serverId,
      input.worldId,
      input.name,
      input.characterId,
    ]);
    await client.query("INSERT INTO party_members (party_id, character_id) VALUES ($1,$2)", [id, input.characterId]);
    await client.query("COMMIT");
    const view = await partyView(pool, id);
    await publishParty(pool, id);
    return { ok: true, party: view ?? undefined };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // already closed
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function joinParty(pool: Pool, input: { partyId: string; characterId: string }): Promise<{ ok: boolean; error?: "party_closed" | "already_in_party" }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`party:${input.characterId}`]);
    const party = (await client.query<PartyRow>("SELECT * FROM parties WHERE id = $1 FOR UPDATE", [input.partyId])).rows[0];
    if (party === undefined || party.state !== "open") {
      await client.query("ROLLBACK");
      return { ok: false, error: "party_closed" };
    }
    const existing = (await client.query("SELECT 1 FROM party_members m JOIN parties p ON p.id = m.party_id WHERE m.character_id = $1 AND p.state = 'open'", [input.characterId])).rows;
    if (existing.length > 0) {
      await client.query("ROLLBACK");
      return { ok: false, error: "already_in_party" };
    }
    await client.query("INSERT INTO party_members (party_id, character_id) VALUES ($1,$2)", [input.partyId, input.characterId]);
    await client.query("COMMIT");
    await publishParty(pool, input.partyId);
    return { ok: true };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // already closed
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Leadership passes to the longest-standing member; the last leaving closes the party. */
export async function leaveParty(pool: Pool, input: { partyId: string; characterId: string }): Promise<{ ok: boolean; newLeader?: string; closed?: boolean }> {
  const client = await pool.connect();
  let newLeaderName: string | null = null;
  let closed = false;
  try {
    await client.query("BEGIN");
    const party = (await client.query<PartyRow>("SELECT * FROM parties WHERE id = $1 FOR UPDATE", [input.partyId])).rows[0];
    if (party === undefined) {
      await client.query("ROLLBACK");
      return { ok: false };
    }
    const deleted = await client.query("DELETE FROM party_members WHERE party_id = $1 AND character_id = $2", [input.partyId, input.characterId]);
    if (deleted.rowCount === 0) {
      await client.query("ROLLBACK");
      return { ok: false };
    }
    const remaining = await client.query<{ character_id: string }>(
      "SELECT character_id FROM party_members WHERE party_id = $1 ORDER BY joined_at, character_id",
      [input.partyId]
    );
    if (remaining.rows.length === 0) {
      await client.query("UPDATE parties SET state = 'closed' WHERE id = $1", [input.partyId]);
      closed = true;
    } else if (party.leader_id === input.characterId) {
      const next = remaining.rows[0]!;
      await client.query("UPDATE parties SET leader_id = $2 WHERE id = $1", [input.partyId, next.character_id]);
      const name = (await client.query<{ name: string }>("SELECT name FROM characters WHERE id = $1", [next.character_id])).rows[0];
      newLeaderName = name?.name ?? "?";
    }
    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // already closed
    }
    throw err;
  } finally {
    client.release();
  }
  await publishParty(pool, input.partyId);
  return { ok: true, newLeader: newLeaderName ?? undefined, closed };
}

/** Starts a chapter run: only the leader, one run per party, played in the leader's world. */
export async function startChapterRun(pool: Pool, input: { partyId: string; chapterId: string }): Promise<{ ok: boolean; error?: "not_leader" | "run_in_progress" | "unknown_chapter"; runId?: string }> {
  if (Chapter.id !== input.chapterId) return { ok: false, error: "unknown_chapter" };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const party = (await client.query<PartyRow>("SELECT * FROM parties WHERE id = $1 FOR UPDATE", [input.partyId])).rows[0];
    if (party === undefined) {
      await client.query("ROLLBACK");
      return { ok: false, error: "unknown_chapter" };
    }
    const runId = newId();
    const existing = (await client.query("SELECT 1 FROM chapter_runs WHERE party_id = $1 AND state IN ('in_progress','paused')", [input.partyId])).rows;
    if (existing.length > 0) {
      await client.query("ROLLBACK");
      return { ok: false, error: "run_in_progress" };
    }
    await client.query(
      "INSERT INTO chapter_runs (id, server_id, party_id, chapter_id, world_id, state) VALUES ($1,$2,$3,$4,$5,'in_progress')",
      [runId, party.server_id, input.partyId, input.chapterId, party.world_id]
    );
    for (const cp of Chapter.checkpoints) {
      await client.query("INSERT INTO run_checkpoints (run_id, n, name, x, y) VALUES ($1,$2,$3,$4,$5)", [runId, cp.n, cp.name, cp.x, cp.y]);
    }
    await client.query("COMMIT");
    await publishParty(pool, input.partyId);
    return { ok: true, runId };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // already closed
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function chapterRunView(client: Queryer, runId: string): Promise<{
  id: string;
  party_id: string;
  chapter_id: string;
  world: string;
  state: "in_progress" | "paused" | "completed";
  checkpoints: { n: number; name: string; x: number; y: number; reached: boolean; stored: boolean }[];
  started_at: string;
} | null> {
  const run = (
    await client.query<{ id: string; party_id: string; chapter_id: string; world_id: string; state: "in_progress" | "paused" | "completed"; started_at: Date }>(
      "SELECT * FROM chapter_runs WHERE id = $1",
      [runId]
    )
  ).rows[0];
  if (run === undefined) return null;
  const world = (await client.query<{ slug: string }>("SELECT slug FROM worlds WHERE id = $1", [run.world_id])).rows[0];
  const checkpoints = (
    await client.query<{ n: number; name: string; x: number; y: number; reached: boolean; stored: boolean }>(
      "SELECT n, name, x, y, reached, stored FROM run_checkpoints WHERE run_id = $1 ORDER BY n",
      [runId]
    )
  ).rows;
  return {
    id: run.id,
    party_id: run.party_id,
    chapter_id: run.chapter_id,
    world: world?.slug ?? "",
    state: run.state,
    checkpoints,
    started_at: isoInstant(run.started_at),
  };
}

