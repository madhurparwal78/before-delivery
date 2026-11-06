/** The world: tiles, walking, blocks, chat, vehicles, trips and parking. */

import type { Pool, Client } from "../db/pool.js";
import { newId } from "../db/seed.js";
import { Copy } from "../../shared/copy.js";
import { WorldHeight, WorldWidth, itemName, tileLabel } from "../../shared/data.js";
import { publish } from "../api/events.js";
import { unlockAchievement } from "../tables/settle.js";
import { isoInstant } from "../time.js";

export interface WorldRow {
  id: string;
  server_id: string;
  slug: string;
  name: string;
  tiles: string;
}

export interface CharacterRow {
  id: string;
  server_id: string;
  world_id: string;
  name: string;
  x: number;
  y: number;
}

export async function loadWorldBySlug(pool: Pool, serverId: string, slug: string): Promise<WorldRow | null> {
  const res = await pool.query<WorldRow>("SELECT * FROM worlds WHERE server_id = $1 AND slug = $2", [serverId, slug]);
  return res.rows[0] ?? null;
}

export async function tileAt(world: WorldRow, x: number, y: number): Promise<string> {
  const rows = world.tiles.split("\n");
  if (y < 0 || y >= rows.length) return "~";
  const row = rows[y]!;
  if (x < 0 || x >= row.length) return "~";
  return row[x]!;
}

/** Builds the World object. */
export async function worldView(pool: Pool, world: WorldRow): Promise<{
  slug: string;
  name: string;
  width: number;
  height: number;
  tiles: string[];
  tables: { id: string; name: string; game: "chess" | "four" | "tricks"; x: number; y: number; state: string }[];
  blocks: { x: number; y: number; material: string }[];
  vehicles: { id: string; name: string; kind: "car" | "plane"; owner_character_id: string; x: number; y: number }[];
  characters: { id: string; name: string; x: number; y: number }[];
}> {
  const tables = await pool.query<{ id: string; name: string; game: "chess" | "four" | "tricks"; x: number; y: number; state: string }>(
    "SELECT id, name, game, x, y, state FROM tables_ WHERE world_id = $1 ORDER BY name",
    [world.id]
  );
  const blocks = await pool.query<{ x: number; y: number; material: string }>(
    "SELECT x, y, material FROM blocks WHERE world_id = $1 ORDER BY y, x",
    [world.id]
  );
  const vehicles = await pool.query<{ id: string; name: string; kind: "car" | "plane"; owner_character_id: string; x: number; y: number }>(
    "SELECT id, name, kind, owner_character_id, x, y FROM vehicles WHERE world_id = $1 ORDER BY id",
    [world.id]
  );
  const characters = await pool.query<{ id: string; name: string; x: number; y: number }>(
    "SELECT id, name, x, y FROM characters WHERE world_id = $1 ORDER BY name",
    [world.id]
  );
  return {
    slug: world.slug,
    name: world.name,
    width: WorldWidth,
    height: WorldHeight,
    tiles: world.tiles.split("\n"),
    tables: tables.rows,
    blocks: blocks.rows,
    vehicles: vehicles.rows,
    characters: characters.rows.map((c) => ({ id: c.id, name: c.name, x: c.x, y: c.y })),
  };
}

export async function publishWorld(pool: Pool, worldId: string): Promise<void> {
  const world = (await pool.query<WorldRow>("SELECT * FROM worlds WHERE id = $1", [worldId])).rows[0];
  if (world === undefined) return;
  const view = await worldView(pool, world);
  await publish(pool, world.server_id, [{ kind: "world", payload: view, audience: { world: world.slug } }]);
}

export type WalkError = "blocked";

export interface WalkOutcome {
  ok: boolean;
  announcement: string;
  checkpoint?: { run_id: string; n: number; name: string; stored: boolean } | null;
  error?: WalkError;
}

