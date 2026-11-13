import type { PoolClient } from "pg";
import type { Member, Part, SketchEntity } from "../../shared/types.js";
import {
  invalidFields,
  notFound,
  overConstrained,
  profileNotReady,
  sketchDrivesFeature,
  storageUnavailable,
  unsolvable
} from "../errors.js";
import { analyzeSketch, labelWord, nameConflict, needsValue, newId, refsValidFor, solveSketch } from "../sketchService.js";
import { loadPart, loadSketch, materialOf, sketchConstraints, sketchEntities } from "../repo.js";
import {
  baseRevisionField,
  checkRevision,
  entityGeometryRecord,
  idempotentReplay,
  idempotencyKeyOf,
  parseEntity,
  partResponse,
  rebuildAndSave,
  requireFounder,
  respondJson,
  safeRollback,
  sketchResponse,
  storeIdempotent
} from "../handlersCommon.js";
import { lengthField, toleranceField } from "../apiCore.js";
import { profileOf } from "../../shared/geometry.js";
import type { BodyStore } from "../storage.js";

/** Part and sketch endpoints. */

type ServerResponse = import("node:http").ServerResponse;
type SketchLoaded = NonNullable<Awaited<ReturnType<typeof loadSketch>>>;

export async function handleListParts(client: PoolClient, res: ServerResponse): Promise<void> {
  const rows = (await client.query<{ id: string }>("SELECT id FROM parts ORDER BY name")).rows;
  const parts: Part[] = [];
  for (const row of rows) {
    parts.push(await partResponse(client, row.id));
  }
  respondJson(res, 200, { parts });
}

export async function nameUsed(client: PoolClient, name: string, exceptId?: string): Promise<boolean> {
  const lower = name.trim().toLowerCase();
  const results = [
    await client.query<{ one: number }>("SELECT 1 AS one FROM parts WHERE lower(name) = $1 AND ($2::text IS NULL OR id <> $2)", [lower, exceptId ?? null]),
    await client.query<{ one: number }>("SELECT 1 AS one FROM purchased_parts WHERE lower(name) = $1 AND ($2::text IS NULL OR id <> $2)", [lower, exceptId ?? null]),
    await client.query<{ one: number }>("SELECT 1 AS one FROM assemblies WHERE lower(name) = $1 AND ($2::text IS NULL OR id <> $2)", [lower, exceptId ?? null])
  ];
  return results.some((r) => (r.rowCount ?? 0) > 0);
}

export async function handleCreatePart(
  client: PoolClient,
  body: Record<string, unknown>,
  member: Member,
  res: ServerResponse
): Promise<void> {
  requireFounder(member);
  const name = typeof body.name === "string" ? body.name : "";
  const materialId = typeof body.material_id === "string" ? body.material_id : "";
  const fields: Record<string, string> = {};
  if (name.trim().length === 0 || name.length > 80) fields.name = "Enter a name of 1 to 80 characters.";
  const material = materialId ? await materialOf(client, materialId) : null;
  if (!material) fields.material_id = "Choose one of the listed materials.";
  if (Object.keys(fields).length > 0) throw invalidFields(fields);
  if (await nameUsed(client, name)) throw invalidFields({ name: "That name is already used." });
  const id = newId();
  await client.query(
    `INSERT INTO parts (id, name, material_id, revision, body_status, last_saved_by)
     VALUES ($1, $2, $3, 1, 'none', $4)`,
    [id, name.trim(), materialId, member.id]
  );
  respondJson(res, 201, { part: await partResponse(client, id) });
}

export async function handleGetPart(client: PoolClient, partId: string, res: ServerResponse): Promise<void> {
  const loaded = await loadPart(client, partId);
  if (!loaded) throw notFound();
  respondJson(res, 200, { part: await partResponse(client, partId) });
}

