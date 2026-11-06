import { config } from "../config";
import { one, pool, rows, transaction } from "../db";
import { ApiError, conflict, notFound, unavailable } from "../http";
import { route, type Ctx } from "../router";
import { formatTime } from "../../shared/format";
import { isoInstant } from "../../shared/zones";
import { centimetresToMetres } from "../../shared/money";
import { sendMail } from "../mail";
import { brokerHoldJson, holdById, holdsWhere, releaseHold } from "../domain/holds";
import { endPages, issuePage, latestPage, livePage, pageStatusJson, type PageRow } from "../domain/pages";
import type { YachtRow } from "../domain/yachts";
import { placeFromBody } from "./holds";
import { weeksJson } from "./yachts";

const BROKER_HOLDS_PER_WINDOW = 5;

interface BrokerRow {
  workspace_slug: string;
  id: string;
  name: string;
  contact_name: string;
  email: string;
  notes: string;
}

route("GET", "/api/w/:ws/brokers", {
  staff: true,
  handle: async (ctx) => {
    ctx.allow(["charter_manager"]);
    const brokers = await rows<BrokerRow>(pool, "SELECT * FROM brokers WHERE workspace_slug = $1 ORDER BY name", [ctx.params.ws]);
    const out = [];
    for (const b of brokers) {
      out.push({
        id: b.id,
        name: b.name,
        contactName: b.contact_name,
        email: b.email,
        notes: b.notes,
        page: pageStatusJson(await latestPage(pool, ctx.params.ws, "broker", b.id), ctx.now, false),
      });
    }
    return { status: 200, body: { brokers: out } };
  },
});

async function staffBroker(ctx: Ctx): Promise<BrokerRow> {
  const broker = await one<BrokerRow>(pool, "SELECT * FROM brokers WHERE workspace_slug = $1 AND id = $2", [ctx.params.ws, ctx.params.id]);
  if (!broker) throw notFound();
  return broker;
}

route("POST", "/api/w/:ws/brokers/:id/page", {
  staff: true,
  handle: async (ctx) => {
    const broker = await staffBroker(ctx);
    ctx.allow(["charter_manager"]);
    const page = await transaction(async (db) => {
      await db.query("SELECT 1 FROM brokers WHERE workspace_slug = $1 AND id = $2 FOR UPDATE", [ctx.params.ws, broker.id]);
      const issued = await issuePage(db, ctx.params.ws, "broker", broker.id);
      await sendMail({
        to: broker.email,
        subject: `Your ${ctx.member.workspaceName} broker page`,
        text: [
          `Your private availability page from ${ctx.member.workspaceName} for ${broker.name}:`,
          "",
          `${config.publicUrl}/b/${issued.token}`,
          "",
          `This link works until ${formatTime(issued.ends_at.toISOString())}.`,
        ].join("\n"),
      }).catch((error: Error) => {
        console.error(`mail: ${error.message}`);
        throw unavailable("mail_unavailable");
      });
      return issued;
    });
    return { status: 201, body: { page: pageStatusJson(page, Date.now(), true) } };
  },
});

route("POST", "/api/w/:ws/brokers/:id/page/end", {
  staff: true,
  handle: async (ctx) => {
    const broker = await staffBroker(ctx);
    ctx.allow(["charter_manager"]);
    if (!(await endPages(pool, ctx.params.ws, "broker", broker.id))) throw conflict("page_not_live");
    return { status: 200, body: { page: pageStatusJson(await latestPage(pool, ctx.params.ws, "broker", broker.id), Date.now(), true) } };
  },
});

async function brokerOf(page: PageRow): Promise<BrokerRow> {
  return (await one<BrokerRow>(pool, "SELECT * FROM brokers WHERE workspace_slug = $1 AND id = $2", [page.workspace_slug, page.broker_id]))!;
}

/** Every hold placement counts against its token, whatever its outcome, before anything else is checked. */
async function rateLimit(ctx: Ctx): Promise<void> {
  const token = ctx.params.token;
  const windowSeconds = config.timers.brokerRateWindowSeconds;
  const retry = await transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [token]);
    const counted = await rows<{ requested_at: Date }>(
      db,
      "SELECT requested_at FROM broker_hold_requests WHERE token = $1 AND requested_at > now() - make_interval(secs => $2) ORDER BY requested_at",
      [token, windowSeconds],
    );
    await db.query("INSERT INTO broker_hold_requests (token, requested_at) VALUES ($1, now())", [token]);
    if (counted.length < BROKER_HOLDS_PER_WINDOW) return null;
    const { now } = (await one<{ now: Date }>(db, "SELECT now()"))!;
    const leavesAt = counted[0].requested_at.getTime() + windowSeconds * 1000;
    return Math.max(1, Math.ceil((leavesAt - now.getTime()) / 1000));
  });
  if (retry !== null) {
    throw new ApiError(429, { error: "rate_limited", retryAfterSeconds: retry }, { "Retry-After": String(retry) });
  }
}

async function onSaleYachts(workspace: string): Promise<YachtRow[]> {
  return rows<YachtRow>(pool, "SELECT * FROM yachts WHERE workspace_slug = $1 AND status = 'on_sale' ORDER BY name", [workspace]);
}

route("GET", "/api/broker/:token", {
  handle: async (ctx) => {
    const page = await livePage(pool, "broker", ctx.params.token, ctx.now);
    const broker = await brokerOf(page);
    const company = (await one<{ name: string }>(pool, "SELECT name FROM workspaces WHERE slug = $1", [page.workspace_slug]))!;
    const yachts = [];
    for (const y of await onSaleYachts(page.workspace_slug)) {
      const weeks = (await weeksJson(y, ctx.now, false)).map((w) => {
        const { weekStart, weekEnd, status, weeklyRateMinor, currency } = w as Record<string, string | number>;
        return { weekStart, weekEnd, status, weeklyRateMinor, currency };
      });
      yachts.push({ slug: y.slug, name: y.name, base: y.base, cabins: y.cabins, lengthM: centimetresToMetres(y.length_cm), weeks });
    }
    const holds = await holdsWhere(pool, "h.workspace_slug = $1 AND h.broker_id = $2", [page.workspace_slug, broker.id], ctx.now);
    return {
      status: 200,
      body: {
        broker: { name: broker.name },
        company: { name: company.name },
        status: "live",
        endsAt: isoInstant(page.ends_at.getTime()),
        yachts,
        holds: holds.map(brokerHoldJson),
      },
    };
  },
});

route("POST", "/api/broker/:token/holds", {
  limit: rateLimit,
  handle: async (ctx) => {
    const page = await livePage(pool, "broker", ctx.params.token, ctx.now);
    const broker = await brokerOf(page);
    const hold = await placeFromBody(page.workspace_slug, await ctx.json(), { kind: "broker", name: broker.name, brokerId: broker.id }, ctx.now);
    return { status: 201, body: { hold: brokerHoldJson(hold) } };
  },
});

route("POST", "/api/broker/:token/holds/:id/release", {
  handle: async (ctx) => {
    const page = await livePage(pool, "broker", ctx.params.token, ctx.now);
    const found = await holdById(pool, page.workspace_slug, ctx.params.id, ctx.now);
    if (!found || found.broker_id !== page.broker_id) throw notFound();
    const hold = await transaction(async (db) => {
      await db.query("SELECT 1 FROM yachts WHERE id = $1 FOR UPDATE", [found.yacht_id]);
      return releaseHold(db, (await holdById(db, page.workspace_slug, found.id, Date.now()))!, Date.now());
    });
    return { status: 200, body: { hold: brokerHoldJson(hold) } };
  },
});
