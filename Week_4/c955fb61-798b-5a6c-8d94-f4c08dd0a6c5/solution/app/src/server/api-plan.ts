import { LAG_LIMIT, LINK_TYPES } from "../shared/types";
import { weekdayIndex } from "../shared/calendar";
import { bumpVersion, findItem, requireWrite, revHeader } from "./api-items";
import { projectAccess } from "./auth";
import { newId, pool } from "./db";
import { ApiError, notFound } from "./errors";
import { route } from "./http";
import { loopMessage, loopPath } from "./links";
import { buildProject } from "./model";
import { mutateProject } from "./mutate";
import * as check from "./validate";

const invalidLink = (field: string) => new ApiError(422, "invalid_link", { field });

async function accessToProject(personId: string, projectId: string) {
  const access = await projectAccess(personId, projectId);
  if (!access) throw notFound();
  return access;
}

route("POST", "/api/projects/:id/links", async ({ person, params, body }) => {
  const access = await accessToProject(person.id, params.id);
  requireWrite(access);
  let linkId = "";
  const mutated = await mutateProject(access.projectId, person, async (tx, before) => {
    const type = LINK_TYPES.find((candidate) => candidate === body.type);
    if (!type) throw invalidLink("type");
    const lag = body.lag;
    if (typeof lag !== "number" || !Number.isInteger(lag) || Math.abs(lag) > LAG_LIMIT) throw invalidLink("lag");
    const from = before.items.find((item) => item.id === body.from);
    if (!from) throw invalidLink("from");
    const to = before.items.find((item) => item.id === body.to);
    if (!to) throw invalidLink("to");
    if (from.id === to.id) throw new ApiError(422, "self_link");
    if (from.kind === "group" || to.kind === "group") throw new ApiError(422, "group_link");
    if (before.links.some((link) => link.from === from.id && link.to === to.id)) throw new ApiError(409, "duplicate_link");
    const rowOf = (id: string) => before.byId[id].row;
    const path = loopPath(before.links, rowOf, from.id, to.id);
    if (path) {
      const nameOf = (id: string) => before.byId[id].name;
      throw new ApiError(422, "loop", { path, message: loopMessage(path, nameOf) });
    }
    const id = newId();
    await tx.query("INSERT INTO links (id, project_id, from_id, to_id, type, lag) VALUES ($1, $2, $3, $4, $5, $6)", [id, before.id, from.id, to.id, type, lag]);
    await bumpVersion(tx, to.id, person.id);
    linkId = id;
    return { kind: "edit", itemId: from.id, itemName: from.name, schedule: true, editedId: from.id };
  });
  const link = mutated.after.links.filter((entry) => entry.id === linkId)[0];
  return {
    status: 201,
    body: { link: { id: link.id, from: link.from, to: link.to, type: link.type, lag: link.lag }, moved: mutated.moved, finish: mutated.after.schedule.finish },
    headers: revHeader(mutated),
  };
});

route("DELETE", "/api/links/:id", async ({ person, params }) => {
  const found = await pool.query(
    `SELECT l.project_id, l.from_id, l.to_id FROM links l JOIN projects p ON p.id = l.project_id
       JOIN members m ON m.workspace_id = p.workspace_id AND m.user_id = $2 WHERE l.id = $1`,
    [params.id, person.id],
  );
  if (found.rowCount === 0) throw notFound();
  const access = await accessToProject(person.id, found.rows[0].project_id);
  requireWrite(access);
  const mutated = await mutateProject(access.projectId, person, async (tx, before) => {
    const from = findItem(before, found.rows[0].from_id);
    await tx.query("DELETE FROM links WHERE id = $1", [params.id]);
    await bumpVersion(tx, found.rows[0].to_id, person.id);
    return { kind: "edit", itemId: from.id, itemName: from.name, schedule: true, editedId: from.id };
  });
  return { status: 200, body: { moved: mutated.moved, finish: mutated.after.schedule.finish }, headers: revHeader(mutated) };
});

route("POST", "/api/projects/:id/holidays", async ({ person, params, body }) => {
  const access = await accessToProject(person.id, params.id);
  requireWrite(access);
  const day = check.date(body, "date");
  const name = check.text(body, "name", 1, 60);
  if (weekdayIndex(day) >= 5) throw new ApiError(422, "weekend");
  const mutated = await mutateProject(access.projectId, person, async (tx, before) => {
    if (before.holidays.some((holiday) => holiday.date === day)) throw new ApiError(409, "duplicate_holiday");
    await tx.query("INSERT INTO holidays (project_id, on_date, name) VALUES ($1, $2, $3)", [before.id, day, name]);
    return { kind: "holidays", itemId: null, itemName: null, schedule: true, editedId: null };
  });
  return {
    status: 201,
    body: { holiday: { date: day, name }, moved: mutated.moved, finish: mutated.after.schedule.finish },
    headers: revHeader(mutated),
  };
});

route("DELETE", "/api/projects/:id/holidays/:date", async ({ person, params }) => {
  const access = await accessToProject(person.id, params.id);
  requireWrite(access);
  const mutated = await mutateProject(access.projectId, person, async (tx, before) => {
    if (!before.holidays.some((holiday) => holiday.date === params.date)) throw notFound();
    await tx.query("DELETE FROM holidays WHERE project_id = $1 AND on_date = $2", [before.id, params.date]);
    return { kind: "holidays", itemId: null, itemName: null, schedule: true, editedId: null };
  });
  return { status: 200, body: { moved: mutated.moved, finish: mutated.after.schedule.finish }, headers: revHeader(mutated) };
});

route("POST", "/api/projects/:id/baseline", async ({ person, params, body }) => {
  const access = await accessToProject(person.id, params.id);
  requireWrite(access);
  const name = check.text(body, "name", 1, 60);
  const mutated = await mutateProject(access.projectId, person, async (tx, before) => {
    if (before.baselineName !== null && body.replace !== true) throw new ApiError(409, "baseline_exists", { name: before.baselineName });
    const placed = before.items.flatMap((item) => {
      const dates = before.schedule.items[item.id];
      return item.kind !== "group" && dates.start && dates.end ? [{ id: item.id, start: dates.start, end: dates.end }] : [];
    });
    await tx.query("UPDATE items SET baseline_start = NULL, baseline_end = NULL WHERE project_id = $1", [before.id]);
    await tx.query(
      `UPDATE items SET baseline_start = v.start, baseline_end = v.finish
         FROM (SELECT unnest($1::text[]) AS id, unnest($2::date[]) AS start, unnest($3::date[]) AS finish) v WHERE items.id = v.id`,
      [placed.map((entry) => entry.id), placed.map((entry) => entry.start), placed.map((entry) => entry.end)],
    );
    await tx.query("UPDATE projects SET baseline_name = $2, baseline_finish = $3 WHERE id = $1", [before.id, name, before.schedule.finish]);
    return { kind: "baseline", itemId: null, itemName: null, schedule: false, editedId: null };
  });
  return { status: 201, body: { baseline: buildProject(mutated.after).baseline }, headers: revHeader(mutated) };
});
