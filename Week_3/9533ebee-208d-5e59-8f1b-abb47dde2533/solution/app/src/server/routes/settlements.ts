import { fail } from "../errors.js";
import type { Ctx, Reply, Route } from "../http.js";
import { readSettlement, renderedPdfKey } from "../settlements.js";
import { readObject } from "../storage.js";

// Settlement receipts and their PDF statements.

async function showSettlement(ctx: Ctx): Promise<Reply> {
  return { status: 200, body: await readSettlement(ctx.tx, ctx.params[0] ?? "") };
}

async function statementPdf(ctx: Ctx): Promise<Reply> {
  const key = await renderedPdfKey(ctx.tx, ctx.params[0] ?? "");
  const pdf = key === null ? null : await readObject(key);
  if (pdf === null) throw fail("pdf_pending");
  return { status: 200, binary: pdf, contentType: "application/pdf" };
}

export const settlementRoutes: Route[] = [
  { method: "GET", pattern: /^\/api\/settlements\/([^/]+)$/, handler: showSettlement },
  { method: "GET", pattern: /^\/api\/settlements\/([^/]+)\/statement\.pdf$/, handler: statementPdf },
];
