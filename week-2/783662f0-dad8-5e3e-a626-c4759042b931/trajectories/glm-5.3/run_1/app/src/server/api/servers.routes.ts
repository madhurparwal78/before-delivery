/** Server, member, invite, billing and admin routes. */

import type { Pool } from "../db/pool.js";
import type { Express } from "express";
import { apiError } from "./errors.js";
import { sendError } from "./boundary.js";
import * as ctx from "./context.js";
import * as val from "./validation.js";
import { FieldCopy } from "../../shared/copy.js";
import { Copy } from "../../shared/copy.js";
import { Plans, TimeZones } from "../../shared/data.js";
import { checkout } from "../billing/checkout.js";
import { approvePayment } from "../billing/payments.js";
import { refreshBilling, cachedBillingState, loadBillingRowById } from "../billing/status.js";
import { changeSubscriptionPlan, KillBillError } from "../billing/killbill.js";
import { buildStatement } from "../billing/statement.js";
import { createInvite, myInvites, friendsList, mailList } from "../invites/invites.js";
import { saveWorld, savesOf, restoreWorld, exportArchive, readExport } from "../world/saves.js";
import { StorageUnavailableError } from "../storage/objects.js";
import { worldView, loadWorldBySlug } from "../world/world.js";
import { startNewSeason } from "../tables/leaderboards.js";
import { isoInstant } from "../time.js";
import { loadPurchase, purchaseView, receiptState } from "../coins/purchases.js";

import { bodyOf as getBody, str, checkFields, bad, userCtx as user, isUser, serverCtx, isServerCtx } from "./helpers.js";

