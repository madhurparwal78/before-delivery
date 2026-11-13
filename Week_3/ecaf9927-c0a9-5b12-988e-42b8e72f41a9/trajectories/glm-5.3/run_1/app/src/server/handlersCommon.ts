import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { Member, Part, Plane, Sketch, SketchEntity } from "../shared/types.js";
import { ApiError, invalidFields, notFound, staleRevision } from "./errors.js";
import { analyzeSketch, labelWord, needsValue, newId, refsValidFor } from "./sketchService.js";
import { attemptBodyWrite, buildPartBody, shapesOfPart } from "./partSave.js";
import { loadPart, loadSketch, partToJson, sketchConstraints, sketchEntities, sketchToJson } from "./repo.js";
import { BodyStore } from "./storage.js";
import { lengthField, angleField } from "./apiCore.js";

/** Shared handler helpers: revisions, role checks, part saves, idempotency. */

export interface HandlerEnv {
  pool: import("pg").Pool;
  store: BodyStore;
}

export function requireFounder(member: Member): void {
  if (member.role !== "founder") {
    throw new ApiError(403, "forbidden", "Only the founder can change this.");
  }
}

export function baseRevisionField(body: Record<string, unknown>): number {
  const value = body.base_revision;
  if (typeof value === "number" && Number.isInteger(value)) return value;
  throw invalidFields({ base_revision: "Send the revision you started from." });
}

/** The single revision check: exactly one simultaneous change from the same
 * base revision succeeds, and the refusal names the member who saved. */
export async function checkRevision(
  client: PoolClient,
  table: "parts" | "sketches" | "assemblies" | "purchased_parts",
  id: string,
  base: number,
  thing: string,
  member: Member
): Promise<void> {
  const row = (
    await client.query<{ revision: number; last_saved_by: string | null }>(
      `SELECT revision, last_saved_by FROM ${table} WHERE id = $1 FOR UPDATE`,
      [id]
    )
  ).rows[0];
  if (!row) throw notFound();
  if (row.revision !== base) {
    let saver = { id: member.id, name: member.name };
    if (row.last_saved_by) {
      const named = (
        await client.query<{ id: string; name: string }>(
          "SELECT id, name FROM members WHERE id = $1",
          [row.last_saved_by]
        )
      ).rows[0];
      if (named) saver = { id: named.id, name: named.name };
    }
    throw staleRevision(saver, thing, row.revision);
  }
}

export async function safeRollback(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Already rolled back.
  }
}

/** Build the body and settle the part save, inside the open transaction. */
export async function rebuildAndSave(
  client: PoolClient,
  member: Member,
  store: BodyStore,
  partId: string
): Promise<{ part: Part }> {
  void member;
  const loaded = await loadPart(client, partId);
  if (!loaded) throw notFound();
  const entitiesBySketch = new Map<string, SketchEntity[]>();
  for (const s of loaded.sketches) {
    entitiesBySketch.set(s.id, await sketchEntities(client, s.id));
  }
  const shapes = shapesOfPart(loaded.features, loaded.sketches, entitiesBySketch);
  const slack = new Map<string, { slack: number; fully_held: boolean }>();
  if (loaded.features.length === 0) {
    for (const s of loaded.sketches) {
      const entities = entitiesBySketch.get(s.id) ?? [];
      const constraints = await sketchConstraints(client, s.id, entities);
      const analysis = analyzeSketch(entities, constraints);
      slack.set(s.id, { slack: analysis.slack, fully_held: analysis.fullyHeld });
      await client.query("UPDATE sketches SET slack = $1 WHERE id = $2", [analysis.slack, s.id]);
    }
    const refreshed = await loadPart(client, partId);
    return {
      part: partToJson(refreshed!.part, refreshed!.material, refreshed!.sketches, refreshed!.features, slack)
    };
  }
  const nextBuild = (loaded.part.body_build ?? 0) + 1;
  const build = buildPartBody(partId, shapes, nextBuild);
  if (!build.ok) {
    throw refusalFor(build.refusal, build.refusedOperation);
  }
  const massG = (loaded.material.density_g_cm3 * build.volume) / 1000;
  await attemptBodyWrite(client, store, partId, build, massG);
  const refreshed = await loadPart(client, partId);
  for (const s of refreshed!.sketches) {
    const entities = entitiesBySketch.get(s.id) ?? [];
    const constraints = await sketchConstraints(client, s.id, entities);
    const analysis = analyzeSketch(entities, constraints);
    slack.set(s.id, { slack: analysis.slack, fully_held: analysis.fullyHeld });
    await client.query("UPDATE sketches SET slack = $1 WHERE id = $2", [analysis.slack, s.id]);
  }
  return {
    part: partToJson(refreshed!.part, refreshed!.material, refreshed!.sketches, refreshed!.features, slack)
  };
}

