// Client routes: every id is looked up within the signed-in brand, so another brand's id is not-found.
import { pool } from "../db.js";
import { newEngagement } from "../domain/brands.js";
import { payDeposit } from "../domain/deposit.js";
import { engagementJson, engagementSummaries, loadEngagement } from "../domain/engagements.js";
import { requireKey, runOnce } from "../domain/idempotency.js";
import { decideUnit, loadFile, receiveUpload, sendFileContent } from "../domain/intake.js";
import { clientInvoice, payInvoice } from "../domain/invoices.js";
import { writeLine } from "../domain/quote.js";
import { requireBrand } from "../domain/sessions.js";
import { publicOrigin, route, type Context } from "../http.js";

const bodyOf = (ctx: Context): Record<string, unknown> => (ctx.body && typeof ctx.body === "object" && !Array.isArray(ctx.body) ? (ctx.body as Record<string, unknown>) : {});
const param = (ctx: Context, name: string): string => ctx.params[name] ?? "";

route("GET", "/api/engagements", async (ctx) => ({ status: 200, body: { engagements: await engagementSummaries(pool, await requireBrand(ctx)) } }));

route("POST", "/api/engagements", async (ctx) => {
  const brandId = await requireBrand(ctx);
  const id = await newEngagement(brandId, bodyOf(ctx));
  return { status: 201, body: await engagementJson(pool, await loadEngagement(pool, id, brandId), "client", new Date()) };
});

route("GET", "/api/engagements/:id", async (ctx) => {
  const brandId = await requireBrand(ctx);
  return { status: 200, body: await engagementJson(pool, await loadEngagement(pool, param(ctx, "id"), brandId), "client", new Date()) };
});

route("PUT", "/api/engagements/:id/quote/lines/:code", async (ctx) => {
  const brandId = await requireBrand(ctx);
  return { status: 200, body: await writeLine(brandId, param(ctx, "id"), param(ctx, "code"), bodyOf(ctx).quantity, false, new Date()) };
});

route("DELETE", "/api/engagements/:id/quote/lines/:code", async (ctx) => {
  const brandId = await requireBrand(ctx);
  return { status: 200, body: await writeLine(brandId, param(ctx, "id"), param(ctx, "code"), null, true, new Date()) };
});

route(
  "POST",
  "/api/engagements/:id/files",
  async (ctx) => receiveUpload(ctx, await requireBrand(ctx), param(ctx, "id")),
  { multipart: true },
);

route("GET", "/api/engagements/:id/files/:fileId/content", async (ctx) => {
  const engagement = await loadEngagement(pool, param(ctx, "id"), await requireBrand(ctx));
  return sendFileContent(ctx, await loadFile(pool, engagement.id, param(ctx, "fileId")));
});

route("PUT", "/api/engagements/:id/files/:fileId/unit", async (ctx) => {
  const brandId = await requireBrand(ctx);
  return { status: 200, body: await decideUnit(brandId, param(ctx, "id"), param(ctx, "fileId"), bodyOf(ctx)) };
});

route("POST", "/api/engagements/:id/deposit", async (ctx) => {
  const brandId = await requireBrand(ctx);
  const engagement = await loadEngagement(pool, param(ctx, "id"), brandId);
  const key = requireKey(ctx.req.headers["idempotency-key"]);
  const origin = publicOrigin(ctx.req);
  const outcome = await runOnce(`brand:${brandId}:POST /api/engagements/${engagement.id}/deposit`, key, ctx.body, () =>
    payDeposit(brandId, engagement.id, bodyOf(ctx), origin, new Date()),
  );
  return { status: outcome.status, body: outcome.body };
});

route("GET", "/api/invoices/:invoiceId", async (ctx) => ({ status: 200, body: await clientInvoice(await requireBrand(ctx), param(ctx, "invoiceId"), new Date()) }));

route("POST", "/api/invoices/:invoiceId/payments", async (ctx) => {
  const brandId = await requireBrand(ctx);
  const invoiceId = param(ctx, "invoiceId");
  await clientInvoice(brandId, invoiceId, new Date());
  const key = requireKey(ctx.req.headers["idempotency-key"]);
  const origin = publicOrigin(ctx.req);
  const outcome = await runOnce(`brand:${brandId}:POST /api/invoices/${invoiceId}/payments`, key, ctx.body, () => payInvoice(brandId, invoiceId, bodyOf(ctx), origin, new Date()));
  return { status: outcome.status, body: outcome.body };
});
