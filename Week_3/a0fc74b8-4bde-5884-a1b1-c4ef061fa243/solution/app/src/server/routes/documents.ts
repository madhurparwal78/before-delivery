import { Hono } from "hono";
import type { Context } from "hono";
import type { PoolClient } from "pg";
import { pool, tx } from "../db.js";
import { ApiError, StorageError, forbidden, invalidState, storageUnavailable, validation } from "../errors.js";
import { VALIDATION_COPY } from "../../shared/copy.js";
import { auditTrail } from "../domain/audit.js";
import {
  addField,
  addRecipient,
  createDraft,
  findField,
  findRecipient,
  moveRecipient,
  removeField,
  removeRecipient,
  updateDocument,
  updateField,
  updateRecipient,
} from "../domain/drafts.js";
import { type Actor, type Permission, can } from "../domain/permissions.js";
import { type DocumentRow, lockDocument, readDocument } from "../domain/rows.js";
import { documentJson, documentSummaries } from "../domain/serialize.js";
import { saveAsTemplate, templateView } from "../domain/templates.js";
import { titleProblem } from "../domain/validate.js";
import {
  type Effects,
  expireDue,
  issueNewLink,
  remindRecipient,
  runEffects,
  sendDocument,
  voidDocument,
} from "../domain/workflow.js";
import { inspectPdf, PAGE_LIMIT, UploadRefused } from "../pdf/inspect.js";
import { completedKey, getObject, originalKey, putObject } from "../storage.js";
import { sha256Hex } from "../util.js";
import { codePoints, truncateCodePoints, TITLE_LIMIT } from "../../shared/limits.js";
import { jsonBody, requireActor } from "./context.js";

export const UPLOAD_LIMIT = 25_000_000;

async function managed<T>(
  c: Context,
  permission: Permission,
  work: (client: PoolClient, document: DocumentRow, actor: Actor) => Promise<T>,
): Promise<{ result: T; document: DocumentRow }> {
  const actor = await requireActor(c);
  const documentId = c.req.param("id") ?? "";
  return tx(async (client) => {
    const document = await lockDocument(client, documentId, actor.teamId);
    if (!can(actor, permission, { ownerId: document.owner_id })) throw forbidden();
    await expireDue(client, document.id);
    return { result: await work(client, document, actor), document };
  });
}

async function respondWithEffects(c: Context, effects: Effects, document: DocumentRow, status: 200 | 201 = 200): Promise<Response> {
  await runEffects(effects);
  const fresh = await readDocument(pool, document.id, document.team_id);
  return c.json(await documentJson(pool, fresh), status);
}

