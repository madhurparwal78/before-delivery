import { randomUUID } from "node:crypto";
import { projectTeam, requireCoordinator, roleIn, taskAccess } from "../access.js";
import { EMAIL_PATTERN } from "../auth.js";
import { dateOf, now } from "../clock.js";
import { isIsoDate } from "../dates.js";
import { pool, transaction, lockProject } from "../db.js";
import { publish } from "../events.js";
import { displayPercent, rollup, type GoalNode } from "../goals.js";
import { fields, forbidden, invalid, notFound, readJson, route } from "../http.js";
import { inboxJson } from "../inbox.js";
import { loadProject, fieldByName } from "../tasks.js";
import { decide, requestApproval } from "../approvals.js";
import { createTask } from "../workflow.js";
import { buildCells, DEFAULT_CAPACITY, gridDays, type WorkloadTask } from "../workload.js";
import { projectProgress } from "./projects.js";

/* ------------------------------------------------------------------ goals */

async function goalsOf(teamId: string) {
  const [goals, links] = await Promise.all([
    pool.query("SELECT id, name, parent_id, weight, manual_value, owner_id FROM goals WHERE team_id = $1 ORDER BY name", [teamId]),
    pool.query(
      `SELECT gp.goal_id, gp.project_id, gp.weight, p.name FROM goal_projects gp JOIN projects p ON p.id = gp.project_id
         JOIN goals g ON g.id = gp.goal_id WHERE g.team_id = $1`, [teamId]),
  ]);
  const progressOf = new Map<string, number>();
  for (const link of links.rows) if (!progressOf.has(link.project_id)) progressOf.set(link.project_id, await projectProgress(pool, link.project_id));
  const nodes: GoalNode[] = goals.rows.map((g) => ({
    id: g.id, parentId: g.parent_id, weight: g.weight, manualValue: g.manual_value,
    projects: links.rows.filter((l) => l.goal_id === g.id).map((l) => ({ projectId: l.project_id, weight: l.weight, progress: progressOf.get(l.project_id)! })),
  }));
  const totals = rollup(nodes);
  return goals.rows.map((g) => ({
    id: g.id, name: g.name, parentId: g.parent_id, weight: g.weight, manualValue: g.manual_value, ownerId: g.owner_id,
    progress: totals.get(g.id)!, percent: displayPercent(totals.get(g.id)!),
    projects: links.rows.filter((l) => l.goal_id === g.id)
      .map((l) => ({ projectId: l.project_id, name: l.name, weight: l.weight, progress: progressOf.get(l.project_id)! })),
  }));
}

function goalErrors(body: Record<string, unknown>, create: boolean): Record<string, string> {
  const errors: Record<string, string> = {};
  if (("name" in body || create) && (typeof body.name !== "string" || !body.name.trim())) errors.name = "Enter a goal name";
  if ("weight" in body && (typeof body.weight !== "number" || !Number.isInteger(body.weight) || body.weight < 1 || body.weight > 10)) {
    errors.weight = "Weight must be a whole number from 1 to 10";
  }
  if ("manualValue" in body && (typeof body.manualValue !== "number" || body.manualValue < 0 || body.manualValue > 100)) {
    errors.manualValue = "Manual value must be from 0 to 100";
  }
  return errors;
}

route("GET", "/api/teams/:teamId/goals", async (ctx) => {
  await roleIn(pool, ctx.personId, ctx.params.teamId);
  return { goals: await goalsOf(ctx.params.teamId) };
});

