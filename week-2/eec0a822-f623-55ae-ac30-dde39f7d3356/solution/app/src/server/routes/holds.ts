import type pg from "pg";
import { config } from "../config";
import { pool, rows, transaction } from "../db";
import { ApiError, conflict, notFound, unavailable, type Json } from "../http";
import { route, type Ctx } from "../router";
import { asBody, Fields } from "../validate";
import { FIELD } from "../../shared/copy";
import { weekday } from "../../shared/zones";
import { createInvoice, voidInvoice } from "../billing";
import { sendMail } from "../mail";
import { assertDepositable, checkWeek, holdById, holdJson, holdsWhere, markCharter, placeHold, releaseHold, type Hold, type Placement } from "../domain/holds";
import { charterById, charterJson, confirmationMail, insertCharter, CHARTER_SELECT, type CharterRow } from "../domain/charters";
import { CURRENCIES, priceCharter, tableInForce } from "../domain/pricing";
import { splitToday } from "../domain/weeks";
import { yachtBySlug, type YachtRow } from "../domain/yachts";

/** A yacht named in a body: 404 when unknown, 410 when withdrawn. */
async function bodyYacht(db: pg.PoolClient | typeof pool, workspace: string, slug: unknown, lock = false): Promise<YachtRow> {
  const yacht = typeof slug === "string" ? await yachtBySlug(db, workspace, slug, lock) : undefined;
  if (!yacht) throw notFound();
  if (yacht.status === "withdrawn") throw new ApiError(410, { error: "yacht_withdrawn" });
  return yacht;
}

/** A hold's week: a Saturday after Split today. */
function holdWeek(fields: Fields, value: unknown, nowMs: number): string | null {
  const date = fields.date("weekStart", value);
  if (date && (weekday(date) !== 6 || date <= splitToday(nowMs))) {
    fields.fail("weekStart", FIELD.weekStart);
    return null;
  }
  return date;
}

route("GET", "/api/w/:ws/holds", {
  staff: true,
  handle: async (ctx) => {
    ctx.allow(["charter_manager", "finance_lead"]);
    const where = ["h.workspace_slug = $1"];
    const params: unknown[] = [ctx.params.ws];
    const slug = ctx.query("yachtSlug");
    if (slug) {
      const yacht = await yachtBySlug(pool, ctx.params.ws, slug);
      if (!yacht) throw notFound();
      params.push(yacht.id);
      where.push(`h.yacht_id = $${params.length}`);
    }
    const week = ctx.query("weekStart");
    if (week) {
      const fields = new Fields();
      params.push(fields.date("weekStart", week));
      fields.check();
      where.push(`h.week_start = $${params.length}`);
    }
    const holds = await holdsWhere(pool, where.join(" AND "), params, ctx.now);
    return { status: 200, body: { holds: holds.map(holdJson) } };
  },
});

/** Places a hold from a request body, in ladder order: yacht (404/410), state (409), fields (422). */
export async function placeFromBody(workspace: string, raw: unknown, placedBy: Placement["placedBy"], nowMs: number): Promise<Hold> {
  const body = asBody(raw);
  return transaction(async (db) => {
    const yacht = await bodyYacht(db, workspace, body.yachtSlug, true);
    const fields = new Fields();
    const weekStart = holdWeek(fields, body.weekStart, nowMs);
    const clientName = fields.text("clientName", body.clientName, 80);
    const queue = body.queue === true;
    if (!weekStart || !clientName) {
      if (weekStart) await checkWeek(db, yacht.id, weekStart, queue);
      throw new ApiError(422, { errors: fields.errors });
    }
    return placeHold(db, { workspace, yachtId: yacht.id, weekStart, clientName, queue, placedBy }, nowMs);
  });
}

route("POST", "/api/w/:ws/holds", {
  staff: true,
  handle: async (ctx) => {
    ctx.allow(["charter_manager"]);
    const hold = await placeFromBody(ctx.params.ws, await ctx.json(), { kind: "member", name: ctx.member.name, brokerId: null }, ctx.now);
    return { status: 201, body: { hold: holdJson(hold) } };
  },
});

async function staffHold(ctx: Ctx) {
  const hold = await holdById(pool, ctx.params.ws, ctx.params.id, ctx.now);
  if (!hold) throw notFound();
  return hold;
}

route("GET", "/api/w/:ws/holds/:id", {
  staff: true,
  handle: async (ctx) => {
    const hold = await staffHold(ctx);
    ctx.allow(["charter_manager", "finance_lead"]);
    return { status: 200, body: { hold: holdJson(hold) } };
  },
});

route("POST", "/api/w/:ws/holds/:id/release", {
  staff: true,
  handle: async (ctx) => {
    const found = await staffHold(ctx);
    ctx.allow(["charter_manager"]);
    const hold = await transaction(async (db) => {
      await db.query("SELECT 1 FROM yachts WHERE id = $1 FOR UPDATE", [found.yacht_id]);
      return releaseHold(db, (await holdById(db, ctx.params.ws, found.id, Date.now()))!, Date.now());
    });
    return { status: 200, body: { hold: holdJson(hold) } };
  },
});

route("GET", "/api/w/:ws/holds/:id/quote", {
  staff: true,
  handle: async (ctx) => {
    const hold = await staffHold(ctx);
    ctx.allow(["charter_manager", "finance_lead"]);
    const fields = new Fields();
    const currency = fields.option("currency", ctx.query("currency"), CURRENCIES);
    fields.check();
    const yacht = (await yachtBySlug(pool, ctx.params.ws, hold.yacht_slug))!;
    const table = await tableInForce(pool, ctx.params.ws, splitToday(ctx.now));
    return { status: 200, body: { quote: priceCharter(yacht, hold.week_start, currency!, table) as unknown as Json } };
  },
});

