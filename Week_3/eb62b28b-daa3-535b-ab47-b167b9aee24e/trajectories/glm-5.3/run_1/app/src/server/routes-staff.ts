import type { Router, Request, Response } from "express";
import type { AppContext } from "./route-context.js";
import { ApiError, sendError } from "./errors.js";
import { requireSession } from "./session.js";
import { copy, FIELD_ERRORS } from "../shared/copy.js";
import type { Person } from "./person.js";
import { memberSelfView } from "./routes-public.js";
import { memberCore, membershipFor } from "./memberships.js";
import { hashPassword, newId } from "./crypto.js";
import { instantZ } from "../shared/time.js";
import type { Cadence } from "../shared/enums.js";
import { packBlend, INGREDIENT_BY_ID, overflowingPacket } from "../shared/blends.js";
import { makeRun } from "./routes-draws.js";
import { DateTime } from "luxon";
import { isServed, SERVED_STATES, stateName } from "../shared/states.js";
import { sendMessage } from "./message-ops.js";
import { markThreadHandled } from "./message-ops.js";
import { killBillReachable, paymentsUnavailable, joinPlus } from "./membership-ops.js";
import { rangeBoundsValid } from "../shared/ranges.js";
import { param, query } from "./request-utils.js";

type RunFn = (
  ctx: AppContext,
  req: Request,
  res: Response,
  roles: string[],
  handler: (req: Request, res: Response, person: Person) => Promise<void>
) => Promise<void>;

export function makeStaffRun(): RunFn {
  return async (ctx, req, res, roles, handler) => {
    try {
      const person = await requireSession(ctx.db, req, ctx.config.timers.sessionSeconds);
      if (!roles.includes(person.role)) {
        throw new ApiError(403, "forbidden", "You can't use that.");
      }
      await handler(req, res, person);
    } catch (error) {
      if (!res.headersSent) sendError(res, error);
      else res.end();
    }
  };
}