/** Walks one tile onto passable tiles only. Announces, and handles chapter checkpoints. */
export async function walk(client: Client, character: CharacterRow, direction: "north" | "east" | "south" | "west"): Promise<WalkOutcome> {
  const dx = direction === "east" ? 1 : direction === "west" ? -1 : 0;
  const dy = direction === "south" ? 1 : direction === "north" ? -1 : 0;
  const nx = character.x + dx;
  const ny = character.y + dy;
  const world = (await client.query<WorldRow>("SELECT * FROM worlds WHERE id = $1", [character.world_id])).rows[0];
  if (world === undefined) return { ok: false, announcement: Copy.world.blocked, error: "blocked" };
  const rows = world.tiles.split("\n");
  if (ny < 0 || ny >= rows.length || nx < 0 || nx >= (rows[ny]?.length ?? 0)) {
    return { ok: false, announcement: Copy.world.blocked, error: "blocked" };
  }
  const code = rows[ny]![nx]!;
  if (code === "~" || code === "T") {
    return { ok: false, announcement: Copy.world.blocked, error: "blocked" };
  }
  const block = (await client.query("SELECT 1 FROM blocks WHERE world_id = $1 AND x = $2 AND y = $3", [world.id, nx, ny])).rows;
  if (block.length > 0) return { ok: false, announcement: Copy.world.blocked, error: "blocked" };
  const vehicle = (await client.query("SELECT 1 FROM vehicles WHERE world_id = $1 AND x = $2 AND y = $3", [world.id, nx, ny])).rows;
  if (vehicle.length > 0) return { ok: false, announcement: Copy.world.blocked, error: "blocked" };
  await client.query("UPDATE characters SET x = $2, y = $3 WHERE id = $1", [character.id, nx, ny]);
  const announcement = Copy.world.walked(nx, ny);
  const checkpoint = await recordRunStep(client, character, world.id, direction, nx, ny);
  return { ok: true, announcement, checkpoint };
}

/** Appends the walk to the run's log and checks the next checkpoint. */
async function recordRunStep(
  client: Client,
  character: CharacterRow,
  worldId: string,
  direction: "north" | "east" | "south" | "west",
  nx: number,
  ny: number
): Promise<{ run_id: string; n: number; name: string; stored: boolean } | null> {
  const membership = (
    await client.query<{ run_id: string }>(
      `SELECT r.id AS run_id FROM parties p
       JOIN party_members m ON m.party_id = p.id
       JOIN chapter_runs r ON r.party_id = p.id AND r.state IN ('in_progress','paused')
       WHERE m.character_id = $1 AND p.world_id = $2`,
      [character.id, worldId]
    )
  ).rows[0];
  if (membership === undefined) return null;
  const runId = membership.run_id;
  const seq = (await client.query<{ n: string }>("SELECT count(*)::text AS n FROM run_walk_log WHERE run_id = $1", [runId])).rows[0];
  await client.query("INSERT INTO run_walk_log (run_id, seq, character_id, step) VALUES ($1,$2,$3,$4)", [
    runId,
    Number(seq?.n ?? 0),
    character.id,
    direction[0]!.toUpperCase(),
  ]);
  // The starting tiles for members who have none yet.
  const started = (await client.query("SELECT 1 FROM run_start_tiles WHERE run_id = $1 AND character_id = $2", [runId, character.id])).rows;
  if (started.length === 0) {
    await client.query("INSERT INTO run_start_tiles (run_id, character_id, x, y) VALUES ($1,$2,$3,$4)", [
      runId,
      character.id,
      character.x,
      character.y,
    ]);
  }
  const next = (
    await client.query<{ n: number; name: string; x: number; y: number; reached: boolean }>(
      "SELECT n, name, x, y, reached FROM run_checkpoints WHERE run_id = $1 AND NOT reached ORDER BY n LIMIT 1",
      [runId]
    )
  ).rows[0];
  if (next === undefined) return null;
  if (next.x !== nx || next.y !== ny) return null;
  await client.query("UPDATE run_checkpoints SET reached = true, reached_at = now() WHERE run_id = $1 AND n = $2", [runId, next.n]);
  const isLast = (
    await client.query<{ n: string }>("SELECT count(*)::text AS n FROM run_checkpoints WHERE run_id = $1 AND NOT reached", [runId])
  ).rows[0];
  if (Number(isLast?.n ?? 0) === 0) {
    await client.query("UPDATE chapter_runs SET state = 'completed' WHERE id = $1", [runId]);
  }
  return { run_id: runId, n: next.n, name: next.name, stored: false };
}

export type PlaceError = "too_far" | "not_buildable" | "tile_taken" | "no_block_in_inventory";

