import type { Router, Request, Response } from "express";
import type { AppContext } from "./route-context.js";
import type { Person } from "./person.js";
import { ApiError, sendError } from "./errors.js";
import { requireSession, endSession, readSessionCookie } from "./session.js";
import { copy, FIELD_ERRORS } from "../shared/copy.js";
import { memberSelfView } from "./routes-public.js";
import { membershipViewFor, joinPlusAction, changeCadenceAction, cancelPlusAction, ensureMembershipCurrent } from "./membership-service.js";
import { membershipFor } from "./memberships.js";
import { memberCore, requireNotClosing } from "./memberships.js";
import { sendMessage } from "./message-ops.js";
import { resultsHistoryCsv } from "./results-history.js";
import { memberResultsView } from "./results-service.js";
import { DateTime } from "luxon";
import { instantZ, localTimeIn, zoneFor } from "../shared/time.js";
import type { TimeZoneKey } from "../shared/enums.js";
import { packBlend } from "../shared/blends.js";
import { newId } from "./crypto.js";

export function registerMemberRoutes(router: Router, ctx: AppContext): void {

  router.get("/api/me", async (req, res) => {
    await run(ctx, req, res, ["member"], async (req2, res2, person) => {
      await ensureMembershipCurrent(ctx, person.id);
      res2.json({ member: await memberSelfView(ctx, person.id) });
    });
  });

  router.patch("/api/me", async (req, res) => {
    await run(ctx, req, res, ["member"], async (req2, res2, person) => {
      const core = await memberCore(ctx.db, person.id);
      if (!core) throw new ApiError(404, "not_found", copy("not_found"));
      requireNotClosing(core.account_state);
      const body = req2.body as Record<string, unknown>;
      const fields: Record<string, string> = {};
      const gateNotes = typeof body["gateNotes"] === "string" ? body["gateNotes"] : undefined;
      let line1: string | null = null;
      let line2: string | null = null;
      let city: string | null = null;
      let postalCode: string | null = null;
      const address = body["address"];
      if (typeof address === "object" && address !== null) {
        const a = address as Record<string, unknown>;
        line1 = typeof a["line1"] === "string" ? a["line1"].trim() : "";
        line2 = typeof a["line2"] === "string" ? a["line2"].trim() : "";
        city = typeof a["city"] === "string" ? a["city"].trim() : "";
        const zip = typeof a["postalCode"] === "string" ? a["postalCode"].trim() : "";
        if (!/^\d{5}$/.test(zip)) {
          fields["postalCode"] = FIELD_ERRORS.postalCode;
        } else {
          postalCode = zip;
        }
      }
      if (Object.keys(fields).length > 0) {
        throw new ApiError(422, "invalid", "Check the highlighted fields.", fields);
      }
      const phoneValue = typeof body["phone"] === "string" ? body["phone"].trim() : null;
      const gateValue = gateNotes !== undefined ? (gateNotes.trim().length === 0 ? null : gateNotes.trim()) : core.gate_notes;
      if (typeof address === "object" && address !== null) {
        await ctx.db.exec(
          `UPDATE members SET phone = $2, gate_notes = $3, address_line1 = $4, address_line2 = $5, city = $6, postal_code = $7
           WHERE id = $1`,
          [person.id, phoneValue, gateValue, line1 ?? core.address_line1, line2 ?? "", city ?? core.city, postalCode ?? core.postal_code]
        );
      } else {
        await ctx.db.exec(`UPDATE members SET phone = $2, gate_notes = $3 WHERE id = $1`, [
          person.id,
          phoneValue,
          gateValue,
        ]);
      }
      res2.json({ member: await memberSelfView(ctx, person.id) });
    });
  });

  router.get("/api/me/membership", async (req, res) => {
    await run(ctx, req, res, ["member"], async (_req, res2, person) => {
      await ensureMembershipCurrent(ctx, person.id);
      res2.json({ membership: await membershipViewFor(ctx, person.id) });
    });
  });

  router.post("/api/me/membership", async (req, res) => {
    await run(ctx, req, res, ["member"], async (req2, res2, person) => {
      const core = await memberCore(ctx.db, person.id);
      if (!core) throw new ApiError(404, "not_found", copy("not_found"));
      requireNotClosing(core.account_state);
      const body = req2.body as { cadence?: unknown };
      const cadence = body.cadence;
      if (cadence !== "sixMonths" && cadence !== "yearly") {
        throw new ApiError(422, "invalid", "Check the highlighted fields.", { cadence: FIELD_ERRORS.chooseOption });
      }
      const requestKey = typeof req2.headers["request-key"] === "string" ? req2.headers["request-key"] : null;
      const rawBody = (req2 as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(body));
      const result = await joinPlusAction(ctx, { id: person.id, name: core.name, email: core.email, accountState: core.account_state }, cadence, requestKey, rawBody);
      if (result.replayed) {
        res2.status(result.status).json(result.body);
        return;
      }
      const row = await membershipFor(ctx.db, person.id);
      const view = row ? await membershipViewFor(ctx, person.id) : null;
      res2.status(201).json({ membership: view });
    });
  });

  router.patch("/api/me/membership", async (req, res) => {
    await run(ctx, req, res, ["member"], async (req2, res2, person) => {
      const core = await memberCore(ctx.db, person.id);
      if (!core) throw new ApiError(404, "not_found", copy("not_found"));
      requireNotClosing(core.account_state);
      const cadence = (req2.body as { cadence?: unknown }).cadence;
      if (cadence !== "sixMonths" && cadence !== "yearly") {
        throw new ApiError(422, "invalid", "Check the highlighted fields.", { cadence: FIELD_ERRORS.chooseOption });
      }
      const view = await changeCadenceAction(ctx, person.id, cadence);
      res2.json({ membership: view });
    });
  });

  router.post("/api/me/membership/cancel", async (req, res) => {
    await run(ctx, req, res, ["member"], async (_req, res2, person) => {
      const core = await memberCore(ctx.db, person.id);
      if (!core) throw new ApiError(404, "not_found", copy("not_found"));
      requireNotClosing(core.account_state);
      const view = await cancelPlusAction(ctx, person.id);
      res2.json({ membership: view });
    });
  });

  router.post("/api/me/closure", async (req, res) => {
    await run(ctx, req, res, ["member"], async (_req, res2, person) => {
      const core = await memberCore(ctx.db, person.id);
      if (!core) throw new ApiError(404, "not_found", copy("not_found"));
      if (core.account_state === "closing" || core.account_state === "erasing") {
        throw new ApiError(409, "account_closing", copy("account_closing_write"));
      }
      const membership = await membershipFor(ctx.db, person.id);
      if (membership && (membership.state === "active" || membership.state === "pending" || membership.state === "cancelled")) {
        if (membership.kb_subscription_id) {
          const view = await (await import("./membership-service.js")).cancelPlusAction(ctx, person.id);
          void view;
        }
      }
      const erasesAt = new Date(Date.now() + ctx.config.timers.closureWaitSeconds * 1000);
      await ctx.db.exec(
        `UPDATE members SET account_state = 'closing', erases_at = $2, closure_requested_at = now() WHERE id = $1`,
        [person.id, erasesAt]
      );
      res2.json({ member: await memberSelfView(ctx, person.id) });
    });
  });

  router.get("/api/me/plan", async (req, res) => {
    await run(ctx, req, res, ["member"], async (_req, res2, person) => {
      const plan = await latestPublishedPlan(ctx, person.id);
      if (plan) {
        const blend = await currentBlend(ctx, person.id);
        plan.blend = blend;
      }
      res2.json({ plan });
    });
  });

  router.get("/api/me/blend", async (req, res) => {
    await run(ctx, req, res, ["member"], async (_req, res2, person) => {
      res2.json({ blend: await currentBlend(ctx, person.id) });
    });
  });

  router.get("/api/me/results", async (req, res) => {
    await run(ctx, req, res, ["member"], async (_req, res2, person) => {
      const markers = await memberResultsView(ctx, person.id, true);
      res2.json({ markers });
    });
  });

  router.get("/api/me/results-history", async (req, res) => {
    await run(ctx, req, res, ["member"], async (req2, res2, person) => {
      const { ok: canDownload, retryAfter } = await rateLimit(
        ctx,
        person.id,
        "download",
        ctx.config.timers.fileRateWindowSeconds,
        5
      );
      if (!canDownload) {
        const message = await downloadLimitCopy(ctx, person.id, retryAfter);
        throw new ApiError(429, "rate_limited", message, undefined, retryAfter);
      }
      await recordRateEvent(ctx, person.id, "download");
      const csv = await resultsHistoryCsv(ctx, person.id);
      res2.setHeader("Content-Type", "text/csv; charset=utf-8");
      res2.setHeader("Content-Disposition", 'attachment; filename="ocotillo-results-history.csv"');
      res2.send(csv);
    });
  });

  router.get("/api/me/messages", async (req, res) => {
    await run(ctx, req, res, ["member"], async (_req, res2, person) => {
      const messages = await listMessages(ctx, person.id);
      res2.json({ messages });
    });
  });

  router.post("/api/me/messages", async (req, res) => {
    await run(ctx, req, res, ["member"], async (req2, res2, person) => {
      const core = await memberCore(ctx.db, person.id);
      if (!core) throw new ApiError(404, "not_found", copy("not_found"));
      requireNotClosing(core.account_state);
      const result = await sendMessage(ctx, person.id, req2, "member", person.name);
      res2.status(result.status).json(result.body);
    });
  });

  router.get("/api/me/receipts", async (req, res) => {
    await run(ctx, req, res, ["member"], async (_req, res2, person) => {
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
         FROM receipts WHERE member_id = $1 ORDER BY number DESC`,
        [person.id]
      );
      res2.json({
        receipts: rows.map((row) => ({
          id: row.id,
          number: row.number,
          memberName: row.member_name,
          paidAt: instantZ(row.paid_at),
          paidDate: row.paid_date,
          amountCents: row.amount_cents,
          currency: row.currency,
        })),
      });
    });
  });

}

type RunFn = (
  ctx: AppContext,
  req: Request,
  res: Response,
  roles: string[],
  handler: (req: Request, res: Response, person: Person) => Promise<void>
) => Promise<void>;

const runImpl: RunFn = async (ctx, req, res, roles, handler) => {
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

const run: RunFn = runImpl;

export async function latestPublishedPlan(ctx: AppContext, memberId: string) {
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
      published_at, published_by, blend_id, updated_at
     FROM longevity_plans
     WHERE member_id = $1 AND state = 'published'
     ORDER BY published_at DESC NULLS LAST, updated_at DESC
     LIMIT 1`,
    [memberId]
  );
  if (!row) return null;
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
    blend: null as ReturnType<typeof blendView> | null,
    updatedAt: instantZ(row.updated_at),
  };
}

export async function currentBlend(ctx: AppContext, memberId: string) {
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
     FROM blends WHERE member_id = $1 ORDER BY saved_at DESC LIMIT 1`,
    [memberId]
  );
  if (!row) return null;
  return blendView(row);
}

export function blendView(row: {
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

export async function listMessages(ctx: AppContext, memberId: string) {
  const rows = await ctx.db.query<{
    id: string;
    from_role: string;
    from_name: string;
    body: string;
    sent_at: Date;
    attachment_id: string | null;
  }>(
    `SELECT id, from_role, from_name, body, sent_at, attachment_id FROM messages
     WHERE member_id = $1 ORDER BY sent_at ASC`,
    [memberId]
  );
  const messages = [];
  for (const row of rows) {
    let attachment = null;
    if (row.attachment_id) {
      const att = await ctx.db.one<{ id: string; kind: string; size_bytes: number }>(
        `SELECT id, kind, size_bytes FROM attachments WHERE id = $1`,
        [row.attachment_id]
      );
      if (att) attachment = { id: att.id, kind: att.kind, bytes: att.size_bytes };
    }
    messages.push({
      id: row.id,
      from: { role: row.from_role, name: row.from_name },
      body: row.body,
      attachment,
      sentAt: instantZ(row.sent_at),
    });
  }
  return messages;
}

export async function rateLimit(
  ctx: AppContext,
  memberId: string,
  kind: "message" | "download",
  windowSeconds: number,
  max: number
): Promise<{ ok: boolean; retryAfter: number }> {
  const rows = await ctx.db.query<{ at: Date }>(
    `SELECT at FROM rate_events WHERE member_id = $1 AND kind = $2 AND at > now() - ($3 || ' seconds')::interval
     ORDER BY at ASC`,
    [memberId, kind, String(windowSeconds)]
  );
  if (rows.length < max) return { ok: true, retryAfter: 0 };
  const oldest = rows[0]?.at;
  if (!oldest) return { ok: true, retryAfter: 0 };
  const retryMs = oldest.getTime() + windowSeconds * 1000 - Date.now();
  const retryAfter = Math.max(1, Math.ceil(retryMs / 1000));
  return { ok: false, retryAfter };
}

/** Record an accepted rate-limited event (a sent message or a download). */
export async function recordRateEvent(ctx: AppContext, memberId: string, kind: "message" | "download"): Promise<void> {
  await ctx.db.exec(
    `INSERT INTO rate_events (id, member_id, kind, at) VALUES ($1, $2, $3, now())`,
    [newId("rate"), memberId, kind]
  );
}

export async function downloadLimitCopy(ctx: AppContext, memberId: string, retryAfterSeconds: number): Promise<string> {
  const core = await memberCore(ctx.db, memberId);
  const timeZone = (core?.time_zone ?? "phoenix") as TimeZoneKey;
  const instant = new Date(Date.now() + retryAfterSeconds * 1000);
  const rounded = roundUpToMinute(instant);
  return copy("download_rate_limited", {
    "HH:MM": localTimeIn(rounded, zoneFor(timeZone)),
    "city": cityOf(timeZone),
  });
}

function roundUpToMinute(instant: Date): Date {
  const dt = DateTime.fromJSDate(instant, { zone: "utc" });
  if (dt.second === 0 && dt.millisecond === 0) return instant;
  return dt.plus({ minutes: 1 }).set({ second: 0, millisecond: 0 }).toJSDate();
}

function cityOf(timeZone: TimeZoneKey): string {
  const map: Record<TimeZoneKey, string> = {
    newYork: "New York",
    chicago: "Chicago",
    denver: "Denver",
    phoenix: "Phoenix",
    losAngeles: "Los Angeles",
  };
  return map[timeZone];
}


