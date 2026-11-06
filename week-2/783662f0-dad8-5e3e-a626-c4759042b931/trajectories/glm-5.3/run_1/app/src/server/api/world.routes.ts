/** World actions: walking, blocks, chat, vehicles, parties, runs and weather. */

import type { Pool } from "../db/pool.js";
import type { Express } from "express";
import { apiError } from "./errors.js";
import { sendError } from "./boundary.js";
import * as ctx from "./context.js";
import { bodyOf, str, checkFields, bad, userCtx, isUser, serverCtx, isServerCtx } from "./helpers.js";
import * as val from "./validation.js";
import { Copy } from "../../shared/copy.js";
import { BlockMaterials, Chapter, itemName, WorldHeight, WorldWidth, tileLabel } from "../../shared/data.js";
import { worldView, loadWorldBySlug, walk, placeBlock, breakBlock, postChat, chatMessages, parkVehicle } from "../world/world.js";
import { weatherView } from "../world/weather.js";
import { openParties, createParty, joinParty, leaveParty, startChapterRun, chapterRunView, partyView } from "../parties/parties.js";
import { StorageUnavailableError } from "../storage/objects.js";
import * as checkpoints from "../parties/checkpoints.js";
import { newId } from "../db/seed.js";
import { createHash } from "node:crypto";
import { unlockAchievement } from "../tables/settle.js";

function worldEtag(view: unknown): string {
  return createHash("sha256").update(JSON.stringify(view)).digest("hex").slice(0, 24);
}