export async function placeBlock(
  client: Client,
  input: { worldId: string; characterId: string; x: number; y: number; material: string }
): Promise<{ ok: true; announcement: string } | { ok: false; error: PlaceError; announcement: string }> {
  const character = (await client.query<CharacterRow>("SELECT * FROM characters WHERE id = $1", [input.characterId])).rows[0];
  if (character === undefined) return { ok: false, error: "too_far", announcement: Copy.world.tooFar };
  const world = (await client.query<WorldRow>("SELECT * FROM worlds WHERE id = $1", [input.worldId])).rows[0];
  if (world === undefined) return { ok: false, error: "too_far", announcement: Copy.world.tooFar };
  if (Math.abs(character.x - input.x) > 1 || Math.abs(character.y - input.y) > 1) {
    return { ok: false, error: "too_far", announcement: Copy.world.tooFar };
  }
  const code = world.tiles.split("\n")[input.y]?.[input.x] ?? "~";
  if (code !== "." && code !== "s") {
    return { ok: false, error: "not_buildable", announcement: Copy.world.notBuildable };
  }
  const occupied =
    (await client.query("SELECT 1 FROM blocks WHERE world_id = $1 AND x = $2 AND y = $3", [world.id, input.x, input.y])).rows.length > 0 ||
    (await client.query("SELECT 1 FROM vehicles WHERE world_id = $1 AND x = $2 AND y = $3", [world.id, input.x, input.y])).rows.length > 0 ||
    (await client.query("SELECT 1 FROM characters WHERE world_id = $1 AND x = $2 AND y = $3", [world.id, input.x, input.y])).rows.length > 0;
  if (occupied) return { ok: false, error: "tile_taken", announcement: Copy.world.tileTaken };
  const slot = (
    await client.query<{ slot: number }>(
      "SELECT slot FROM inventory_slots WHERE character_id = $1 AND kind = $2 AND count > held ORDER BY slot LIMIT 1",
      [input.characterId, input.material]
    )
  ).rows[0];
  if (slot === undefined) {
    return { ok: false, error: "no_block_in_inventory", announcement: Copy.world.noBlockInInventory(input.material) };
  }
  await client.query("UPDATE inventory_slots SET count = count - 1 WHERE character_id = $1 AND slot = $2", [input.characterId, slot.slot]);
  await client.query("INSERT INTO blocks (server_id, world_id, x, y, material) VALUES ($1,$2,$3,$4,$5)", [
    character.server_id,
    world.id,
    input.x,
    input.y,
    input.material,
  ]);
  await unlockAchievement(client, character.server_id, input.characterId, "First Stone");
  return { ok: true, announcement: Copy.world.placed(input.material, input.x, input.y) };
}

export async function breakBlock(
  client: Client,
  input: { worldId: string; characterId: string; x: number; y: number }
): Promise<{ ok: true; announcement: string } | { ok: false; error: string; announcement: string }> {
  const character = (await client.query<CharacterRow>("SELECT * FROM characters WHERE id = $1", [input.characterId])).rows[0];
  if (character === undefined) return { ok: false, error: "too_far", announcement: Copy.world.tooFar };
  const world = (await client.query<WorldRow>("SELECT * FROM worlds WHERE id = $1", [input.worldId])).rows[0];
  if (world === undefined) return { ok: false, error: "too_far", announcement: Copy.world.tooFar };
  if (Math.abs(character.x - input.x) > 1 || Math.abs(character.y - input.y) > 1) {
    return { ok: false, error: "too_far", announcement: Copy.world.tooFar };
  }
  const block = (await client.query<{ material: string }>("SELECT material FROM blocks WHERE world_id = $1 AND x = $2 AND y = $3", [world.id, input.x, input.y])).rows[0];
  if (block === undefined) {
    return { ok: false, error: "no_block", announcement: Copy.world.noBlock };
  }
  const target = (
    await client.query<{ slot: number; count: number }>(
      "SELECT slot, count FROM inventory_slots WHERE character_id = $1 AND kind = $2 AND count < 64 ORDER BY slot LIMIT 1",
      [input.characterId, block.material]
    )
  ).rows[0];
  let targetSlot = target?.slot;
  if (targetSlot === undefined) {
    const empty = (await client.query<{ slot: number }>("SELECT slot FROM inventory_slots WHERE character_id = $1 AND kind IS NULL ORDER BY slot LIMIT 1", [input.characterId])).rows[0];
    if (empty === undefined) {
      return { ok: false, error: "inventory_full", announcement: Copy.world.inventoryFull };
    }
    targetSlot = empty.slot;
    await client.query("UPDATE inventory_slots SET kind = $3, count = 1 WHERE character_id = $1 AND slot = $2", [input.characterId, targetSlot, block.material]);
  } else {
    await client.query("UPDATE inventory_slots SET count = count + 1 WHERE character_id = $1 AND slot = $2", [input.characterId, targetSlot]);
  }
  await client.query("DELETE FROM blocks WHERE world_id = $1 AND x = $2 AND y = $3", [world.id, input.x, input.y]);
  await client.query(
    `INSERT INTO blocks_broken_total (character_id, broken) VALUES ($1, 1)
     ON CONFLICT (character_id) DO UPDATE SET broken = blocks_broken_total.broken + 1`,
    [input.characterId]
  );
  const total = (await client.query<{ broken: number }>("SELECT broken FROM blocks_broken_total WHERE character_id = $1", [input.characterId])).rows[0];
  if (total !== undefined && total.broken >= 10) {
    await unlockAchievement(client, character.server_id, input.characterId, "Groundbreaker");
  }
  return { ok: true, announcement: Copy.world.broken(block.material, input.x, input.y) };
}