export function registerStaffRoutes(router: Router, ctx: AppContext): void {
  const run = makeStaffRun();

  // ---- Team management (owner only) ----
  router.get("/api/staff", async (req, res) => {
    await run(ctx, req, res, ["owner"], async (_req, res2) => {
      const rows = await ctx.db.query<{ id: string; name: string; email: string; role: string }>(
        `SELECT id, name, email, role FROM staff WHERE removed_at IS NULL ORDER BY name`
      );
      res2.json({ staff: rows });
    });
  });

  router.post("/api/staff", async (req, res) => {
    await run(ctx, req, res, ["owner"], async (req2, res2) => {
      const body = req2.body as Record<string, unknown>;
      const fields: Record<string, string> = {};
      const name = typeof body["name"] === "string" ? body["name"].trim() : "";
      const email = typeof body["email"] === "string" ? body["email"].trim().toLowerCase() : "";
      const password = typeof body["password"] === "string" ? body["password"] : "";
      const role = typeof body["role"] === "string" ? body["role"] : "";
      if (name.length === 0) fields["name"] = FIELD_ERRORS.name;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields["email"] = FIELD_ERRORS.email;
      if (password.length < 12) fields["password"] = FIELD_ERRORS.passwordShort;
      if (!["specialist", "coordinator", "billingLead"].includes(role)) {
        fields["role"] = FIELD_ERRORS.chooseOption;
      }
      if (Object.keys(fields).length > 0) {
        throw new ApiError(422, "invalid", "Check the highlighted fields.", fields);
      }
      const existing = await ctx.db.one<{ id: string }>(`SELECT id FROM staff WHERE lower(email) = $1`, [email]);
      if (existing) {
        throw new ApiError(409, "email_taken", copy("email_taken"));
      }
      const id = newId("staff");
      const hash = await hashPassword(password);
      await ctx.db.exec(`INSERT INTO staff (id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)`, [
        id,
        name,
        email,
        hash,
        role,
      ]);
      res2.status(201).json({ staff: { id, name, email, role } });
    });
  });

  router.get("/api/staff/:staffId", async (req, res) => {
    await run(ctx, req, res, ["owner"], async (req2, res2) => {
      const row = await ctx.db.one<{ id: string; name: string; email: string; role: string }>(
        `SELECT id, name, email, role FROM staff WHERE id = $1 AND removed_at IS NULL`,
        [param(req2, "staffId")]
      );
      if (!row) throw new ApiError(404, "not_found", copy("not_found"));
      res2.json({ staff: row });
    });
  });

  router.patch("/api/staff/:staffId", async (req, res) => {
    await run(ctx, req, res, ["owner"], async (req2, res2, person) => {
      const staffId = param(req2, "staffId");
      const row = await ctx.db.one<{ id: string; name: string; email: string; role: string; removed_at: Date | null }>(
        `SELECT id, name, email, role, removed_at FROM staff WHERE id = $1`,
        [staffId]
      );
      if (!row || row.removed_at) throw new ApiError(404, "not_found", copy("not_found"));
      const body = req2.body as { role?: unknown };
      const role = body.role;
      if (typeof role !== "string" || !["owner", "specialist", "coordinator", "billingLead"].includes(role)) {
        throw new ApiError(422, "invalid", "Check the highlighted fields.", { role: FIELD_ERRORS.chooseOption });
      }
      if (row.role === "owner" && role !== "owner") {
        throw new ApiError(409, "owner_stays", copy("owner_stays"));
      }
      await ctx.db.exec(`UPDATE staff SET role = $2 WHERE id = $1`, [staffId, role]);
      res2.json({ staff: { id: row.id, name: row.name, email: row.email, role } });
      void person;
    });
  });

  router.delete("/api/staff/:staffId", async (req, res) => {
    await run(ctx, req, res, ["owner"], async (req2, res2) => {
      const staffId = param(req2, "staffId");
      const row = await ctx.db.one<{ id: string; role: string; removed_at: Date | null }>(
        `SELECT id, role, removed_at FROM staff WHERE id = $1`,
        [staffId]
      );
      if (!row || row.removed_at) throw new ApiError(404, "not_found", copy("not_found"));
      if (row.role === "owner") {
        throw new ApiError(409, "owner_stays", copy("owner_stays"));
      }
      await ctx.db.exec(`UPDATE staff SET removed_at = now() WHERE id = $1`, [staffId]);
      await ctx.db.exec(`UPDATE sessions SET ended_at = now() WHERE person_kind = 'staff' AND person_id = $1 AND ended_at IS NULL`, [staffId]);
      res2.status(204).end();
    });
  });

  // ---- Members ----
  router.get("/api/members", async (req, res) => {
    await run(ctx, req, res, ["owner", "specialist", "coordinator", "billingLead"], async (req2, res2, person) => {
      const q = typeof req2.query["q"] === "string" ? req2.query["q"] : "";
      const rows = await ctx.db.query<{
        id: string;
        name: string;
        email: string;
        phone: string | null;
        date_of_birth: string | null;
        sex: string | null;
        state: string | null;
        time_zone: string | null;
        address_line1: string | null;
        address_line2: string | null;
        city: string | null;
        postal_code: string | null;
        gate_notes: string | null;
        account_state: string;
        erases_at: Date | null;
      }>(
        `SELECT id, name, email, phone, date_of_birth::text AS date_of_birth, sex, state, time_zone,
          address_line1, address_line2, city, postal_code, gate_notes, account_state, erases_at
         FROM members
         ${q ? "WHERE lower(name) LIKE '%' || lower($1) || '%' OR lower(email) LIKE '%' || lower($1) || '%'" : ""}
         ORDER BY name`,
        q ? [q] : []
      );
      const members = [];
      for (const row of rows) {
        const membership = await membershipFor(ctx.db, row.id);
        if (person.role === "billingLead") {
          members.push({
            id: row.id,
            name: row.account_state === "erased" ? null : row.name,
            email: row.account_state === "erased" ? null : row.email,
            accountState: row.account_state,
            membership: membershipViewOf(membership),
          });
          continue;
        }
        members.push(await fullMemberView(ctx, row, membership));
      }
      res2.json({ members });
    });
  });

  router.post("/api/members", async (req, res) => {
    await run(ctx, req, res, ["owner"], async (req2, res2) => {
      const body = req2.body as Record<string, unknown>;
      const fields: Record<string, string> = {};
      const name = typeof body["name"] === "string" ? body["name"].trim() : "";
      const email = typeof body["email"] === "string" ? body["email"].trim().toLowerCase() : "";
      const password = typeof body["password"] === "string" ? body["password"] : "";
      const dateOfBirth = typeof body["dateOfBirth"] === "string" ? body["dateOfBirth"] : "";
      const sex = typeof body["sex"] === "string" ? body["sex"] : "";
      const state = typeof body["state"] === "string" ? body["state"].toLowerCase() : "";
      const timeZone = typeof body["timeZone"] === "string" ? body["timeZone"] : "";
      const cadence = body["cadence"] === null ? null : body["cadence"];
      if (name.length === 0) fields["name"] = FIELD_ERRORS.name;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields["email"] = FIELD_ERRORS.email;
      if (password.length < 12) fields["password"] = FIELD_ERRORS.passwordShort;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) fields["dateOfBirth"] = FIELD_ERRORS.dateOfBirthFormat;
      if (!(state in SERVED_STATES) || !isServed(state)) fields["state"] = copy("state_not_served", { "State name": stateName(state) });
      if (sex !== "female" && sex !== "male") fields["sex"] = FIELD_ERRORS.chooseOption;
      if (!["newYork", "chicago", "denver", "phoenix", "losAngeles"].includes(timeZone)) {
        fields["timeZone"] = FIELD_ERRORS.chooseOption;
      }
      if (cadence !== null && cadence !== "sixMonths" && cadence !== "yearly") {
        fields["cadence"] = FIELD_ERRORS.chooseOption;
      }
      const address = body["address"];
      if (typeof address === "object" && address !== null) {
        const a = address as Record<string, unknown>;
        const zip = typeof a["postalCode"] === "string" ? a["postalCode"].trim() : "";
        if (!/^\d{5}$/.test(zip)) fields["postalCode"] = FIELD_ERRORS.postalCode;
      }
      if (Object.keys(fields).length > 0) {
        throw new ApiError(422, "invalid", "Check the highlighted fields.", fields);
      }
      const existing = await ctx.db.one<{ id: string }>(`SELECT id FROM members WHERE lower(email) = $1`, [email]);
      if (existing) throw new ApiError(409, "email_taken", copy("email_taken"));
      if (cadence !== null && !(await killBillReachable(ctx))) {
        throw paymentsUnavailable();
      }
      const id = newId("mem");
      const hash = await hashPassword(password);
      const a = (address ?? {}) as Record<string, unknown>;
      await ctx.db.exec(
        `INSERT INTO members (id, name, email, password_hash, phone, date_of_birth, sex, state, time_zone,
          address_line1, address_line2, city, postal_code, gate_notes, account_state)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'active')`,
        [
          id,
          name,
          email,
          hash,
          typeof body["phone"] === "string" ? body["phone"].trim() : null,
          dateOfBirth,
          sex,
          state,
          timeZone,
          typeof a["line1"] === "string" ? a["line1"].trim() : null,
          typeof a["line2"] === "string" ? a["line2"].trim() : null,
          typeof a["city"] === "string" ? a["city"].trim() : null,
          typeof a["postalCode"] === "string" ? a["postalCode"].trim() : null,
          typeof body["gateNotes"] === "string" && body["gateNotes"].trim().length > 0 ? body["gateNotes"].trim() : null,
        ]
      );
      await ctx.db.exec(`INSERT INTO memberships (member_id, state) VALUES ($1, 'free') ON CONFLICT DO NOTHING`, [id]);
      if (cadence === "sixMonths" || cadence === "yearly") {
        await joinPlus(ctx, { id, name, email }, cadence as Cadence);
      }
      const view = await memberSelfView(ctx, id);
      res2.status(201).json({ member: view });
    });
  });

  router.get("/api/members/:memberId", async (req, res) => {
    await run(ctx, req, res, ["owner", "specialist", "coordinator", "billingLead"], async (req2, res2, person) => {
      const memberId = param(req2, "memberId");
      const row = await loadMemberRow(ctx, memberId);
      if (!row) throw new ApiError(404, "not_found", copy("not_found"));
      const membership = await membershipFor(ctx.db, memberId);
      if (person.role === "billingLead") {
        res2.json({
          member: {
            id: row.id,
            name: row.account_state === "erased" ? null : row.name,
            email: row.account_state === "erased" ? null : row.email,
            accountState: row.account_state,
            membership: membershipViewOf(membership),
          },
        });
        return;
      }
      res2.json({ member: await fullMemberView(ctx, row, membership) });
    });
  });

  router.patch("/api/members/:memberId", async (req, res) => {
    await run(ctx, req, res, ["owner"], async (req2, res2) => {
      const memberId = param(req2, "memberId");
      const row = await loadMemberRow(ctx, memberId);
      if (!row) throw new ApiError(404, "not_found", copy("not_found"));
      const body = req2.body as Record<string, unknown>;
      const fields: Record<string, string> = {};
      if (typeof body["address"] === "object" && body["address"] !== null) {
        const a = body["address"] as Record<string, unknown>;
        const zip = typeof a["postalCode"] === "string" ? a["postalCode"].trim() : "";
        if (!/^\d{5}$/.test(zip)) fields["postalCode"] = FIELD_ERRORS.postalCode;
      }
      if (Object.keys(fields).length > 0) {
        throw new ApiError(422, "invalid", "Check the highlighted fields.", fields);
      }
      const a = (body["address"] ?? {}) as Record<string, unknown>;
      await ctx.db.exec(
        `UPDATE members SET
          phone = COALESCE($2, phone),
          gate_notes = COALESCE($3, gate_notes),
          address_line1 = COALESCE($4, address_line1),
          address_line2 = COALESCE($5, address_line2),
          city = COALESCE($6, city),
          postal_code = COALESCE($7, postal_code)
         WHERE id = $1`,
        [
          memberId,
          typeof body["phone"] === "string" ? body["phone"] : null,
          typeof body["gateNotes"] === "string" ? body["gateNotes"] : null,
          typeof a["line1"] === "string" ? a["line1"] : null,
          typeof a["line2"] === "string" ? a["line2"] : null,
          typeof a["city"] === "string" ? a["city"] : null,
          typeof a["postalCode"] === "string" ? a["postalCode"] : null,
        ]
      );
      const view = await memberSelfView(ctx, memberId);
      res2.json({ member: view });
    });
  });

  router.post("/api/members/:memberId/restore", async (req, res) => {
    await run(ctx, req, res, ["owner"], async (req2, res2) => {
      const memberId = param(req2, "memberId");
      const row = await loadMemberRow(ctx, memberId);
      if (!row) throw new ApiError(404, "not_found", copy("not_found"));
      const erasurePassed = row.erases_at !== null && Date.now() >= row.erases_at.getTime();
      if (row.account_state === "erased" || (erasurePassed && row.account_state === "erasing")) {
        throw new ApiError(409, "erasure_started", copy("restore_after_wait"));
      }
      if (row.account_state !== "closing" && row.account_state !== "erasing") {
        throw new ApiError(409, "not_closing", copy("not_closing"));
      }
      if (!(await killBillReachable(ctx))) {
        throw paymentsUnavailable();
      }
      await ctx.db.exec(
        `UPDATE members SET account_state = 'active', erases_at = NULL, closure_requested_at = NULL WHERE id = $1`,
        [memberId]
      );
      const { restoreMembershipAfterClosure } = await import("./membership-service.js");
      await restoreMembershipAfterClosure(ctx, memberId);
      const view = await memberSelfView(ctx, memberId);
      res2.json({ member: view, message: copy("account_restored", { "member name": row.name }) });
    });
  });

  // ---- Range changes ----
  router.get("/api/ranges", async (req, res) => {
    await run(ctx, req, res, ["owner", "specialist", "coordinator"], async (req2, res2) => {
      const marker = typeof req2.query["marker"] === "string" ? req2.query["marker"] : "";
      const on = typeof req2.query["on"] === "string" ? req2.query["on"] : "";
      if (!marker || !/^\d{4}-\d{2}-\d{2}$/.test(on)) {
        throw new ApiError(422, "invalid", "Check the highlighted fields.", { marker: FIELD_ERRORS.chooseOption });
      }
      const rows = await ctx.db.query<{
        effective_from: string;
        sex: string;
        age_band: string;
        low: string;
        high: string;
        optimal_low: string;
        optimal_high: string;
      }>(
        `SELECT v.effective_from::text AS effective_from, r.sex, r.age_band, r.low, r.high, r.optimal_low, r.optimal_high
         FROM range_versions v
         JOIN range_rows r ON r.version_id = v.id
         WHERE v.marker = $1 AND v.effective_from::date <= $2::date
         ORDER BY v.effective_from DESC
         LIMIT 6`,
        [marker, on]
      );
      res2.json({
        marker,
        effectiveFrom: rows[0]?.effective_from ?? null,
        ranges: rows.map((row) => ({
          sex: row.sex,
          ageBand: row.age_band,
          low: row.low,
          high: row.high,
          optimalLow: row.optimal_low,
          optimalHigh: row.optimal_high,
        })),
      });
    });
  });

  router.get("/api/range-changes", async (req, res) => {
    await run(ctx, req, res, ["owner"], async (_req, res2) => {
      const rows = await ctx.db.query<{
        id: string;
        marker: string;
        effective_from: string;
        created_by: string;
        created_at: Date;
      }>(
        `SELECT id, marker, effective_from::text AS effective_from, created_by, created_at
         FROM range_versions ORDER BY effective_from DESC`
      );
      res2.json({
        changes: rows.map((row) => ({
          id: row.id,
          marker: row.marker,
          effectiveFrom: row.effective_from,
          createdBy: row.created_by,
          createdAt: instantZ(row.created_at),
        })),
      });
    });
  });

  router.post("/api/range-changes", async (req, res) => {
    await run(ctx, req, res, ["owner"], async (req2, res2, person) => {
      const body = req2.body as Record<string, unknown>;
      const marker = typeof body["marker"] === "string" ? body["marker"] : "";
      const effectiveFrom = typeof body["effectiveFrom"] === "string" ? body["effectiveFrom"] : "";
      const ranges = Array.isArray(body["ranges"]) ? body["ranges"] : [];
      const fields: Record<string, string> = {};
      if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
        fields["effectiveFrom"] = FIELD_ERRORS.rangesDate;
      } else {
        const phoenixToday = DateTime.now().setZone("America/Phoenix").toFormat("yyyy-MM-dd");
        if (effectiveFrom < phoenixToday) {
          fields["effectiveFrom"] = FIELD_ERRORS.rangesDate;
        }
      }
      if (ranges.length !== 6) {
        fields["ranges"] = FIELD_ERRORS.rangesAllSix;
      }
      if (Object.keys(fields).length > 0) {
        throw new ApiError(422, "invalid", "Check the highlighted fields.", fields);
      }
      const existing = await ctx.db.one<{ id: string }>(
        `SELECT id FROM range_versions WHERE marker = $1 AND effective_from = $2::date`,
        [marker, effectiveFrom]
      );
      const markerDef = (await import("../shared/markers.js")).MARKER_BY_ID.get(marker);
      if (existing) {
        throw new ApiError(409, "ranges_already_change", copy("ranges_already_change", {
          marker: markerDef?.name ?? marker,
          date: DateTime.fromISO(effectiveFrom).toFormat("ccc dd MMM yyyy"),
        }));
      }
      for (const row of ranges) {
        if (typeof row !== "object" || row === null) {
          throw new ApiError(422, "invalid", "Check the highlighted fields.", { "ranges.0": FIELD_ERRORS.rangesBounds });
        }
        const r = row as Record<string, unknown>;
        const parsed = {
          low: String(r["low"] ?? ""),
          high: String(r["high"] ?? ""),
          optimalLow: String(r["optimalLow"] ?? ""),
          optimalHigh: String(r["optimalHigh"] ?? ""),
        };
        if (!rangeBoundsValid(parsed)) {
          throw new ApiError(422, "invalid", "Check the highlighted fields.", {
            "ranges.0": FIELD_ERRORS.rangesBounds,
          });
        }
      }
      const versionId = newId("rngver");
      await ctx.db.exec(
        `INSERT INTO range_versions (id, marker, effective_from, created_by, created_at)
         VALUES ($1, $2, $3::date, $4, now())`,
        [versionId, marker, effectiveFrom, person.name]
      );
      for (const row of ranges) {
        const r = row as Record<string, unknown>;
        await ctx.db.exec(
          `INSERT INTO range_rows (version_id, sex, age_band, low, high, optimal_low, optimal_high)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            versionId,
            String(r["sex"] ?? ""),
            String(r["ageBand"] ?? ""),
            String(r["low"] ?? ""),
            String(r["high"] ?? ""),
            String(r["optimalLow"] ?? ""),
            String(r["optimalHigh"] ?? ""),
          ]
        );
      }
      res2.status(201).json({
        change: {
          id: versionId,
          marker,
          effectiveFrom,
          createdBy: person.name,
          createdAt: instantZ(new Date()),
        },
      });
    });
  });

  // ---- Ingredients, blends, plans ----
  router.get("/api/ingredients", async (req, res) => {
    await run(ctx, req, res, ["owner", "specialist"], async (_req, res2) => {
      const { INGREDIENTS, strengthLabel } = await import("../shared/blends.js");
      res2.json({
        ingredients: INGREDIENTS.map((ingredient) => ({
          id: ingredient.id,
          name: ingredient.name,
          strength: ingredient.strength,
          strengthLabel: strengthLabel(ingredient),
          mcg: ingredient.mcg,
          time: ingredient.time,
          priceCentsPerCapsule: ingredient.priceCentsPerCapsule,
        })),
      });
    });
  });

  router.post("/api/members/:memberId/blends/preview", async (req, res) => {
    await run(ctx, req, res, ["owner", "specialist"], async (req2, res2) => {
      const memberId = param(req2, "memberId");
      const core = await memberCore(ctx.db, memberId);
      if (!core) throw new ApiError(404, "not_found", copy("not_found"));
      const items = await parseBlendItems(ctx, req2);
      const packed = packBlend(items);
      const overflow = overflowingPacket(packed);
      if (overflow) {
        throw new ApiError(
          422,
          "packet_full",
          copy(overflow === "morning" ? "packet_full_morning" : "packet_full_evening")
        );
      }
      res2.json({ blend: packedBlendView(packed) });
    });
  });

  router.post("/api/members/:memberId/blends", async (req, res) => {
    await run(ctx, req, res, ["owner", "specialist"], async (req2, res2, person) => {
      const memberId = param(req2, "memberId");
      const core = await memberCore(ctx.db, memberId);
      if (!core) throw new ApiError(404, "not_found", copy("not_found"));
      const items = await parseBlendItems(ctx, req2);
      const packed = packBlend(items);
      const overflow = overflowingPacket(packed);
      if (overflow) {
        throw new ApiError(
          422,
          "packet_full",
          copy(overflow === "morning" ? "packet_full_morning" : "packet_full_evening")
        );
      }
      const id = newId("blend");
      await ctx.db.exec(
        `INSERT INTO blends (id, member_id, items, morning_capsules, evening_capsules, list_price_cents, member_price_cents, saved_by, saved_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
        [
          id,
          memberId,
          JSON.stringify(items),
          packed.morningCapsules,
          packed.eveningCapsules,
          packed.listPriceCents,
          packed.memberPriceCents,
          person.name,
        ]
      );
      const row = await ctx.db.one<{
        id: string;
        member_id: string;
        items: unknown;
        morning_capsules: number;
        evening_capsules: number;
        list_price_cents: number;
        member_price_cents: number;
        saved_by: string;
        saved_at: Date;
      }>(
        `SELECT id, member_id, items, morning_capsules, evening_capsules, list_price_cents, member_price_cents, saved_by, saved_at
         FROM blends WHERE id = $1`,
        [id]
      );
      if (!row) throw new ApiError(500, "internal_error", "Something went wrong.");
      res2.status(201).json({ blend: blendRowView(row) });
    });
  });

  router.get("/api/members/:memberId/blends", async (req, res) => {
    await run(ctx, req, res, ["owner", "specialist"], async (req2, res2) => {
      const memberId = param(req2, "memberId");
      const core = await memberCore(ctx.db, memberId);
      if (!core) throw new ApiError(404, "not_found", copy("not_found"));
      const rows = await ctx.db.query<{
        id: string;
        member_id: string;
        items: unknown;
        morning_capsules: number;
        evening_capsules: number;
        list_price_cents: number;
        member_price_cents: number;
        saved_by: string;
        saved_at: Date;
      }>(
        `SELECT id, member_id, items, morning_capsules, evening_capsules, list_price_cents, member_price_cents, saved_by, saved_at
         FROM blends WHERE member_id = $1 ORDER BY saved_at DESC`,
        [memberId]
      );
      res2.json({ blends: rows.map(blendRowView) });
    });
  });

  router.post("/api/members/:memberId/plans", async (req, res) => {
    await run(ctx, req, res, ["owner", "specialist"], async (req2, res2, person) => {
      const memberId = param(req2, "memberId");
      const core = await memberCore(ctx.db, memberId);
      if (!core) throw new ApiError(404, "not_found", copy("not_found"));
      const body = req2.body as Record<string, unknown>;
      const sections = body["sections"] as Record<string, unknown> | undefined;
      const fields: Record<string, string> = {};
      const parsed: Record<string, string> = {};
      for (const key of ["nutrition", "movement", "sleep", "supplements"]) {
        const value = sections?.[key];
        if (typeof value !== "string") {
          fields[`sections.${key}`] = FIELD_ERRORS.sectionTooLong;
          continue;
        }
        if ([...value].length > 20000) {
          fields[`sections.${key}`] = FIELD_ERRORS.sectionTooLong;
          continue;
        }
        parsed[key] = value;
      }
      if (Object.keys(fields).length > 0) {
        throw new ApiError(422, "invalid", "Check the highlighted fields.", fields);
      }
      const basedOnPlanId = typeof body["basedOnPlanId"] === "string" ? body["basedOnPlanId"] : null;
      if (basedOnPlanId) {
        const based = await ctx.db.one<{ id: string; member_id: string; state: string }>(
          `SELECT id, member_id, state FROM longevity_plans WHERE id = $1`,
          [basedOnPlanId]
        );
        if (!based || based.member_id !== memberId) {
          throw new ApiError(404, "not_found", copy("not_found"));
        }
        const latest = await ctx.db.one<{ id: string }>(
          `SELECT id FROM longevity_plans WHERE member_id = $1 AND state = 'published' ORDER BY published_at DESC LIMIT 1`,
          [memberId]
        );
        if (!latest || latest.id !== basedOnPlanId) {
          const newer = await ctx.db.one<{ published_by: string; published_at: Date }>(
            `SELECT published_by, published_at FROM longevity_plans WHERE member_id = $1 AND state = 'published' ORDER BY published_at DESC LIMIT 1`,
            [memberId]
          );
          throw new ApiError(412, "stale", copy("newer_plan", {
            name: newer?.published_by ?? "",
            "HH:MM": newer ? DateTime.fromJSDate(newer.published_at).setZone("America/Phoenix").toFormat("HH:mm") : "",
          }));
        }
      }
      const id = newId("plan");
      await ctx.db.exec(
        `INSERT INTO longevity_plans (id, member_id, state, based_on_plan_id, nutrition, movement, sleep, supplements, updated_at)
         VALUES ($1, $2, 'draft', $3, $4, $5, $6, $7, now())`,
        [id, memberId, basedOnPlanId, parsed["nutrition"], parsed["movement"], parsed["sleep"], parsed["supplements"]]
      );
      const plan = await planRowView(ctx, id);
      res2.status(201).json({ plan });
    });
  });

  router.get("/api/members/:memberId/plans", async (req, res) => {
    await run(ctx, req, res, ["owner", "specialist"], async (req2, res2) => {
      const memberId = param(req2, "memberId");
      const core = await memberCore(ctx.db, memberId);
      if (!core) throw new ApiError(404, "not_found", copy("not_found"));
      const rows = await ctx.db.query<{ id: string }>(
        `SELECT id FROM longevity_plans WHERE member_id = $1 ORDER BY COALESCE(published_at, updated_at) DESC`,
        [memberId]
      );
      const plans = [];
      for (const row of rows) {
        plans.push(await planRowView(ctx, row.id));
      }
      res2.json({ plans });
    });
  });

  router.get("/api/longevity-plans/:planId", async (req, res) => {
    await run(ctx, req, res, ["owner", "specialist"], async (req2, res2) => {
      const planId = param(req2, "planId");
      const row = await ctx.db.one<{ member_id: string }>(`SELECT member_id FROM longevity_plans WHERE id = $1`, [planId]);
      if (!row) throw new ApiError(404, "not_found", copy("not_found"));
      res2.json({ plan: await planRowView(ctx, planId) });
    });
  });

  router.put("/api/longevity-plans/:planId", async (req, res) => {
    await run(ctx, req, res, ["owner", "specialist"], async (req2, res2) => {
      const planId = param(req2, "planId");
      const plan = await ctx.db.one<{
        id: string;
        member_id: string;
        state: string;
        based_on_plan_id: string | null;
      }>(`SELECT id, member_id, state, based_on_plan_id FROM longevity_plans WHERE id = $1`, [planId]);
      if (!plan) throw new ApiError(404, "not_found", copy("not_found"));
      if (plan.state === "published") {
        throw new ApiError(409, "already_published", "This plan is already published.");
      }
      const body = req2.body as Record<string, unknown>;
      const sections = body["sections"] as Record<string, unknown> | undefined;
      const fields: Record<string, string> = {};
      const parsed: Record<string, string> = {};
      for (const key of ["nutrition", "movement", "sleep", "supplements"]) {
        const value = sections?.[key];
        if (typeof value !== "string" || [...value].length > 20000) {
          fields[`sections.${key}`] = FIELD_ERRORS.sectionTooLong;
          continue;
        }
        parsed[key] = value;
      }
      if (Object.keys(fields).length > 0) {
        throw new ApiError(422, "invalid", "Check the highlighted fields.", fields);
      }
      const latest = await ctx.db.one<{ id: string; published_by: string; published_at: Date }>(
        `SELECT id, published_by, published_at FROM longevity_plans WHERE member_id = $1 AND state = 'published' ORDER BY published_at DESC LIMIT 1`,
        [plan.member_id]
      );
      if (plan.based_on_plan_id && (!latest || latest.id !== plan.based_on_plan_id)) {
        throw new ApiError(412, "stale", copy("newer_plan", {
          name: latest?.published_by ?? "",
          "HH:MM": latest ? DateTime.fromJSDate(latest.published_at).setZone("America/Phoenix").toFormat("HH:mm") : "",
        }));
      }
      await ctx.db.exec(
        `UPDATE longevity_plans SET nutrition = $2, movement = $3, sleep = $4, supplements = $5, updated_at = now() WHERE id = $1`,
        [planId, parsed["nutrition"], parsed["movement"], parsed["sleep"], parsed["supplements"]]
      );
      res2.json({ plan: await planRowView(ctx, planId) });
    });
  });

  router.post("/api/longevity-plans/:planId/publish", async (req, res) => {
    await run(ctx, req, res, ["owner", "specialist"], async (req2, res2, person) => {
      const planId = param(req2, "planId");
      const plan = await ctx.db.one<{ id: string; member_id: string; state: string; based_on_plan_id: string | null }>(
        `SELECT id, member_id, state, based_on_plan_id FROM longevity_plans WHERE id = $1`,
        [planId]
      );
      if (!plan) throw new ApiError(404, "not_found", copy("not_found"));
      if (plan.state === "published") {
        throw new ApiError(409, "already_published", "This plan is already published.");
      }
      const latest = await ctx.db.one<{ id: string; published_by: string; published_at: Date }>(
        `SELECT id, published_by, published_at FROM longevity_plans WHERE member_id = $1 AND state = 'published' ORDER BY published_at DESC LIMIT 1`,
        [plan.member_id]
      );
      if (plan.based_on_plan_id && (!latest || latest.id !== plan.based_on_plan_id)) {
        throw new ApiError(412, "stale", copy("newer_plan", {
          name: latest?.published_by ?? "",
          "HH:MM": latest ? DateTime.fromJSDate(latest.published_at).setZone("America/Phoenix").toFormat("HH:mm") : "",
        }));
      }
      const blend = await ctx.db.one<{ id: string }>(
        `SELECT id FROM blends WHERE member_id = $1 ORDER BY saved_at DESC LIMIT 1`,
        [plan.member_id]
      );
      await ctx.db.exec(
        `UPDATE longevity_plans SET state = 'published', published_at = now(), published_by = $2, blend_id = $3, updated_at = now()
         WHERE id = $1`,
        [planId, person.name, blend?.id ?? null]
      );
      res2.json({ plan: await planRowView(ctx, planId) });
    });
  });

  // ---- Messages ----
  router.get("/api/message-threads", async (req, res) => {
    await run(ctx, req, res, ["owner", "specialist", "coordinator"], async (_req, res2) => {
      const rows = await ctx.db.query<{
        member_id: string;
        member_name: string;
        state: string;
        last_message_at: Date;
      }>(
        `SELECT t.member_id, m.name AS member_name, t.state, t.last_message_at
         FROM message_threads t
         JOIN members m ON m.id = t.member_id
         ORDER BY (t.state = 'open') DESC, t.last_message_at ASC`
      );
      res2.json({
        threads: rows.map((row) => ({
          memberId: row.member_id,
          memberName: row.member_name,
          state: row.state,
          lastMessageAt: instantZ(row.last_message_at),
        })),
      });
    });
  });

  router.get("/api/members/:memberId/messages", async (req, res) => {
    await run(ctx, req, res, ["owner", "specialist", "coordinator"], async (req2, res2) => {
      const memberId = param(req2, "memberId");
      const core = await memberCore(ctx.db, memberId);
      if (!core) throw new ApiError(404, "not_found", copy("not_found"));
      const { listMessages } = await import("./routes-member.js");
      res2.json({ messages: await listMessages(ctx, memberId) });
    });
  });

  router.post("/api/members/:memberId/messages", async (req, res) => {
    await run(ctx, req, res, ["owner", "specialist", "coordinator"], async (req2, res2, person) => {
      const memberId = param(req2, "memberId");
      const core = await memberCore(ctx.db, memberId);
      if (!core) throw new ApiError(404, "not_found", copy("not_found"));
      const result = await sendMessage(ctx, memberId, req2, person.role, person.name, person.id);
      res2.status(result.status).json(result.body);
    });
  });

  router.post("/api/members/:memberId/messages/handled", async (req, res) => {
    await run(ctx, req, res, ["owner", "specialist", "coordinator"], async (req2, res2) => {
      const memberId = param(req2, "memberId");
      const core = await memberCore(ctx.db, memberId);
      if (!core) throw new ApiError(404, "not_found", copy("not_found"));
      await markThreadHandled(ctx, memberId);
      res2.json({ thread: { state: "handled" } });
    });
  });

  // ---- Staff results ----
  router.get("/api/members/:memberId/results", async (req, res) => {
    await run(ctx, req, res, ["owner", "specialist", "coordinator"], async (req2, res2) => {
      const memberId = param(req2, "memberId");
      const core = await memberCore(ctx.db, memberId);
      if (!core) throw new ApiError(404, "not_found", copy("not_found"));
      const { memberResultsView } = await import("./results-service.js");
      res2.json({ markers: await memberResultsView(ctx, memberId, false) });
    });
  });

  // ---- Receipts ----
  router.get("/api/receipts", async (req, res) => {
    await run(ctx, req, res, ["owner", "billingLead"], async (req2, res2) => {
      const month = typeof req2.query["month"] === "string" ? req2.query["month"] : "";
      const cursor = typeof req2.query["cursor"] === "string" ? req2.query["cursor"] : null;
      if (!/^\d{4}-\d{2}$/.test(month)) {
        throw new ApiError(422, "invalid", "Check the highlighted fields.", { month: FIELD_ERRORS.monthFormat });
      }
      let afterNumber: string | null = null;
      if (cursor) {
        const row = await ctx.db.one<{ number: string }>(`SELECT number FROM receipts WHERE id = $1`, [cursor]);
        if (!row) {
          throw new ApiError(422, "invalid", "Check the highlighted fields.", { cursor: FIELD_ERRORS.cursorInvalid });
        }
        afterNumber = row.number;
      }
      const rows = await ctx.db.query<{
        id: string;
        number: string;
        member_name: string | null;
        paid_at: Date;
        paid_date: string;
        amount_cents: number;
        currency: string;
      }>(
        `SELECT id, number, member_name, paid_at, paid_date::text AS paid_date, amount_cents, currency
         FROM receipts
         WHERE paid_date >= $1::date AND paid_date < ($1::date + interval '1 month')
           ${afterNumber ? "AND number > $2" : ""}
         ORDER BY number ASC
         LIMIT 26`,
        afterNumber ? [`${month}-01`, afterNumber] : [`${month}-01`]
      );
      const page = rows.slice(0, 25);
      res2.json({
        receipts: page.map((row) => ({
          id: row.id,
          number: row.number,
          memberName: row.member_name,
          paidAt: instantZ(row.paid_at),
          paidDate: row.paid_date,
          amountCents: row.amount_cents,
          currency: row.currency,
        })),
        nextCursor: rows.length > 25 ? (page[24]?.id ?? null) : null,
      });
    });
  });

  router.get("/api/receipts/:receiptId", async (req, res) => {
    await run(ctx, req, res, ["owner", "billingLead", "member"], async (req2, res2, person) => {
      const receiptId = param(req2, "receiptId");
      const row = await ctx.db.one<{
        id: string;
        number: string;
        member_id: string;
        member_name: string | null;
        invoice_id: string;
        paid_at: Date;
        paid_date: string;
        amount_cents: number;
        currency: string;
        items: unknown;
      }>(
        `SELECT id, number, member_id, member_name, invoice_id, paid_at, paid_date::text AS paid_date, amount_cents, currency, items
         FROM receipts WHERE id = $1`,
        [receiptId]
      );
      if (!row) throw new ApiError(404, "not_found", copy("not_found"));
      if (person.role === "member" && row.member_id !== person.id) {
        throw new ApiError(404, "not_found", copy("not_found"));
      }
      const { PRACTICE } = await import("../shared/constants.js");
      res2.json({
        receipt: {
          id: row.id,
          number: row.number,
          memberName: row.member_name,
          paidAt: instantZ(row.paid_at),
          paidDate: row.paid_date,
          amountCents: row.amount_cents,
          currency: row.currency,
          invoiceId: row.invoice_id,
          items: row.items,
          practice: {
            name: PRACTICE.name,
            address: PRACTICE.address,
            taxNumber: PRACTICE.taxNumber,
          },
        },
      });
    });
  });

  // ---- Attachments ----
  router.get("/api/attachments/:attachmentId", async (req, res) => {
    await run(ctx, req, res, ["owner", "specialist", "coordinator", "member"], async (req2, res2, person) => {
      const attachmentId = param(req2, "attachmentId");
      const row = await ctx.db.one<{
        member_id: string;
        kind: string;
        object_key_original: string;
        object_key_clean: string | null;
      }>(`SELECT member_id, kind, object_key_original, object_key_clean FROM attachments WHERE id = $1`, [
        attachmentId,
      ]);
      if (!row) throw new ApiError(404, "not_found", copy("not_found"));
      if (person.role === "member" && row.member_id !== person.id) {
        throw new ApiError(404, "not_found", copy("not_found"));
      }
      const key = row.kind === "pdf" ? row.object_key_original : row.object_key_clean ?? row.object_key_original;
      const bytes = await ctx.store.get(key);
      if (bytes === null || bytes === "unavailable") {
        throw new ApiError(503, "attachment_store_unavailable", copy("attachment_store_unavailable"));
      }
      res2.setHeader("Content-Type", row.kind === "pdf" ? "application/pdf" : "image/jpeg");
      res2.send(bytes);
    });
  });

  router.get("/api/attachments/:attachmentId/original", async (req, res) => {
    await run(ctx, req, res, ["owner", "specialist", "coordinator", "member"], async (req2, res2, person) => {
      const attachmentId = param(req2, "attachmentId");
      const row = await ctx.db.one<{ member_id: string; kind: string; object_key_original: string }>(
        `SELECT member_id, kind, object_key_original FROM attachments WHERE id = $1`,
        [attachmentId]
      );
      if (!row) throw new ApiError(404, "not_found", copy("not_found"));
      if (person.role === "member" && row.member_id !== person.id) {
        throw new ApiError(404, "not_found", copy("not_found"));
      }
      const bytes = await ctx.store.get(row.object_key_original);
      if (bytes === null || bytes === "unavailable") {
        throw new ApiError(503, "attachment_store_unavailable", copy("attachment_store_unavailable"));
      }
      res2.setHeader("Content-Type", row.kind === "pdf" ? "application/pdf" : row.kind === "jpeg" ? "image/jpeg" : "image/png");
      res2.send(bytes);
    });
  });
}

