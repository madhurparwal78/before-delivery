/** Who may see what: everything outside the caller's teams answers as not found. */
import { notFound, forbidden } from "./http.js";
import type { Queryable } from "./db.js";

interface Membership {
  teamId: string;
  role: "coordinator" | "member";
}

export async function teamsOf(db: Queryable, personId: string): Promise<Membership[]> {
  const { rows } = await db.query<{ team_id: string; role: "coordinator" | "member" }>(
    "SELECT team_id, role FROM memberships WHERE person_id = $1",
    [personId],
  );
  return rows.map((r) => ({ teamId: r.team_id, role: r.role }));
}

export async function roleIn(db: Queryable, personId: string, teamId: string): Promise<Membership["role"]> {
  const { rows } = await db.query<{ role: Membership["role"] }>(
    "SELECT role FROM memberships WHERE person_id = $1 AND team_id = $2",
    [personId, teamId],
  );
  if (!rows.length) throw notFound();
  return rows[0].role;
}

export async function projectTeam(db: Queryable, personId: string, projectId: string): Promise<{ teamId: string; role: Membership["role"] }> {
  const { rows } = await db.query<{ team_id: string; role: Membership["role"] }>(
    `SELECT p.team_id, m.role FROM projects p JOIN memberships m ON m.team_id = p.team_id AND m.person_id = $2 WHERE p.id = $1`,
    [projectId, personId],
  );
  if (!rows.length) throw notFound();
  return { teamId: rows[0].team_id, role: rows[0].role };
}

export async function taskAccess(db: Queryable, personId: string, taskId: string): Promise<{ projectId: string; teamId: string; role: Membership["role"] }> {
  const { rows } = await db.query<{ project_id: string; team_id: string; role: Membership["role"] }>(
    `SELECT t.project_id, p.team_id, m.role FROM tasks t JOIN projects p ON p.id = t.project_id
       JOIN memberships m ON m.team_id = p.team_id AND m.person_id = $2 WHERE t.id = $1`,
    [taskId, personId],
  );
  if (!rows.length) throw notFound();
  return { projectId: rows[0].project_id, teamId: rows[0].team_id, role: rows[0].role };
}

export function requireCoordinator(role: Membership["role"]): void {
  if (role !== "coordinator") throw forbidden();
}

export async function personName(db: Queryable, personId: string): Promise<string> {
  const { rows } = await db.query<{ name: string }>("SELECT name FROM people WHERE id = $1", [personId]);
  return rows[0].name;
}