async function charterRow(db: pg.PoolClient, workspace: string, id: string): Promise<CharterRow> {
  return (await charterById(db, workspace, id))!;
}

route("POST", "/api/w/:ws/holds/:id/deposit", {
  staff: true,
  handle: async (ctx) => {
    await staffHold(ctx);
    ctx.allow(["charter_manager"]);
    const body = asBody(await ctx.json());
    const charter = await transaction(async (db) => {
      const hold = (await holdById(db, ctx.params.ws, ctx.params.id, Date.now(), true))!;
      assertDepositable(hold);
      const fields = new Fields();
      const clientEmail = fields.email("clientEmail", body.clientEmail);
      const currency = fields.option("currency", body.currency, CURRENCIES);
      fields.check();
      const yacht = (await yachtBySlug(db, ctx.params.ws, hold.yacht_slug))!;
      const depositDate = splitToday(Date.now());
      const quote = priceCharter(yacht, hold.week_start, currency!, await tableInForce(db, ctx.params.ws, depositDate));
      const charterId = await insertCharter(db, {
        workspace: ctx.params.ws, holdId: hold.id, yacht, weekStart: hold.week_start, clientName: hold.client_name,
        clientEmail: clientEmail!, depositDate, quote,
      });
      let invoiceId: string;
      try {
        invoiceId = await createInvoice({
          charterId,
          clientName: hold.client_name,
          clientEmail: clientEmail!,
          currency: currency!,
          items: quote.lines.map((line) => ({
            description: line.kind === "charter_fee" ? `Charter fee — ${yacht.name}, week of ${hold.week_start}` : line.label,
            amountMinor: line.amountMinor,
          })),
        });
      } catch (error) {
        console.error(`billing: ${(error as Error).message}`);
        throw unavailable("billing_unavailable");
      }
      await db.query("UPDATE charters SET invoice_status = 'invoiced', killbill_invoice_id = $2, invoiced_at = now() WHERE id = $1", [charterId, invoiceId]);
      const stored = await charterRow(db, ctx.params.ws, charterId);
      try {
        await sendMail(confirmationMail(stored));
      } catch (error) {
        console.error(`mail: ${(error as Error).message}`);
        await voidInvoice(invoiceId).catch((voidError: Error) => console.error(`void: ${voidError.message}`));
        throw unavailable("mail_unavailable");
      }
      await markCharter(db, hold.id, charterId);
      return stored;
    });
    return { status: 201, body: { charter: charterJson(charter) } };
  },
});

route("GET", "/api/w/:ws/charters", {
  staff: true,
  handle: async (ctx) => {
    ctx.allow(["charter_manager", "finance_lead", "captain"]);
    const list = await rows<CharterRow>(pool, `${CHARTER_SELECT} WHERE c.workspace_slug = $1 ORDER BY c.created_at DESC`, [ctx.params.ws]);
    return { status: 200, body: { charters: list.map(charterJson) } };
  },
});

route("POST", "/api/w/:ws/charters", {
  staff: true,
  handle: async (ctx) => {
    ctx.allow(["charter_manager"]);
    const body = asBody(await ctx.json());
    const charter = await transaction(async (db) => {
      const yacht = await bodyYacht(db, ctx.params.ws, body.yachtSlug, true);
      const fields = new Fields();
      const weekStart = fields.date("weekStart", body.weekStart);
      if (weekStart && weekday(weekStart) !== 6) fields.fail("weekStart", FIELD.saturday);
      const clientName = fields.text("clientName", body.clientName, 80);
      const clientEmail = fields.email("clientEmail", body.clientEmail);
      const currency = fields.option("currency", body.currency, CURRENCIES);
      if (weekStart && weekday(weekStart) === 6) await checkWeek(db, yacht.id, weekStart, false);
      fields.check();
      const today = splitToday(Date.now());
      const quote = priceCharter(yacht, weekStart!, currency!, await tableInForce(db, ctx.params.ws, today));
      const id = await insertCharter(db, {
        workspace: ctx.params.ws, holdId: null, yacht, weekStart: weekStart!, clientName: clientName!, clientEmail: clientEmail!,
        depositDate: null, quote,
      });
      return charterRow(db, ctx.params.ws, id);
    });
    return { status: 201, body: { charter: charterJson(charter) } };
  },
});

export async function staffCharter(ctx: Ctx, db: pg.PoolClient | typeof pool = pool, lock = false): Promise<CharterRow> {
  const charter = await charterById(db, ctx.params.ws, ctx.params.id, lock);
  if (!charter) throw notFound();
  return charter;
}

route("GET", "/api/w/:ws/charters/:id", {
  staff: true,
  handle: async (ctx) => {
    const charter = await staffCharter(ctx);
    ctx.allow(["charter_manager", "finance_lead", "captain"]);
    return { status: 200, body: { charter: charterJson(charter) } };
  },
});

route("POST", "/api/w/:ws/charters/:id/close", {
  staff: true,
  handle: async (ctx) => {
    await staffCharter(ctx);
    ctx.allow(["captain"]);
    const charter = await transaction(async (db) => {
      const found = await staffCharter(ctx, db, true);
      if (found.status === "closed") throw conflict("charter_closed");
      await db.query(
        "UPDATE charters SET status = 'closed', closed_at = now(), erases_at = now() + make_interval(secs => $2) WHERE id = $1",
        [found.id, config.timers.manifestRetentionSeconds],
      );
      await db.query("UPDATE private_pages SET ended_at = now() WHERE kind = 'manifest' AND charter_id = $1 AND ended_at IS NULL", [found.id]);
      return staffCharter(ctx, db);
    });
    return { status: 200, body: { charter: charterJson(charter) } };
  },
});
