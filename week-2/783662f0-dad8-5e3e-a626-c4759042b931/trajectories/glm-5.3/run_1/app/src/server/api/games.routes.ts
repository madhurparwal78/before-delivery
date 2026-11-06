/** Characters, inventory, crafting, wallet, achievements, tables, moves, games and leaderboards. */

import type { Pool } from "../db/pool.js";
import type { Express } from "express";
import { apiError } from "./errors.js";
import { sendError } from "./boundary.js";
import * as ctx from "./context.js";
import { bodyOf, str, checkFields, bad, userCtx, isUser, serverCtx, isServerCtx } from "./helpers.js";
import * as val from "./validation.js";
import { Copy } from "../../shared/copy.js";
import { Appearances, LoadoutItems, MaxCharactersPerUser, Recipes, itemName, SeatLabels } from "../../shared/data.js";
import { createCharacter, characterView, setAppearance, inventoryView, moveSlot, craft, walletView } from "../characters/characters.js";
import { balanceOf } from "../coins/ledger.js";
import { takeSeat, watchTable, unwatchTable, standUp, startGame, playMove, forfeitGame, offerRematch, chessFenHistory } from "../tables/engine.js";
import { loadTable, tableView } from "../tables/serialize.js";
import * as chess from "../games/chess.js";
import * as four from "../games/four.js";
import { leaderboardEntries } from "../tables/leaderboards.js";
import * as records from "../games/game-records.js";
import { isoInstant } from "../time.js";
import { DbError } from "./db-error.js";
import { newRecordId } from "./context.js";