function refusalFor(refusal: string | null, operation: string | null): ApiError {
  const op = operation === "new" ? "New body" : operation === "join" ? "Join" : operation === "cut" ? "Cut" : "Intersect";
  if (refusal === "empty") {
    return new ApiError(409, "empty_body", `${op} leaves no material. Nothing was changed.`);
  }
  return new ApiError(
    409,
    "separate_bodies",
    `${op} would leave separate pieces; a part must be one connected body. Nothing was changed.`
  );
}

/** Entity validation, reporting the first problem per field. */
export function parseEntity(entity: Record<string, unknown>, member: Member): SketchEntity {
  const fields: Record<string, string> = {};
  const type = entity.type as SketchEntity["type"];
  const firstError = (key: string, parsed: { value: number } | { error: string }): void => {
    if ("error" in parsed && Object.keys(fields).length === 0) fields[key] = parsed.error;
  };
  if (type === "point") {
    const x = lengthField(entity.x, member, "coordinate");
    const y = lengthField(entity.y, member, "coordinate");
    firstError("entity.x", x);
    firstError("entity.y", y);
    if ("value" in x && "value" in y) return { id: "new", label: "", type, x: x.value, y: y.value };
  } else if (type === "line") {
    const start = entity.start as Record<string, unknown> | undefined;
    const end = entity.end as Record<string, unknown> | undefined;
    const startX = lengthField(start?.x, member, "coordinate");
    const startY = lengthField(start?.y, member, "coordinate");
    const endX = lengthField(end?.x, member, "coordinate");
    const endY = lengthField(end?.y, member, "coordinate");
    firstError("entity.start.x", startX);
    firstError("entity.start.y", startY);
    firstError("entity.end.x", endX);
    firstError("entity.end.y", endY);
    if ("value" in startX && "value" in startY && "value" in endX && "value" in endY) {
      return {
        id: "new",
        label: "",
        type,
        start: { x: startX.value, y: startY.value },
        end: { x: endX.value, y: endY.value }
      };
    }
  } else if (type === "circle") {
    const center = entity.center as Record<string, unknown> | undefined;
    const cx = lengthField(center?.x, member, "coordinate");
    const cy = lengthField(center?.y, member, "coordinate");
    const radius = lengthField(entity.radius, member, "length");
    firstError("entity.center.x", cx);
    firstError("entity.center.y", cy);
    firstError("entity.radius", radius);
    if ("value" in cx && "value" in cy && "value" in radius) {
      return { id: "new", label: "", type, center: { x: cx.value, y: cy.value }, radius: radius.value };
    }
  } else if (type === "arc") {
    const center = entity.center as Record<string, unknown> | undefined;
    const cx = lengthField(center?.x, member, "coordinate");
    const cy = lengthField(center?.y, member, "coordinate");
    const radius = lengthField(entity.radius, member, "length");
    const startAngle = angleField(entity.start_angle_deg);
    const endAngle = angleField(entity.end_angle_deg);
    firstError("entity.center.x", cx);
    firstError("entity.center.y", cy);
    firstError("entity.radius", radius);
    firstError("entity.start_angle_deg", startAngle);
    firstError("entity.end_angle_deg", endAngle);
    if ("value" in cx && "value" in cy && "value" in radius && "value" in startAngle && "value" in endAngle) {
      return {
        id: "new",
        label: "",
        type,
        center: { x: cx.value, y: cy.value },
        radius: radius.value,
        start_angle_deg: startAngle.value,
        end_angle_deg: endAngle.value
      };
    }
  } else {
    throw invalidFields({ "entity.type": "Choose one of the listed options." });
  }
  throw invalidFields(fields);
}

