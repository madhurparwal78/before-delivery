/** Coin purchases and trades. */

import type { Pool } from "../db/pool.js";
import type { Express } from "express";
import { apiError } from "./errors.js";
import { sendError } from "./boundary.js";
import * as ctx from "./context.js";
import { bodyOf, checkFields, bad, userCtx, isUser, serverCtx, isServerCtx } from "./helpers.js";
import * as val from "./validation.js";
import { Copy } from "../../shared/copy.js";
import { CoinPacks, itemName } from "../../shared/data.js";
import { createPurchase, refundPurchase, loadPurchase, receiptState, purchaseView } from "../coins/purchases.js";
import { balanceOf, availableCoins } from "../coins/ledger.js";
import { inventoryView } from "../characters/characters.js";
import { openTrade, updateOffer, acceptTrade, cancelTrade, tradeView } from "../trades/trades.js";
import { secondsUntilMidnight } from "../time.js";

export function installCoinRoutes(app: Express, pool: Pool): void {
  app.post("/api/servers/:slug/coin-purchases", async (req, res) => {
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
    if (checkFields(res, b, ["character_id", "pack"]) !== null) return;
    const character = await ctx.ownCharacter(pool, s.server.id, u.id, typeof b.character_id === "string" ? b.character_id : "");
    if (!ctx.isCharacter(character)) {
      sendError(res, character);
      return;
    }
    const pack = CoinPacks.find((p) => p.pack === b.pack);
    if (pack === undefined) {
      bad(res, 422, "validation", "Some fields need attention.", { pack: "Choose a coin pack." });
      return;
    }
    const outcome = await createPurchase(pool, {
      serverId: s.server.id,
      timeZone: s.server.time_zone,
      userId: u.id,
      handle: u.handle,
      email: (await pool.query<{ email: string }>("SELECT email FROM users WHERE id = $1", [u.id])).rows[0]?.email ?? "",
      characterId: character.id,
      characterName: character.name,
      pack: pack.pack,
      serverName: s.server.name,
    });
    if (!outcome.ok) {
      if (outcome.error === "daily_limit_reached") {
        sendError(res, apiError(429, "daily_limit_reached", Copy.coins.dailyLimit, { retryAfter: secondsUntilMidnight(s.server.time_zone) }));
        return;
      }
      sendError(res, apiError(503, "billing_unavailable", Copy.coins.billingOutage, { retryAfter: 30 }));
      return;
    }
    res.status(outcome.status).json(purchaseView(outcome.purchase, await receiptState(pool, outcome.purchase.id)));
  });

  app.get("/api/coin-purchases/:id", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const purchase = (await pool.query<{ id: string; user_id: string; server_id: string }>("SELECT id, user_id, server_id FROM coin_purchases WHERE id = $1", [req.params.id!])).rows[0];
    if (purchase === undefined) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    const owner = (await pool.query<{ owner_id: string }>("SELECT owner_id FROM servers WHERE id = $1", [purchase.server_id])).rows[0];
    if (purchase.user_id !== u.id && owner?.owner_id !== u.id) {
      sendError(res, apiError(403, "forbidden", "Only the buyer and the owner may see this purchase."));
      return;
    }
    const row = await loadPurchase(pool, purchase.id);
    if (row === null) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    res.json(purchaseView(row, await receiptState(pool, row.id)));
  });

  app.post("/api/coin-purchases/:id/refund", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const purchase = (await pool.query<{ id: string; server_id: string }>("SELECT id, server_id FROM coin_purchases WHERE id = $1", [req.params.id!])).rows[0];
    if (purchase === undefined) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    const owner = (await pool.query<{ owner_id: string }>("SELECT owner_id FROM servers WHERE id = $1", [purchase.server_id])).rows[0];
    if (owner?.owner_id !== u.id) {
      sendError(res, apiError(403, "forbidden", "Only the owner may refund purchases."));
      return;
    }
    const outcome = await refundPurchase(pool, purchase.id);
    if (!outcome.ok) {
      if (outcome.error === "not_paid") {
        sendError(res, apiError(409, "not_paid", "Only a paid purchase can be refunded."));
        return;
      }
      if (outcome.error === "already_refunded") {
        sendError(res, apiError(409, "already_refunded", Copy.coins.alreadyRefunded));
        return;
      }
      if (outcome.error === "coins_spent") {
        sendError(res, apiError(409, "coins_spent", Copy.coins.coinsSpent));
        return;
      }
      sendError(res, apiError(503, "billing_unavailable", Copy.coins.billingOutage, { retryAfter: 30 }));
      return;
    }
    res.json(purchaseView(outcome.purchase, await receiptState(pool, outcome.purchase.id)));
  });

  // ---- Trades ----
  app.post("/api/servers/:slug/trades", async (req, res) => {
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
    if (checkFields(res, b, ["character_id", "partner_id", "coins", "items"]) !== null) return;
    const character = await ctx.ownCharacter(pool, s.server.id, u.id, typeof b.character_id === "string" ? b.character_id : "");
    if (!ctx.isCharacter(character)) {
      sendError(res, character);
      return;
    }
    const partnerRow = (await pool.query<{ id: string; server_id: string; name: string; world_id: string }>(
      "SELECT id, server_id, name, world_id FROM characters WHERE id = $1",
      [typeof b.partner_id === "string" ? b.partner_id : ""]
    )).rows[0];
    if (partnerRow === undefined || partnerRow.server_id !== s.server.id) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    const available = await availableCoins(pool, character.id);
    const coinsError = val.validateCoinsToOffer(b.coins, available);
    if (coinsError !== undefined) {
      bad(res, 422, "validation", "Some fields need attention.", { coins: coinsError });
      return;
    }
    const items: { kind: string; count: number }[] = [];
    if (b.items !== undefined) {
      if (typeof b.items !== "object" || b.items === null) {
        bad(res, 422, "validation", "Some fields need attention.", { items: "Choose items to offer." });
        return;
      }
      for (const [kind, count] of Object.entries(b.items as Record<string, unknown>)) {
        const held = await inventoryOfKind(pool, character.id, kind);
        const itemError = val.validateItemCount(count, held);
        if (itemError !== undefined) {
          bad(res, 422, "validation", "Some fields need attention.", { [`${itemName(kind)} to offer`]: itemError });
          return;
        }
        if (Number(count) > 0) items.push({ kind, count: Number(count) });
      }
    }
    const worldId = (await pool.query<{ world_id: string }>("SELECT world_id FROM characters WHERE id = $1", [character.id])).rows[0];
    const outcome = await openTrade(pool, {
      serverId: s.server.id,
      worldId: worldId?.world_id ?? "",
      characterId: character.id,
      partnerId: partnerRow.id,
      coins: Number(b.coins),
      items,
    });
    if (!outcome.ok) {
      sendError(res, apiError(outcome.error === "too_far" ? 422 : 409, outcome.error!, outcome.error === "too_far" ? Copy.trading.tooFar(partnerRow.name) : Copy.trading.tradeOpen(partnerRow.name)));
      return;
    }
    res.status(201).json(await tradeView(pool, outcome.tradeId!));
  });

  app.get("/api/trades/:id", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const trade = (await pool.query<{ id: string; a_character_id: string; b_character_id: string }>(
      "SELECT id, a_character_id, b_character_id FROM trades WHERE id = $1",
      [req.params.id!]
    )).rows[0];
    if (trade === undefined) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    const mine = (await pool.query<{ user_id: string }>("SELECT user_id FROM characters WHERE id IN ($1, $2)", [trade.a_character_id, trade.b_character_id])).rows;
    const isParty = mine.some((m) => m.user_id === u.id);
    if (!isParty) {
      sendError(res, apiError(403, "not_trade_party", "Only the trade's two players may see it."));
      return;
    }
    res.json(await tradeView(pool, trade.id));
  });

  app.post("/api/trades/:id/offer", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const b = bodyOf(req);
    if (checkFields(res, b, ["character_id", "version", "coins", "items"]) !== null) return;
    const trade = (await pool.query<{ id: string; server_id: string }>("SELECT id, server_id FROM trades WHERE id = $1", [req.params.id!])).rows[0];
    if (trade === undefined) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    const character = await ctx.ownCharacter(pool, trade.server_id, u.id, typeof b.character_id === "string" ? b.character_id : "");
    if (!ctx.isCharacter(character)) {
      sendError(res, character);
      return;
    }
    const available = await availableCoins(pool, character.id);
    const coinsError = val.validateCoinsToOffer(b.coins, available);
    if (coinsError !== undefined) {
      bad(res, 422, "validation", "Some fields need attention.", { coins: coinsError });
      return;
    }
    const items: { kind: string; count: number }[] = [];
    if (b.items !== undefined && typeof b.items === "object" && b.items !== null) {
      for (const [kind, count] of Object.entries(b.items as Record<string, unknown>)) {
        const held = await inventoryOfKind(pool, character.id, kind);
        const itemError = val.validateItemCount(count, held);
        if (itemError !== undefined) {
          bad(res, 422, "validation", "Some fields need attention.", { [`${itemName(kind)} to offer`]: itemError });
          return;
        }
        if (Number(count) > 0) items.push({ kind, count: Number(count) });
      }
    }
    const outcome = await updateOffer(pool, { tradeId: trade.id, characterId: character.id, version: Number(b.version), coins: Number(b.coins), items });
    if (!outcome.ok) {
      sendError(res, apiError(outcome.error === "trade_closed" ? 409 : 409, outcome.error!, outcome.error === "trade_closed" ? "That trade is closed." : Copy.trading.tradeChanged));
      return;
    }
    res.json(outcome.trade);
  });

  app.post("/api/trades/:id/accept", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const b = bodyOf(req);
    if (checkFields(res, b, ["character_id", "version"]) !== null) return;
    const trade = (await pool.query<{ id: string; server_id: string }>("SELECT id, server_id FROM trades WHERE id = $1", [req.params.id!])).rows[0];
    if (trade === undefined) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    const character = await ctx.ownCharacter(pool, trade.server_id, u.id, typeof b.character_id === "string" ? b.character_id : "");
    if (!ctx.isCharacter(character)) {
      sendError(res, character);
      return;
    }
    const outcome = await acceptTrade(pool, { tradeId: trade.id, characterId: character.id, version: Number(b.version) });
    if (!outcome.ok) {
      sendError(res, apiError(409, outcome.error!, outcome.error === "trade_closed" ? "That trade is closed." : outcome.error === "trade_changed" ? Copy.trading.tradeChanged : Copy.trading.inventoryFull));
      return;
    }
    res.json(outcome.trade);
  });

  app.post("/api/trades/:id/cancel", async (req, res) => {
    const u = await userCtx(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const b = bodyOf(req);
    if (checkFields(res, b, ["character_id"]) !== null) return;
    const trade = (await pool.query<{ id: string; server_id: string }>("SELECT id, server_id FROM trades WHERE id = $1", [req.params.id!])).rows[0];
    if (trade === undefined) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    const character = await ctx.ownCharacter(pool, trade.server_id, u.id, typeof b.character_id === "string" ? b.character_id : "");
    if (!ctx.isCharacter(character)) {
      sendError(res, character);
      return;
    }
    const outcome = await cancelTrade(pool, trade.id, character.id);
    res.json(await tradeView(pool, trade.id));
    void outcome;
  });

  void balanceOf;
  void inventoryView;
}

async function inventoryOfKind(pool: Pool, characterId: string, kind: string): Promise<number> {
  const rows = await pool.query<{ count: number }>(
    "SELECT COALESCE(SUM(count - held), 0) AS count FROM inventory_slots WHERE character_id = $1 AND kind = $2",
    [characterId, kind]
  );
  return Number(rows.rows[0]?.count ?? 0);
}
