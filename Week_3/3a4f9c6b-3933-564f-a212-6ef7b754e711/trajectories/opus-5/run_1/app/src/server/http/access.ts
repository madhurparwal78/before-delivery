import { mayPerform, type Action } from '../../shared/authority.js';
import type { ProjectRole } from '../../shared/types.js';
import { errors } from '../errors.js';
import { findMembership, findProject, findStage, type PersonRow, type StageRow } from '../repo.js';
import type { Ctx, Membership } from './types.js';

export function caller(ctx: Ctx): PersonRow {
  if (!ctx.person) throw errors.unauthenticated();
  return ctx.person;
}

/**
 * A project the caller does not belong to is indistinguishable from one that does not exist,
 * so every stage, bundle and promotion inside it answers as unknown.
 */
export async function membership(ctx: Ctx): Promise<Membership> {
  const person = caller(ctx);
  const project = await findProject(ctx.params.project ?? '');
  if (!project) throw errors.notFound();
  const role = await findMembership(project.id, person.id);
  if (!role) throw errors.notFound();
  return { project, role };
}

export async function stageOf(ctx: Ctx, projectId: string): Promise<StageRow> {
  const stage = await findStage(projectId, ctx.params.stage ?? '');
  if (!stage) throw errors.notFound();
  return stage;
}

/** Called after the addressed resource is known, because an unknown one answers first. */
export function requireRole(role: ProjectRole, action: Action): void {
  if (!mayPerform(role, action)) throw errors.forbidden();
}