route("POST", "/api/teams/:teamId/goals", async (ctx) => {
  await roleIn(pool, ctx.personId, ctx.params.teamId);
  const body = fields(await readJson(ctx));
  const errors = goalErrors(body, true);
  let parentId: string | null = null;
  if (body.parentId !== undefined && body.parentId !== null) {
    const parent = typeof body.parentId === "string" ? await pool.query("SELECT 1 FROM goals WHERE id = $1 AND team_id = $2", [body.parentId, ctx.params.teamId]) : null;
    if (!parent?.rowCount) errors.parentId = "Choose a goal of this team";
    else parentId = body.parentId as string;
  }
  if (Object.keys(errors).length) throw invalid(errors);
  const id = randomUUID();
  await transaction(async (tx) => {
    await tx.query("INSERT INTO goals (id, team_id, name, parent_id, weight, manual_value, owner_id) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [id, ctx.params.teamId, (body.name as string).trim(), parentId, body.weight ?? 1, body.manualValue ?? 0, ctx.personId]);
    await publish(tx, { t: "goals", team: ctx.params.teamId });
  });
  return (await goalsOf(ctx.params.teamId)).find((g) => g.id === id);
}, { status: 201 });

async function goalAccess(personId: string, goalId: string) {
  const { rows } = await pool.query("SELECT team_id, owner_id FROM goals WHERE id = $1", [goalId]);
  if (!rows.length) throw notFound();
  const role = await roleIn(pool, personId, rows[0].team_id);
  return { teamId: rows[0].team_id as string, mayEdit: role === "coordinator" || rows[0].owner_id === personId };
}

route("PATCH", "/api/goals/:id", async (ctx) => {
  const { teamId, mayEdit } = await goalAccess(ctx.personId, ctx.params.id);
  const raw = await readJson(ctx);
  if (!mayEdit) throw forbidden();
  const body = fields(raw);
  const errors = goalErrors(body, false);
  if (Object.keys(errors).length) throw invalid(errors);
  await transaction(async (tx) => {
    if ("name" in body) await tx.query("UPDATE goals SET name = $2 WHERE id = $1", [ctx.params.id, (body.name as string).trim()]);
    if ("weight" in body) await tx.query("UPDATE goals SET weight = $2 WHERE id = $1", [ctx.params.id, body.weight]);
    if ("manualValue" in body) await tx.query("UPDATE goals SET manual_value = $2 WHERE id = $1", [ctx.params.id, body.manualValue]);
    await publish(tx, { t: "goals", team: teamId });
  });
  return (await goalsOf(teamId)).find((g) => g.id === ctx.params.id);
});

route("POST", "/api/goals/:id/projects", async (ctx) => {
  const { teamId, mayEdit } = await goalAccess(ctx.personId, ctx.params.id);
  const raw = await readJson(ctx);
  if (!mayEdit) throw forbidden();
  const body = fields(raw);
  const project = typeof body.projectId === "string" ? await pool.query("SELECT 1 FROM projects WHERE id = $1 AND team_id = $2", [body.projectId, teamId]) : null;
  const errors: Record<string, string> = {};
  if (!project?.rowCount) errors.projectId = "Choose a project of this team";
  if (body.weight !== undefined) Object.assign(errors, goalErrors({ weight: body.weight }, false));
  if (Object.keys(errors).length) throw invalid(errors);
  await transaction(async (tx) => {
    await tx.query(
      "INSERT INTO goal_projects (goal_id, project_id, weight) VALUES ($1,$2,$3) ON CONFLICT (goal_id, project_id) DO UPDATE SET weight = $3",
      [ctx.params.id, body.projectId, body.weight ?? 1]);
    await publish(tx, { t: "goals", team: teamId });
  });
  return { goalId: ctx.params.id, projectId: body.projectId, weight: body.weight ?? 1 };
}, { status: 201 });

/* ------------------------------------------------------------------ workload */

route("GET", "/api/teams/:teamId/workload", async (ctx) => {
  await roleIn(pool, ctx.personId, ctx.params.teamId);
  const asked = ctx.url.searchParams.get("from");
  const from = asked && isIsoDate(asked) ? asked : dateOf(await now(pool));
  const days = gridDays(from);
  const [people, capacities, tasks] = await Promise.all([
    pool.query("SELECT p.id, p.name FROM people p JOIN memberships m ON m.person_id = p.id WHERE m.team_id = $1 ORDER BY p.name", [ctx.params.teamId]),
    pool.query("SELECT person_id, weekday, hours FROM capacities WHERE team_id = $1", [ctx.params.teamId]),
    pool.query(
      `SELECT t.id, t.name, t.assignee_id, t.start_date, t.due_date, t.effort, t.completed FROM tasks t JOIN projects p ON p.id = t.project_id
         WHERE p.team_id = $1`, [ctx.params.teamId]),
  ]);
  const work: WorkloadTask[] = tasks.rows.map((t) => ({
    id: t.id, name: t.name, assigneeId: t.assignee_id, start: t.start_date, due: t.due_date, effort: t.effort, completed: t.completed,
  }));
  const capacityOf = (personId: string, weekday: string) =>
    capacities.rows.find((c) => c.person_id === personId && c.weekday === weekday)?.hours ?? DEFAULT_CAPACITY;
  const team = await pool.query("SELECT name FROM teams WHERE id = $1", [ctx.params.teamId]);
  return {
    from, days, teamName: team.rows[0].name,
    people: people.rows.map((p) => ({ id: p.id, name: p.name, cells: buildCells(days, p.id, work, capacityOf) })),
  };
});

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri"];

route("PUT", "/api/teams/:teamId/capacities", async (ctx) => {
  const role = await roleIn(pool, ctx.personId, ctx.params.teamId);
  const raw = await readJson(ctx);
  requireCoordinator(role);
  const body = fields(raw);
  const errors: Record<string, string> = {};
  const member = typeof body.personId === "string"
    ? await pool.query("SELECT 1 FROM memberships WHERE team_id = $1 AND person_id = $2", [ctx.params.teamId, body.personId]) : null;
  if (!member?.rowCount) errors.personId = "Choose a member of this team";
  if (typeof body.weekday !== "string" || !WEEKDAYS.includes(body.weekday)) errors.weekday = "Choose a weekday from mon to fri";
  if (typeof body.hours !== "number" || body.hours < 0 || body.hours > 24) errors.hours = "Hours must be from 0 to 24";
  if (Object.keys(errors).length) throw invalid(errors);
  await transaction(async (tx) => {
    await tx.query(
      `INSERT INTO capacities (team_id, person_id, weekday, hours) VALUES ($1,$2,$3,$4)
       ON CONFLICT (team_id, person_id, weekday) DO UPDATE SET hours = $4`, [ctx.params.teamId, body.personId, body.weekday, body.hours]);
    await publish(tx, { t: "workload", team: ctx.params.teamId });
  });
  return { personId: body.personId, weekday: body.weekday, hours: body.hours };
});

/* ------------------------------------------------------------------ intake forms */

route("POST", "/api/projects/:id/forms", async (ctx) => {
  const { teamId, role } = await projectTeam(pool, ctx.personId, ctx.params.id);
  const raw = await readJson(ctx);
  requireCoordinator(role);
  const body = fields(raw);
  const project = await loadProject(pool, ctx.params.id);
  const errors: Record<string, string> = {};
  if (typeof body.slug !== "string" || !/^[a-z0-9-]+$/.test(body.slug)) errors.slug = "Use lowercase letters, digits and hyphens";
  else if ((await pool.query("SELECT 1 FROM forms WHERE slug = $1", [body.slug])).rowCount) errors.slug = "That form address is taken";
  if (typeof body.section !== "string" || !project.sections.some((s) => s.id === body.section)) errors.section = "Choose a section of this project";
  if (typeof body.title !== "string" || !body.title.trim()) errors.title = "Enter a form title";
  if (Object.keys(errors).length) throw invalid(errors);
  const id = randomUUID();
  await transaction(async (tx) => {
    await lockProject(tx, project.id);
    const taken = await tx.query("INSERT INTO forms (id, project_id, slug, section_id, title) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (slug) DO NOTHING",
      [id, project.id, body.slug, body.section, (body.title as string).trim()]);
    if (!taken.rowCount) throw invalid({ slug: "That form address is taken" });
    const current = await loadProject(tx, project.id);
    if (!fieldByName(current, "Requested by")) {
      await tx.query("INSERT INTO fields (id, project_id, name, type, options, position) VALUES ($1,$2,'Requested by','text','[]',$3)", [randomUUID(), project.id, current.fields.length + 1]);
    }
    await publish(tx, { t: "structure", team: teamId, project: project.id });
  });
  return { id, slug: body.slug, section: body.section, title: (body.title as string).trim() };
}, { status: 201 });

async function formBySlug(slug: string) {
  const { rows } = await pool.query("SELECT id, project_id, section_id, title FROM forms WHERE slug = $1", [slug]);
  if (!rows.length) throw notFound();
  return rows[0];
}

route("GET", "/api/forms/:slug", async (ctx) => {
  const form = await formBySlug(ctx.params.slug);
  const category = fieldByName(await loadProject(pool, form.project_id), "Category");
  return { title: form.title, categories: category?.options ?? [] };
}, { open: true });

route("POST", "/api/forms/:slug/submissions", async (ctx) => {
  const form = await formBySlug(ctx.params.slug);
  const body = fields(await readJson(ctx));
  const project = await loadProject(pool, form.project_id);
  const errors: Record<string, string> = {};
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) errors.title = "Enter a request title";
  else if (title.length > 120) errors.title = "Request title must be 120 characters or fewer";
  const instant = await now(pool);
  if (typeof body.neededBy !== "string" || !isIsoDate(body.neededBy) || body.neededBy < dateOf(instant)) errors.neededBy = "Enter a date today or later";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!EMAIL_PATTERN.test(email)) errors.email = "Enter an email address like name@example.com";
  const category = fieldByName(project, "Category");
  const chosen = typeof body.category === "string" && body.category !== "" ? body.category : null;
  if (chosen !== null && !category?.options.includes(chosen)) errors.category = "Choose a category from the list";
  if (Object.keys(errors).length) throw invalid(errors);
  return transaction(async (tx) => {
    await lockProject(tx, project.id);
    const counter = await tx.query("UPDATE teams SET request_counter = request_counter + 1 WHERE id = $1 RETURNING request_counter", [project.teamId]);
    const values: Record<string, unknown> = {};
    const requestedBy = fieldByName(project, "Requested by");
    if (requestedBy) values[requestedBy.id] = email;
    if (category && chosen) values[category.id] = chosen;
    const task = await createTask(tx, project, {
      name: title, description: typeof body.details === "string" ? body.details : "", sectionId: form.section_id, due: body.neededBy as string, values,
    }, { name: `Request form (${email})` }, await now(tx));
    return { reference: `REQ-${String(counter.rows[0].request_counter).padStart(4, "0")}`, taskId: task.id };
  });
}, { open: true, status: 201 });

