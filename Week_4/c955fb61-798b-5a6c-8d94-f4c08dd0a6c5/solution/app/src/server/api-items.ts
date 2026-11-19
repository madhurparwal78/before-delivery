import type { PoolClient } from "pg";
import { ITEM_KINDS, type Role } from "../shared/types";
import { itemAccess, projectAccess } from "./auth";
import { planToday, settings } from "./config";
import { newId, pool } from "./db";
import { ApiError, invalidField, notFound, readOnly } from "./errors";
import { route, type Reply } from "./http";
import { parsePredecessors, PredecessorError } from "./links";
import { publishToProject } from "./live";
import { loadProject, type ItemRow, type LoadedProject } from "./model";
import { itemOf, mutateProject, type Mutated } from "./mutate";
import { moveIntoGroup, moveOutOfGroup, swapWithNeighbour, type RowPlace } from "./rows";
import * as check from "./validate";

export function requireWrite(access: { role: Role }): void {
  if (access.role === "viewer") throw readOnly();
}

async function accessToItem(personId: string, itemId: string) {
  const access = await itemAccess(personId, itemId);
  if (!access) throw notFound();
  return access;
}

/** The version check: an edit based on anything but the item's current version is refused with who changed it. */
function requireCurrentVersion(loaded: LoadedProject, item: ItemRow, baseVersion: number): void {
  if (item.version !== baseVersion) throw new ApiError(409, "version_conflict", { item: itemOf(loaded, item.id), by: item.updatedByName });
}

function baseVersionOf(body: Record<string, unknown>): number {
  const value = body.baseVersion;
  if (typeof value !== "number" || !Number.isInteger(value)) throw invalidField("baseVersion");
  return value;
}

export function findItem(loaded: LoadedProject, itemId: string): ItemRow {
  const item = loaded.items.find((candidate) => candidate.id === itemId);
  if (!item) throw notFound();
  return item;
}

async function writeOrder(tx: PoolClient, rows: readonly RowPlace[]): Promise<void> {
  await tx.query(
    `UPDATE items SET position = v.position, group_id = v.group_id
       FROM (SELECT unnest($1::text[]) AS id, unnest($2::int[]) AS position, unnest($3::text[]) AS group_id) v
      WHERE items.id = v.id`,
    [rows.map((row) => row.id), rows.map((_, index) => index + 1), rows.map((row) => row.group)],
  );
}

async function renumber(tx: PoolClient, projectId: string): Promise<void> {
  await tx.query(
    `UPDATE items SET position = r.position FROM
       (SELECT id, row_number() OVER (ORDER BY position) AS position FROM items WHERE project_id = $1) r WHERE items.id = r.id`,
    [projectId],
  );
}

const rowsOf = (loaded: LoadedProject): RowPlace[] => loaded.items.map((item) => ({ id: item.id, group: item.group }));

export const revHeader = (mutated: Mutated) => ({ "x-project-rev": String(mutated.rev) });

function itemReply(status: number, itemId: string, mutated: Mutated, extra: Record<string, unknown> = {}): Reply {
  return {
    status,
    body: { item: itemOf(mutated.after, itemId), moved: mutated.moved, finish: mutated.after.schedule.finish, ...extra },
    headers: revHeader(mutated),
  };
}

export async function bumpVersion(tx: PoolClient, itemId: string, personId: string): Promise<void> {
  await tx.query("UPDATE items SET version = version + 1, updated_by = $2 WHERE id = $1", [itemId, personId]);
}

route("POST", "/api/projects/:id/items", async ({ person, params, body }) => {
  const access = await projectAccess(person.id, params.id);
  if (!access) throw notFound();
  requireWrite(access);
  const name = check.text(body, "name", 1, 120);
  const kind = check.oneOf(body, "kind", ITEM_KINDS);
  let createdId = "";
  const mutated = await mutateProject(access.projectId, person, async (tx, before) => {
    const start = kind === "group" || !check.has(body, "start") ? planToday() : check.date(body, "start");
    const duration = kind === "group" || !check.has(body, "duration") ? (kind === "task" ? 1 : 0) : check.whole(body, "duration", 0, 999);
    if ((kind === "task" && duration < 1) || (kind === "milestone" && duration !== 0)) throw invalidField("duration");
    const groupId = body.group ?? null;
    const group = typeof groupId === "string" ? before.items.find((item) => item.id === groupId && item.kind === "group") : undefined;
    if (groupId !== null && (!group || kind === "group")) throw invalidField("group");
    createdId = newId();
    await tx.query(
      `INSERT INTO items (id, project_id, position, name, kind, chosen_start, duration, percent, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8)`,
      [createdId, before.id, before.items.length + 1, name, kind, kind === "group" ? null : before.calendar.nextWorking(start), duration, person.id],
    );
    if (group) await writeOrder(tx, moveIntoGroup([...rowsOf(before), { id: createdId, group: null }], createdId, group.id));
    return { kind: "add", itemId: createdId, itemName: name, schedule: true, editedId: createdId };
  });
  return itemReply(201, createdId, mutated);
});