export function installGameRoutes(app: Express, pool: Pool): void {
  // ---- Characters ----
  app.get("/api/servers/:slug/characters", async (req, res) => {
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
    const prefix = typeof req.query.q === "string" ? req.query.q : "";
    const mine = req.query.mine !== "false";
    const rows = await pool.query<{ id: string }>(
      `SELECT id FROM characters WHERE server_id = $1 AND name ILIKE $2 ${mine ? "AND user_id = $3" : ""} ORDER BY name LIMIT 10`,
      mine ? [s.server.id, `${prefix}%`, u.id] : [s.server.id, `${prefix}%`]
    );
    const total = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM characters WHERE server_id = $1 AND name ILIKE $2 ${mine ? "AND user_id = $3" : ""}`,
      mine ? [s.server.id, `${prefix}%`, u.id] : [s.server.id, `${prefix}%`]
    );
    const characters = [];
    for (const row of rows.rows) {
      const view = await characterView(pool, row.id);
      if (view !== null) characters.push(view);
    }
    res.json({ characters, total: Number(total.rows[0]?.n ?? 0) });
  });

  app.post("/api/servers/:slug/characters", async (req, res) => {
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
    if (checkFields(res, b, ["name", "appearance", "loadout"]) !== null) return;
    const fields: Record<string, string> = {};
    const nameError = val.validateCharacterName(str(b.name));
    if (nameError !== undefined) fields.name = nameError;
    if (typeof b.appearance !== "string" || !Appearances.includes(b.appearance as (typeof Appearances)[number])) {
      fields.appearance = "Choose an appearance.";
    }
    if (!Array.isArray(b.loadout)) {
      fields.loadout = "Choose at most 3 items.";
    } else {
      const unique = new Set(b.loadout as string[]);
      if (unique.size > 3) fields.loadout = "Choose at most 3 items.";
      for (const item of b.loadout as string[]) {
        if (!LoadoutItems.includes(item as (typeof LoadoutItems)[number])) fields.loadout = "Choose at most 3 items.";
      }
    }
    if (Object.keys(fields).length > 0) {
      bad(res, 422, "validation", "Some fields need attention.", fields);
      return;
    }
    const world = (await pool.query<{ id: string }>("SELECT id FROM worlds WHERE server_id = $1 ORDER BY slug LIMIT 1", [s.server.id])).rows[0];
    if (world === undefined) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    const created = await createCharacter(pool, {
      serverId: s.server.id,
      userId: u.id,
      worldId: world.id,
      name: str(b.name)!,
      appearance: b.appearance as string,
      loadout: b.loadout as string[],
    });
    if (!created.ok) {
      if (created.error === "name_taken") {
        bad(res, 422, "validation", "Some fields need attention.", { name: "That character name is taken on this server." });
        return;
      }
      if (created.error === "roster_full") {
        sendError(res, apiError(409, "roster_full", Copy.roster.rosterFull));
        return;
      }
      const plan = (await pool.query<{ plan: "hamlet" | "borough" }>("SELECT plan FROM servers WHERE id = $1", [s.server.id])).rows[0];
      sendError(res, apiError(409, "character_limit", Copy.roster.characterLimit(plan === undefined ? 12 : (plan.plan === "borough" ? 40 : 12))));
      return;
    }
    const view = await characterView(pool, created.characterId);
    res.status(201).json({ character: view });
  });

  app.get("/api/characters/:id", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const row = (await pool.query<{ id: string; server_id: string; user_id: string }>("SELECT id, server_id, user_id FROM characters WHERE id = $1", [req.params.id!])).rows[0];
    if (row === undefined) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    const member = (await pool.query("SELECT 1 FROM members WHERE server_id = $1 AND user_id = $2", [row.server_id, u.id])).rows;
    if (member.length === 0) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    const view = await characterView(pool, row.id);
    res.setHeader("ETag", `"${row.id}:${view?.appearance ?? ""}:${view?.x ?? 0}:${view?.y ?? 0}"`);
    res.json(view);
  });

  app.patch("/api/characters/:id", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const row = (await pool.query<{ id: string; server_id: string; user_id: string }>("SELECT id, server_id, user_id FROM characters WHERE id = $1", [req.params.id!])).rows[0];
    if (row === undefined) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    const member = (await pool.query("SELECT 1 FROM members WHERE server_id = $1 AND user_id = $2", [row.server_id, u.id])).rows;
    if (member.length === 0) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    if (row.user_id !== u.id) {
      sendError(res, apiError(403, "not_your_character", "That character belongs to another player."));
      return;
    }
    const b = bodyOf(req);
    if (checkFields(res, b, ["appearance"]) !== null) return;
    const etag = `"${row.id}:${(await pool.query<{ appearance: string }>("SELECT appearance FROM characters WHERE id = $1", [row.id])).rows[0]?.appearance ?? ""}"`;
    const precondition = ctx.checkIfMatch(req, etag);
    if (precondition !== null) {
      sendError(res, precondition);
      return;
    }
    if (typeof b.appearance !== "string" || !Appearances.includes(b.appearance as (typeof Appearances)[number])) {
      bad(res, 422, "validation", "Some fields need attention.", { appearance: "Choose an appearance." });
      return;
    }
    await setAppearance(pool, row.id, b.appearance);
    const view = await characterView(pool, row.id);
    res.setHeader("ETag", `"${row.id}:${b.appearance}"`);
    res.json(view);
  });

  app.get("/api/characters/:id/wallet", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const row = (await pool.query<{ id: string; server_id: string; user_id: string }>("SELECT id, server_id, user_id FROM characters WHERE id = $1", [req.params.id!])).rows[0];
    if (row === undefined) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    const server = (await pool.query<{ owner_id: string }>("SELECT owner_id FROM servers WHERE id = $1", [row.server_id])).rows[0];
    if (row.user_id !== u.id && server?.owner_id !== u.id) {
      sendError(res, apiError(403, "not_your_character", "That character belongs to another player."));
      return;
    }
    res.json(await walletView(pool, row.id));
  });

  app.get("/api/characters/:id/inventory", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const row = (await pool.query<{ id: string; user_id: string }>("SELECT id, user_id FROM characters WHERE id = $1", [req.params.id!])).rows[0];
    if (row === undefined || row.user_id !== u.id) {
      sendError(res, apiError(row === undefined ? 404 : 403, row === undefined ? "not_found" : "forbidden", "Not allowed."));
      return;
    }
    res.json(await inventoryView(pool, row.id));
  });

  app.post("/api/characters/:id/inventory/moves", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const row = (await pool.query<{ id: string; user_id: string; server_id: string }>("SELECT id, user_id, server_id FROM characters WHERE id = $1", [req.params.id!])).rows[0];
    if (row === undefined || row.user_id !== u.id) {
      sendError(res, apiError(row === undefined ? 404 : 403, row === undefined ? "not_found" : "forbidden", "Not allowed."));
      return;
    }
    const b = bodyOf(req);
    if (checkFields(res, b, ["from", "to"]) !== null) return;
    const from = Number(b.from);
    const to = Number(b.to);
    if (!Number.isInteger(from) || from < 1 || from > 24 || !Number.isInteger(to) || to < 1 || to > 24) {
      bad(res, 422, "validation", "Some fields need attention.", { from: "Choose a slot.", to: "Choose a slot." });
      return;
    }
    const moved = await moveSlot(pool, row.id, from, to);
    if (!moved.ok) {
      sendError(res, apiError(409, moved.error, moved.error === "slot_held" ? "That stack is offered in a trade." : "That slot is empty."));
      return;
    }
    res.json(await inventoryView(pool, row.id));
  });

  app.post("/api/characters/:id/crafts", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const row = (await pool.query<{ id: string; user_id: string; server_id: string }>("SELECT id, user_id, server_id FROM characters WHERE id = $1", [req.params.id!])).rows[0];
    if (row === undefined || row.user_id !== u.id) {
      sendError(res, apiError(row === undefined ? 404 : 403, row === undefined ? "not_found" : "forbidden", "Not allowed."));
      return;
    }
    const gate = ctx.playGate((await pool.query<{ status: string }>("SELECT status FROM servers WHERE id = $1", [row.server_id])).rows[0]?.status ?? "");
    if (gate !== null) {
      sendError(res, gate);
      return;
    }
    const b = bodyOf(req);
    if (checkFields(res, b, ["recipe"]) !== null) return;
    const crafted = await craft(pool, row.id, typeof b.recipe === "string" ? b.recipe : "");
    if (!crafted.ok) {
      if (crafted.error === "missing_ingredients") {
        const recipe = Recipes.find((r) => r.id === b.recipe);
        sendError(res, apiError(422, "missing_ingredients", Copy.inventory.missing(recipe?.name ?? "")));
        return;
      }
      sendError(res, apiError(409, "inventory_full", Copy.world.inventoryFull));
      return;
    }
    res.status(201).json({ inventory: await inventoryView(pool, row.id), crafted: { kind: crafted.output.kind, count: crafted.output.count } });
  });

  app.get("/api/characters/:id/achievements", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const row = (await pool.query<{ id: string; server_id: string }>("SELECT id, server_id FROM characters WHERE id = $1", [req.params.id!])).rows[0];
    if (row === undefined) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    const member = (await pool.query("SELECT 1 FROM members WHERE server_id = $1 AND user_id = $2", [row.server_id, u.id])).rows;
    if (member.length === 0) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    const rows = await pool.query<{ name: string; unlocked_at: Date }>(
      "SELECT a.name, a.unlocked_at FROM achievements a JOIN characters c ON c.id = a.character_id WHERE a.character_id = $1 ORDER BY a.unlocked_at",
      [row.id]
    );
    res.json({ achievements: rows.rows.map((r) => ({ id: r.name, name: r.name, unlocked_at: isoInstant(r.unlocked_at) })) });
  });

  // ---- Tables ----
  const tableOf = async (res2: import("express").Response, tableId: string) => {
    const table = await loadTable(pool, tableId);
    if (table === null) {
      sendError(res2, apiError(404, "not_found", "Not found."));
      return null;
    }
    return table;
  };

  app.patch("/api/tables/:id", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const table = await tableOf(res, req.params.id!);
    if (table === null) return;
    const server = (await pool.query<{ id: string; owner_id: string }>("SELECT id, owner_id FROM servers WHERE id = $1", [table.server_id])).rows[0];
    if (server === undefined || server.owner_id !== u.id) {
      sendError(res, apiError(403, "forbidden", "Only the owner may do that."));
      return;
    }
    const b = bodyOf(req);
    if (checkFields(res, b, ["stake", "turn_seconds"]) !== null) return;
    const precondition = ctx.checkIfMatch(req, table.etag);
    if (precondition !== null) {
      sendError(res, precondition);
      return;
    }
    const fields: Record<string, string> = {};
    const stakeError = val.validateStake(b.stake);
    if (stakeError !== undefined) fields.stake = stakeError;
    const turnError = val.validateTurnSeconds(b.turn_seconds);
    if (turnError !== undefined) fields.turn_seconds = turnError;
    if (Object.keys(fields).length > 0) {
      bad(res, 422, "validation", "Some fields need attention.", fields);
      return;
    }
    const seated = (await pool.query("SELECT 1 FROM seats WHERE table_id = $1", [table.id])).rows;
    if (seated.length > 0) {
      sendError(res, apiError(409, "table_in_use", Copy.tablesAdmin.tableInUse));
      return;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT * FROM tables_ WHERE id = $1 FOR UPDATE", [table.id]);
      const fresh = (await client.query<{ etag: string }>("SELECT etag FROM tables_ WHERE id = $1", [table.id])).rows[0];
      if (fresh !== undefined && fresh.etag !== table.etag) {
        throw new DbError(apiError(412, "precondition_failed", "This changed since you opened it. The latest version is now shown.", { etag: fresh.etag }));
      }
      const newEtag = newRecordId();
      await client.query("UPDATE tables_ SET stake = $2, turn_seconds = $3, etag = $4 WHERE id = $1", [table.id, Number(b.stake), Number(b.turn_seconds), newEtag]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
      if (err instanceof DbError) {
        sendError(res, err.api);
        return;
      }
      throw err;
    }
    client.release();
    const updated = await loadTable(pool, table.id);
    res.setHeader("ETag", updated!.etag);
    res.json(await tableView(pool, updated!, { userId: u.id }));
  });

  app.get("/api/tables/:id", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const table = await tableOf(res, req.params.id!);
    if (table === null) return;
    const member = (await pool.query("SELECT 1 FROM members WHERE server_id = $1 AND user_id = $2", [table.server_id, u.id])).rows;
    if (member.length === 0) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    res.setHeader("ETag", `"${table.etag}"`);
    res.json(await tableView(pool, table, { userId: u.id }));
  });

  const playGateOf = async (serverId: string): Promise<string> => {
    return (await pool.query<{ status: string }>("SELECT status FROM servers WHERE id = $1", [serverId])).rows[0]?.status ?? "";
  };

  app.post("/api/tables/:id/seats", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const table = await tableOf(res, req.params.id!);
    if (table === null) return;
    const b = bodyOf(req);
    if (checkFields(res, b, ["character_id"]) !== null) return;
    const character = await ctx.ownCharacter(pool, table.server_id, u.id, typeof b.character_id === "string" ? b.character_id : "");
    if (!ctx.isCharacter(character)) {
      sendError(res, character);
      return;
    }
    const gate = ctx.playGate(await playGateOf(table.server_id));
    if (gate !== null) {
      sendError(res, gate);
      return;
    }
    if (Math.abs(character.x - table.x) > 1 || Math.abs(character.y - table.y) > 1) {
      sendError(res, apiError(422, "too_far", Copy.world.tooFar));
      return;
    }
    const outcome = await takeSeat(pool, { tableId: table.id, characterId: character.id });
    if (!outcome.ok) {
      const code = outcome.error === "table_full" ? "table_full" : outcome.error === "already_seated" ? "already_seated" : outcome.error === "too_far" ? "too_far" : "insufficient_coins";
      const message = outcome.error === "table_full" ? Copy.tablesPlay.tableFull : outcome.error === "already_seated" ? "You already hold a seat." : outcome.error === "too_far" ? Copy.world.tooFar : "You do not have enough available coins.";
      sendError(res, apiError(outcome.error === "insufficient_coins" ? 422 : 409, code, message));
      return;
    }
    const updated = await loadTable(pool, table.id);
    res.status(201).json({ seat: { seat: outcome.seat ?? 0, label: (SeatLabels[table.game] ?? ["Seat"])[(outcome.seat ?? 1) - 1] ?? "Seat" }, table: await tableView(pool, updated!, { userId: u.id }) });
  });

  app.delete("/api/tables/:id/seats/:characterId", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const table = await tableOf(res, req.params.id!);
    if (table === null) return;
    const outcome = await standUp(pool, table.id, req.params.characterId!);
    if (!outcome.ok) {
      const message = outcome.error === "game_in_play" ? Copy.tablesPlay.standUpInPlay : outcome.error === "not_settled" ? Copy.tablesPlay.standUpNotSettled : "You hold no seat here.";
      sendError(res, apiError(outcome.error === "not_seated" ? 404 : 409, outcome.error === "not_seated" ? "not_found" : outcome.error!, message));
      return;
    }
    const updated = await loadTable(pool, table.id);
    res.json(await tableView(pool, updated!, { userId: u.id }));
  });

  app.post("/api/tables/:id/spectators", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const table = await tableOf(res, req.params.id!);
    if (table === null) return;
    const b = bodyOf(req);
    if (checkFields(res, b, ["character_id"]) !== null) return;
    const character = await ctx.ownCharacter(pool, table.server_id, u.id, typeof b.character_id === "string" ? b.character_id : "");
    if (!ctx.isCharacter(character)) {
      sendError(res, character);
      return;
    }
    if (Math.abs(character.x - table.x) > 1 || Math.abs(character.y - table.y) > 1) {
      sendError(res, apiError(422, "too_far", Copy.world.tooFar));
      return;
    }
    await watchTable(pool, table.id, character.id);
    const updated = await loadTable(pool, table.id);
    res.status(201).json(await tableView(pool, updated!, { userId: u.id }));
  });

  app.delete("/api/tables/:id/spectators/:characterId", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const table = await tableOf(res, req.params.id!);
    if (table === null) return;
    await unwatchTable(pool, table.id, req.params.characterId!);
    const updated = await loadTable(pool, table.id);
    res.json(await tableView(pool, updated!, { userId: u.id }));
  });

  app.post("/api/tables/:id/start", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const table = await tableOf(res, req.params.id!);
    if (table === null) return;
    const gate = ctx.playGate(await playGateOf(table.server_id));
    if (gate !== null) {
      sendError(res, gate);
      return;
    }
    const b = bodyOf(req);
    if (checkFields(res, b, ["character_id"]) !== null) return;
    const character = await ctx.ownCharacter(pool, table.server_id, u.id, typeof b.character_id === "string" ? b.character_id : "");
    if (!ctx.isCharacter(character)) {
      sendError(res, character);
      return;
    }
    const outcome = await startGame(pool, table.id, character.id);
    if (!outcome.ok) {
      sendError(res, apiError(outcome.error === "not_seated" ? 403 : 409, outcome.error === "not_seated" ? "not_seated" : (outcome.error ?? "table_not_full"), outcome.error === "not_seated" ? "You hold no seat here." : startErrorCopy(outcome.error ?? "")));
      return;
    }
    const updated = await loadTable(pool, table.id);
    res.json(await tableView(pool, updated!, { userId: u.id }));
  });

  app.get("/api/tables/:id/legal-moves", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const table = await tableOf(res, req.params.id!);
    if (table === null) return;
    const characterId = typeof req.query.character_id === "string" ? req.query.character_id : "";
    const character = await ctx.ownCharacter(pool, table.server_id, u.id, characterId);
    if (!ctx.isCharacter(character)) {
      sendError(res, character);
      return;
    }
    const game = (await pool.query<{ id: string; game: "chess" | "four" | "tricks"; state: string; to_move_seat: number | null; position: unknown }>(
      "SELECT id, game, state, to_move_seat, position FROM games WHERE table_id = $1 AND state = 'in_play' ORDER BY started_at DESC LIMIT 1",
      [table.id]
    )).rows[0];
    if (game === undefined) {
      sendError(res, apiError(409, "game_not_in_play", "No game is in play."));
      return;
    }
    const seatRow = (await pool.query<{ seat: number }>("SELECT seat FROM seats WHERE table_id = $1 AND character_id = $2", [table.id, character.id])).rows[0];
    if (seatRow === undefined || game.to_move_seat !== seatRow.seat) {
      sendError(res, apiError(403, "not_your_turn", "Moves are shown only to the player on turn."));
      return;
    }
    const position = game.position as { fen?: string; rows?: string[] };
    let moves: string[] = [];
    if (game.game === "chess" && position.fen !== undefined) {
      moves = chess.legalMovesForSeat(position.fen, seatRow.seat as 1 | 2);
    } else if (game.game === "four") {
      moves = ["1", "2", "3", "4", "5", "6", "7"].filter((c) => four.dropRow(position.rows ?? [], Number(c) - 1) !== null);
    } else {
      const hand = (await pool.query<{ hands: Record<string, string[]> }>("SELECT hands FROM games WHERE id = $1", [game.id])).rows[0];
      const position2 = game.position as { trick: { seat: number; card: string }[]; led_suit: string | null };
      const myHand = (hand !== undefined ? hand.hands?.[String(seatRow.seat)] : undefined) ?? [];
      const led = position2.led_suit;
      const hasLed = led === null ? false : myHand.some((c) => c[1] === led);
      moves = myHand.filter((c) => led === null || c[1] === led || !hasLed);
    }
    res.json({ moves });
  });

  app.post("/api/tables/:id/moves", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const table = await tableOf(res, req.params.id!);
    if (table === null) return;
    const b = bodyOf(req);
    if (checkFields(res, b, ["character_id", "turn", "move"]) !== null) return;
    const character = await ctx.ownCharacter(pool, table.server_id, u.id, typeof b.character_id === "string" ? b.character_id : "");
    if (!ctx.isCharacter(character)) {
      sendError(res, character);
      return;
    }
    const outcome = await playMove(pool, { tableId: table.id, characterId: character.id, turn: Number(b.turn), move: typeof b.move === "string" ? b.move : "" });
    if (!outcome.ok) {
      if (outcome.error === "not_seated") {
        sendError(res, apiError(403, "not_seated", "You hold no seat here."));
        return;
      }
      if (outcome.error === "game_not_in_play") {
        sendError(res, apiError(409, "game_not_in_play", "No game is in play."));
        return;
      }
      if (outcome.error === "stale_turn") {
        sendError(res, apiError(409, "stale_turn", Copy.tablesPlay.staleTurn));
        return;
      }
      if (outcome.error === "turn_expired") {
        sendError(res, apiError(409, "turn_expired", Copy.tablesPlay.turnExpired));
        return;
      }
      sendError(res, apiError(422, "illegal_move", moveRejectionCopy(outcome.detail ?? "")));
      return;
    }
    const updated = await loadTable(pool, table.id);
    res.json({ announcement: outcome.announcement ?? "", table: await tableView(pool, updated!, { userId: u.id }) });
  });

  app.post("/api/tables/:id/forfeit", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const table = await tableOf(res, req.params.id!);
    if (table === null) return;
    const b = bodyOf(req);
    if (checkFields(res, b, ["character_id"]) !== null) return;
    const character = await ctx.ownCharacter(pool, table.server_id, u.id, typeof b.character_id === "string" ? b.character_id : "");
    if (!ctx.isCharacter(character)) {
      sendError(res, character);
      return;
    }
    const outcome = await forfeitGame(pool, table.id, character.id);
    if (!outcome.ok) {
      sendError(res, apiError(outcome.error === "not_seated" ? 403 : 409, outcome.error === "not_seated" ? "not_seated" : "game_not_in_play", outcome.error === "not_seated" ? "You hold no seat here." : "No game is in play."));
      return;
    }
    const updated = await loadTable(pool, table.id);
    res.json(await tableView(pool, updated!, { userId: u.id }));
  });

  app.post("/api/tables/:id/rematch", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const table = await tableOf(res, req.params.id!);
    if (table === null) return;
    const gate = ctx.playGate(await playGateOf(table.server_id));
    if (gate !== null) {
      sendError(res, gate);
      return;
    }
    const b = bodyOf(req);
    if (checkFields(res, b, ["character_id"]) !== null) return;
    const character = await ctx.ownCharacter(pool, table.server_id, u.id, typeof b.character_id === "string" ? b.character_id : "");
    if (!ctx.isCharacter(character)) {
      sendError(res, character);
      return;
    }
    const outcome = await offerRematch(pool, table.id, character.id);
    if (!outcome.ok) {
      const status = outcome.error === "not_seated" ? 403 : outcome.error === "insufficient_coins" ? 422 : 409;
      const code = outcome.error === "not_seated" ? "not_seated" : outcome.error === "insufficient_coins" ? "insufficient_coins" : "not_settled";
      const message = outcome.error === "not_seated" ? "You hold no seat here." : outcome.error === "insufficient_coins" ? "You do not have enough available coins." : "You can rematch once the coins have settled.";
      sendError(res, apiError(status, code, message));
      return;
    }
    const updated = await loadTable(pool, table.id);
    res.json(await tableView(pool, updated!, { userId: u.id }));
  });

  // ---- Games history, records, replays ----
  app.get("/api/servers/:slug/games", async (req, res) => {
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
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const page = Math.max(1, Number(req.query.page ?? 1));
    const rows = await pool.query<{ id: string; table_name: string; game: string; result: unknown; finished_at: Date }>(
      `SELECT g.id, t.name AS table_name, t.game, gr.result, g.finished_at
       FROM games g JOIN tables_ t ON t.id = g.table_id JOIN game_results gr ON gr.game_id = g.id
       WHERE t.server_id = $1 AND gr.stored = true
         AND (t.name ILIKE '%' || $2 || '%'
           OR EXISTS (SELECT 1 FROM seats se JOIN characters c ON c.id = se.character_id WHERE se.table_id = t.id AND c.name ILIKE '%' || $2 || '%'))
       ORDER BY g.finished_at DESC LIMIT 20 OFFSET $3`,
      [s.server.id, q, (page - 1) * 20]
    );
    const total = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM games g JOIN tables_ t ON t.id = g.table_id JOIN game_results gr ON gr.game_id = g.id
       WHERE t.server_id = $1 AND gr.stored = true
         AND (t.name ILIKE '%' || $2 || '%'
           OR EXISTS (SELECT 1 FROM seats se JOIN characters c ON c.id = se.character_id WHERE se.table_id = t.id AND c.name ILIKE '%' || $2 || '%'))`,
      [s.server.id, q]
    );
    const games = [];
    for (const row of rows.rows) {
      const result = row.result as { text?: string };
      const seats = await pool.query<{ character_id: string; name: string }>(
        "SELECT s.character_id, c.name FROM seats s JOIN characters c ON c.id = s.character_id WHERE s.table_id IN (SELECT table_id FROM games WHERE id = $1) ORDER BY s.seat",
        [row.id]
      );
      games.push({
        id: row.id,
        table_name: row.table_name,
        game: row.game,
        players: seats.rows.map((x) => x.name),
        result_text: result?.text ?? "",
        finished_at: isoInstant(row.finished_at),
      });
    }
    res.json({ games, total: Number(total.rows[0]?.n ?? 0), page, page_size: 20 });
  });

  app.get("/api/games/:id", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const record = await records.gameRecord(pool, req.params.id!, u.id);
    if (record === null) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    res.json(record);
  });

  app.get("/api/games/:id/replay", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const replay = await records.gameReplay(pool, req.params.id!, u.id);
    if (replay === null) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    res.json(replay);
  });

  // ---- Leaderboards ----
  app.get("/api/servers/:slug/leaderboards/:game", async (req, res) => {
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
    const game = req.params.game as "chess" | "four" | "tricks";
    if (game !== "chess" && game !== "four" && game !== "tricks") {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    res.json({ game, ...(await leaderboardEntries(pool, s.server.id, game)) });
  });

  void chessFenHistory;
  void itemName;
  void balanceOf;
  void MaxCharactersPerUser;
}

function startErrorCopy(error: string): string {
  const map: Record<string, string> = {
    table_not_full: "Every seat must be taken first.",
    game_in_play: "A game is already in play.",
    not_settled: "You can start again once the coins have settled.",
    rematch_required: "Offer a rematch first.",
    insufficient_coins: "You do not have enough available coins.",
  };
  return map[error] ?? "The game cannot start.";
}

function moveRejectionCopy(detail: string): string {
  const map: Record<string, string> = {
    not_your_turn: Copy.chess.illegalNotYourTurn,
    no_piece: "Illegal: there is no piece of yours on that square.",
    cannot_move: Copy.chess.illegalCannotMove,
    king_in_check: Copy.chess.illegalKingInCheck,
    castle: Copy.chess.illegalCastle,
    promotion_needed: Copy.chess.illegalPromotion,
    column_full: Copy.four.columnFull,
    must_follow_suit: Copy.cards.followSuit,
    not_in_hand: Copy.cards.notInHand,
  };
  return map[detail] ?? Copy.chess.illegalCannotMove;
}