function pdfResponse(bytes: Buffer, title: string): Response {
  const safe = title.replace(/[^\x20-\x7e]|["\\]/g, "_").replace(/[\r\n]/g, " ");
  return new Response(new Uint8Array(bytes), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${safe}.pdf"`, "cache-control": "private, no-store" },
  });
}

const REFUSALS: Record<string, { status: 415 | 422; extra?: Record<string, number> }> = {
  not_a_pdf: { status: 415 },
  pdf_encrypted: { status: 422 },
  pdf_has_scripts: { status: 422 },
  pdf_rotated: { status: 422 },
  too_many_pages: { status: 422, extra: { limit: PAGE_LIMIT } },
};

export const documentRoutes = new Hono();

documentRoutes.get("/", async (c) => {
  const actor = await requireActor(c);
  await expireDue(pool);
  const filter = c.req.query("filter") ?? "all";
  return c.json({ documents: await documentSummaries(pool, actor.teamId, filter) });
});

documentRoutes.post("/", async (c) => {
  const actor = await requireActor(c);
  if (!can(actor, "document.upload")) throw forbidden();
  const form = await c.req.parseBody().catch(() => ({}) as Record<string, string | File>);
  const file = form["file"];
  if (!(file instanceof File)) throw validation({ file: VALIDATION_COPY.file });
  if (file.size > UPLOAD_LIMIT) throw new ApiError(413, { error: "too_large", limit: UPLOAD_LIMIT });
  const given = form["title"];
  const fallback = truncateCodePoints(file.name.replace(/\.pdf$/i, "").trim(), TITLE_LIMIT);
  const title = typeof given === "string" && given.trim() !== "" ? given.trim() : fallback;
  const problem = titleProblem(title);
  if (problem) throw validation({ title: problem });
  const bytes = Buffer.from(await file.arrayBuffer());
  let inspected;
  try {
    inspected = inspectPdf(bytes);
  } catch (error) {
    if (error instanceof UploadRefused) {
      const refusal = REFUSALS[error.code];
      throw new ApiError(refusal?.status ?? 422, { error: error.code, ...refusal?.extra });
    }
    throw error;
  }
  try {
    const document = await tx(async (client) =>
      createDraft(client, {
        teamId: actor.teamId,
        owner: actor,
        title,
        originalSha256: sha256Hex(bytes),
        pageCount: inspected.pageCount,
        pageSizes: inspected.pageSizes,
        timeZone: "UTC",
        storeOriginal: (key) => putObject(key, bytes),
      }),
    );
    return c.json(await documentJson(pool, document), 201);
  } catch (error) {
    if (error instanceof StorageError) throw storageUnavailable();
    throw error;
  }
});

documentRoutes.get("/:id", async (c) => {
  const actor = await requireActor(c);
  const id = c.req.param("id");
  const document = await readDocument(pool, id, actor.teamId);
  await expireDue(pool, document.id);
  return c.json(await documentJson(pool, await readDocument(pool, id, actor.teamId)));
});

documentRoutes.patch("/:id", async (c) => {
  const body = await jsonBody(c);
  const { document } = await managed(c, "document.manage", (client, doc) => updateDocument(client, doc, body));
  return c.json(await documentJson(pool, await readDocument(pool, document.id, document.team_id)));
});

documentRoutes.get("/:id/original.pdf", async (c) => {
  const actor = await requireActor(c);
  const document = await readDocument(pool, c.req.param("id"), actor.teamId);
  try {
    return pdfResponse(await getObject(originalKey(document.id)), document.title);
  } catch (error) {
    if (error instanceof StorageError) throw storageUnavailable();
    throw error;
  }
});

documentRoutes.get("/:id/completed.pdf", async (c) => {
  const actor = await requireActor(c);
  const document = await readDocument(pool, c.req.param("id"), actor.teamId);
  if (document.status !== "completed") throw invalidState(document.status);
  try {
    return pdfResponse(await getObject(completedKey(document.id)), document.title);
  } catch (error) {
    if (error instanceof StorageError) throw storageUnavailable();
    throw error;
  }
});

documentRoutes.get("/:id/audit", async (c) => {
  const actor = await requireActor(c);
  const document = await readDocument(pool, c.req.param("id"), actor.teamId);
  return c.json({ events: await auditTrail(pool, document.id) });
});

documentRoutes.post("/:id/recipients", async (c) => {
  const body = await jsonBody(c);
  const { result } = await managed(c, "document.manage", (client, doc) => addRecipient(client, doc, body));
  return c.json(result, 201);
});

documentRoutes.patch("/:id/recipients/:recipientId", async (c) => {
  const body = await jsonBody(c);
  const { result } = await managed(c, "document.manage", async (client, doc) =>
    updateRecipient(client, doc, await findRecipient(client, doc, c.req.param("recipientId")), body),
  );
  return c.json(result);
});

documentRoutes.delete("/:id/recipients/:recipientId", async (c) => {
  await managed(c, "document.manage", async (client, doc) => removeRecipient(client, doc, await findRecipient(client, doc, c.req.param("recipientId"))));
  return c.body(null, 204);
});

documentRoutes.post("/:id/recipients/:recipientId/move", async (c) => {
  const body = await jsonBody(c);
  const { result } = await managed(c, "document.manage", async (client, doc) =>
    moveRecipient(client, doc, await findRecipient(client, doc, c.req.param("recipientId")), body["direction"]),
  );
  return c.json({ recipients: result });
});

documentRoutes.post("/:id/recipients/:recipientId/new-link", async (c) => {
  const { result, document } = await managed(c, "document.manage", async (client, doc, actor) =>
    issueNewLink(client, doc, await findRecipient(client, doc, c.req.param("recipientId")), actor),
  );
  return respondWithEffects(c, result, document);
});

documentRoutes.post("/:id/fields", async (c) => {
  const body = await jsonBody(c);
  const { result } = await managed(c, "document.manage", (client, doc) => addField(client, doc, body));
  return c.json(result, 201);
});

documentRoutes.patch("/:id/fields/:fieldId", async (c) => {
  const body = await jsonBody(c);
  const { result } = await managed(c, "document.manage", async (client, doc) =>
    updateField(client, doc, await findField(client, doc, c.req.param("fieldId")), body),
  );
  return c.json(result);
});

documentRoutes.delete("/:id/fields/:fieldId", async (c) => {
  await managed(c, "document.manage", async (client, doc) => removeField(client, doc, await findField(client, doc, c.req.param("fieldId"))));
  return c.body(null, 204);
});

interface StoredResponse {
  status: number;
  body: unknown;
}

documentRoutes.post("/:id/send", async (c) => {
  const actor = await requireActor(c);
  const key = c.req.header("Idempotency-Key");
  if (key !== undefined && (key.length < 1 || codePoints(key) > 100)) {
    throw validation({ idempotencyKey: "Idempotency-Key must be 1 to 100 characters." });
  }
  const outcome = await tx(async (client): Promise<{ replay: StoredResponse } | { effects: Effects; document: DocumentRow }> => {
    const document = await lockDocument(client, c.req.param("id") ?? "", actor.teamId);
    if (key !== undefined) {
      const { rows } = await client.query<{ document_id: string; status: number; body: unknown }>(
        "SELECT document_id, status, body FROM idempotency_keys WHERE key = $1",
        [key],
      );
      const stored = rows[0];
      if (stored && stored.document_id === document.id) return { replay: { status: stored.status, body: stored.body } };
      if (stored) throw new ApiError(422, { error: "idempotency_key_reused" });
    }
    if (!can(actor, "document.manage", { ownerId: document.owner_id })) throw forbidden();
    const effects = await sendDocument(client, document, actor);
    if (key !== undefined) {
      await client.query("INSERT INTO idempotency_keys (key, document_id, status, body) VALUES ($1, $2, 200, $3)", [key, document.id, "{}"]);
    }
    return { effects, document };
  });
  if ("replay" in outcome) return c.json(outcome.replay.body, outcome.replay.status as 200);
  await runEffects(outcome.effects);
  const body = await documentJson(pool, await readDocument(pool, outcome.document.id, outcome.document.team_id));
  if (key !== undefined) await pool.query("UPDATE idempotency_keys SET body = $2 WHERE key = $1", [key, JSON.stringify(body)]);
  return c.json(body);
});

documentRoutes.post("/:id/remind", async (c) => {
  const { result } = await managed(c, "document.manage", (client, doc, actor) => remindRecipient(client, doc, actor));
  return c.json({ reminderAvailableAt: result.toISOString() });
});

documentRoutes.post("/:id/void", async (c) => {
  const body = await jsonBody(c);
  const { result, document } = await managed(c, "document.manage", (client, doc, actor) => voidDocument(client, doc, actor, body["reason"]));
  return respondWithEffects(c, result, document);
});

documentRoutes.post("/:id/template", async (c) => {
  const actor = await requireActor(c);
  try {
    const template = await tx(async (client) => {
      const document = await lockDocument(client, c.req.param("id") ?? "", actor.teamId);
      if (!can(actor, "template.save")) throw forbidden();
      return saveAsTemplate(client, document);
    });
    return c.json(await templateView(pool, template), 201);
  } catch (error) {
    if (error instanceof StorageError) throw storageUnavailable();
    throw error;
  }
});

