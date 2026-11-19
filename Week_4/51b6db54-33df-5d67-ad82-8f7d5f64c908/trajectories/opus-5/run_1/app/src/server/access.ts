import type { Role } from '../shared/types.js';
import { one, query } from './db.js';
import {
  forbidden,
  notFound,
  OWNER_ONLY,
  REVIEWER_ARTWORK,
  REVIEWER_DRAW,
  REVIEWER_EXPORT,
  unauthenticated,
} from './errors.js';
import type { Ctx, Person } from './http.js';

export interface ProjectRow {
  id: number;
  name: string;
  owner_id: number;
}

export interface SpriteRow {
  id: number;
  project_id: number;
  palette_id: number;
  name: string;
  width: number;
  height: number;
  seq: number;
}

export interface Access {
  person: Person;
  project: ProjectRow;
  role: Role;
}

export function requirePerson(ctx: Ctx): Person {
  if (ctx.person === null) throw unauthenticated();
  return ctx.person;
}

export async function roleIn(projectId: number, personId: number): Promise<Role | null> {
  const project = await one<ProjectRow>('SELECT id, name, owner_id FROM projects WHERE id = $1', [
    projectId,
  ]);
  if (project === null) return null;
  if (project.owner_id === personId) return 'owner';
  const membership = await one<{ role: Role }>(
    'SELECT role FROM memberships WHERE project_id = $1 AND user_id = $2',
    [projectId, personId],
  );
  return membership === null ? null : membership.role;
}

/** A record the person cannot open answers 404, never 403. */
export async function openProject(ctx: Ctx, projectId: number): Promise<Access> {
  const person = requirePerson(ctx);
  if (!Number.isInteger(projectId)) throw notFound();
  const project = await one<ProjectRow>('SELECT id, name, owner_id FROM projects WHERE id = $1', [
    projectId,
  ]);
  if (project === null) throw notFound();
  const role = await roleIn(projectId, person.id);
  if (role === null) throw notFound();
  return { person, project, role };
}

export async function openSprite(
  ctx: Ctx,
  spriteId: number,
): Promise<{ sprite: SpriteRow; access: Access }> {
  if (!Number.isInteger(spriteId)) throw notFound();
  const sprite = await one<SpriteRow>(
    'SELECT id, project_id, palette_id, name, width, height, seq FROM sprites WHERE id = $1',
    [spriteId],
  );
  if (sprite === null) throw notFound();
  const access = await openProject(ctx, sprite.project_id);
  return { sprite, access };
}

export async function openPalette(
  ctx: Ctx,
  paletteId: number,
): Promise<{ sprite: SpriteRow; access: Access }> {
  if (!Number.isInteger(paletteId)) throw notFound();
  const sprite = await one<SpriteRow>(
    'SELECT id, project_id, palette_id, name, width, height, seq FROM sprites WHERE palette_id = $1',
    [paletteId],
  );
  if (sprite === null) throw notFound();
  const access = await openProject(ctx, sprite.project_id);
  return { sprite, access };
}

export function requireDrawing(access: Access): void {
  if (access.role === 'reviewer') throw forbidden(REVIEWER_DRAW);
}

export function requireArtwork(access: Access): void {
  if (access.role === 'reviewer') throw forbidden(REVIEWER_ARTWORK);
}

export function requireExporting(access: Access): void {
  if (access.role === 'reviewer') throw forbidden(REVIEWER_EXPORT);
}

export function requireOwner(access: Access): void {
  if (access.role !== 'owner') throw forbidden(OWNER_ONLY);
}

export async function membersOf(
  projectId: number,
): Promise<{ id: number; name: string; email: string; role: Role }[]> {
  return query<{ id: number; name: string; email: string; role: Role }>(
    `SELECT * FROM (
       SELECT u.id, u.name, u.email, 'owner'::text AS role
         FROM projects p JOIN users u ON u.id = p.owner_id
        WHERE p.id = $1
       UNION ALL
       SELECT u.id, u.name, u.email, m.role
         FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.project_id = $1
     ) AS people
     ORDER BY role <> 'owner', id`,
    [projectId],
  );
}
