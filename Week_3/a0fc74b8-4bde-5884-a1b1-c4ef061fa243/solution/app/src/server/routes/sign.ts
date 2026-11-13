import { Hono } from "hono";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { tx } from "../db.js";
import { ApiError, StorageError, notFound, storageUnavailable, validation } from "../errors.js";
import { VALIDATION_COPY } from "../../shared/copy.js";
import { type LinkContext, lockLink, readLink, requireTurn, signView } from "../domain/links.js";
import { fieldsOf, touchDocument } from "../domain/rows.js";
import { signFieldJson } from "../domain/serialize.js";
import { declineDocument, runEffects, signRecipient } from "../domain/workflow.js";
import { subscribe } from "../live.js";
import { completedKey, getObject, originalKey } from "../storage.js";
import { isUuid } from "../util.js";
import { STROKE_POINT_LIMIT, TEXT_LIMIT, TYPED_LIMIT, codePoints } from "../../shared/limits.js";
import type { Stroke } from "../../shared/types.js";
import { jsonBody } from "./context.js";

function pdfBytes(bytes: Buffer, title: string): Response {
  const safe = title.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return new Response(new Uint8Array(bytes), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${safe}.pdf"`, "cache-control": "private, no-store" },
  });
}

function parseStrokes(value: unknown): Stroke[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  let points = 0;
  const strokes: Stroke[] = [];
  for (const stroke of value as unknown[]) {
    if (!Array.isArray(stroke) || stroke.length === 0) return null;
    const parsed: Stroke = [];
    for (const point of stroke as unknown[]) {
      if (!Array.isArray(point) || point.length !== 2 || typeof point[0] !== "number" || typeof point[1] !== "number") return null;
      parsed.push([point[0], point[1]]);
      points += 1;
      if (points > STROKE_POINT_LIMIT) return null;
    }
    strokes.push(parsed);
  }
  return strokes;
}

export const signRoutes = new Hono();

const token = (c: Context): string => c.req.param("token") ?? "";

signRoutes.get("/:token", async (c) => c.json(await signView(await readLink(token(c)))));

signRoutes.get("/:token/original.pdf", async (c) => {
  const link = await readLink(token(c));
  requireTurn(link);
  try {
    return pdfBytes(await getObject(originalKey(link.document.id)), link.document.title);
  } catch (error) {
    if (error instanceof StorageError) throw storageUnavailable();
    throw error;
  }
});

signRoutes.put("/:token/fields/:fieldId", async (c) => {
  const body = await jsonBody(c);
  const fieldId = c.req.param("fieldId") ?? "";
  const saved = await tx(async (client) => {
    const link = await lockLink(client, token(c));
    const field = (await fieldsOf(client, link.document.id)).find((f) => f.id === fieldId && f.recipient_id === link.recipient.id);
    if (!field || !isUuid(fieldId)) throw notFound();
    requireTurn(link);
    if (field.kind === "date") throw new ApiError(422, { error: "read_only" });
    let value: string | null;
    let strokes: Stroke[] | null = null;
    if (field.kind === "text") {
      const text = body["value"];
      if (typeof text !== "string" || codePoints(text) > TEXT_LIMIT) throw validation({ value: VALIDATION_COPY.value });
      value = text === "" ? null : text;
    } else if ("strokes" in body) {
      strokes = parseStrokes(body["strokes"]);
      if (!strokes) throw validation({ strokes: VALIDATION_COPY.strokes });
      value = "drawn";
    } else {
      const typed = body["typed"];
      if (typeof typed !== "string" || codePoints(typed) < 1 || codePoints(typed) > TYPED_LIMIT) throw validation({ typed: VALIDATION_COPY.typed });
      value = `typed:${typed}`;
    }
    await client.query("UPDATE fields SET value = $2, strokes = $3 WHERE id = $1", [field.id, value, strokes ? JSON.stringify(strokes) : null]);
    await touchDocument(client, link.document);
    const updated = (await fieldsOf(client, link.document.id)).find((f) => f.id === field.id);
    if (!updated) throw notFound();
    return updated;
  });
  return c.json(signFieldJson(saved));
});

signRoutes.post("/:token/finish", async (c) => {
  const effects = await tx(async (client) => {
    const link: LinkContext = await lockLink(client, token(c));
    requireTurn(link);
    return signRecipient(client, link.document, link.recipient);
  });
  await runEffects(effects);
  return c.json({ state: (await readLink(token(c))).state });
});

signRoutes.post("/:token/decline", async (c) => {
  const body = await jsonBody(c);
  const effects = await tx(async (client) => {
    const link = await lockLink(client, token(c));
    requireTurn(link);
    return declineDocument(client, link.document, link.recipient, body["reason"]);
  });
  await runEffects(effects);
  return c.json({ state: "declined" });
});

signRoutes.get("/:token/live", async (c) => {
  const link = await readLink(token(c));
  return streamSSE(c, async (stream) => {
    const unsubscribe = subscribe((event) => {
      if (event.type === "document" && event.documentId === link.document.id) void stream.writeSSE({ data: JSON.stringify(event) });
    });
    stream.onAbort(unsubscribe);
    await stream.writeSSE({ data: JSON.stringify({ type: "document", documentId: link.document.id, teamId: link.document.team_id }) });
    while (!stream.aborted) {
      await stream.sleep(15000);
      await stream.write(": keep-alive\n\n");
    }
  });
});

export const completedPdfRoute = new Hono();

completedPdfRoute.get("/:token/completed.pdf", async (c) => {
  const link = await readLink(token(c));
  if (link.state !== "completed") throw new ApiError(409, { error: "link_closed", state: link.state });
  try {
    return pdfBytes(await getObject(completedKey(link.document.id)), link.document.title);
  } catch (error) {
    if (error instanceof StorageError) throw storageUnavailable();
    throw error;
  }
});