export interface ChatInput {
  worldId: string;
  characterId: string;
  text: string;
}

export async function postChat(pool: Pool, input: ChatInput): Promise<{ id: string; character: { id: string; name: string }; text: string; created_at: string }> {
  const id = newId();
  const world = (await pool.query<WorldRow>("SELECT * FROM worlds WHERE id = $1", [input.worldId])).rows[0];
  const character = (await pool.query<{ id: string; name: string }>("SELECT id, name FROM characters WHERE id = $1", [input.characterId])).rows[0];
  if (world === undefined || character === undefined) throw new Error("Chat target missing");
  const trimmed = input.text.trim();
  await pool.query("INSERT INTO chat_messages (id, server_id, world_id, character_id, text) VALUES ($1,$2,$3,$4,$5)", [
    id,
    world.server_id,
    world.id,
    input.characterId,
    trimmed,
  ]);
  const message = { id, character: { id: character.id, name: character.name }, text: trimmed, created_at: isoInstant(new Date()) };
  await publish(pool, world.server_id, [{ kind: "chat", payload: message, audience: { world: world.slug } }]);
  return message;
}

export async function chatMessages(pool: Pool, worldId: string): Promise<{ id: string; character: { id: string; name: string }; text: string; created_at: string }[]> {
  const rows = await pool.query<{ id: string; character_id: string; text: string; created_at: Date; name: string }>(
    `SELECT m.id, m.character_id, m.text, m.created_at, c.name
     FROM chat_messages m JOIN characters c ON c.id = m.character_id
     WHERE m.world_id = $1 ORDER BY m.created_at DESC LIMIT 50`,
    [worldId]
  );
  return rows.rows.reverse().map((r) => ({
    id: r.id,
    character: { id: r.character_id, name: r.name },
    text: r.text,
    created_at: isoInstant(r.created_at),
  }));
}

export type ParkError = "wrong_surface" | "no_route" | "tile_taken" | "same_tile" | "weather_grounded" | "not_your_character";

export interface ParkOutcome {
  ok: boolean;
  announcement?: string;
  trip?: { id: string; vehicle_id: string; from: { x: number; y: number }; to: { x: number; y: number }; steps: string[] };
  error?: ParkError;
}