async function parseBlendItems(ctx: AppContext, req: Request): Promise<{ ingredient: string; capsulesPerDay: number }[]> {
  const body = req.body as { items?: unknown };
  const raw = Array.isArray(body.items) ? body.items : [];
  const fields: Record<string, string> = {};
  const items: { ingredient: string; capsulesPerDay: number }[] = [];
  raw.forEach((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      fields[`items.${index}.ingredient`] = FIELD_ERRORS.ingredientChoice;
      return;
    }
    const record = entry as Record<string, unknown>;
    const ingredient = record["ingredient"];
    const capsules = record["capsulesPerDay"];
    if (typeof ingredient !== "string" || !INGREDIENT_BY_ID.has(ingredient)) {
      fields[`items.${index}.ingredient`] = FIELD_ERRORS.ingredientChoice;
      return;
    }
    if (items.some((item) => item.ingredient === ingredient)) {
      fields[`items.${index}.ingredient`] = FIELD_ERRORS.ingredientOnce;
      return;
    }
    const perDay = Number(capsules);
    if (!Number.isInteger(perDay) || perDay < 1) {
      fields[`items.${index}.capsulesPerDay`] = FIELD_ERRORS.capsulesWhole;
      return;
    }
    items.push({ ingredient, capsulesPerDay: perDay });
  });
  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, "invalid", "Check the highlighted fields.", fields);
  }
  return items;
}

