// Workspace admins grant and remove per-project roles. A change applies to the person's next request.

import { visibleProject, type Person } from "../auth.js";
import { pool } from "../db.js";
import { HttpError, notFound, validationError, type Context, type Route } from "../http.js";
import { requirePerson } from "./common.js";

const ROLES = ["viewer", "analyst", "sealer"];

function requireAdmin(person: Person): void {
  if (person.org_role !== "admin") throw new HttpError(403, { error: "forbidden" });
}

/** 401 → 404 (project the caller cannot see, then unknown person) → 403 (not an admin). */
async function grantTarget(ctx: Context): Promise<{ slug: string; personId: string }> {
  const caller = await requirePerson(ctx);
  const { project } = await visibleProject(caller, ctx.params.slug!);
  const { rowCount } = await pool.query("SELECT 1 FROM people WHERE id = $1", [ctx.params.person]);
  if (!rowCount) throw notFound();
  requireAdmin(caller);
  return { slug: project.slug, personId: ctx.params.person! };
}

const GRANT_PATH = /^\/api\/projects\/(?<slug>[a-z0-9-]+)\/grants\/(?<person>[^/]+)$/;

export const accessRoutes: Route[] = [
  {
    method: "GET", pattern: /^\/api\/access$/,
    handle: async (ctx) => {
      requireAdmin(await requirePerson(ctx));
      const [people, projects, grants] = await Promise.all([
        pool.query("SELECT id, name, email, org_role FROM people ORDER BY name"),
        pool.query("SELECT slug, name FROM projects ORDER BY name"),
        pool.query("SELECT person_id, project, role FROM grants ORDER BY person_id, project"),
      ]);
      return { status: 200, json: { people: people.rows, projects: projects.rows, grants: grants.rows } };
    },
  },
  {
    method: "PUT", pattern: GRANT_PATH,
    handle: async (ctx) => {
      const { slug, personId } = await grantTarget(ctx);
      const role = ctx.body.role;
      if (typeof role !== "string" || !ROLES.includes(role)) throw validationError({ role: "must be viewer, analyst or sealer" });
      await pool.query(
        `INSERT INTO grants (person_id, project, role) VALUES ($1, $2, $3)
         ON CONFLICT (person_id, project) DO UPDATE SET role = EXCLUDED.role`, [personId, slug, role]);
      return { status: 200, json: { person_id: personId, project: slug, role } };
    },
  },
  {
    method: "DELETE", pattern: GRANT_PATH,
    handle: async (ctx) => {
      const { slug, personId } = await grantTarget(ctx);
      await pool.query("DELETE FROM grants WHERE person_id = $1 AND project = $2", [personId, slug]);
      return { status: 204 };
    },
  },
];