/* ------------------------------------------------------------------ approvals */

route("POST", "/api/tasks/:id/approval", async (ctx) => {
  const access = await taskAccess(pool, ctx.personId, ctx.params.id);
  const raw = await readJson(ctx);
  return transaction((tx) => requestApproval(tx, access, ctx.params.id, ctx.personId, fields(raw)));
}, { status: 201 });

route("POST", "/api/tasks/:id/decision", async (ctx) => {
  const access = await taskAccess(pool, ctx.personId, ctx.params.id);
  const raw = await readJson(ctx);
  return transaction((tx) => decide(tx, access, ctx.params.id, ctx.personId, raw, fields));
});

/* ------------------------------------------------------------------ inbox */

route("GET", "/api/inbox", async (ctx) => {
  const { rows } = await pool.query(
    `SELECT i.*, (i.kind = 'approval_request' AND a.status = 'requested' AND a.approver_id = i.person_id) AS pending
       FROM inbox i LEFT JOIN approvals a ON a.id = i.approval_id
       WHERE i.person_id = $1 AND NOT i.archived ORDER BY i.created_at DESC, i.seq DESC LIMIT 300`, [ctx.personId]);
  return { unread: rows.filter((r) => !r.read).length, items: rows.map((r) => inboxJson(r, r.pending === true)) };
});

route("PATCH", "/api/inbox/:id", async (ctx) => {
  const found = await pool.query("SELECT id FROM inbox WHERE id = $1 AND person_id = $2", [ctx.params.id, ctx.personId]);
  if (!found.rows.length) throw notFound();
  const body = fields(await readJson(ctx));
  if (typeof body.read !== "boolean" && body.archived !== true) throw invalid({ read: "Send read true or false, or archived true" });
  await transaction(async (tx) => {
    if (typeof body.read === "boolean") await tx.query("UPDATE inbox SET read = $2 WHERE id = $1", [ctx.params.id, body.read]);
    if (body.archived === true) await tx.query("UPDATE inbox SET archived = true WHERE id = $1", [ctx.params.id]);
    await publish(tx, { t: "inbox", person: ctx.personId });
  });
  const { rows } = await pool.query("SELECT * FROM inbox WHERE id = $1", [ctx.params.id]);
  return inboxJson(rows[0], false);
});

