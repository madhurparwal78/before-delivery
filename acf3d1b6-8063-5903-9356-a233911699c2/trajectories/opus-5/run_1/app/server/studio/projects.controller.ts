import { Body, Controller, Get, HttpCode, HttpException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { DbService } from '../db.service';
import { Member, SessionGuard } from '../auth/session.guard';
import { MemberContext } from '../auth/auth.service';
import { planById } from '../../shared/catalog';
import { checkText } from '../../shared/forms';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ProjectRow {
  id: string;
  name: string;
  generation_count: number;
  last_generation_at: Date | null;
  created_at: Date;
}

const PROJECT_COLUMNS = `
  p.id, p.name, p.created_at,
  (select count(*)::int from generations g where g.project_id = p.id) as generation_count,
  (select max(g.created_at) from generations g where g.project_id = p.id) as last_generation_at`;

const DUPLICATE_NAME = '23505';

@Controller('api/projects')
@UseGuards(SessionGuard)
export class ProjectsController {
  constructor(private readonly db: DbService) {}

  @Get()
  async list(@Member() member: MemberContext): Promise<ProjectRow[]> {
    const result = await this.db.query<ProjectRow>(
      `select ${PROJECT_COLUMNS} from projects p where p.workspace_id = $1 order by p.created_at desc, p.id desc`,
      [member.workspace.id]
    );
    return result.rows;
  }

  @Post()
  @HttpCode(201)
  async create(@Member() member: MemberContext, @Body() body: Record<string, unknown>) {
    const name = this.readName(body.name);
    const limit = planById(member.workspace.plan)!.project_limit!;
    return this.db
      .transaction(async (client) => {
        await this.db.lockWorkspace(client, member.workspace.id);
        const count = await client.query<{ count: number }>(
          'select count(*)::int as count from projects where workspace_id = $1',
          [member.workspace.id]
        );
        if (count.rows[0].count >= limit) throw new HttpException({ error: 'project_limit', limit }, 409);
        const inserted = await client.query<ProjectRow>(
          `insert into projects (workspace_id, name) values ($1, $2)
           returning id, name, created_at, 0 as generation_count, null::timestamptz as last_generation_at`,
          [member.workspace.id, name]
        );
        return inserted.rows[0];
      })
      .catch((error: HttpException & { code?: string }) => {
        if (error.code === DUPLICATE_NAME) throw new HttpException({ error: 'duplicate_name' }, 409);
        throw error;
      });
  }

  @Patch(':id')
  async rename(
    @Member() member: MemberContext,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>
  ): Promise<ProjectRow> {
    const name = this.readName(body.name);
    if (!UUID.test(id)) throw new HttpException({ error: 'not_found' }, 404);
    const updated = await this.db
      .query<ProjectRow>(
        `update projects set name = $3 where id = $1 and workspace_id = $2
         returning id, name, created_at,
           (select count(*)::int from generations g where g.project_id = projects.id) as generation_count,
           (select max(g.created_at) from generations g where g.project_id = projects.id) as last_generation_at`,
        [id, member.workspace.id, name]
      )
      .catch((error: { code?: string }) => {
        if (error.code === DUPLICATE_NAME) throw new HttpException({ error: 'duplicate_name' }, 409);
        throw error;
      });
    if (!updated.rows[0]) throw new HttpException({ error: 'not_found' }, 404);
    return updated.rows[0];
  }

  private readName(value: unknown): string {
    const error = checkText(value, 1, 80, 'Enter a project name of 1 to 80 characters.');
    if (error) throw new HttpException({ errors: { name: error } }, 422);
    return String(value).trim();
  }
}