route("PATCH", "/api/items/:id", async ({ person, params, body }) => {
  const access = await accessToItem(person.id, params.id);
  requireWrite(access);
  const baseVersion = baseVersionOf(body);
  const mutated = await mutateProject(access.projectId, person, async (tx, before) => {
    const item = findItem(before, params.id);
    requireCurrentVersion(before, item, baseVersion);
    const isGroup = item.kind === "group";
    const refuseOnGroup = (field: string) => {
      if (isGroup && check.has(body, field)) throw invalidField(field);
    };
    const name = check.has(body, "name") ? check.text(body, "name", 1, 120) : item.name;
    refuseOnGroup("start");
    const chosenStart = check.has(body, "start") ? before.calendar.nextWorking(check.date(body, "start")) : item.chosenStart;
    refuseOnGroup("duration");
    const duration = check.has(body, "duration") ? check.whole(body, "duration", 0, 999) : item.duration;
    const kind = isGroup ? "group" : duration === 0 ? "milestone" : "task";
    refuseOnGroup("percent");
    let percent = item.percent;
    if (check.has(body, "percent")) {
      percent = check.whole(body, "percent", 0, 100);
      if (item.kind === "milestone" && percent !== 0 && percent !== 100) throw invalidField("percent");
    }
    refuseOnGroup("group");
    const target = body.group;
    const targetGroup = typeof target === "string" ? before.items.find((candidate) => candidate.id === target && candidate.kind === "group") : undefined;
    if (check.has(body, "group") && target !== null && !targetGroup) throw invalidField("group");
    if (kind === "milestone" && item.kind === "task" && item.assignees.length > 0) throw new ApiError(422, "has_assignees");

    if (kind === "milestone" && percent !== 100) percent = 0;
    await tx.query(
      "UPDATE items SET name = $2, chosen_start = $3, duration = $4, kind = $5, percent = $6, version = version + 1, updated_by = $7 WHERE id = $1",
      [item.id, name, chosenStart, duration, kind, percent, person.id],
    );
    if (check.has(body, "group") && target !== item.group) {
      const rows = rowsOf(before);
      await writeOrder(tx, targetGroup ? moveIntoGroup(rows, item.id, targetGroup.id) : item.group ? moveOutOfGroup(rows, item.id, item.group) : rows);
    }
    return { kind: "edit", itemId: item.id, itemName: name, schedule: true, editedId: item.id };
  });
  const pushedBy = mutated.after.schedule.pushedBy[params.id];
  const predecessor = pushedBy ? mutated.after.items.find((candidate) => candidate.id === pushedBy) : undefined;
  return itemReply(200, params.id, mutated, { constraint: predecessor ? { predecessor: predecessor.name } : null });
});

route("DELETE", "/api/items/:id", async ({ person, params }) => {
  const access = await accessToItem(person.id, params.id);
  requireWrite(access);
  const mutated = await mutateProject(access.projectId, person, async (tx, before) => {
    const item = findItem(before, params.id);
    await tx.query("DELETE FROM items WHERE id = $1", [item.id]);
    await renumber(tx, before.id);
    return { kind: "delete", itemId: item.id, itemName: item.name, schedule: true, editedId: item.id };
  });
  return { status: 200, body: { moved: mutated.moved, finish: mutated.after.schedule.finish }, headers: revHeader(mutated) };
});

route("POST", "/api/items/:id/reorder", async ({ person, params, body }) => {
  const access = await accessToItem(person.id, params.id);
  requireWrite(access);
  const direction = check.oneOf(body, "direction", ["up", "down"] as const);
  const rowsReply = (loaded: LoadedProject, changed: boolean): Reply => ({
    status: 200,
    body: { changed, rows: loaded.items.map((item) => ({ id: item.id, row: item.row, group: item.group })) },
  });
  const mutated = await mutateProject(access.projectId, person, async (tx, before) => {
    const item = findItem(before, params.id);
    if (item.kind === "group") throw new ApiError(422, "not_reorderable");
    const reordered = swapWithNeighbour(rowsOf(before), item.id, direction);
    if (!reordered) return null;
    await writeOrder(tx, reordered);
    return { kind: "edit", itemId: item.id, itemName: item.name, schedule: true, editedId: item.id };
  });
  return mutated ? { ...rowsReply(mutated.after, true), headers: revHeader(mutated) } : rowsReply(await loadProject(pool, access.projectId), false);
});