export function entityGeometryRecord(entity: SketchEntity): Record<string, unknown> {
  switch (entity.type) {
    case "point":
      return { x: entity.x, y: entity.y };
    case "line":
      return { start: { x: entity.start.x, y: entity.start.y }, end: { x: entity.end.x, y: entity.end.y } };
    case "circle":
      return { center: { x: entity.center.x, y: entity.center.y }, radius: entity.radius };
    case "arc":
      return {
        center: { x: entity.center.x, y: entity.center.y },
        radius: entity.radius,
        start_angle_deg: entity.start_angle_deg,
        end_angle_deg: entity.end_angle_deg
      };
  }
}

export async function sketchResponse(client: PoolClient, sketchId: string): Promise<Sketch> {
  const loaded = await loadSketch(client, sketchId);
  if (!loaded) throw notFound();
  const drives = (
    await client.query<{ id: string }>("SELECT id FROM features WHERE sketch_id = $1 ORDER BY number", [sketchId])
  ).rows.map((r) => r.id);
  return sketchToJson(loaded.sketch, loaded.entities, loaded.constraints, drives);
}

export async function partResponse(client: PoolClient, partId: string): Promise<Part> {
  const loaded = await loadPart(client, partId);
  if (!loaded) throw notFound();
  const slack = new Map<string, { slack: number; fully_held: boolean }>();
  for (const s of loaded.sketches) {
    const entities = await sketchEntities(client, s.id);
    const constraints = await sketchConstraints(client, s.id, entities);
    const analysis = analyzeSketch(entities, constraints);
    slack.set(s.id, { slack: analysis.slack, fully_held: analysis.fullyHeld });
  }
  return partToJson(loaded.part, loaded.material, loaded.sketches, loaded.features, slack);
}

/** Idempotency records, scoped to the member and the endpoint path. */
export async function idempotentReplay(
  client: PoolClient,
  member: Member,
  endpoint: string,
  key: string | null,
  body: Record<string, unknown>
): Promise<{ status: number; body: unknown } | null> {
  if (!key) return null;
  const hash = hashBody(body);
  const row = (
    await client.query<{ status: number; response: unknown; body_hash: string }>(
      "SELECT status, response, body_hash FROM idempotency WHERE member_id = $1 AND endpoint = $2 AND key = $3 FOR UPDATE",
      [member.id, endpoint, key]
    )
  ).rows[0];
  if (!row) return null;
  if (row.body_hash !== hash) {
    throw new ApiError(409, "idempotency_conflict", "This Idempotency-Key was already used for a different request.");
  }
  return { status: row.status, body: row.response };
}

export async function storeIdempotent(
  client: PoolClient,
  member: Member,
  endpoint: string,
  key: string | null,
  body: Record<string, unknown>,
  response: { status: number; body: unknown }
): Promise<void> {
  if (!key) return;
  await client.query(
    `INSERT INTO idempotency (key, member_id, endpoint, body_hash, status, response)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (member_id, endpoint, key) DO NOTHING`,
    [key, member.id, endpoint, hashBody(body), response.status, JSON.stringify(response.body)]
  );
}

export function hashBody(body: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

export function idempotencyKeyOf(req: IncomingMessage): string | null {
  const key = req.headers["idempotency-key"];
  if (typeof key === "string" && key.trim().length >= 1 && key.trim().length <= 100) return key.trim();
  return null;
}

export function respondJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

export function respondError(res: ServerResponse, err: ApiError): void {
  const inner: Record<string, unknown> = { code: err.code, message: err.message };
  if (err.fields) inner.fields = err.fields;
  if (err.extra) Object.assign(inner, err.extra);
  res.writeHead(err.status, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: inner }));
}

export { analyzeSketch, labelWord, needsValue, newId, refsValidFor, staleRevision, invalidFields };
export type { Plane };
export type { IncomingMessage };
