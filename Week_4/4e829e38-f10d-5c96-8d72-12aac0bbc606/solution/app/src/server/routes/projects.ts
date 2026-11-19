import { randomUUID } from "node:crypto";
import { projectTeam, requireCoordinator, roleIn } from "../access.js";
import { config } from "../config.js";
import { now } from "../clock.js";
import { pool, transaction, lockProject, type Queryable } from "../db.js";
import { publish } from "../events.js";
import { BUILT_IN_FIELDS, FormulaError, renameReference, validateFormula } from "../formula.js";
import { fields, invalid, notFound, readJson, route } from "../http.js";
import { loadProject, type Field } from "../tasks.js";
import { NO_CONTENT } from "../state.js";

export async function projectProgress(db: Queryable, projectId: string): Promise<number> {
  const { rows } = await db.query(
    "SELECT count(*)::int AS total, count(*) FILTER (WHERE completed)::int AS done FROM tasks WHERE project_id = $1 AND parent_id IS NULL",
    [projectId],
  );
  return rows[0].total ? (rows[0].done * 100) / rows[0].total : 0;
}

async function projectJson(projectId: string) {
  const ctx = await loadProject(pool, projectId);
  const [members, project] = await Promise.all([
    pool.query("SELECT p.id, p.name, p.email FROM people p JOIN memberships m ON m.person_id = p.id WHERE m.team_id = $1 ORDER BY p.name", [ctx.teamId]),
    pool.query("SELECT trace FROM projects WHERE id = $1", [projectId]),
  ]);
  return {
    id: ctx.id, name: ctx.name, teamId: ctx.teamId, progress: await projectProgress(pool, projectId), members: members.rows,
    sections: ctx.sections, fields: ctx.fields.map((f) => ({ id: f.id, name: f.name, type: f.type, options: f.options, formula: f.formula })),
    trace: project.rows[0].trace,
  };
}

route("GET", "/api/teams/:teamId/projects", async (ctx) => {
  await roleIn(pool, ctx.personId, ctx.params.teamId);
  const { rows } = await pool.query("SELECT id, name FROM projects WHERE team_id = $1 ORDER BY created_at, name", [ctx.params.teamId]);
  const projects = await Promise.all(rows.map(async (p) => ({ id: p.id, name: p.name, progress: await projectProgress(pool, p.id) })));
  return { projects };
});

