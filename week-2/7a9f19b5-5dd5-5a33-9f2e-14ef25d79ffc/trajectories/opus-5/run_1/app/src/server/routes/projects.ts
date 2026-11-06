/**
 * Projects: lines, room placements, cover images, collaborators, comments and the
 * live stream. Only the owner and the collaborators can see a project; everyone
 * else gets the not-found answer.
 */

import { randomUUID } from "node:crypto";
import { query, queryOne, transaction } from "../db/pool.js";
import { isValidEmail, LIMITS } from "../../shared/domain.js";
import { hasTradeAccount } from "../../shared/projection.js";
import type { Comment, ProjectSummary, User } from "../../shared/types.js";
import { HEALTH_PROBE_TIMEOUT_MS } from "../config.js";
import { isMultipart, readJson, sendJson, sendNoContent, type Ctx } from "../http/context.js";
import {
  collaborationUnavailable,
  notFound,
  ownerOnly,
  payloadTooLarge,
  placementExceedsQuantity,
  placementsOutsideRoom,
  storageUnavailable,
  unknownVariant,
  unsupportedMediaType,
  validation,
} from "../http/errors.js";
import { requireTradeAccount, requireUser } from "../http/router.js";
import { FieldErrors, optionalInteger, optionalString, requiredInteger, requiredString } from "../http/validate.js";
import {
  buildProject,
  buildProjectSummary,
  countPlacements,
  findVisibleProject,
  isInsideRoom,
  lineQuantity,
  listProjectsFor,
  lockProject,
  nextOrdinal,
  placementDto,
  placementsOutside,
  singlePlacement,
  type ProjectRow,
} from "../domain/projects.js";
import { loadVariant } from "../domain/catalogue.js";
import { getObject, objectExists, objectKeys, putObject } from "../services/storage.js";
import * as pocketbase from "../services/pocketbase.js";
import { ProviderUnavailable } from "../services/provider.js";
import { parseSingleFilePart } from "../http/multipart.js";
import { publishPlacement, subscribeToProject } from "./live.js";

/** Whether live collaboration is connected right now. */
async function liveNow(): Promise<boolean> {
  try {
    await pocketbase.ping(HEALTH_PROBE_TIMEOUT_MS);
    return true;
  } catch {
    return false;
  }
}

async function visibleProject(ctx: Ctx, user: User): Promise<ProjectRow> {
  const found = await findVisibleProject(ctx.params.id ?? "", user.id);
  if (!found) throw notFound();
  return found;
}

