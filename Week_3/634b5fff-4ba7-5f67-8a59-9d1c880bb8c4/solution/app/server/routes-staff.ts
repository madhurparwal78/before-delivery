import type { FastifyInstance, FastifyRequest } from "fastify";
import { requireSignedIn, requireStaff } from "./auth.js";
import { WAITING_HEADER } from "../shared/copy.js";
import { availableCount, putBackOnShelf } from "./boxes.js";
import { BrokerUnreachable } from "./broker.js";
import { businessNow } from "./clock.js";
import { config } from "./config.js";
import { pool, withTx } from "./db.js";
import { dismissDeadLetter, hasUnpublishedEvents, listDeadLetters, retryDeadLetter } from "./events.js";
import { fail } from "./http.js";
import { begin, finish, fingerprint, forget } from "./idempotency.js";
import { hasPending } from "./jobs.js";
import { pack } from "./packing.js";
import { startStaffRefund } from "./refunds.js";
import { saveArt } from "./art.js";
import { staffSearch } from "./searching.js";
import { issueStatement, listStatements, statementPdf } from "./statements.js";
import { listDeliveries, saveEndpoint, SvixUnreachable, syncEndpoint } from "./svix.js";
import { orderLedger, packerOrders, ratesList, scheduleRate, treasurerOrders } from "./views.js";
import { requireOrder } from "./orders.js";
import { isBoxNumber } from "./holds.js";
import { nudge } from "./shelf.js";

const param = (request: FastifyRequest, name: string): string => (request.params as Record<string, string>)[name] ?? "";

const MAX_NOTE = 280;