/** Parks a car along roads or a plane along x then y, storing the trip. */
export async function parkVehicle(pool: Pool, vehicleId: string, x: number, y: number): Promise<ParkOutcome> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const vehicle = (await client.query<{ id: string; server_id: string; world_id: string; name: string; kind: "car" | "plane"; owner_character_id: string; x: number; y: number }>(
      "SELECT * FROM vehicles WHERE id = $1 FOR UPDATE",
      [vehicleId]
    )).rows[0];
    if (vehicle === undefined) {
      await client.query("ROLLBACK");
      return { ok: false, error: "not_your_character" };
    }
    if (vehicle.x === x && vehicle.y === y) {
      await client.query("ROLLBACK");
      return { ok: false, error: "same_tile" };
    }
    const world = (await client.query<WorldRow>("SELECT * FROM worlds WHERE id = $1", [vehicle.world_id])).rows[0];
    if (world === undefined) {
      await client.query("ROLLBACK");
      return { ok: false, error: "wrong_surface" };
    }
    const rows = world.tiles.split("\n");
    const code = rows[y]?.[x] ?? "~";
    const occupied = (await client.query("SELECT 1 FROM vehicles WHERE world_id = $1 AND x = $2 AND y = $3 AND id <> $4", [world.id, x, y, vehicle.id])).rows;
    if (occupied.length > 0) {
      await client.query("ROLLBACK");
      return { ok: false, error: "tile_taken" };
    }
    if (vehicle.kind === "car") {
      if (code !== "=") {
        await client.query("ROLLBACK");
        return { ok: false, error: "wrong_surface" };
      }
      const steps = roadPath(rows, vehicle.x, vehicle.y, x, y);
      if (steps === null) {
        await client.query("ROLLBACK");
        return { ok: false, error: "no_route" };
      }
      if (steps.length >= 10) {
        await unlockAchievement(client, vehicle.server_id, vehicle.owner_character_id, "Long Haul");
      }
      const tripId = await finishPark(client, vehicle, x, y, steps);
      await client.query("COMMIT");
      return { ok: true, announcement: Copy.vehicles.parked(vehicle.name, "road", x, y), trip: { id: tripId, vehicle_id: vehicle.id, from: { x: vehicle.x, y: vehicle.y }, to: { x, y }, steps } };
    }
    // A plane.
    if (code !== "#") {
      await client.query("ROLLBACK");
      return { ok: false, error: "wrong_surface" };
    }
    const weather = await weatherNow(client, vehicle.server_id);
    if (weather === "storm") {
      await client.query("ROLLBACK");
      return { ok: false, error: "weather_grounded" };
    }
    const steps: string[] = [];
    let cx = vehicle.x;
    const cy = vehicle.y;
    if (cx < x) {
      while (cx < x) {
        steps.push("E");
        cx += 1;
      }
    } else {
      while (cx > x) {
        steps.push("W");
        cx -= 1;
      }
    }
    let ty = cy;
    if (ty < y) {
      while (ty < y) {
        steps.push("S");
        ty += 1;
      }
    } else {
      while (ty > y) {
        steps.push("N");
        ty -= 1;
      }
    }
    const tripId = await finishPark(client, vehicle, x, y, steps);
    await client.query("COMMIT");
    await unlockAchievement(client, vehicle.server_id, vehicle.owner_character_id, "Smooth Landing");
    return { ok: true, announcement: Copy.vehicles.parked(vehicle.name, "runway", x, y), trip: { id: tripId, vehicle_id: vehicle.id, from: { x: vehicle.x, y: cy }, to: { x, y }, steps } };
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

/** Stores the trip and moves the vehicle. Returns the trip id. */
async function finishPark(
  client: Client,
  vehicle: { id: string; x: number; y: number; name: string },
  x: number,
  y: number,
  steps: string[]
): Promise<string> {
  const tripId = newId();
  await client.query(
    "INSERT INTO trips (id, vehicle_id, from_x, from_y, to_x, to_y, steps) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [tripId, vehicle.id, vehicle.x, vehicle.y, x, y, steps]
  );
  await client.query("UPDATE vehicles SET x = $2, y = $3 WHERE id = $1", [vehicle.id, x, y]);
  return tripId;
}

/** One shortest road path as steps, or null. */
export function roadPath(rows: string[], fromX: number, fromY: number, toX: number, toY: number): string[] | null {
  const key = (x: number, y: number): number => y * WorldWidth + x;
  const queue: { x: number; y: number; steps: string[] }[] = [{ x: fromX, y: fromY, steps: [] }];
  const seen = new Set<number>([key(fromX, fromY)]);
  const dirs: [number, number, string][] = [
    [0, -1, "N"],
    [1, 0, "E"],
    [0, 1, "S"],
    [-1, 0, "W"],
  ];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node.x === toX && node.y === toY) return node.steps;
    for (const [dx, dy, step] of dirs) {
      const nx = node.x + dx;
      const ny = node.y + dy;
      if (nx < 0 || nx >= WorldWidth || ny < 0 || ny >= WorldHeight) continue;
      if (seen.has(key(nx, ny))) continue;
      const code = rows[ny]?.[nx] ?? "~";
      if (code !== "=") continue;
      seen.add(key(nx, ny));
      queue.push({ x: nx, y: ny, steps: [...node.steps, step] });
    }
  }
  return null;
}

export async function weatherNow(client: Client | Pool, serverId: string): Promise<"clear" | "rain" | "storm"> {
  const { weatherAt } = await import("./weather.js");
  const server = (await client.query<{ weather_seed: number }>("SELECT weather_seed FROM servers WHERE id = $1", [serverId])).rows[0];
  return weatherAt(server?.weather_seed ?? 0, Date.now() / 1000);
}

export function tileName(code: string, tableName?: string): string {
  if (code === "T") return tableName ?? "Table";
  return tileLabel(code);
}

export function blockLabel(material: string): string {
  return `${material} block`;
}

export function itemDisplayName(kind: string): string {
  return itemName(kind);
}