export async function createProject(ctx: Ctx): Promise<void> {
  const user = requireTradeAccount(ctx);
  const body = readJson<Record<string, unknown>>(ctx);

  const errors = new FieldErrors();
  const name = requiredString(errors, "name", body.name, { max: 120 });
  const clientName = optionalString(errors, "client_name", body.client_name, { max: 120 });
  const ceiling =
    optionalInteger(errors, "ceiling_height_mm", body.ceiling_height_mm, LIMITS.ceilingHeightMm) ??
    LIMITS.ceilingHeightMm.default;
  const width =
    optionalInteger(errors, "room_width_mm", body.room_width_mm, LIMITS.roomWidthMm) ?? LIMITS.roomWidthMm.default;
  const depth =
    optionalInteger(errors, "room_depth_mm", body.room_depth_mm, LIMITS.roomDepthMm) ?? LIMITS.roomDepthMm.default;
  errors.throwIfAny();

  const created = await queryOne<ProjectRow>(
    `INSERT INTO projects (name, client_name, owner_id, ceiling_height_mm, room_width_mm, room_depth_mm)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [name, clientName, user.id, ceiling, width, depth],
  );
  if (!created) throw new Error("failed to create the project");

  sendJson(ctx.res, 201, { project: await buildProject(created, user.id, await liveNow()) });
}

export async function listProjects(ctx: Ctx): Promise<void> {
  const user = requireTradeAccount(ctx);
  const live = await liveNow();
  const records = await listProjectsFor(user.id);
  const projects: ProjectSummary[] = [];
  for (const record of records) projects.push(await buildProjectSummary(record, user.id, live));
  sendJson(ctx.res, 200, { projects });
}

export async function getProject(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const record = await visibleProject(ctx, user);
  sendJson(ctx.res, 200, { project: await buildProject(record, user.id, await liveNow()) });
}

export async function patchProject(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const record = await visibleProject(ctx, user);
  const body = readJson<Record<string, unknown>>(ctx);

  const errors = new FieldErrors();
  const name = body.name === undefined ? null : requiredString(errors, "name", body.name, { max: 120 });
  const clientName =
    body.client_name === undefined ? undefined : optionalString(errors, "client_name", body.client_name, { max: 120 });
  const ceiling = optionalInteger(errors, "ceiling_height_mm", body.ceiling_height_mm, LIMITS.ceilingHeightMm);
  const width = optionalInteger(errors, "room_width_mm", body.room_width_mm, LIMITS.roomWidthMm);
  const depth = optionalInteger(errors, "room_depth_mm", body.room_depth_mm, LIMITS.roomDepthMm);
  errors.throwIfAny();

  const updated = await transaction(async (client) => {
    const locked = await lockProject(client, record.id);
    if (!locked) throw notFound();

    const nextWidth = width ?? locked.room_width_mm;
    const nextDepth = depth ?? locked.room_depth_mm;
    if ((await placementsOutside(client, locked.id, nextWidth, nextDepth)) > 0) throw placementsOutsideRoom();

    await client.query(
      `UPDATE projects SET
         name = COALESCE($2, name),
         client_name = CASE WHEN $3::boolean THEN $4 ELSE client_name END,
         ceiling_height_mm = COALESCE($5, ceiling_height_mm),
         room_width_mm = $6,
         room_depth_mm = $7
       WHERE id = $1`,
      [locked.id, name, clientName !== undefined, clientName ?? null, ceiling, nextWidth, nextDepth],
    );
    const reloaded = await lockProject(client, locked.id);
    if (!reloaded) throw new Error("the project disappeared while it was being changed");
    return reloaded;
  });

  sendJson(ctx.res, 200, { project: await buildProject(updated, user.id, await liveNow()) });
}

export async function addProjectLine(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const record = await visibleProject(ctx, user);
  const body = readJson<{ variant_code?: unknown; quantity?: unknown }>(ctx);

  const errors = new FieldErrors();
  const code = requiredString(errors, "variant_code", body.variant_code, { max: 40 });
  const quantity = requiredInteger(errors, "quantity", body.quantity, LIMITS.quantity);
  errors.throwIfAny();

  if (!(await loadVariant(code))) throw unknownVariant();

  await query(
    `INSERT INTO project_lines (project_id, variant_code, quantity)
     VALUES ($1,$2,$3)
     ON CONFLICT (project_id, variant_code)
       DO UPDATE SET quantity = LEAST(project_lines.quantity + EXCLUDED.quantity, $4)`,
    [record.id, code, quantity, LIMITS.quantity.max],
  );

  sendJson(ctx.res, 200, { project: await buildProject(record, user.id, await liveNow()) });
}

export async function setProjectLineQuantity(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const record = await visibleProject(ctx, user);
  const code = ctx.params.code ?? "";
  const body = readJson<{ quantity?: unknown }>(ctx);

  const errors = new FieldErrors();
  const quantity = requiredInteger(errors, "quantity", body.quantity, { min: 0, max: LIMITS.quantity.max });
  errors.throwIfAny();

  await transaction(async (client) => {
    const locked = await lockProject(client, record.id);
    if (!locked) throw notFound();
    if ((await lineQuantity(client, locked.id, code)) === 0) throw notFound();

    // Lowering a quantity below the placed count is refused.
    if (quantity < (await countPlacements(client, locked.id, code))) throw placementExceedsQuantity();

    if (quantity === 0) {
      await client.query("DELETE FROM project_lines WHERE project_id = $1 AND variant_code = $2", [
        locked.id,
        code,
      ]);
    } else {
      await client.query("UPDATE project_lines SET quantity = $3 WHERE project_id = $1 AND variant_code = $2", [
        locked.id,
        code,
        quantity,
      ]);
    }
  });

  sendJson(ctx.res, 200, { project: await buildProject(record, user.id, await liveNow()) });
}

const COVER_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** A cover counts as ready only once the stored object is confirmed to exist. */
export async function uploadCover(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const record = await visibleProject(ctx, user);
  if (!isMultipart(ctx.contentType)) throw unsupportedMediaType();

  const part = parseSingleFilePart(ctx.body, ctx.contentType, "image");
  if (!part) throw validation({ image: "required" });
  if (part.content.length > LIMITS.coverImageBytes) throw payloadTooLarge();

  const extension = COVER_TYPES[part.contentType.toLowerCase()];
  if (!extension) throw validation({ image: "unsupported_type" });

  const key = objectKeys.cover(record.id, randomUUID(), extension);
  try {
    await putObject(key, part.content, part.contentType);
    if (!(await objectExists(key))) throw new ProviderUnavailable("minio");
  } catch (error) {
    if (error instanceof ProviderUnavailable) throw storageUnavailable();
    throw error;
  }

  await query("UPDATE projects SET cover_key = $2 WHERE id = $1", [record.id, key]);
  sendJson(ctx.res, 201, { cover: { status: "ready", url: `/api/projects/${record.id}/cover` } });
}

export async function getCover(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const record = await visibleProject(ctx, user);
  if (!record.cover_key) throw notFound();

  const bytes = await getObject(record.cover_key);
  if (!bytes) throw notFound();
  const extension = record.cover_key.split(".").pop() ?? "jpg";
  const contentType =
    Object.entries(COVER_TYPES).find(([, value]) => value === extension)?.[0] ?? "application/octet-stream";

  ctx.res.writeHead(200, {
    "content-type": contentType,
    "content-length": bytes.length,
    "cache-control": "no-store",
  });
  ctx.res.end(bytes);
}

export async function createPlacement(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const record = await visibleProject(ctx, user);
  const body = readJson<{ variant_code?: unknown; x_mm?: unknown; y_mm?: unknown }>(ctx);

  const errors = new FieldErrors();
  const code = requiredString(errors, "variant_code", body.variant_code, { max: 40 });
  const xMm = requiredInteger(errors, "x_mm", body.x_mm, { min: 0, max: record.room_width_mm });
  const yMm = requiredInteger(errors, "y_mm", body.y_mm, { min: 0, max: record.room_depth_mm });
  errors.throwIfAny();

  const placement = await transaction(async (client) => {
    const locked = await lockProject(client, record.id);
    if (!locked) throw notFound();
    if (!isInsideRoom(locked, xMm, yMm)) throw validation({ x_mm: "out_of_range" });

    const quantity = await lineQuantity(client, locked.id, code);
    if (quantity === 0) throw placementExceedsQuantity();
    if ((await countPlacements(client, locked.id, code)) >= quantity) throw placementExceedsQuantity();

    const ordinal = await nextOrdinal(client, locked.id, code);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO placements (project_id, variant_code, ordinal, x_mm, y_mm)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [locked.id, code, ordinal, xMm, yMm],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error("the placement was not saved");
    return placementDto(client, locked.id, row.id, locked.ceiling_height_mm);
  });

  // Placements always save to Postgres; the live relay is best effort.
  const live = await publishPlacement(record.id, "created", placement);
  sendJson(ctx.res, 201, { placement, live });
}

export async function movePlacement(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const record = await visibleProject(ctx, user);
  const body = readJson<{ x_mm?: unknown; y_mm?: unknown }>(ctx);

  const errors = new FieldErrors();
  const xMm = requiredInteger(errors, "x_mm", body.x_mm, { min: 0, max: record.room_width_mm });
  const yMm = requiredInteger(errors, "y_mm", body.y_mm, { min: 0, max: record.room_depth_mm });
  errors.throwIfAny();

  const placement = await transaction(async (client) => {
    const locked = await lockProject(client, record.id);
    if (!locked) throw notFound();
    const existing = await singlePlacement(client, locked.id, ctx.params.pid ?? "");
    if (!existing) throw notFound();

    await client.query("UPDATE placements SET x_mm = $2, y_mm = $3 WHERE id = $1", [existing.id, xMm, yMm]);
    return placementDto(client, locked.id, existing.id, locked.ceiling_height_mm);
  });

  const live = await publishPlacement(record.id, "updated", placement);
  sendJson(ctx.res, 200, { placement, live });
}

export async function deletePlacement(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const record = await visibleProject(ctx, user);

  const removed = await transaction(async (client) => {
    const locked = await lockProject(client, record.id);
    if (!locked) throw notFound();
    const existing = await singlePlacement(client, locked.id, ctx.params.pid ?? "");
    if (!existing) throw notFound();
    const dto = await placementDto(client, locked.id, existing.id, locked.ceiling_height_mm);
    await client.query("DELETE FROM placements WHERE id = $1", [existing.id]);
    return dto;
  });

  await publishPlacement(record.id, "deleted", removed);
  sendNoContent(ctx.res);
}

export async function addCollaborator(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const record = await visibleProject(ctx, user);
  if (record.owner_id !== user.id) throw ownerOnly();

  const body = readJson<{ email?: unknown }>(ctx);
  const errors = new FieldErrors();
  const email = requiredString(errors, "email", body.email, { max: 254 }).toLowerCase();
  if (email !== "" && !isValidEmail(email)) errors.set("email", "invalid");
  errors.throwIfAny();

  const invitee = await queryOne<{ id: string; name: string; email: string; role: string; trade_status: string | null }>(
    "SELECT id, name, email, role, trade_status FROM users WHERE email = $1",
    [email],
  );
  if (!invitee || !hasTradeAccount({ role: invitee.role as User["role"], trade_status: invitee.trade_status as User["trade_status"] })) {
    throw validation({ email: "not_a_trade_account" });
  }
  if (invitee.id === record.owner_id) throw validation({ email: "not_a_trade_account" });

  await query(
    "INSERT INTO project_collaborators (project_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
    [record.id, invitee.id],
  );
  sendJson(ctx.res, 201, {
    collaborator: { user_id: invitee.id, name: invitee.name, email: invitee.email },
  });
}

export async function removeCollaborator(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const record = await visibleProject(ctx, user);
  if (record.owner_id !== user.id) throw ownerOnly();

  await query("DELETE FROM project_collaborators WHERE project_id = $1 AND user_id = $2", [
    record.id,
    ctx.params.userId ?? "",
  ]);
  sendNoContent(ctx.res);
}

export async function listComments(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const record = await visibleProject(ctx, user);

  try {
    const records = await pocketbase.listComments(record.id);
    const comments: Comment[] = records.map((comment) => ({
      id: comment.id,
      author_name: comment.author_name,
      body: comment.body,
      created_at: comment.created,
    }));
    sendJson(ctx.res, 200, { comments });
  } catch (error) {
    if (error instanceof ProviderUnavailable) throw collaborationUnavailable();
    throw error;
  }
}

export async function postComment(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const record = await visibleProject(ctx, user);
  const body = readJson<{ body?: unknown }>(ctx);

  const errors = new FieldErrors();
  const text = requiredString(errors, "body", body.body, {
    min: LIMITS.commentBody.min,
    max: LIMITS.commentBody.max,
  });
  errors.throwIfAny();

  try {
    const created = await pocketbase.createComment({
      projectId: record.id,
      authorId: user.id,
      authorName: user.name,
      body: text,
    });
    sendJson(ctx.res, 201, {
      comment: {
        id: created.id,
        author_name: created.author_name,
        body: created.body,
        created_at: created.created,
      },
    });
  } catch (error) {
    if (error instanceof ProviderUnavailable) throw collaborationUnavailable();
    throw error;
  }
}

export async function liveStream(ctx: Ctx): Promise<void> {
  const user = requireUser(ctx);
  const record = await visibleProject(ctx, user);
  await subscribeToProject(ctx, record.id, user);
}
