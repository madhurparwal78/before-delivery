import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { planOf } from '../shared/catalog.js';
import { checkProjectName } from '../shared/rules.js';
import { Database, isUniqueViolation } from './database.js';
import { invalid, recordId, refuse } from './errors.js';
import { GENERATION_COLUMNS } from './generations.js';
import type { SignedInRequest } from './session.js';

const PROJECT_COLUMNS = `p.id, p.name, p.created_at,
  (SELECT COUNT(*)::int FROM generations g WHERE g.project_id = p.id) AS generation_count,
  (SELECT MAX(g.created_at) FROM generations g WHERE g.project_id = p.id) AS latest_generation_at`;

@Controller('projects')
export class ProjectsController {
  constructor(private readonly db: Database) {}

  @Get()
  async list(@Req() req: SignedInRequest) {
    const { rows } = await this.db.query(
      `SELECT ${PROJECT_COLUMNS} FROM projects p WHERE p.workspace_id = $1 ORDER BY p.created_at DESC, p.id`,
      [req.member.workspace.id],
    );
    return rows;
  }

  @Post()
  async create(@Req() req: SignedInRequest, @Body() body: Record<string, unknown>) {
    const checked = checkProjectName(body ?? {});
    if (!checked.ok) throw invalid(checked.errors);
    const { workspace } = req.member;
    const limit = planOf(workspace.plan).project_limit;
    try {
      return await this.db.transaction(async (client) => {
        await this.db.lockWorkspace(client, workspace.id);
        const count = await client.query<{ n: number }>(
          'SELECT COUNT(*)::int AS n FROM projects project WHERE project.workspace_id = $1',
          [workspace.id],
        );
        if (count.rows[0].n >= limit) throw refuse(409, 'project_limit', { limit });
        const { rows } = await client.query(
          `INSERT INTO projects (workspace_id, name) VALUES ($1, $2)
           RETURNING id, name, created_at, 0 AS generation_count, NULL::timestamptz AS latest_generation_at`,
          [workspace.id, checked.value.name],
        );
        return rows[0];
      });
    } catch (error) {
      if (isUniqueViolation(error, 'projects_name_key')) throw refuse(409, 'duplicate_name');
      throw error;
    }
  }

  @Patch(':id')
  async rename(@Req() req: SignedInRequest, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    const projectId = recordId(id);
    const checked = checkProjectName(body ?? {});
    if (!checked.ok) throw invalid(checked.errors);
    try {
      const { rows } = await this.db.query(
        `WITH p AS (UPDATE projects SET name = $3 WHERE id = $1 AND workspace_id = $2 RETURNING *)
         SELECT ${PROJECT_COLUMNS} FROM p`,
        [projectId, req.member.workspace.id, checked.value.name],
      );
      if (!rows[0]) throw refuse(404, 'not_found');
      return rows[0];
    } catch (error) {
      if (isUniqueViolation(error, 'projects_name_key')) throw refuse(409, 'duplicate_name');
      throw error;
    }
  }

  @Get(':id/generations')
  async generations(@Req() req: SignedInRequest, @Param('id') id: string) {
    const projectId = recordId(id);
    const workspaceId = req.member.workspace.id;
    const project = await this.db.query('SELECT 1 FROM projects WHERE id = $1 AND workspace_id = $2', [projectId, workspaceId]);
    if (!project.rowCount) throw refuse(404, 'not_found');
    const { rows } = await this.db.query(
      `SELECT ${GENERATION_COLUMNS} FROM generations g JOIN users u ON u.id = g.user_id
        WHERE g.project_id = $1 AND g.workspace_id = $2 ORDER BY g.created_at DESC`,
      [projectId, workspaceId],
    );
    return rows;
  }
}