route("PUT", "/api/items/:id/predecessors", async ({ person, params, body }) => {
  const access = await accessToItem(person.id, params.id);
  requireWrite(access);
  const baseVersion = baseVersionOf(body);
  if (typeof body.text !== "string") throw invalidField("text");
  const cell = body.text;
  const mutated = await mutateProject(access.projectId, person, async (tx, before) => {
    const item = findItem(before, params.id);
    requireCurrentVersion(before, item, baseVersion);
    const rowOf = (id: string) => before.byId[id].row;
    let entries;
    try {
      if (item.kind === "group") throw new PredecessorError("Groups cannot be linked.");
      entries = parsePredecessors(
        cell,
        item.id,
        (row) => {
          const target = before.items[row - 1];
          return target ? { id: target.id, isGroup: target.kind === "group" } : undefined;
        },
        before.links.filter((link) => link.to !== item.id),
        rowOf,
        (id) => before.byId[id].name,
      );
    } catch (error) {
      if (error instanceof PredecessorError) throw new ApiError(422, "invalid_predecessors", { message: error.message });
      throw error;
    }
    await tx.query("DELETE FROM links WHERE to_id = $1", [item.id]);
    for (const entry of entries) {
      await tx.query("INSERT INTO links (id, project_id, from_id, to_id, type, lag) VALUES ($1, $2, $3, $4, $5, $6)", [newId(), before.id, entry.from, entry.to, entry.type, entry.lag]);
    }
    await bumpVersion(tx, item.id, person.id);
    return { kind: "edit", itemId: item.id, itemName: item.name, schedule: true, editedId: item.id };
  });
  return itemReply(200, params.id, mutated);
});

route("POST", "/api/items/:id/assignees", async ({ person, params, body }) => {
  const access = await accessToItem(person.id, params.id);
  requireWrite(access);
  const mutated = await mutateProject(access.projectId, person, async (tx, before) => {
    const item = findItem(before, params.id);
    if (item.kind !== "task") throw new ApiError(422, "not_a_task");
    const userId = body.userId;
    const member = typeof userId === "string" ? await tx.query("SELECT role FROM members WHERE workspace_id = $1 AND user_id = $2", [before.workspaceId, userId]) : null;
    if (typeof userId !== "string" || !member || member.rowCount === 0 || member.rows[0].role === "viewer") throw invalidField("userId");
    const hours = check.hours(body, "hours");
    if (item.assignees.some((assignee) => assignee.userId === userId)) throw new ApiError(409, "already_assigned");
    await tx.query("INSERT INTO assignments (item_id, user_id, hours) VALUES ($1, $2, $3)", [item.id, userId, hours]);
    await bumpVersion(tx, item.id, person.id);
    if (userId !== person.id) {
      await tx.query(
        "INSERT INTO notices (id, item_id, assignee_id, assigner_id, hours, attempt_at) VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))",
        [newId(), item.id, userId, person.id, hours, settings.assignNoticeDelaySeconds],
      );
    }
    return { kind: "edit", itemId: item.id, itemName: item.name, schedule: true, editedId: item.id };
  });
  return { status: 201, body: { item: itemOf(mutated.after, params.id) }, headers: revHeader(mutated) };
});

route("DELETE", "/api/items/:id/assignees/:userId", async ({ person, params }) => {
  const access = await accessToItem(person.id, params.id);
  requireWrite(access);
  const mutated = await mutateProject(access.projectId, person, async (tx, before) => {
    const item = findItem(before, params.id);
    if (!item.assignees.some((assignee) => assignee.userId === params.userId)) throw notFound();
    await tx.query("DELETE FROM assignments WHERE item_id = $1 AND user_id = $2", [item.id, params.userId]);
    await tx.query("DELETE FROM notices WHERE item_id = $1 AND assignee_id = $2 AND sent_at IS NULL", [item.id, params.userId]);
    await bumpVersion(tx, item.id, person.id);
    return { kind: "edit", itemId: item.id, itemName: item.name, schedule: true, editedId: item.id };
  });
  return { status: 200, body: { item: itemOf(mutated.after, params.id) }, headers: revHeader(mutated) };
});

const commentOf = (row: { id: string; user_id: string; name: string; body: string; created_at: Date }) => ({
  id: row.id,
  author: { userId: row.user_id, name: row.name },
  text: row.body,
  createdAt: row.created_at.toISOString(),
});

route("GET", "/api/items/:id/comments", async ({ person, params }) => {
  await accessToItem(person.id, params.id);
  const found = await pool.query(
    "SELECT c.id, c.user_id, u.name, c.body, c.created_at FROM comments c JOIN users u ON u.id = c.user_id WHERE c.item_id = $1 ORDER BY c.created_at, c.id",
    [params.id],
  );
  return { status: 200, body: { comments: found.rows.map(commentOf) } };
});

route("POST", "/api/items/:id/comments", async ({ person, params, body }) => {
  const access = await accessToItem(person.id, params.id);
  requireWrite(access);
  const text = check.text(body, "text", 1, 1000);
  const id = newId();
  const found = await pool.query("SELECT name FROM items WHERE id = $1", [params.id]);
  await pool.query("INSERT INTO comments (id, item_id, user_id, body) VALUES ($1, $2, $3, $4)", [id, params.id, person.id, text]);
  const created = await pool.query(
    "SELECT c.id, c.user_id, u.name, c.body, c.created_at FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = $1",
    [id],
  );
  const comment = commentOf(created.rows[0]);
  publishToProject(access.projectId, {
    type: "comment",
    projectId: access.projectId,
    itemId: params.id,
    itemName: found.rows[0].name,
    actor: { id: person.id, name: person.name },
    comment,
  });
  return { status: 201, body: { comment } };
});
