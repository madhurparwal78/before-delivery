// Library listing, link issue and the /dl download route (brief: Library, links and downloads).
import { Readable } from "node:stream";
import { accessToDerivative, libraryFor } from "../availability.ts";
import { read, transaction } from "../db.ts";
import { refuse } from "../denial.ts";
import { ApiError, notFound, STORAGE_MESSAGES, storageUnavailable } from "../errors.ts";
import { created, ok, type Ctx, type Router, type Reply } from "../http.ts";
import { contentTypeFor } from "../images.ts";
import { expiryFrom, issueToken, readToken } from "../links.ts";
import { StorageUnavailable, derivativeKey, getObject, storageReachable } from "../storage.ts";
import { ASSET_CLASS_LABELS } from "../../shared/domain.ts";
import type { LibraryCard, LibraryResponse, Principal } from "../../shared/api.ts";

const CLASS_LABEL_BY_KEY: Record<string, string> = ASSET_CLASS_LABELS;

/** `class` takes a class key and `availability` a badge string; an unrecognised value matches no card. */
function filtered(cards: LibraryCard[], query: URLSearchParams): LibraryCard[] {
  const classKey = query.get("class");
  const badges = query.getAll("availability");
  const search = (query.get("q") ?? "").toLowerCase();
  return cards.filter(
    (card) =>
      (classKey === null || card.classLabel === CLASS_LABEL_BY_KEY[classKey]) &&
      (badges.length === 0 || badges.includes(card.badge)) &&
      (search === "" || card.cardName.toLowerCase().includes(search) || card.classLabel.toLowerCase().includes(search)),
  );
}

async function library(ctx: Ctx): Promise<Reply> {
  const principal = ctx.user();
  const cards = filtered(await read((tx) => libraryFor(tx, principal)), ctx.query);
  const body: LibraryResponse = { count: cards.length, cards };
  return ok(body);
}

async function issueLink(ctx: Ctx): Promise<Reply> {
  const principal = ctx.user();
  const derivativeId = ctx.params.id;
  const found = await read((tx) => accessToDerivative(tx, principal, derivativeId));
  if (!found) throw notFound();
  const { decision } = found;
  if (decision.badge !== "Available") {
    return refuse(
      { actorId: principal.id, actorRole: principal.role, action: "link.issued", resourceType: "derivative", resourceId: derivativeId, requestId: null },
      new ApiError(403, "download_not_allowed", decision.reason!),
    );
  }
  if (!(await storageReachable())) throw storageUnavailable(STORAGE_MESSAGES.download);
  const link = await transaction(async (tx) => {
    const expiresAt = expiryFrom(tx.now);
    const token = issueToken({ derivativeId, principalId: principal.id, grant: decision.coveredBy!, expiresAt });
    tx.audit({
      actorId: principal.id,
      actorRole: principal.role,
      action: "link.issued",
      resourceType: "derivative",
      resourceId: derivativeId,
      requestId: null,
      before: null,
      after: { expiresAt, grant: decision.coveredBy },
    });
    return { url: `/dl/${token}`, expiresAt };
  });
  return created(link);
}

const PAGE_TEXT: Record<number, string> = { 404: "Not found", 410: "This link has expired.", 503: STORAGE_MESSAGES.download };

function messagePage(status: 404 | 410 | 503): Reply {
  const text = PAGE_TEXT[status];
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${text}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fff;color:#17161c;font:16px/1.5 ui-sans-serif,-apple-system,Arial,system-ui,sans-serif}main{background:#c9c6cf;padding:46px;max-width:30rem}h1{margin:0;font-size:32px;font-weight:650}</style></head>
<body><main><h1>${text}</h1></main></body></html>`;
  return { status, raw: Buffer.from(html, "utf8"), headers: { "content-type": "text/html; charset=utf-8" } };
}

async function download(ctx: Ctx): Promise<Reply> {
  const claims = readToken(ctx.params.token);
  if (!claims) return messagePage(404);
  const check = await read(async (tx) => {
    const row = await tx.one<{ id: string; display_name: string; role: Principal["role"]; organisation_id: string }>(
      "SELECT id, display_name, role, organisation_id FROM principals WHERE id = $1", [claims.principalId]);
    if (!row) return null;
    const principal: Principal = { id: row.id, displayName: row.display_name, role: row.role, organisationId: row.organisation_id };
    const found = await accessToDerivative(tx, principal, claims.derivativeId);
    return { found, now: tx.now };
  });
  if (!check?.found || check.found.decision.badge !== "Available") return messagePage(404);
  if (check.now > claims.expiresAt) return messagePage(410);
  const { found } = check;
  try {
    const object = await getObject(derivativeKey(found.assetId, found.variantKey, found.fileName));
    if (!object) return messagePage(404);
    return {
      status: 200,
      raw: Readable.fromWeb(object.body as import("node:stream/web").ReadableStream<Uint8Array>),
      headers: {
        "content-type": contentTypeFor(found.derivative.format),
        "content-length": String(object.size),
        "content-disposition": `attachment; filename="${found.fileName}"`,
        "cache-control": "private, no-store",
      },
    };
  } catch (error) {
    if (error instanceof StorageUnavailable) return messagePage(503);
    throw error;
  }
}

export function registerLibrary(router: Router): void {
  router.get("/api/library", library);
  router.post("/api/derivatives/:id/link", issueLink);
  router.get("/dl/:token", download);
}