function packedBlendView(packed: ReturnType<typeof packBlend>) {
  return {
    items: packed.items,
    morningCapsules: packed.morningCapsules,
    eveningCapsules: packed.eveningCapsules,
    listPriceCents: packed.listPriceCents,
    memberPriceCents: packed.memberPriceCents,
  };
}

function blendRowView(row: {
  id: string;
  member_id: string;
  items: unknown;
  morning_capsules: number;
  evening_capsules: number;
  list_price_cents: number;
  member_price_cents: number;
  saved_by: string;
  saved_at: Date;
}) {
  const items = Array.isArray(row.items) ? (row.items as { ingredient: string; capsulesPerDay: number }[]) : [];
  const packed = packBlend(items);
  return {
    id: row.id,
    memberId: row.member_id,
    items: packed.items,
    morningCapsules: row.morning_capsules,
    eveningCapsules: row.evening_capsules,
    listPriceCents: row.list_price_cents,
    memberPriceCents: row.member_price_cents,
    savedBy: row.saved_by,
    savedAt: instantZ(row.saved_at),
  };
}

async function planRowView(ctx: AppContext, planId: string) {
  const row = await ctx.db.one<{
    id: string;
    member_id: string;
    state: string;
    based_on_plan_id: string | null;
    nutrition: string;
    movement: string;
    sleep: string;
    supplements: string;
    published_at: Date | null;
    published_by: string | null;
    blend_id: string | null;
    updated_at: Date;
  }>(
    `SELECT id, member_id, state, based_on_plan_id, nutrition, movement, sleep, supplements,
      published_at, published_by, blend_id, updated_at FROM longevity_plans WHERE id = $1`,
    [planId]
  );
  if (!row) throw new ApiError(404, "not_found", copy("not_found"));
  let blend = null;
  if (row.blend_id) {
    const blendRow = await ctx.db.one<{
      id: string;
      member_id: string;
      items: unknown;
      morning_capsules: number;
      evening_capsules: number;
      list_price_cents: number;
      member_price_cents: number;
      saved_by: string;
      saved_at: Date;
    }>(
      `SELECT id, member_id, items, morning_capsules, evening_capsules, list_price_cents, member_price_cents, saved_by, saved_at
       FROM blends WHERE id = $1`,
      [row.blend_id]
    );
    if (blendRow) blend = blendRowView(blendRow);
  }
  return {
    id: row.id,
    memberId: row.member_id,
    state: row.state,
    basedOnPlanId: row.based_on_plan_id,
    sections: {
      nutrition: row.nutrition,
      movement: row.movement,
      sleep: row.sleep,
      supplements: row.supplements,
    },
    publishedAt: row.published_at ? instantZ(row.published_at) : null,
    publishedBy: row.published_by,
    blend,
    updatedAt: instantZ(row.updated_at),
  };
}