export const registerStaffRoutes = (app: FastifyInstance): void => {
  app.addHook("onSend", async (request, reply, payload) => {
    if (!request.url.startsWith("/api/staff/")) return payload;
    const waiting = [
      (await hasUnpublishedEvents().catch(() => false)) ? "queue" : "",
      (await hasPending("alert").catch(() => false)) ? "alerts" : "",
    ].filter(Boolean);
    if (waiting.length > 0) reply.header(WAITING_HEADER, waiting.join(","));
    return payload;
  });

  app.get("/api/staff/me", async (request) => {
    const principal = await requireSignedIn(request);
    return { username: principal.username, roles: principal.roles };
  });

  app.get("/api/staff/search", async (request) => {
    await requireStaff(request, "any");
    return staffSearch(String((request.query as { q?: string }).q ?? "").trim());
  });

  app.get("/api/staff/orders", async (request) => {
    await requireStaff(request, "packer");
    return { orders: await packerOrders((request.query as { boxState?: string }).boxState ?? null) };
  });

  app.post("/api/staff/orders/:reference/pack", async (request, reply) => {
    await requireStaff(request, "packer");
    const result = await pack(param(request, "reference"));
    return reply.code(result.status).send(result.body);
  });

  app.post("/api/staff/boxes/:number/back-on-shelf", async (request) => {
    await requireStaff(request, "packer");
    const number = Number(param(request, "number"));
    if (!isBoxNumber(number)) return fail("not_found");
    await withTx((tx) => putBackOnShelf(tx, number));
    nudge();
    return { number, state: "available" };
  });

  const deadLetters = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      if (error instanceof BrokerUnreachable) return fail("queue_unreachable");
      throw error;
    }
  };

  app.get("/api/staff/dead-letters", async (request) => {
    await requireStaff(request, "packer");
    return { events: await deadLetters(listDeadLetters) };
  });
  app.post("/api/staff/dead-letters/:eventId/retry", async (request, reply) => {
    await requireStaff(request, "packer");
    const eventId = param(request, "eventId");
    if (!(await deadLetters(() => retryDeadLetter(eventId)))) return fail("not_found");
    return reply.code(202).send({ eventId, status: "requeued" });
  });
  app.post("/api/staff/dead-letters/:eventId/dismiss", async (request) => {
    await requireStaff(request, "packer");
    const eventId = param(request, "eventId");
    const note = typeof (request.body as { note?: unknown } | undefined)?.note === "string" ? ((request.body as { note: string }).note).trim() : "";
    const found = await pool.query("SELECT 1 FROM events WHERE event_id = $1 AND state = 'dead'", [eventId]);
    if (found.rowCount === 0) return fail("not_found");
    if (note === "" || note.length > MAX_NOTE) return fail("dismissal_note_required");
    await deadLetters(() => dismissDeadLetter(eventId, note));
    return { eventId, status: "dismissed" };
  });

  app.get("/api/staff/ledger/orders", async (request) => {
    await requireStaff(request, "treasurer");
    return { orders: await treasurerOrders() };
  });
  app.get("/api/staff/orders/:reference/ledger", async (request) => {
    await requireStaff(request, "treasurer");
    return orderLedger(param(request, "reference"));
  });

  app.post("/api/staff/orders/:reference/refunds", async (request, reply) => {
    await requireStaff(request, "treasurer");
    const reference = param(request, "reference");
    await requireOrder(pool, reference);
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || key === "") return fail("validation_failed");
    const amount = (request.body as { amountOre?: unknown } | undefined)?.amountOre;
    const replay = await begin("refund", key, fingerprint("POST", `/api/staff/orders/${reference}/refunds`, { amountOre: amount }));
    if (replay) return reply.code(replay.status).send(replay.body);
    try {
      const outcome = await startStaffRefund(reference, typeof amount === "number" ? amount : Number.NaN, key);
      await finish("refund", key, outcome.status, outcome.body);
      return reply.code(outcome.status).send(outcome.body);
    } catch (error) {
      await forget("refund", key);
      throw error;
    }
  });

  app.get("/api/staff/charity-rates", async (request) => {
    await requireStaff(request, "treasurer");
    return { rates: await ratesList() };
  });
  app.post("/api/staff/charity-rates", async (request, reply) => {
    await requireStaff(request, "treasurer");
    const body = (request.body ?? {}) as { rateBasisPoints?: unknown; effectiveFrom?: unknown };
    return reply.code(201).send(await scheduleRate(body.rateBasisPoints, body.effectiveFrom, businessNow()));
  });

  app.get("/api/staff/statements", async (request) => {
    await requireStaff(request, "treasurer");
    return { statements: await listStatements() };
  });
  app.post("/api/staff/statements", async (request, reply) => {
    await requireStaff(request, "treasurer");
    return reply.code(201).send(await issueStatement((request.body as { month?: unknown } | undefined)?.month));
  });
  app.get("/api/staff/statements/:id/pdf", async (request, reply) => {
    await requireStaff(request, "treasurer");
    return reply.header("content-type", "application/pdf").send(await statementPdf(param(request, "id"), null));
  });

  app.put("/api/staff/charity-endpoint", async (request) => {
    await requireStaff(request, "treasurer");
    const url = (request.body as { url?: unknown } | undefined)?.url;
    const parsed = typeof url === "string" ? URL.canParse(url) && /^https?:$/.test(new URL(url).protocol) : false;
    if (!parsed) return fail("endpoint_invalid");
    await saveEndpoint(url as string);
    await syncEndpoint().catch(() => undefined);
    return { url };
  });
  app.get("/api/staff/deliveries", async (request) => {
    await requireStaff(request, "treasurer");
    try {
      return { deliveries: await listDeliveries() };
    } catch (error) {
      if (error instanceof SvixUnreachable) return fail("deliveries_unreachable");
      throw error;
    }
  });

  app.post("/api/staff/plates/:plate/art", async (request, reply) => {
    await requireStaff(request, "maker");
    const upload = await request.file();
    if (!upload) return fail("validation_failed");
    return reply.code(201).send(await saveArt(param(request, "plate"), await upload.toBuffer()));
  });
  app.get("/api/staff/stock", async (request) => {
    await requireStaff(request, "maker");
    return { remaining: await availableCount(pool), thresholds: config.lowStockThresholds };
  });
};
