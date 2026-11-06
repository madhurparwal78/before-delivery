import { pool } from '../db/pool';
import type { ProjectRole } from '../db/seed-data';
import { bodyField, sendJson, sendNoContent } from '../http/context';
import { notFound, ValidationError } from '../http/errors';
import { requireAdmin, requirePerson, requireProject } from '../http/guards';
import type { Route } from '../http/router';
import { loadAllProjects } from '../projects';

const ROLES: readonly ProjectRole[] = ['viewer', 'analyst', 'sealer'];

async function requireKnownPerson(personId: string): Promise<void> {
  const result = await pool.query('select 1 from people where id = $1', [personId]);
  if (result.rowCount === 0) throw notFound();
}

export const accessRoutes: readonly Route[] = [
  {
    method: 'GET',
    path: '/api/access',
    handler: async (context) => {
      const person = await requirePerson(pool, context);
      requireAdmin(person);
      const people = await pool.query<{
        id: string;
        name: string;
        email: string;
        org_role: string;
      }>('select id, name, email, org_role from people order by name');
      const projects = await loadAllProjects(pool);
      const grants = await pool.query<{ person_id: string; project_slug: string; role: string }>(
        'select person_id, project_slug, role from project_grants order by person_id, project_slug',
      );
      sendJson(context, 200, {
        people: people.rows.map((row) => ({
          id: row.id,
          name: row.name,
          email: row.email,
          org_role: row.org_role,
        })),
        projects: projects.map((project) => ({ slug: project.slug, name: project.name })),
        grants: grants.rows.map((row) => ({
          person_id: row.person_id,
          project: row.project_slug,
          role: row.role,
        })),
      });
    },
  },
  {
    method: 'PUT',
    path: '/api/projects/:slug/grants/:personId',
    handler: async (context) => {
      const person = await requirePerson(pool, context);
      const { project } = await requireProject(pool, person, context.params.slug!);
      requireAdmin(person);
      await requireKnownPerson(context.params.personId!);
      const role = bodyField(context.body, 'role');
      if (typeof role !== 'string' || !ROLES.includes(role as ProjectRole)) {
        throw new ValidationError({ role: 'Give role as viewer, analyst or sealer.' });
      }
      await pool.query(
        `insert into project_grants (person_id, project_slug, role) values ($1, $2, $3)
         on conflict (person_id, project_slug) do update set role = excluded.role`,
        [context.params.personId!, project.slug, role],
      );
      sendJson(context, 200, {
        person_id: context.params.personId!,
        project: project.slug,
        role,
      });
    },
  },
  {
    method: 'DELETE',
    path: '/api/projects/:slug/grants/:personId',
    handler: async (context) => {
      const person = await requirePerson(pool, context);
      const { project } = await requireProject(pool, person, context.params.slug!);
      requireAdmin(person);
      await requireKnownPerson(context.params.personId!);
      await pool.query(
        'delete from project_grants where person_id = $1 and project_slug = $2',
        [context.params.personId!, project.slug],
      );
      sendNoContent(context);
    },
  },
];