async function loadMemberRow(ctx: AppContext, memberId: string) {
  return ctx.db.one<{
    id: string;
    name: string;
    email: string;
    phone: string | null;
    date_of_birth: string | null;
    sex: string | null;
    state: string | null;
    time_zone: string | null;
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    postal_code: string | null;
    gate_notes: string | null;
    account_state: string;
    erases_at: Date | null;
  }>(
    `SELECT id, name, email, phone, date_of_birth::text AS date_of_birth, sex, state, time_zone,
      address_line1, address_line2, city, postal_code, gate_notes, account_state, erases_at
     FROM members WHERE id = $1`,
    [memberId]
  );
}

function membershipViewOf(membership: Awaited<ReturnType<typeof membershipFor>>) {
  if (!membership) {
    return { state: "free", cadence: null, renewalDate: null, plusUntil: null, pendingCadence: null, pendingFrom: null };
  }
  return {
    state: membership.state,
    cadence: membership.cadence,
    renewalDate: membership.renewal_date,
    plusUntil: membership.plus_until,
    pendingCadence: membership.pending_cadence,
    pendingFrom: membership.pending_from,
  };
}

async function fullMemberView(ctx: AppContext, row: NonNullable<Awaited<ReturnType<typeof loadMemberRow>>>, membership: Awaited<ReturnType<typeof membershipFor>>) {
  if (row.account_state === "erased") {
    return {
      id: row.id,
      name: "Erased member",
      email: null,
      phone: null,
      dateOfBirth: null,
      sex: null,
      state: null,
      timeZone: null,
      address: null,
      gateNotes: null,
      accountState: row.account_state,
      erasesAt: row.erases_at ? instantZ(row.erases_at) : null,
      membership: membershipViewOf(membership),
    };
  }
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    dateOfBirth: row.date_of_birth,
    sex: row.sex,
    state: row.state,
    timeZone: row.time_zone,
    address:
      row.address_line1 || row.city || row.postal_code
        ? {
            line1: row.address_line1 ?? "",
            line2: row.address_line2 ?? "",
            city: row.city ?? "",
            postalCode: row.postal_code ?? "",
          }
        : null,
    gateNotes: row.gate_notes,
    accountState: row.account_state,
    erasesAt: row.erases_at ? instantZ(row.erases_at) : null,
    membership: membershipViewOf(membership),
  };
}

