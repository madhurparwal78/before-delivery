import { nowIso, setClock, today } from "./clock.js";
import { config } from "./config.js";
import { db } from "./db.js";
import { ApiError, notFound, storageUnavailable, validation } from "./errors.js";
import { COPY } from "../shared/copy.js";
import { json, route } from "./http.js";
import { countLookup } from "./limits.js";
import { loadBook, packFacts } from "./pricing.js";
import { parseBatchCode } from "./batchcode.js";
import { copyId } from "./meta.js";
import { pdfKey, presign } from "./s3.js";
import { isBatchShaped, search } from "./search.js";
import { providers } from "./status.js";
import { catalogue, loadNotices, skuDetail, withStates } from "./views.js";

route("GET", "/api/catalogue", { auth: "public" }, async () => {
  const book = await loadBook(db);
  return json(200, catalogue(book, today()));
});

route("GET", "/api/skus/:code", { auth: "public" }, async (ctx) => {
  const book = await loadBook(db);
  const sku = book.bySku.get(ctx.params[0]!);
  if (!sku) throw notFound();
  return json(200, skuDetail(book, today(), sku));
});

route("GET", "/api/batches/:code", { auth: "public", acceptsNul: true, guard: (ctx) => countLookup(ctx.ip) }, async (ctx) => {
  const code = ctx.params[0]!.trim().toUpperCase();
  const unknown = (status: number): ApiError => new ApiError(status, "unknown_batch", COPY.unknownBatch);
  if (!parseBatchCode(code)) throw unknown(422);
  const book = await loadBook(db);
  const batch = book.batches.find((b) => b.code === code);
  if (!batch) throw unknown(404);
  return json(200, packFacts(book, today(), batch));
});

if (config.testClock) {
  const view = (): { now: string; today: string } => ({ now: nowIso(), today: today() });
  route("PUT", "/api/test/clock", { auth: "public", body: "json" }, async (ctx) => {
    const now = (ctx.body as { now?: unknown }).now;
    const ms = typeof now === "string" && /(Z|[+-]\d{2}:\d{2})$/.test(now) ? Date.parse(now) : NaN;
    if (Number.isNaN(ms)) throw validation({ now: "Send an ISO 8601 time with an offset." });
    setClock(ms);
    return json(200, view());
  });
  route("DELETE", "/api/test/clock", { auth: "public" }, async () => {
    setClock(null);
    return json(200, view());
  });
}

route("GET", "/api/search", { auth: "public", guard: (ctx) => { if (isBatchShaped(ctx.url.searchParams.get("q") ?? "")) countLookup(ctx.ip); } }, async (ctx) =>
  json(200, await search(ctx.url.searchParams.get("q") ?? "")),
);

route("GET", "/api/notices", { auth: "public" }, async () => {
  const notices = withStates(await loadNotices(db), today()).map((n) => ({ number: n.number, state: n.state, currentVersion: n.versions[0]! }));
  return json(200, { notices });
});

route("GET", "/api/notices/:number", { auth: "public" }, async (ctx) => {
  const [notice] = withStates(await loadNotices(db, [ctx.params[0]!]), today());
  if (!notice) throw notFound();
  return json(200, notice);
});

/** A printable version's stored PDF, or the reason it cannot be had: 409 still printing, 503 print failed or storage away. */
async function printableKey(number: string, versionText: string): Promise<{ key: string; sha256: string }> {
  const v = (await db.query("SELECT print_state, pdf_sha256 FROM notice_versions WHERE number = $1 AND version::text = $2", [number, versionText])).rows[0];
  if (!v) throw notFound();
  if (v.print_state === "pending") throw new ApiError(409, "print_pending", COPY.stillPrinting);
  if (v.print_state === "failed") throw new ApiError(503, "print_unavailable", COPY.printOutage);
  if (!providers.storage) throw storageUnavailable();
  return { key: pdfKey(await copyId(), number, Number(versionText)), sha256: v.pdf_sha256 as string };
}

route("GET", "/api/notices/:number/versions/:version/link", { auth: "public" }, async (ctx) => {
  const { key, sha256 } = await printableKey(ctx.params[0]!, ctx.params[1]!);
  return json(200, { url: presign(key), expiresInSeconds: 60, sha256 });
});

route("GET", "/api/notices/:number/versions/:version/pdf", { auth: "public" }, async (ctx) => {
  const { key } = await printableKey(ctx.params[0]!, ctx.params[1]!);
  return { status: 302, headers: { location: presign(key) } };
});
