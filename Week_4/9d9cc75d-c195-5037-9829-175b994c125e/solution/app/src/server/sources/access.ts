import type { Role } from '../../shared/model.ts';
import type { App, AuthUser } from '../http/app.ts';
import { notFound } from '../http/errors.ts';
import type { ProjectRow } from '../projects/access.ts';
import { projectAccess } from '../projects/access.ts';
import type { SourceRow } from './repo.ts';
import { getSource } from './repo.ts';

export interface SourceAccess {
  source: SourceRow;
  project: ProjectRow;
  role: Role;
}

/** The source and the caller's role in its project; a source outside the caller's projects is the same 404. */
export async function sourceAccess(app: App, user: AuthUser, sourceId: string): Promise<SourceAccess> {
  const source = await getSource(app.db, sourceId);
  if (!source) throw notFound();
  const { project, role } = await projectAccess(app, user, source.project_id);
  return { source, project, role };
}
