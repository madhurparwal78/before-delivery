import { Request, Response, NextFunction } from 'express';
import { query } from './db';
import { AuthedRequest } from './apiutil';

export interface TeamContext {
  teamId: string;
  role: string;
  isCoordinator: boolean;
}

/**
 * Access checks in the published error order. A resource outside the caller's
 * teams answers 404 not_found; a visible but disallowed action answers 403.
 */
export async function projectTeam(projectId: string, teamIds: string[] | undefined, roles?: Record<string, string>): Promise<TeamContext | null> {
  if (!teamIds || teamIds.length === 0) return null;
  const r = await query<{ team_id: string }>(`SELECT team_id FROM projects WHERE id = $1`, [projectId]);
  const row = r.rows[0];
  if (!row) return null;
  if (!teamIds.includes(row.team_id)) return null;
  const role = roles?.[row.team_id] ?? 'member';
  return { teamId: row.team_id, role, isCoordinator: role === 'coordinator' };
}

export function requireTeamProject(): (req: Request, res: Response, next: NextFunction) => void {
  return async (req, res, next) => {
    const ar = req as AuthedRequest;
    const ctx = await projectTeam(String(req.params.id), ar.teamIds, ar.personRole);
    if (!ctx) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    (ar as AuthedRequest & { ctx: TeamContext }).ctx = ctx;
    next();
  };
}