export function installServerRoutes(app: Express, pool: Pool): void {

  // ---- Checkout ----
  app.post("/api/checkout", async (req, res) => {
    const u = await user(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const b = getBody(req);
    if (checkFields(res, b, ["server_name", "plan"]) !== null) return;
    const keyHeader = req.headers["idempotency-key"];
    const key = Array.isArray(keyHeader) ? keyHeader[0] : keyHeader;
    const keyError = ctx.idempotencyError(key);
    if (keyError !== null) {
      sendError(res, keyError);
      return;
    }
    const stored = await ctx.findIdempotent(pool, u.id, "checkout", key ?? "");
    if (stored !== null) {
      res.status(stored.status).json(JSON.parse(stored.body));
      return;
    }
    const fields: Record<string, string> = {};
    const nameError = val.validateServerName(str(b.server_name));
    if (nameError !== undefined) fields.server_name = nameError;
    if (b.plan !== "hamlet" && b.plan !== "borough") fields.plan = FieldCopy.plan.required;
    if (Object.keys(fields).length > 0) {
      bad(res, 422, "validation", "Some fields need attention.", fields);
      return;
    }
    const taken = await pool.query("SELECT 1 FROM servers WHERE lower(name) = lower($1)", [str(b.server_name)!]);
    if (taken.rows.length > 0) {
      bad(res, 422, "validation", "Some fields need attention.", { server_name: FieldCopy.serverName.taken });
      return;
    }
    let result;
    try {
      result = await checkout(pool, { serverName: str(b.server_name)!, plan: b.plan as "hamlet" | "borough", ownerId: u.id });
    } catch (err) {
      if (err instanceof KillBillError) {
        sendError(res, apiError(503, "billing_unavailable", "The billing provider is unreachable.", { retryAfter: 30 }));
        return;
      }
      throw err;
    }
    const billing = await cachedBillingState(pool, result.serverId);
    const response = {
      server: { id: result.serverId, slug: result.slug, name: str(b.server_name)! },
      billing,
      billing_url: `/s/${result.slug}/billing`,
    };
    await ctx.storeIdempotent(pool, u.id, "checkout", key ?? "", 201, JSON.stringify(response));
    res.status(201).json(response);
  });

  // ---- The server ----
  app.get("/api/servers/:slug", async (req, res) => {
    const u = await user(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const s = await serverCtx(pool, req);
    if (!isServerCtx(s)) {
      sendError(res, s);
      return;
    }
    const etag = await ctx.serverEtag(pool, s.server.id);
    if (etag !== null) res.setHeader("ETag", etag);
    res.json(await ctx.serverObject(pool, s.server, u.id));
  });

  app.patch("/api/servers/:slug", async (req, res) => {
    const u = await user(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const s = await serverCtx(pool, req);
    if (!isServerCtx(s)) {
      sendError(res, s);
      return;
    }
    const forbidden = ctx.ownerOnly(s.role);
    if (forbidden !== null) {
      sendError(res, forbidden);
      return;
    }
    const b = getBody(req);
    if (checkFields(res, b, ["time_zone"]) !== null) return;
    const precondition = ctx.checkIfMatch(req, await ctx.serverEtag(pool, s.server.id));
    if (precondition !== null) {
      sendError(res, precondition);
      return;
    }
    const tzError = val.validateTimeZone(b.time_zone, TimeZones);
    if (tzError !== undefined) {
      bad(res, 422, "validation", "Some fields need attention.", { time_zone: tzError });
      return;
    }
    await pool.query("UPDATE servers SET time_zone = $2 WHERE id = $1", [s.server.id, String(b.time_zone)]);
    const etag = await ctx.serverEtag(pool, s.server.id);
    if (etag !== null) res.setHeader("ETag", etag);
    res.json(await ctx.serverObject(pool, s.server, u.id));
  });

  // ---- Members ----
  app.post("/api/servers/:slug/members", async (req, res) => {
    const u = await user(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const s = await serverCtx(pool, req);
    if (!isServerCtx(s)) {
      sendError(res, s);
      return;
    }
    const forbidden = ctx.ownerOnly(s.role);
    if (forbidden !== null) {
      sendError(res, forbidden);
      return;
    }
    const b = getBody(req);
    if (checkFields(res, b, ["handle"]) !== null) return;
    const handleError = val.validateHandle(str(b.handle));
    if (handleError !== undefined) {
      bad(res, 422, "validation", "Some fields need attention.", { handle: handleError });
      return;
    }
    const account = (await pool.query<{ id: string }>("SELECT id FROM users WHERE handle = $1", [str(b.handle)!])).rows[0];
    if (account === undefined) {
      sendError(res, apiError(404, "unknown_handle", Copy.members.unknownHandle));
      return;
    }
    const already = (await pool.query("SELECT 1 FROM members WHERE server_id = $1 AND user_id = $2", [s.server.id, account.id])).rows;
    if (already.length > 0) {
      sendError(res, apiError(409, "already_member", Copy.members.alreadyMember(str(b.handle)!)));
      return;
    }
    const count = (await pool.query<{ n: string }>("SELECT count(*)::text AS n FROM members WHERE server_id = $1", [s.server.id])).rows[0];
    if (Number(count?.n ?? 0) >= Plans[s.server.plan].members) {
      sendError(res, apiError(409, "member_limit_reached", Copy.members.memberLimit(Plans[s.server.plan].members)));
      return;
    }
    await pool.query("INSERT INTO members (server_id, user_id) VALUES ($1,$2)", [s.server.id, account.id]);
    const { publishFriends } = await import("../invites/invites.js");
    await publishFriends(pool, s.server.id);
    res.status(201).json({ member: { handle: str(b.handle)! } });
  });

  app.get("/api/servers/:slug/friends", async (req, res) => {
    const u = await user(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const s = await serverCtx(pool, req);
    if (!isServerCtx(s)) {
      sendError(res, s);
      return;
    }
    res.json({ friends: await friendsList(pool, s.server.id) });
  });

  app.post("/api/servers/:slug/invites", async (req, res) => {
    const u = await user(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const s = await serverCtx(pool, req);
    if (!isServerCtx(s)) {
      sendError(res, s);
      return;
    }
    const b = getBody(req);
    if (checkFields(res, b, ["email"]) !== null) return;
    const keyHeader = req.headers["idempotency-key"];
    const key = Array.isArray(keyHeader) ? keyHeader[0] : keyHeader;
    const keyError = ctx.idempotencyError(key);
    if (keyError !== null) {
      sendError(res, keyError);
      return;
    }
    const stored = await ctx.findIdempotent(pool, u.id, "invite", key ?? "");
    if (stored !== null) {
      res.status(stored.status).json(JSON.parse(stored.body));
      return;
    }
    const emailError = val.validateEmail(str(b.email));
    if (emailError !== undefined) {
      bad(res, 422, "validation", "Some fields need attention.", { email: emailError });
      return;
    }
    const created = await createInvite(pool, { serverId: s.server.id, email: str(b.email)!, inviterId: u.id });
    if (!created.ok) {
      if (created.error === "already_member") {
        sendError(res, apiError(409, "already_member", Copy.invites.alreadyMember(str(b.email)!)));
        return;
      }
      sendError(res, apiError(409, "member_limit_reached", Copy.members.memberLimit(Plans[s.server.plan].members)));
      return;
    }
    const response = { invite: created.invite };
    await ctx.storeIdempotent(pool, u.id, "invite", key ?? "", 201, JSON.stringify(response));
    res.status(201).json(response);
  });

  app.get("/api/servers/:slug/invites", async (req, res) => {
    const u = await user(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const s = await serverCtx(pool, req);
    if (!isServerCtx(s)) {
      sendError(res, s);
      return;
    }
    res.json({ invites: await myInvites(pool, s.server.id, u.id) });
  });

  app.get("/api/servers/:slug/mail", async (req, res) => {
    const u = await user(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const s = await serverCtx(pool, req);
    if (!isServerCtx(s)) {
      sendError(res, s);
      return;
    }
    const forbidden = ctx.ownerOnly(s.role);
    if (forbidden !== null) {
      sendError(res, forbidden);
      return;
    }
    res.json({ mail: await mailList(pool, s.server.id) });
  });

  // ---- Billing ----
  app.get("/api/servers/:slug/billing", async (req, res) => {
    const u = await user(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const s = await serverCtx(pool, req);
    if (!isServerCtx(s)) {
      sendError(res, s);
      return;
    }
    const forbidden = ctx.ownerOnly(s.role);
    if (forbidden !== null) {
      sendError(res, forbidden);
      return;
    }
    const refreshed = await refreshBilling(pool, s.server.id);
    if (refreshed.state === null) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    res.setHeader("ETag", `"${s.server.id}:${refreshed.state.status}:${refreshed.state.balance}:${refreshed.state.checked_at}"`);
    res.json(refreshed.state);
  });

  app.post("/api/servers/:slug/billing/payments", async (req, res) => {
    const u = await user(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const s = await serverCtx(pool, req);
    if (!isServerCtx(s)) {
      sendError(res, s);
      return;
    }
    const forbidden = ctx.ownerOnly(s.role);
    if (forbidden !== null) {
      sendError(res, forbidden);
      return;
    }
    const outcome = await approvePayment(pool, s.server.id);
    if (!outcome.ok) {
      if (outcome.error === "payment_pending") {
        sendError(res, apiError(409, "payment_pending", Copy.billing.paymentPendingConflict));
        return;
      }
      if (outcome.error === "nothing_due") {
        sendError(res, apiError(409, "nothing_due", Copy.billing.nothingDue));
        return;
      }
      sendError(res, apiError(503, "billing_unavailable", "The billing provider is unreachable.", { retryAfter: 30 }));
      return;
    }
    res.status(outcome.status).json(outcome.state);
  });

  app.post("/api/servers/:slug/plan", async (req, res) => {
    const u = await user(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const s = await serverCtx(pool, req);
    if (!isServerCtx(s)) {
      sendError(res, s);
      return;
    }
    const forbidden = ctx.ownerOnly(s.role);
    if (forbidden !== null) {
      sendError(res, forbidden);
      return;
    }
    const b = getBody(req);
    if (checkFields(res, b, ["plan"]) !== null) return;
    const row = await loadBillingRowById(pool, s.server.id);
    if (row === null) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    if (row.status !== "active") {
      sendError(res, apiError(409, "server_not_active", Copy.billing.serverNotActive));
      return;
    }
    if (b.plan !== "hamlet" && b.plan !== "borough") {
      bad(res, 422, "validation", "Some fields need attention.", { plan: FieldCopy.plan.required });
      return;
    }
    if (b.plan === row.plan) {
      sendError(res, apiError(409, "same_plan", Copy.billing.samePlan));
      return;
    }
    if (row.pending_plan !== null) {
      sendError(res, apiError(409, "plan_change_pending", Copy.billing.planChangePending));
      return;
    }
    const kbAccount = (await pool.query<{ account_id: string }>("SELECT account_id FROM kb_accounts WHERE external_key = $1", [
      `plotwright-${s.server.id}-sub`,
    ])).rows[0];
    if (kbAccount === undefined) {
      sendError(res, apiError(503, "billing_unavailable", "The billing provider is unreachable.", { retryAfter: 30 }));
      return;
    }
    try {
      await changeSubscriptionPlan(kbAccount.account_id, `${b.plan}-monthly`);
    } catch (err) {
      if (err instanceof KillBillError) {
        sendError(res, apiError(503, "billing_unavailable", "The billing provider is unreachable.", { retryAfter: 30 }));
        return;
      }
      throw err;
    }
    await pool.query("UPDATE servers SET pending_plan = $2 WHERE id = $1", [s.server.id, b.plan]);
    const refreshed = await refreshBilling(pool, s.server.id);
    res.json(refreshed.state);
  });

  app.get("/api/servers/:slug/billing/statement.csv", async (req, res) => {
    const u = await user(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const s = await serverCtx(pool, req);
    if (!isServerCtx(s)) {
      sendError(res, s);
      return;
    }
    const forbidden = ctx.ownerOnly(s.role);
    if (forbidden !== null) {
      sendError(res, forbidden);
      return;
    }
    const csv = await buildStatement(pool, s.server.id, req.params.slug!);
    if (csv === null) {
      sendError(res, apiError(503, "billing_unavailable", Copy.billing.statementOutage, { retryAfter: 30 }));
      return;
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${req.params.slug!}-statement.csv"`);
    res.send(csv);
  });

  app.get("/api/servers/:slug/ledger", async (req, res) => {
    const u = await user(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const s = await serverCtx(pool, req);
    if (!isServerCtx(s)) {
      sendError(res, s);
      return;
    }
    const forbidden = ctx.ownerOnly(s.role);
    if (forbidden !== null) {
      sendError(res, forbidden);
      return;
    }
    const rows = await pool.query<{ id: string; kind: string; game_id: string | null; trade_id: string | null; purchase_id: string | null; lines: unknown; created_at: Date }>(
      "SELECT id, kind, game_id, trade_id, purchase_id, lines, created_at FROM ledger_entries WHERE server_id = $1 ORDER BY created_at, id",
      [s.server.id]
    );
    res.json({
      entries: rows.rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        game_id: r.game_id,
        trade_id: r.trade_id,
        purchase_id: r.purchase_id,
        lines: r.lines,
        created_at: isoInstant(r.created_at),
      })),
    });
  });

  // ---- Admin: worlds, saves, exports, tables, purchases, seasons ----
  app.get("/api/servers/:slug/worlds/:world/saves", async (req, res) => {
    const u = await user(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const s = await serverCtx(pool, req);
    if (!isServerCtx(s)) {
      sendError(res, s);
      return;
    }
    const world = await loadWorldBySlug(pool, s.server.id, req.params.world!);
    if (world === null) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    res.json({ saves: await savesOf(pool, world.id) });
  });

  app.post("/api/servers/:slug/worlds/:world/saves", async (req, res) => {
    const u = await user(pool, req);
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
    const forbidden = ctx.ownerOnly(s.role);
    if (forbidden !== null) {
      sendError(res, forbidden);
      return;
    }
    const world = await loadWorldBySlug(pool, s.server.id, req.params.world!);
    if (world === null) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    try {
      const save = await saveWorld(pool, s.server.id, world.id, world.slug);
      const view = await worldView(pool, world);
      res.status(201).json({ save: { id: save.id, number: save.number, created_at: isoInstant(save.created_at), restored_from: null, objects: 2 }, world: view });
    } catch (err) {
      if (err instanceof StorageUnavailableError) {
        sendError(res, apiError(503, "storage_unavailable", "Storage is unreachable.", { retryAfter: 10 }));
        return;
      }
      throw err;
    }
  });

  app.post("/api/servers/:slug/worlds/:world/restore", async (req, res) => {
    const u = await user(pool, req);
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
    const forbidden = ctx.ownerOnly(s.role);
    if (forbidden !== null) {
      sendError(res, forbidden);
      return;
    }
    const b = getBody(req);
    if (checkFields(res, b, ["save_id"]) !== null) return;
    const world = await loadWorldBySlug(pool, s.server.id, req.params.world!);
    if (world === null) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    try {
      const restored = await restoreWorld(pool, s.server.id, world.id, world.slug, str(b.save_id) ?? "");
      if (!restored.ok) {
        sendError(res, apiError(404, "not_found", "Not found."));
        return;
      }
      const view = await worldView(pool, world);
      res.json({ world: view, save: { id: restored.save!.id, number: restored.save!.number, created_at: isoInstant(restored.save!.created_at), restored_from: restored.save!.restored_from, objects: 2 } });
    } catch (err) {
      if (err instanceof StorageUnavailableError) {
        sendError(res, apiError(503, "storage_unavailable", "Storage is unreachable.", { retryAfter: 10 }));
        return;
      }
      throw err;
    }
  });

  app.patch("/api/servers/:slug/worlds/:world", async (req, res) => {
    const u = await user(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const s = await serverCtx(pool, req);
    if (!isServerCtx(s)) {
      sendError(res, s);
      return;
    }
    const forbidden = ctx.ownerOnly(s.role);
    if (forbidden !== null) {
      sendError(res, forbidden);
      return;
    }
    const b = getBody(req);
    if (checkFields(res, b, ["name"]) !== null) return;
    const world = await loadWorldBySlug(pool, s.server.id, req.params.world!);
    if (world === null) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    const etag = `"${world.id}:${world.name}"`;
    const precondition = ctx.checkIfMatch(req, etag);
    if (precondition !== null) {
      sendError(res, precondition);
      return;
    }
    const nameError = val.validateWorldName(str(b.name));
    if (nameError !== undefined) {
      bad(res, 422, "validation", "Some fields need attention.", { name: nameError });
      return;
    }
    await pool.query("UPDATE worlds SET name = $2 WHERE id = $1", [world.id, str(b.name)!]);
    const fresh = await loadWorldBySlug(pool, s.server.id, req.params.world!);
    res.setHeader("ETag", `"${fresh!.id}:${fresh!.name}"`);
    res.json(await worldView(pool, fresh!));
  });

  app.post("/api/servers/:slug/exports", async (req, res) => {
    const u = await user(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const s = await serverCtx(pool, req);
    if (!isServerCtx(s)) {
      sendError(res, s);
      return;
    }
    const forbidden = ctx.ownerOnly(s.role);
    if (forbidden !== null) {
      sendError(res, forbidden);
      return;
    }
    try {
      const exported = await exportArchive(pool, s.server.id);
      res.status(201).json({ export: { id: exported.id, key: exported.key, download_url: `/api/servers/${req.params.slug!}/exports/${exported.id}` } });
    } catch (err) {
      if (err instanceof StorageUnavailableError) {
        sendError(res, apiError(503, "storage_unavailable", "Storage is unreachable.", { retryAfter: 10 }));
        return;
      }
      throw err;
    }
  });

  app.get("/api/servers/:slug/exports/:id", async (req, res) => {
    const u = await user(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const s = await serverCtx(pool, req);
    if (!isServerCtx(s)) {
      sendError(res, s);
      return;
    }
    const forbidden = ctx.ownerOnly(s.role);
    if (forbidden !== null) {
      sendError(res, forbidden);
      return;
    }
    const data = await readExport(pool, s.server.id, req.params.id!);
    if (data === null) {
      sendError(res, apiError(404, "not_found", "Not found."));
      return;
    }
    res.setHeader("Content-Type", "application/x-tar");
    res.setHeader("Content-Disposition", `attachment; filename="${req.params.slug!}-worlds.tar"`);
    res.send(Buffer.from(data.bytes));
  });

  app.post("/api/servers/:slug/seasons", async (req, res) => {
    const u = await user(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const s = await serverCtx(pool, req);
    if (!isServerCtx(s)) {
      sendError(res, s);
      return;
    }
    const forbidden = ctx.ownerOnly(s.role);
    if (forbidden !== null) {
      sendError(res, forbidden);
      return;
    }
    const season = await startNewSeason(pool, s.server.id);
    res.status(201).json({ season });
  });

  // Purchases listed for the owner on admin.
  app.get("/api/servers/:slug/coin-purchases", async (req, res) => {
    const u = await user(pool, req);
    if (!isUser(u)) {
      sendError(res, u);
      return;
    }
    const s = await serverCtx(pool, req);
    if (!isServerCtx(s)) {
      sendError(res, s);
      return;
    }
    if (s.role === "owner") {
      const rows = await pool.query("SELECT id FROM coin_purchases WHERE server_id = $1 ORDER BY created_at DESC", [s.server.id]);
      const purchases = [];
      for (const row of rows.rows) {
        const p = await loadPurchase(pool, row.id);
        if (p !== null) purchases.push(purchaseView(p, await receiptState(pool, p.id)));
      }
      res.json({ purchases });
      return;
    }
    const rows = await pool.query("SELECT id FROM coin_purchases WHERE server_id = $1 AND user_id = $2 ORDER BY created_at DESC", [s.server.id, u.id]);
    const purchases = [];
    for (const row of rows.rows) {
      const p = await loadPurchase(pool, row.id);
      if (p !== null) purchases.push(purchaseView(p, await receiptState(pool, p.id)));
    }
    res.json({ purchases });
  });

}