route("POST", "/api/teams/:teamId/projects", async (ctx) => {
  const role = await roleIn(pool, ctx.personId, ctx.params.teamId);
  const raw = await readJson(ctx);
  requireCoordinator(role);
  const body = fields(raw);
  const errors: Record<string, string> = {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const sections = Array.isArray(body.sections)
    ? [...new Set(body.sections.filter((s): s is string => typeof s === "string").map((s) => s.trim()).filter(Boolean))]
    : [];
  if (!name) errors.name = "Enter a project name";
  if (!sections.length) errors.sections = "Add at least one section";
  if (Object.keys(errors).length) throw invalid(errors);
  const id = randomUUID();
  await transaction(async (tx) => {
    await tx.query("INSERT INTO projects (id, team_id, name, created_at) VALUES ($1,$2,$3,$4)", [id, ctx.params.teamId, name, await now(tx)]);
    for (const [index, section] of sections.entries()) {
      await tx.query("INSERT INTO sections (id, project_id, name, position) VALUES ($1,$2,$3,$4)", [randomUUID(), id, section, index + 1]);
    }
    await publish(tx, { t: "structure", team: ctx.params.teamId, project: id });
  });
  return projectJson(id);
}, { status: 201 });

route("GET", "/api/projects/:id", async (ctx) => {
  await projectTeam(pool, ctx.personId, ctx.params.id);
  return projectJson(ctx.params.id);
});

/* ------------------------------------------------------------------ sections */

route("POST", "/api/projects/:id/sections", async (ctx) => {
  const { teamId } = await projectTeam(pool, ctx.personId, ctx.params.id);
  const raw = await readJson(ctx);
  const body = fields(raw);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const sections = (await loadProject(pool, ctx.params.id)).sections;
  if (!name) throw invalid({ name: "Enter a section name" });
  if (sections.some((s) => s.name === name)) throw invalid({ name: "A section with that name already exists" });
  const section = { id: randomUUID(), name, position: sections.length + 1 };
  await transaction(async (tx) => {
    await lockProject(tx, ctx.params.id);
    const current = (await loadProject(tx, ctx.params.id)).sections;
    if (current.some((s) => s.name === name)) throw invalid({ name: "A section with that name already exists" });
    section.position = current.length + 1;
    await tx.query("INSERT INTO sections (id, project_id, name, position) VALUES ($1,$2,$3,$4)", [section.id, ctx.params.id, name, section.position]);
    await publish(tx, { t: "structure", team: teamId, project: ctx.params.id });
  });
  return section;
}, { status: 201 });

route("DELETE", "/api/sections/:id", async (ctx) => {
  const found = await pool.query("SELECT project_id FROM sections WHERE id = $1", [ctx.params.id]);
  if (!found.rows.length) throw notFound();
  const projectId = found.rows[0].project_id;
  const { teamId } = await projectTeam(pool, ctx.personId, projectId);
  await readJson(ctx);
  await transaction(async (tx) => {
    await lockProject(tx, projectId);
    const sections = (await loadProject(tx, projectId)).sections;
    if (sections.length <= 1) throw invalid({ section: "A project needs at least one section" });
    await tx.query("DELETE FROM sections WHERE id = $1", [ctx.params.id]);
    const left = sections.filter((s) => s.id !== ctx.params.id);
    for (const [index, section] of left.entries()) await tx.query("UPDATE sections SET position = $2 WHERE id = $1", [section.id, index + 1]);
    await publish(tx, { t: "structure", team: teamId, project: projectId });
  });
  return NO_CONTENT;
});

/* ------------------------------------------------------------------ fields */

const FIELD_TYPES = ["text", "number", "date", "single_select", "multi_select", "formula"];

function formulaProblem(formula: string, name: string, existing: Field[]): string | null {
  try {
    validateFormula(formula, name, existing, config.limits.formulaMaxChars);
    return null;
  } catch (error) {
    if (error instanceof FormulaError) return error.message;
    throw error;
  }
}

const takenName = (existing: Field[], name: string, exceptId?: string) =>
  BUILT_IN_FIELDS.includes(name) || existing.some((f) => f.name === name && f.id !== exceptId);

route("POST", "/api/projects/:id/fields", async (ctx) => {
  const { teamId } = await projectTeam(pool, ctx.personId, ctx.params.id);
  const raw = await readJson(ctx);
  const body = fields(raw);
  const project = await loadProject(pool, ctx.params.id);
  const errors: Record<string, string> = {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) errors.name = "Enter a field name";
  else if (takenName(project.fields, name)) errors.name = "A field with that name already exists";
  const type = typeof body.type === "string" && FIELD_TYPES.includes(body.type) ? body.type : null;
  if (!type) errors.type = "Choose a field type";
  const options = Array.isArray(body.options) ? body.options.filter((o): o is string => typeof o === "string" && o.trim() !== "").map((o) => o.trim()) : [];
  let formula: string | null = null;
  if (type === "formula") {
    formula = typeof body.formula === "string" ? body.formula : "";
    const problem = formulaProblem(formula, name, project.fields);
    if (problem) errors.formula = problem;
  }
  if (Object.keys(errors).length) throw invalid(errors);
  const id = randomUUID();
  await transaction(async (tx) => {
    await lockProject(tx, ctx.params.id);
    const existing = (await loadProject(tx, ctx.params.id)).fields;
    if (takenName(existing, name)) throw invalid({ name: "A field with that name already exists" });
    await tx.query("INSERT INTO fields (id, project_id, name, type, options, formula, position) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [id, ctx.params.id, name, type, JSON.stringify(options), formula, existing.length + 1]);
    await publish(tx, { t: "structure", team: teamId, project: ctx.params.id });
  });
  return { id, name, type, options, formula };
}, { status: 201 });

async function fieldProject(personId: string, fieldId: string) {
  const found = await pool.query("SELECT project_id FROM fields WHERE id = $1", [fieldId]);
  if (!found.rows.length) throw notFound();
  const projectId = found.rows[0].project_id;
  const { teamId } = await projectTeam(pool, personId, projectId);
  return { projectId, teamId };
}

route("PATCH", "/api/fields/:id", async (ctx) => {
  const { projectId, teamId } = await fieldProject(ctx.personId, ctx.params.id);
  const raw = await readJson(ctx);
  const body = fields(raw);
  const project = await loadProject(pool, projectId);
  const current = project.fields.find((f) => f.id === ctx.params.id)!;
  const errors: Record<string, string> = {};
  let name = current.name;
  if ("name" in body) {
    name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) errors.name = "Enter a field name";
    else if (takenName(project.fields, name, current.id)) errors.name = "A field with that name already exists";
  }
  let formula = current.formula;
  if ("formula" in body) {
    formula = typeof body.formula === "string" ? body.formula : "";
    const problem = formulaProblem(formula, name, project.fields);
    if (problem) errors.formula = problem;
  }
  if (Object.keys(errors).length) throw invalid(errors);
  await transaction(async (tx) => {
    await lockProject(tx, projectId);
    if (name !== current.name && takenName((await loadProject(tx, projectId)).fields, name, current.id)) {
      throw invalid({ name: "A field with that name already exists" });
    }
    await tx.query("UPDATE fields SET name = $2, formula = $3 WHERE id = $1", [current.id, name, current.type === "formula" ? formula : null]);
    if (name !== current.name) {
      for (const other of project.fields.filter((f) => f.type === "formula" && f.formula?.includes(`{${current.name}}`))) {
        await tx.query("UPDATE fields SET formula = $2 WHERE id = $1", [other.id, renameReference(other.formula!, current.name, name)]);
      }
    }
    await publish(tx, { t: "structure", team: teamId, project: projectId });
  });
  return { id: current.id, name, type: current.type, options: current.options, formula: current.type === "formula" ? formula : null };
});

route("DELETE", "/api/fields/:id", async (ctx) => {
  const { projectId, teamId } = await fieldProject(ctx.personId, ctx.params.id);
  await readJson(ctx);
  await transaction(async (tx) => {
    await lockProject(tx, projectId);
    await tx.query("DELETE FROM fields WHERE id = $1", [ctx.params.id]);
    await tx.query("UPDATE tasks SET values = values - $2 WHERE project_id = $1", [projectId, ctx.params.id]);
    const left = await tx.query("SELECT id FROM fields WHERE project_id = $1 ORDER BY position", [projectId]);
    for (const [index, row] of left.rows.entries()) await tx.query("UPDATE fields SET position = $2 WHERE id = $1", [row.id, index + 1]);
    await publish(tx, { t: "structure", team: teamId, project: projectId });
  });
  return NO_CONTENT;
});