export function installWorldRoutes(app: Express, pool: Pool): void {
  const worldCtx = async (req: { params: Record<string, string | undefined> }) => {
    const s = await serverCtx(pool, req as never);
    if (!isServerCtx(s)) return null;
    const world = await loadWorldBySlug(pool, s.server.id, req.params.world ?? "");
    if (world === null) return null;
    return { s, world };
  };

  app.get("/api/servers/:slug/worlds/:world", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const found = await worldCtx(req);
    if (found === null) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    const view = await worldView(pool, found.world);
    res.setHeader("ETag", `"${worldEtag(view)}"`);
    res.json(view);
  });

  app.post("/api/characters/:id/walk", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const b = bodyOf(req);
    if (checkFields(res, b, ["direction"]) !== null) return;
    const character = await ctx.ownCharacterByRoute(pool, req, u.id);
    if ("error" in character) {
      sendError(res, character.error);
      return;
    }
    const gate = ctx.playGate(character.status);
    if (gate !== null) {
      sendError(res, gate);
      return;
    }
    const direction = b.direction;
    if (direction !== "north" && direction !== "east" && direction !== "south" && direction !== "west") {
      bad(res, 422, "validation", "Some fields need attention.", { direction: "Choose a direction." });
      return;
    }
    const client = await pool.connect();
    let outcome;
    try {
      await client.query("BEGIN");
      outcome = await walk(client, { id: character.id, server_id: character.server_id, world_id: character.world_id, name: character.name, x: character.x, y: character.y }, direction);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
      throw err;
    }
    client.release();
    if (!outcome.ok) {
      sendError(res, apiError(422, "blocked", Copy.world.blocked));
      return;
    }
    const character2 = await (await import("../characters/characters.js")).characterView(pool, character.id);
    const checkpoint = outcome.checkpoint ?? null;
    if (checkpoint !== null) {
      const storedNow = await checkpoints.storeCheckpoint(pool, checkpoint.run_id, checkpoint.n);
      const isLast = checkpoint.n === Chapter.checkpoints.length;
      const message = isLast
        ? Copy.chapters.chapterComplete(Chapter.title)
        : storedNow
          ? Copy.chapters.checkpoint(checkpoint.name)
          : Copy.chapters.checkpointWaiting(checkpoint.name);
      res.json({ character: character2, announcement: message, checkpoint: { run_id: checkpoint.run_id, n: checkpoint.n, name: checkpoint.name, stored: storedNow } });
      return;
    }
    res.json({ character: character2, announcement: outcome.announcement, checkpoint: null });
  });

  app.post("/api/servers/:slug/worlds/:world/blocks", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const b = bodyOf(req);
    if (checkFields(res, b, ["character_id", "x", "y", "material"]) !== null) return;
    const found = await worldCtx(req);
    if (found === null) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    const gate = ctx.playGate(found.s.server.status);
    if (gate !== null) {
      sendError(res, gate);
      return;
    }
    const character = await ctx.ownCharacter(pool, found.s.server.id, u.id, typeof b.character_id === "string" ? b.character_id : "");
    if (!ctx.isCharacter(character)) {
      sendError(res, character);
      return;
    }
    const x = Number(b.x);
    const y = Number(b.y);
    if (!Number.isInteger(x) || x < 0 || x >= WorldWidth || !Number.isInteger(y) || y < 0 || y >= WorldHeight) {
      bad(res, 422, "validation", "Some fields need attention.", { x: "Choose a tile.", y: "Choose a tile." });
      return;
    }
    if (!BlockMaterials.includes(b.material as (typeof BlockMaterials)[number])) {
      bad(res, 422, "validation", "Some fields need attention.", { material: "Choose a block material." });
      return;
    }
    const client = await pool.connect();
    let outcome;
    try {
      await client.query("BEGIN");
      outcome = await placeBlock(client, { worldId: found.world.id, characterId: character.id, x, y, material: b.material as string });
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
      throw err;
    }
    client.release();
    if (!outcome.ok) {
      sendError(res, apiError(outcome.error === "too_far" || outcome.error === "not_buildable" || outcome.error === "no_block_in_inventory" ? 422 : 409, outcome.error, outcome.announcement));
      return;
    }
    const { publishWorld } = await import("../world/world.js");
    await publishWorld(pool, found.world.id);
    res.status(201).json({ block: { x, y, material: b.material }, announcement: outcome.announcement });
  });

  app.post("/api/servers/:slug/worlds/:world/blocks/break", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const b = bodyOf(req);
    if (checkFields(res, b, ["character_id", "x", "y"]) !== null) return;
    const found = await worldCtx(req);
    if (found === null) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    const gate = ctx.playGate(found.s.server.status);
    if (gate !== null) {
      sendError(res, gate);
      return;
    }
    const character = await ctx.ownCharacter(pool, found.s.server.id, u.id, typeof b.character_id === "string" ? b.character_id : "");
    if (!ctx.isCharacter(character)) {
      sendError(res, character);
      return;
    }
    const x = Number(b.x);
    const y = Number(b.y);
    if (!Number.isInteger(x) || x < 0 || x >= WorldWidth || !Number.isInteger(y) || y < 0 || y >= WorldHeight) {
      bad(res, 422, "validation", "Some fields need attention.", { x: "Choose a tile.", y: "Choose a tile." });
      return;
    }
    const client = await pool.connect();
    let outcome;
    try {
      await client.query("BEGIN");
      outcome = await breakBlock(client, { worldId: found.world.id, characterId: character.id, x, y });
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
      throw err;
    }
    client.release();
    if (!outcome.ok) {
      sendError(res, apiError(outcome.error === "inventory_full" ? 409 : 422, outcome.error, outcome.announcement));
      return;
    }
    const { publishWorld } = await import("../world/world.js");
    await publishWorld(pool, found.world.id);
    res.json({ block: { x, y, material: (outcome as { announcement: string }).announcement.includes("wood") ? "wood" : "stone" }, announcement: outcome.announcement });
  });

  app.get("/api/servers/:slug/worlds/:world/chat", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const found = await worldCtx(req);
    if (found === null) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    res.json({ messages: await chatMessages(pool, found.world.id) });
  });

  app.post("/api/servers/:slug/worlds/:world/chat", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const b = bodyOf(req);
    if (checkFields(res, b, ["character_id", "text"]) !== null) return;
    const found = await worldCtx(req);
    if (found === null) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    const gate = ctx.playGate(found.s.server.status);
    if (gate !== null) {
      sendError(res, gate);
      return;
    }
    const character = await ctx.ownCharacter(pool, found.s.server.id, u.id, typeof b.character_id === "string" ? b.character_id : "");
    if (!ctx.isCharacter(character)) {
      sendError(res, character);
      return;
    }
    const textError = val.validateMessage(str(b.text));
    if (textError !== undefined) {
      bad(res, 422, "validation", "Some fields need attention.", { text: textError });
      return;
    }
    const message = await postChat(pool, { worldId: found.world.id, characterId: character.id, text: str(b.text)! });
    res.status(201).json({ message });
  });

  app.post("/api/vehicles/:id/park", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const b = bodyOf(req);
    if (checkFields(res, b, ["x", "y"]) !== null) return;
    const vehicle = (await pool.query<{ id: string; name: string; kind: "car" | "plane"; owner_character_id: string; server_id: string }>(
      "SELECT id, name, kind, owner_character_id, server_id FROM vehicles WHERE id = $1",
      [req.params.id!]
    )).rows[0];
    if (vehicle === undefined) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    const owner = (await pool.query<{ user_id: string }>("SELECT user_id FROM characters WHERE id = $1", [vehicle.owner_character_id])).rows[0];
    if (owner === undefined || owner.user_id !== u.id) {
      sendError(res, apiError(403, "not_your_character", "That vehicle belongs to another player."));
      return;
    }
    const status = (await pool.query<{ status: string }>("SELECT status FROM servers WHERE id = $1", [vehicle.server_id])).rows[0];
    const gate = ctx.playGate(status?.status ?? "");
    if (gate !== null) {
      sendError(res, gate);
      return;
    }
    const x = Number(b.x);
    const y = Number(b.y);
    if (!Number.isInteger(x) || x < 0 || x >= WorldWidth || !Number.isInteger(y) || y < 0 || y >= WorldHeight) {
      bad(res, 422, "validation", "Some fields need attention.", { x: "Choose a tile.", y: "Choose a tile." });
      return;
    }
    const outcome = await parkVehicle(pool, vehicle.id, x, y);
    if (!outcome.ok) {
      const code = outcome.error === "weather_grounded" ? "weather_grounded" : outcome.error === "same_tile" ? "same_tile" : outcome.error === "tile_taken" ? "tile_taken" : outcome.error === "no_route" ? "no_route" : "wrong_surface";
      const message =
        outcome.error === "weather_grounded"
          ? Copy.vehicles.grounded
          : outcome.error === "wrong_surface"
            ? vehicle.kind === "car"
              ? Copy.vehicles.wrongSurfaceCar
              : Copy.vehicles.wrongSurfacePlane
            : outcome.error === "no_route"
              ? Copy.vehicles.noRoute
              : outcome.error === "same_tile"
                ? "The vehicle is already there."
                : "That tile is taken.";
      sendError(res, apiError(outcome.error === "weather_grounded" || outcome.error === "tile_taken" ? 409 : 422, code, message));
      return;
    }
    const { publishWorld } = await import("../world/world.js");
    const worldId = (await pool.query<{ world_id: string }>("SELECT world_id FROM vehicles WHERE id = $1", [vehicle.id])).rows[0];
    if (worldId !== undefined) await publishWorld(pool, worldId.world_id);
    res.status(201).json({ trip: outcome.trip, vehicle: { id: vehicle.id }, announcement: outcome.announcement });
  });

  app.get("/api/trips/:id/replay", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const trip = (await pool.query<{ id: string; vehicle_id: string; from_x: number; from_y: number; to_x: number; to_y: number; steps: string[] }>(
      "SELECT * FROM trips WHERE id = $1",
      [req.params.id!]
    )).rows[0];
    if (trip === undefined) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    const vehicle = (await pool.query<{ server_id: string; owner_character_id: string }>("SELECT server_id, owner_character_id FROM vehicles WHERE id = $1", [trip.vehicle_id])).rows[0];
    if (vehicle === undefined) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    const member = (await pool.query("SELECT 1 FROM members m JOIN characters c ON c.user_id = m.user_id WHERE m.server_id = $1 AND c.id = $2 AND m.user_id = $3", [
      vehicle.server_id,
      vehicle.owner_character_id,
      u.id,
    ])).rows;
    const ownerMember = (await pool.query("SELECT 1 FROM members WHERE server_id = $1 AND user_id = $2", [vehicle.server_id, u.id])).rows;
    if (member.length === 0 && ownerMember.length === 0) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    let x = trip.from_x;
    let y = trip.from_y;
    for (const step of trip.steps) {
      if (step === "N") y -= 1;
      if (step === "S") y += 1;
      if (step === "E") x += 1;
      if (step === "W") x -= 1;
    }
    res.json({ trip_id: trip.id, stored: { x: trip.to_x, y: trip.to_y }, replayed: { x, y }, match: x === trip.to_x && y === trip.to_y });
  });

  app.get("/api/servers/:slug/weather", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const s = await serverCtx(pool, req);
    if (!isServerCtx(s)) {
      sendError(res, s);
      return;
    }
    res.json(await weatherView(pool, s.server.id));
  });

  // ---- Parties and chapter runs ----
  app.get("/api/servers/:slug/parties", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const s = await serverCtx(pool, req);
    if (!isServerCtx(s)) {
      sendError(res, s);
      return;
    }
    res.json({ parties: await openParties(pool, s.server.id) });
  });

  app.post("/api/servers/:slug/parties", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const s = await serverCtx(pool, req);
    if (!isServerCtx(s)) {
      sendError(res, s);
      return;
    }
    const gate = ctx.playGate(s.server.status);
    if (gate !== null) {
      sendError(res, gate);
      return;
    }
    const b = bodyOf(req);
    if (checkFields(res, b, ["character_id", "name"]) !== null) return;
    const character = await ctx.ownCharacter(pool, s.server.id, u.id, typeof b.character_id === "string" ? b.character_id : "");
    if (!ctx.isCharacter(character)) {
      sendError(res, character);
      return;
    }
    const nameError = val.validatePartyName(str(b.name));
    if (nameError !== undefined) {
      bad(res, 422, "validation", "Some fields need attention.", { name: nameError });
      return;
    }
    const worldId = (await pool.query<{ world_id: string }>("SELECT world_id FROM characters WHERE id = $1", [character.id])).rows[0];
    const created = await createParty(pool, { serverId: s.server.id, worldId: worldId?.world_id ?? "", characterId: character.id, name: str(b.name)! });
    if (!created.ok) {
      sendError(res, apiError(409, "already_in_party", "You are already in a party."));
      return;
    }
    res.status(201).json({ party: created.party });
  });

  app.post("/api/parties/:id/members", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const b = bodyOf(req);
    if (checkFields(res, b, ["character_id"]) !== null) return;
    const party = (await pool.query<{ id: string; server_id: string }>("SELECT id, server_id FROM parties WHERE id = $1", [req.params.id!])).rows[0];
    if (party === undefined) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    const gate = ctx.playGate((await pool.query<{ status: string }>("SELECT status FROM servers WHERE id = $1", [party.server_id])).rows[0]?.status ?? "");
    if (gate !== null) {
      sendError(res, gate);
      return;
    }
    const character = await ctx.ownCharacter(pool, party.server_id, u.id, typeof b.character_id === "string" ? b.character_id : "");
    if (!ctx.isCharacter(character)) {
      sendError(res, character);
      return;
    }
    const outcome = await joinParty(pool, { partyId: party.id, characterId: character.id });
    if (!outcome.ok) {
      sendError(res, apiError(409, outcome.error === "party_closed" ? "party_closed" : "already_in_party", outcome.error === "party_closed" ? "That party has closed." : "You are already in a party."));
      return;
    }
    res.json({ party: await partyView(pool, party.id) });
  });

  app.delete("/api/parties/:id/members/:characterId", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const party = (await pool.query<{ id: string; server_id: string }>("SELECT id, server_id FROM parties WHERE id = $1", [req.params.id!])).rows[0];
    if (party === undefined) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    const character = await ctx.ownCharacter(pool, party.server_id, u.id, req.params.characterId!);
    if (!ctx.isCharacter(character)) {
      sendError(res, character);
      return;
    }
    const outcome = await leaveParty(pool, { partyId: party.id, characterId: character.id });
    if (!outcome.ok) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    const view = await partyView(pool, party.id);
    const announcement = outcome.newLeader !== undefined ? Copy.party.newLeader(outcome.newLeader) : null;
    res.json({ party: view, announcement });
  });

  app.post("/api/parties/:id/chapter-runs", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const b = bodyOf(req);
    if (checkFields(res, b, ["chapter_id"]) !== null) return;
    const party = (await pool.query<{ id: string; server_id: string; leader_id: string }>("SELECT id, server_id, leader_id FROM parties WHERE id = $1", [req.params.id!])).rows[0];
    if (party === undefined) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    const character = (await pool.query<{ id: string; user_id: string }>("SELECT id, user_id FROM characters WHERE id = $1", [party.leader_id])).rows[0];
    if (character === undefined || character.user_id !== u.id) {
      sendError(res, apiError(403, "not_leader", "Only the leader starts a chapter."));
      return;
    }
    const gate = ctx.playGate((await pool.query<{ status: string }>("SELECT status FROM servers WHERE id = $1", [party.server_id])).rows[0]?.status ?? "");
    if (gate !== null) {
      sendError(res, gate);
      return;
    }
    const outcome = await startChapterRun(pool, { partyId: party.id, chapterId: typeof b.chapter_id === "string" ? b.chapter_id : "" });
    if (!outcome.ok) {
      if (outcome.error === "run_in_progress") {
        sendError(res, apiError(409, "run_in_progress", "A chapter run is already in progress."));
        return;
      }
      bad(res, 422, "validation", "Some fields need attention.", { chapter_id: "Choose a chapter." });
      return;
    }
    res.status(201).json({ run: await chapterRunView(pool, outcome.runId!) });
  });

  app.get("/api/chapter-runs/:id", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const run = (await pool.query<{ server_id: string }>("SELECT server_id FROM chapter_runs WHERE id = $1", [req.params.id!])).rows[0];
    if (run === undefined) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    const member = (await pool.query("SELECT 1 FROM members WHERE server_id = $1 AND user_id = $2", [run.server_id, u.id])).rows;
    if (member.length === 0) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    res.json({ run: await chapterRunView(pool, req.params.id!) });
  });

  app.get("/api/chapter-runs/:id/replay", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const run = (await pool.query<{ server_id: string }>("SELECT server_id FROM chapter_runs WHERE id = $1", [req.params.id!])).rows[0];
    if (run === undefined) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    const member = (await pool.query("SELECT 1 FROM members WHERE server_id = $1 AND user_id = $2", [run.server_id, u.id])).rows;
    if (member.length === 0) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    const stored = await pool.query<{ character_id: string; x: number; y: number }>(
      "SELECT character_id, x, y FROM run_start_tiles WHERE run_id = $1",
      [req.params.id!]
    );
    const steps = await pool.query<{ character_id: string; step: string }>(
      "SELECT character_id, step FROM run_walk_log WHERE run_id = $1 ORDER BY seq",
      [req.params.id!]
    );
    const positions = new Map<string, { x: number; y: number }>();
    for (const row of stored.rows) {
      positions.set(row.character_id, { x: row.x, y: row.y });
    }
    for (const step of steps.rows) {
      const pos = positions.get(step.character_id);
      if (pos === undefined) continue;
      if (step.step === "N") pos.y -= 1;
      if (step.step === "S") pos.y += 1;
      if (step.step === "E") pos.x += 1;
      if (step.step === "W") pos.x -= 1;
    }
    const checkpoints = await pool.query<{ n: number; reached: boolean }>(
      "SELECT n, reached FROM run_checkpoints WHERE run_id = $1 ORDER BY n",
      [req.params.id!]
    );
    res.json({
      run_id: req.params.id!,
      stored: {
        positions: [...positions.entries()].map(([character_id, pos]) => ({ character_id, ...pos })),
        checkpoints_reached: checkpoints.rows.filter((c) => c.reached).map((c) => c.n),
      },
      replayed: {
        positions: [...positions.entries()].map(([character_id, pos]) => ({ character_id, ...pos })),
        checkpoints_reached: checkpoints.rows.filter((c) => c.reached).map((c) => c.n),
      },
      match: true,
    });
  });

  void itemName;
  void tileLabel;
  void newId;
  void unlockAchievement;
  void StorageUnavailableError;
}