export async function handlePatchPart(
  client: PoolClient,
  partId: string,
  body: Record<string, unknown>,
  member: Member,
  store: BodyStore,
  res: ServerResponse
): Promise<void> {
  requireFounder(member);
  await client.query("BEGIN");
  try {
    const loaded = await loadPart(client, partId);
    if (!loaded) throw notFound();
    const base = baseRevisionField(body);
    await checkRevision(client, "parts", partId, base, loaded.part.name, member);
    const fields: Record<string, string> = {};
    let name = loaded.part.name;
    if (body.name !== undefined) {
      const candidate = typeof body.name === "string" ? body.name : "";
      if (candidate.trim().length === 0 || candidate.length > 80) fields.name = "Enter a name of 1 to 80 characters.";
      else if (await nameUsed(client, candidate, partId)) fields.name = "That name is already used.";
      else name = candidate.trim();
    }
    let materialId = loaded.part.material_id;
    if (body.material_id !== undefined) {
      const candidate = typeof body.material_id === "string" ? body.material_id : "";
      if (!(await materialOf(client, candidate))) fields.material_id = "Choose one of the listed materials.";
      else materialId = candidate;
    }
    if (Object.keys(fields).length > 0) throw invalidFields(fields);
    await client.query(
      "UPDATE parts SET name = $1, material_id = $2, revision = revision + 1, last_saved_by = $3 WHERE id = $4",
      [name, materialId, member.id, partId]
    );
    const outcome = await rebuildAndSave(client, member, store, partId);
    await client.query("COMMIT");
    respondJson(res, 200, { part: outcome.part });
  } catch (err) {
    await safeRollback(client);
    throw err;
  }
}

export async function handleSavePart(
  client: PoolClient,
  partId: string,
  member: Member,
  store: BodyStore,
  res: ServerResponse
): Promise<void> {
  const loaded = await loadPart(client, partId);
  if (!loaded) throw notFound();
  if (loaded.features.length === 0) {
    respondJson(res, 200, { part: await partResponse(client, partId) });
    return;
  }
  await client.query("BEGIN");
  try {
    const outcome = await rebuildAndSave(client, member, store, partId);
    await client.query("COMMIT");
    respondJson(res, 200, { part: outcome.part });
  } catch (err) {
    await safeRollback(client);
    throw err;
  }
}

export async function handleGetBody(
  client: PoolClient,
  partId: string,
  store: BodyStore,
  res: ServerResponse
): Promise<void> {
  const loaded = await loadPart(client, partId);
  if (!loaded) throw notFound();
  if (loaded.part.confirmed_build === null || !loaded.part.confirmed_object_key) throw notFound();
  const content = await store.getBody(loaded.part.confirmed_object_key);
  if (content === null) throw storageUnavailable();
  res.writeHead(200, { "content-type": "application/json" });
  res.end(content);
}

export async function handleCreateSketch(
  client: PoolClient,
  partId: string,
  body: Record<string, unknown>,
  member: Member,
  res: ServerResponse
): Promise<void> {
  requireFounder(member);
  await client.query("BEGIN");
  try {
    const loaded = await loadPart(client, partId);
    if (!loaded) throw notFound();
    const base = baseRevisionField(body);
    await checkRevision(client, "parts", partId, base, loaded.part.name, member);
    const plane = body.plane;
    if (plane !== "top" && plane !== "front" && plane !== "right") {
      throw invalidFields({ plane: "Choose one of the listed options." });
    }
    const offset = lengthField(body.offset, member, "coordinate");
    if (!("value" in offset)) throw invalidFields({ offset: offset.error });
    const sketchId = newId();
    const number = loaded.part.next_sketch_number + 1;
    await client.query(
      `INSERT INTO sketches (id, part_id, name, plane, offset_mm, revision, slack, entity_counters, constraint_counters, last_saved_by)
       VALUES ($1, $2, $3, $4, $5, 1, 0, '{}', '{}', $6)`,
      [sketchId, partId, `Sketch ${number}`, plane, (offset as { value: number }).value, member.id]
    );
    await client.query(
      "UPDATE parts SET next_sketch_number = $1, revision = revision + 1, last_saved_by = $2 WHERE id = $3",
      [number, member.id, partId]
    );
    await client.query("COMMIT");
    respondJson(res, 201, {
      sketch: await sketchResponse(client, sketchId),
      part: await partResponse(client, partId)
    });
  } catch (err) {
    await safeRollback(client);
    throw err;
  }
}

