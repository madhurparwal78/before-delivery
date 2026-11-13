import { readFile } from "node:fs/promises";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { CHAPTERS, CHARITY_NAME, CLOSES_AT, EDITION, EDITION_PRICE, plateOf } from "../shared/domain.js";
import { OUTAGE_COPY } from "../shared/copy.js";
import { artUrl, hasArt, readArt } from "./art.js";
import { businessNow } from "./clock.js";
import { handleCallback, parseCallback } from "./callbacks.js";
import { answer, checkout } from "./checkout.js";
import { pool } from "./db.js";
import { holdStatus, isBoxNumber, putBack, reach } from "./holds.js";
import { fail } from "./http.js";
import { lookupOrder } from "./lookup.js";
import { loadOrder, orderView, rateAt, saleParts } from "./orders.js";
import { publicSearch } from "./searching.js";
import { SearchUnreachable } from "./search.js";
import { StorageUnreachable } from "./s3.js";
import { verifyCallback } from "./signatures.js";
import { availableCount } from "./boxes.js";
import { readShelf, salesEvent, salesOpen, subscribe } from "./shelf.js";
import { statementPdf } from "./statements.js";
import { downloadCertificate } from "./certificates.js";

/** A stream ends after this long and the browser reconnects at once, re-reading the shelf: no connection lives for ever. */
const STREAM_LIFETIME_MS = 25000;
const STREAM_RETRY_MS = 500;

const header = (request: FastifyRequest, name: string): string | undefined => {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

const orderTokenOf = (request: FastifyRequest): string | undefined =>
  header(request, "x-order-token") ?? (request.query as { token?: string }).token;

const accessibleOrder = async (request: FastifyRequest) => {
  const { reference } = request.params as { reference: string };
  const order = await loadOrder(pool, reference);
  const token = orderTokenOf(request);
  if (!order || !token || token !== order.order_token) return fail("not_found");
  return order;
};

const boxNumber = (request: FastifyRequest): number => {
  const number = Number((request.params as { number: string }).number);
  return isBoxNumber(number) ? number : fail("not_found");
};

const NARRATION = new URL("../../narration/", import.meta.url);

const sendFile = async (reply: FastifyReply, request: FastifyRequest, bytes: Buffer, type: string): Promise<FastifyReply> => {
  const range = /^bytes=(\d*)-(\d*)$/.exec(header(request, "range") ?? "");
  reply.header("content-type", type).header("accept-ranges", "bytes");
  if (!range) return reply.send(bytes);
  const start = range[1] ? Number(range[1]) : 0;
  const end = range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
  return reply.code(206).header("content-range", `bytes ${start}-${end}/${bytes.length}`).send(bytes.subarray(start, end + 1));
};

export const registerPublicRoutes = (app: FastifyInstance): void => {
  app.get("/api/health", async () => ({ status: "ok" }));

  app.get("/api/edition", async () => {
    const rate = await rateAt(pool, businessNow());
    return {
      edition: EDITION, ...EDITION_PRICE, charityName: CHARITY_NAME, rateBasisPoints: rate,
      charityOre: saleParts(rate).charityOre, closesAt: CLOSES_AT, salesOpen: salesOpen(),
    };
  });

  app.get("/api/shelf", async () => {
    const shelf = await readShelf();
    return {
      salesPaused: shelf.salesPaused,
      remaining: await availableCount(pool),
      boxes: shelf.states.map((state, index) => ({ number: index + 1, plate: plateOf(index + 1), state })),
    };
  });

  app.get("/api/shelf/events", (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "x-content-type-options": "nosniff",
    });
    const write = (name: string, data: Record<string, unknown>): void => {
      reply.raw.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    reply.raw.write(`retry: ${STREAM_RETRY_MS}\n\n`);
    write("sales", salesEvent().data);
    const unsubscribe = subscribe((event) => write(event.name, event.data));
    const rotation = setTimeout(() => reply.raw.end(), STREAM_LIFETIME_MS);
    request.raw.on("close", () => {
      clearTimeout(rotation);
      unsubscribe();
    });
  });

  app.get("/api/boxes/:number", async (request) => {
    const number = boxNumber(request);
    const plate = plateOf(number);
    return {
      number, plate, state: (await readShelf()).states[number - 1], artUrl: (await hasArt(plate)) ? artUrl(plate) : null,
    };
  });

  app.get("/api/plates/:plate/art", async (request, reply) => {
    const art = await readArt((request.params as { plate: string }).plate);
    return reply.header("content-type", art.contentType).send(art.bytes);
  });

  app.get("/narration/:file", async (request, reply) => {
    const name = /^([a-z]+)\.ogg$/.exec((request.params as { file: string }).file)?.[1];
    if (!name || !(CHAPTERS as readonly string[]).includes(name)) return fail("not_found");
    return sendFile(reply, request, await readFile(new URL(`${name}.ogg`, NARRATION)), "audio/ogg");
  });

  app.post("/api/holds", async (request, reply) => {
    const result = await reach((request.body as { number?: unknown } | undefined)?.number, header(request, "x-hold-token"));
    return reply.code(result.status).send(result.body);
  });
  app.get("/api/holds/:number", async (request) => holdStatus(boxNumber(request), header(request, "x-hold-token")));
  app.delete("/api/holds/:number", async (request, reply) => {
    await putBack(boxNumber(request), header(request, "x-hold-token"));
    return reply.code(204).send();
  });

  app.post("/api/checkout", async (request, reply) => {
    const result = await checkout(header(request, "x-hold-token"), header(request, "idempotency-key"), request.body);
    return reply.code(result.status).send(result.body);
  });
  app.post("/api/checkout/:reference/challenge", async (request, reply) => {
    const result = await answer((request.params as { reference: string }).reference, header(request, "x-hold-token"), (request.body ?? {}) as Record<string, unknown>);
    return reply.code(result.status).send(result.body);
  });

  app.get("/api/orders/:reference", async (request) => orderView(pool, await accessibleOrder(request)));
  app.post("/api/orders/lookup", async (request) => {
    const body = (request.body ?? {}) as { reference?: unknown; email?: unknown };
    return lookupOrder(request.socket.remoteAddress ?? "unknown", body.reference, body.email);
  });
  app.get("/api/orders/:reference/certificate", async (request, reply) => {
    const order = await accessibleOrder(request);
    try {
      const bytes = await downloadCertificate(order);
      return reply.header("content-type", "application/pdf").send(bytes);
    } catch (error) {
      if (error instanceof StorageUnreachable) return fail("storage_unreachable", { message: OUTAGE_COPY.download });
      throw error;
    }
  });

  app.get("/api/search", async (request) => {
    const { q } = request.query as { q?: unknown };
    if (typeof q !== "string" || q.trim() === "") return { hits: [] };
    if (q.length > 100) return fail("validation_failed");
    try {
      return { hits: await publicSearch(q) };
    } catch (error) {
      if (error instanceof SearchUnreachable) return fail("search_unreachable");
      throw error;
    }
  });

  app.get("/api/statements/:id/pdf", async (request, reply) => {
    const token = (request.query as { token?: string }).token;
    if (!token) return fail("not_found");
    return reply.header("content-type", "application/pdf").send(await statementPdf((request.params as { id: string }).id, token));
  });

  app.post("/api/gateway/callbacks", async (request, reply) => {
    if (!request.rawBody || !verifyCallback(request.rawBody, header(request, "x-gateway-signature"))) return fail("bad_signature");
    return reply.send({ status: await handleCallback(parseCallback(request.body)) });
  });
};