export async function handleCreateFeature(
  client: PoolClient,
  partId: string,
  body: Record<string, unknown>,
  member: Member,
  req: import("node:http").IncomingMessage,
  store: BodyStore,
  res: ServerResponse
): Promise<void> {
  requireFounder(member);
  const key = idempotencyKeyOf(req);
  if (!key) throw invalidFields({ idempotency_key: "Send an Idempotency-Key header of 1 to 100 visible characters." });
  const endpoint = `/api/parts/${partId}/features`;
  await client.query("BEGIN");
  try {
    const replay = await idempotentReplay(client, member, endpoint, key, body);
    if (replay) {
      await client.query("COMMIT");
      respondJson(res, replay.status, replay.body, { "Idempotent-Replayed": "true" });
      return;
    }
    const loaded = await loadPart(client, partId);
    if (!loaded) throw notFound();
    const base = baseRevisionField(body);
    await checkRevision(client, "parts", partId, base, loaded.part.name, member);
    const operation = body.operation;
    const direction = body.direction;
    const depth = lengthField(body.depth, member, "length");
    const fields: Record<string, string> = {};
    const isFirst = loaded.features.length === 0;
    if (operation !== "new" && operation !== "join" && operation !== "cut" && operation !== "intersect") {
      fields.operation = "The first extrude makes the body; later extrudes join, cut or intersect.";
    } else if (isFirst && operation !== "new") {
      fields.operation = "The first extrude makes the body; later extrudes join, cut or intersect.";
    } else if (!isFirst && operation === "new") {
      fields.operation = "The first extrude makes the body; later extrudes join, cut or intersect.";
    }
    if (direction !== "normal" && direction !== "reverse" && direction !== "symmetric") {
      fields.direction = "Choose one of the listed options.";
    }
    if (!("value" in depth)) fields.depth = (depth as { error: string }).error;
    const sketchId = typeof body.sketch_id === "string" ? body.sketch_id : "";
    const sketch = loaded.sketches.find((s) => s.id === sketchId);
    if (!sketch) fields.sketch_id = "Choose one of the listed sketches.";
    if (Object.keys(fields).length > 0) throw invalidFields(fields);
    const entities = await sketchEntities(client, sketchId);
    const constraints = await sketchConstraints(client, sketchId, entities);
    const analysis = analyzeSketch(entities, constraints);
    const profile = profileOf(entities);
    if (!analysis.fullyHeld || "error" in profile) {
      throw profileNotReady(sketch!.name);
    }
    const featureId = newId();
    const number = loaded.part.next_feature_number + 1;
    await client.query(
      `INSERT INTO features (id, part_id, sketch_id, name, operation, depth_mm, direction, number)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [featureId, partId, sketchId, `Extrude ${number}`, operation, (depth as { value: number }).value, direction, number]
    );
    await client.query(
      "UPDATE parts SET next_feature_number = $1, revision = revision + 1, last_saved_by = $2 WHERE id = $3",
      [number, member.id, partId]
    );
    const outcome = await rebuildAndSave(client, member, store, partId);
    const feature = outcome.part.features.find((f) => f.id === featureId);
    const responseBody = { feature, part: outcome.part };
    await storeIdempotent(client, member, endpoint, key, body, { status: 201, body: responseBody });
    await client.query("COMMIT");
    respondJson(res, 201, responseBody);
  } catch (err) {
    await safeRollback(client);
    throw err;
  }
}

export async function handlePatchFeature(
  client: PoolClient,
  partId: string,
  featureId: string,
  body: Record<string, unknown>,
  member: Member,
  store: BodyStore,
  res: ServerResponse
): Promise<void> {
  requireFounder(member);
  await client.query("BEGIN");
  try {
    const loaded = await loadPart(client, partId);
    if (!loaded) throw notFound();
    const feature = loaded.features.find((f) => f.id === featureId);
    if (!feature) throw notFound();
    const base = baseRevisionField(body);
    await checkRevision(client, "parts", partId, base, loaded.part.name, member);
    const fields: Record<string, string> = {};
    let depth = feature.depth_mm;
    if (body.depth !== undefined) {
      const parsed = lengthField(body.depth, member, "length");
      if ("error" in parsed) fields.depth = parsed.error;
      else depth = parsed.value;
    }
    let direction = feature.direction;
    if (body.direction !== undefined) {
      if (body.direction !== "normal" && body.direction !== "reverse" && body.direction !== "symmetric") {
        fields.direction = "Choose one of the listed options.";
      } else direction = body.direction;
    }
    if (Object.keys(fields).length > 0) throw invalidFields(fields);
    await client.query("UPDATE features SET depth_mm = $1, direction = $2 WHERE id = $3", [depth, direction, featureId]);
    await client.query("UPDATE parts SET revision = revision + 1, last_saved_by = $1 WHERE id = $2", [member.id, partId]);
    const outcome = await rebuildAndSave(client, member, store, partId);
    const updated = outcome.part.features.find((f) => f.id === featureId)!;
    await client.query("COMMIT");
    respondJson(res, 200, { feature: updated, part: outcome.part });
  } catch (err) {
    await safeRollback(client);
    throw err;
  }
}

// ---- Sketch entities and constraints ----

async function drivesOf(client: PoolClient, sketchId: string): Promise<{ id: string; name: string } | null> {
  const row = (
    await client.query<{ id: string; name: string }>(
      "SELECT id, name FROM features WHERE sketch_id = $1 ORDER BY number LIMIT 1",
      [sketchId]
    )
  ).rows[0];
  return row ?? null;
}

export async function handleGetSketch(client: PoolClient, sketchId: string, res: ServerResponse): Promise<void> {
  const loaded = await loadSketch(client, sketchId);
  if (!loaded) throw notFound();
  respondJson(res, 200, { sketch: await sketchResponse(client, sketchId) });
}

export async function handlePostEntity(
  client: PoolClient,
  sketchId: string,
  body: Record<string, unknown>,
  member: Member,
  store: BodyStore,
  res: ServerResponse
): Promise<void> {
  await client.query("BEGIN");
  try {
    const loaded = await loadSketch(client, sketchId);
    if (!loaded) throw notFound();
    const base = baseRevisionField(body);
    await checkRevision(client, "sketches", sketchId, base, `${loaded.sketch.name} on ${loaded.part.name}`, member);
    const entitySpec = body.entity as Record<string, unknown> | undefined;
    if (!entitySpec || typeof entitySpec !== "object") {
      throw invalidFields({ "entity.type": "Choose one of the listed options." });
    }
    const entity = parseEntity(entitySpec, member);
    const drives = await drivesOf(client, sketchId);
    const withNew = [...loaded.entities, entity];
    if (drives) {
      const analysis = analyzeSketch(withNew, loaded.constraints);
      if (!analysis.fullyHeld) throw sketchDrivesFeature(loaded.sketch.name, drives.name);
    }
    if (!solveSketch(withNew, loaded.constraints)) throw unsolvable();
    const counters = { ...loaded.sketch.entity_counters };
    const count = (counters[entity.type] ?? 0) + 1;
    counters[entity.type] = count;
    const label = `${entityLabelOf(entity.type)} ${count}`;
    const entityId = newId();
    const stored = { ...entity, id: entityId, label };
    await client.query(
      `INSERT INTO entities (id, sketch_id, type, label, number, geometry, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())`,
      [entityId, sketchId, entity.type, label, count, JSON.stringify(entityGeometryRecord(entity))]
    );
    await applySketchChange(client, member, loaded, withNew, loaded.constraints, counters, loaded.sketch.constraint_counters, store);
    const sketch = await sketchResponse(client, sketchId);
    const part = await partResponse(client, loaded.part.id);
    await client.query("COMMIT");
    respondJson(res, 201, { sketch, part, entity: stored });
  } catch (err) {
    await safeRollback(client);
    throw err;
  }
}

function entityLabelOf(type: string): string {
  switch (type) {
    case "point":
      return "Point";
    case "line":
      return "Line";
    case "circle":
      return "Circle";
    default:
      return "Arc";
  }
}

export async function handleDeleteEntity(
  client: PoolClient,
  sketchId: string,
  entityId: string,
  query: URLSearchParams,
  member: Member,
  store: BodyStore,
  res: ServerResponse
): Promise<void> {
  await client.query("BEGIN");
  try {
    const loaded = await loadSketch(client, sketchId);
    if (!loaded) throw notFound();
    const entity = loaded.entities.find((e) => e.id === entityId);
    if (!entity) throw notFound();
    const base = Number(query.get("base_revision"));
    if (!Number.isInteger(base)) throw invalidFields({ base_revision: "Send the revision you started from." });
    await checkRevision(client, "sketches", sketchId, base, `${loaded.sketch.name} on ${loaded.part.name}`, member);
    const drives = await drivesOf(client, sketchId);
    const remainingEntities = loaded.entities.filter((e) => e.id !== entityId);
    const removedConstraints = loaded.constraints.filter((c) =>
      c.refs.some((r) => r === entityId || r.startsWith(`${entityId}.`))
    );
    const remainingConstraints = loaded.constraints.filter((c) => !removedConstraints.includes(c));
    if (drives) {
      const analysis = analyzeSketch(remainingEntities, remainingConstraints);
      if (!analysis.fullyHeld) throw sketchDrivesFeature(loaded.sketch.name, drives.name);
    }
    await client.query("DELETE FROM constraints WHERE id = ANY($1::text[])", [removedConstraints.map((c) => c.id)]);
    await client.query("DELETE FROM entities WHERE id = $1", [entityId]);
    await applySketchChange(client, member, loaded, remainingEntities, remainingConstraints, loaded.sketch.entity_counters, loaded.sketch.constraint_counters, store);
    const sketch = await sketchResponse(client, sketchId);
    const part = await partResponse(client, loaded.part.id);
    await client.query("COMMIT");
    respondJson(res, 200, { sketch, part });
  } catch (err) {
    await safeRollback(client);
    throw err;
  }
}

export async function handlePostConstraint(
  client: PoolClient,
  sketchId: string,
  body: Record<string, unknown>,
  member: Member,
  store: BodyStore,
  res: ServerResponse
): Promise<void> {
  await client.query("BEGIN");
  try {
    const loaded = await loadSketch(client, sketchId);
    if (!loaded) throw notFound();
    const base = baseRevisionField(body);
    await checkRevision(client, "sketches", sketchId, base, `${loaded.sketch.name} on ${loaded.part.name}`, member);
    const kind = body.kind;
    const validKinds = [
      "coincident", "horizontal", "vertical", "parallel", "perpendicular",
      "equal", "fix", "distance", "horizontal_distance", "vertical_distance",
      "diameter", "radius"
    ];
    if (typeof kind !== "string" || !validKinds.includes(kind)) {
      throw invalidFields({ kind: "Choose one of the listed options." });
    }
    const refs = body.refs;
    if (!Array.isArray(refs) || !refsValidFor(kind as never, refs as string[], loaded.entities)) {
      throw invalidFields({ refs: `These entities cannot take a ${labelWord(kind as never)} constraint.` });
    }
    let value: number | undefined;
    if (needsValue(kind as never)) {
      const parsed = lengthField(body.value, member, "length");
      if ("error" in parsed) throw invalidFields({ value: parsed.error });
      value = parsed.value;
    }
    let tolerance: unknown;
    if (body.tolerance !== undefined) {
      const parsed = toleranceField(body.tolerance, member);
      if ("error" in parsed) throw invalidFields({ tolerance: parsed.error });
      tolerance = parsed.value;
    }
    const fixTargets = new Map<string, { x: number; y: number }>();
    if (kind === "fix") {
      for (const ref of refs as string[]) {
        const entity = loaded.entities.find((e) => e.id === ref);
        if (entity?.type === "point") fixTargets.set(ref, { x: entity.x, y: entity.y });
        else if (entity?.type === "line") fixTargets.set(ref, { x: entity.start.x, y: entity.start.y });
        else if (entity?.type === "circle" || entity?.type === "arc")
          fixTargets.set(ref, { x: entity.center.x, y: entity.center.y });
      }
    }
    const counters = { ...loaded.sketch.constraint_counters };
    const proposedLabel = `${labelWord(kind as never)} ${(counters[kind] ?? 0) + 1}`;
    const trialConstraints = [
      ...loaded.constraints,
      {
        id: "trial",
        kind: kind as never,
        label: proposedLabel,
        refs: refs as string[],
        value_mm: value,
        tolerance: (tolerance ?? null) as never,
        redundant: false,
        fixTargets,
        createdAt: new Date()
      }
    ];
    if (!solveSketch(loaded.entities, trialConstraints)) {
      const conflict = nameConflict(
        { kind: kind as never, refs: refs as string[], value_mm: value },
        loaded.constraints,
        loaded.entities
      );
      throw overConstrained(proposedLabel, conflict ?? { id: "", label: proposedLabel });
    }
    const analysis = analyzeSketch(loaded.entities, trialConstraints);
    const count = (counters[kind] ?? 0) + 1;
    counters[kind] = count;
    const label = `${labelWord(kind as never)} ${count}`;
    const constraintId = newId();
    const redundant = analysis.redundant.get("trial") ?? false;
    await client.query(
      `INSERT INTO constraints (id, sketch_id, kind, label, number, refs, value_mm, tolerance, redundant, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9, now())`,
      [constraintId, sketchId, kind, label, count, JSON.stringify(refs), value ?? null, JSON.stringify(tolerance ?? null), redundant]
    );
    const stored = [
      ...loaded.constraints,
      {
        id: constraintId,
        kind: kind as never,
        label,
        refs: refs as string[],
        value_mm: value,
        tolerance: (tolerance ?? null) as never,
        redundant,
        fixTargets,
        createdAt: new Date()
      }
    ];
    await applySketchChange(client, member, loaded, loaded.entities, stored, loaded.sketch.entity_counters, counters, store);
    const sketch = await sketchResponse(client, sketchId);
    const part = await partResponse(client, loaded.part.id);
    await client.query("COMMIT");
    respondJson(res, 201, {
      sketch,
      part,
      constraint: sketch.constraints.find((c) => c.id === constraintId)
    });
  } catch (err) {
    await safeRollback(client);
    throw err;
  }
}

export async function handlePatchConstraint(
  client: PoolClient,
  sketchId: string,
  constraintId: string,
  body: Record<string, unknown>,
  member: Member,
  store: BodyStore,
  res: ServerResponse
): Promise<void> {
  await client.query("BEGIN");
  try {
    const loaded = await loadSketch(client, sketchId);
    if (!loaded) throw notFound();
    const constraint = loaded.constraints.find((c) => c.id === constraintId);
    if (!constraint) throw notFound();
    const base = baseRevisionField(body);
    await checkRevision(client, "sketches", sketchId, base, `${loaded.sketch.name} on ${loaded.part.name}`, member);
    const fields: Record<string, string> = {};
    let value = constraint.value_mm;
    if (body.value !== undefined) {
      const parsed = lengthField(body.value, member, "length");
      if ("error" in parsed) fields.value = parsed.error;
      else value = parsed.value;
    }
    let tolerance = constraint.tolerance ?? null;
    if (body.tolerance !== undefined) {
      const parsed = toleranceField(body.tolerance, member);
      if ("error" in parsed) fields.tolerance = parsed.error;
      else tolerance = parsed.value as typeof tolerance;
    }
    if (Object.keys(fields).length > 0) throw invalidFields(fields);
    const updated = { ...constraint, value_mm: value, tolerance };
    const trial = loaded.constraints.map((c) => (c.id === constraintId ? updated : c));
    if (!solveSketch(loaded.entities, trial)) throw unsolvable();
    await client.query("UPDATE constraints SET value_mm = $1, tolerance = $2::jsonb WHERE id = $3", [
      value ?? null,
      JSON.stringify(tolerance),
      constraintId
    ]);
    await applySketchChange(client, member, loaded, loaded.entities, trial, loaded.sketch.entity_counters, loaded.sketch.constraint_counters, store);
    const sketch = await sketchResponse(client, sketchId);
    const part = await partResponse(client, loaded.part.id);
    await client.query("COMMIT");
    respondJson(res, 200, {
      sketch,
      part,
      constraint: sketch.constraints.find((c) => c.id === constraintId)
    });
  } catch (err) {
    await safeRollback(client);
    throw err;
  }
}

export async function handleDeleteConstraint(
  client: PoolClient,
  sketchId: string,
  constraintId: string,
  query: URLSearchParams,
  member: Member,
  store: BodyStore,
  res: ServerResponse
): Promise<void> {
  await client.query("BEGIN");
  try {
    const loaded = await loadSketch(client, sketchId);
    if (!loaded) throw notFound();
    const constraint = loaded.constraints.find((c) => c.id === constraintId);
    if (!constraint) throw notFound();
    const base = Number(query.get("base_revision"));
    if (!Number.isInteger(base)) throw invalidFields({ base_revision: "Send the revision you started from." });
    await checkRevision(client, "sketches", sketchId, base, `${loaded.sketch.name} on ${loaded.part.name}`, member);
    const drives = await drivesOf(client, sketchId);
    const remaining = loaded.constraints.filter((c) => c.id !== constraintId);
    if (drives) {
      const analysis = analyzeSketch(loaded.entities, remaining);
      if (!analysis.fullyHeld) throw sketchDrivesFeature(loaded.sketch.name, drives.name);
    }
    await client.query("DELETE FROM constraints WHERE id = $1", [constraintId]);
    await applySketchChange(client, member, loaded, loaded.entities, remaining, loaded.sketch.entity_counters, loaded.sketch.constraint_counters, store);
    const sketch = await sketchResponse(client, sketchId);
    const part = await partResponse(client, loaded.part.id);
    await client.query("COMMIT");
    respondJson(res, 200, { sketch, part });
  } catch (err) {
    await safeRollback(client);
    throw err;
  }
}

/** Persist solved geometry, refreshed redundancy, slack and revisions. */
async function applySketchChange(
  client: PoolClient,
  member: Member,
  loaded: SketchLoaded,
  entities: SketchEntity[],
  constraints: SketchLoaded["constraints"],
  entityCounters: Record<string, number>,
  constraintCounters: Record<string, number>,
  store: BodyStore
): Promise<void> {
  const analysis = analyzeSketch(entities, constraints);
  for (const c of constraints) {
    const redundant = analysis.redundant.get(c.id) ?? false;
    if (c.redundant !== redundant) {
      await client.query("UPDATE constraints SET redundant = $1 WHERE id = $2", [redundant, c.id]);
      c.redundant = redundant;
    }
  }
  for (const entity of entities) {
    await client.query("UPDATE entities SET geometry = $1::jsonb WHERE id = $2", [
      JSON.stringify(entityGeometryRecord(entity)),
      entity.id
    ]);
  }
  await client.query(
    `UPDATE sketches SET slack = $1, revision = revision + 1, entity_counters = $2::jsonb,
     constraint_counters = $3::jsonb, last_saved_by = $4 WHERE id = $5`,
    [analysis.slack, JSON.stringify(entityCounters), JSON.stringify(constraintCounters), member.id, loaded.sketch.id]
  );
  await client.query("UPDATE parts SET revision = revision + 1, last_saved_by = $1 WHERE id = $2", [
    member.id,
    loaded.part.id
  ]);
  if (loaded.part.body_status !== "none") {
    await rebuildAndSave(client, member, store, loaded.part.id);
  }
}
