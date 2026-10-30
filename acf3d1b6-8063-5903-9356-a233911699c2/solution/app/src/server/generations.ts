import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { RENDER_SECONDS, generationCost, planOf } from '../shared/catalog.js';
import { drawPicture } from '../shared/picture.js';
import { checkGeneration } from '../shared/rules.js';
import { CreditsService } from './credits.js';
import { Database, type Queryable } from './database.js';
import { invalid, recordId, refuse } from './errors.js';
import type { Member, SignedInRequest } from './session.js';

/** A generation as the API returns it; `g` is generations, `u` the user who started it. */
export const GENERATION_COLUMNS = `g.id, g.project_id, g.model, g.prompt, g.duration, g.image_count, g.aspect, g.cost,
  g.status, u.name AS started_by, g.created_at, g.finished_at`;

/** Queued becomes Rendering after this long, and Rendering becomes Ready this long after the start. */
const RENDERING_AFTER_SECONDS = 0.5;
const TICK_MS = 1000;

interface GenerationRow {
  id: string;
  status: string;
  prompt: string;
  aspect: '16:9' | '9:16' | '1:1';
  duration: number | null;
  cost: number;
}

async function generationById(client: Queryable, id: string, workspaceId: string) {
  const { rows } = await client.query(
    `SELECT ${GENERATION_COLUMNS} FROM generations g JOIN users u ON u.id = g.user_id
      WHERE g.id = $1 AND g.workspace_id = $2`,
    [id, workspaceId],
  );
  return rows[0] as (GenerationRow & Record<string, unknown>) | undefined;
}

@Injectable()
export class GenerationsService {
  constructor(
    private readonly db: Database,
    private readonly credits: CreditsService,
  ) {}

  /**
   * Starts a generation: computes its cost, checks the balance and the parallel limit, writes the generation and
   * its charge, all in one transaction under the workspace lock. A repeated idempotency key returns the generation
   * it already started and charges nothing.
   */
  async start(member: Member, body: Record<string, unknown>, idempotencyKey: string | undefined) {
    const checked = checkGeneration(body);
    if (!checked.ok) throw invalid(checked.errors);
    const key = idempotencyKey?.trim() || null;
    if (key && key.length > 200) throw invalid({ idempotency_key: 'Use an idempotency key of 200 characters or fewer.' });
    const request = checked.value;
    const projectId = recordId(request.project_id);
    const workspaceId = member.workspace.id;
    return this.db.transaction(async (client) => {
      await this.db.lockWorkspace(client, workspaceId);
      if (key) {
        const earlier = await client.query<{ id: string }>(
          'SELECT id FROM generations WHERE idempotency_key = $2 AND workspace_id = $1',
          [workspaceId, key],
        );
        if (earlier.rows[0]) return { generation: await generationById(client, earlier.rows[0].id, workspaceId), created: false };
      }
      const project = await client.query('SELECT 1 FROM projects WHERE id = $1 AND workspace_id = $2', [projectId, workspaceId]);
      if (!project.rowCount) throw refuse(404, 'not_found');

      const cost = generationCost(request.model, request.duration, request.image_count);
      const balance = await this.credits.balance(client, workspaceId);
      if (balance < cost) throw refuse(402, 'insufficient_credits', { needed: cost, balance });
      const limit = planOf(member.workspace.plan).parallel_limit;
      const open = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM generations WHERE status IN ('queued', 'rendering') AND workspace_id = $1`,
        [workspaceId],
      );
      if (open.rows[0].n >= limit) throw refuse(409, 'parallel_limit', { limit });

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO generations
           (workspace_id, project_id, user_id, model, prompt, duration, image_count, aspect, cost, status, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'queued', $10) RETURNING id`,
        [workspaceId, projectId, member.id, request.model.id, request.prompt, request.duration, request.image_count,
          request.aspect, cost, key],
      );
      const generationId = inserted.rows[0].id;
      await this.credits.record(client, { workspaceId, kind: 'charge', amount: -cost, userId: member.id, generationId });
      return { generation: await generationById(client, generationId, workspaceId), created: true };
    });
  }

  /** Cancels a Queued or Rendering generation and refunds its full cost, once. */
  async cancel(member: Member, id: string) {
    const generationId = recordId(id);
    const workspaceId = member.workspace.id;
    return this.db.transaction(async (client) => {
      await this.db.lockWorkspace(client, workspaceId);
      const cancelled = await client.query<{ cost: number }>(
        `UPDATE generations SET status = 'cancelled', finished_at = clock_timestamp()
          WHERE id = $1 AND workspace_id = $2 AND status IN ('queued', 'rendering') RETURNING cost`,
        [generationId, workspaceId],
      );
      if (!cancelled.rows[0]) {
        if (!(await generationById(client, generationId, workspaceId))) throw refuse(404, 'not_found');
        throw refuse(409, 'not_cancellable');
      }
      await this.credits.record(client, {
        workspaceId,
        kind: 'refund',
        amount: cancelled.rows[0].cost,
        userId: member.id,
        generationId,
      });
      return generationById(client, generationId, workspaceId);
    });
  }
}

/** The server alone moves generations on: Queued, then Rendering, then Ready, whether or not a page is open. */
@Injectable()
export class GenerationProgress implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('GenerationProgress');
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly db: Database) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.advance(), TICK_MS);
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  private async advance(): Promise<void> {
    try {
      await this.db.query(
        `UPDATE generations SET status = 'rendering'
          WHERE status = 'queued' AND created_at <= clock_timestamp() - make_interval(secs => $1)`,
        [RENDERING_AFTER_SECONDS],
      );
      await this.db.query(
        `UPDATE generations SET status = 'ready', finished_at = clock_timestamp()
          WHERE status = 'rendering' AND created_at <= clock_timestamp() - make_interval(secs => $1)`,
        [RENDER_SECONDS],
      );
    } catch (error) {
      this.logger.error(`Could not move generations on: ${(error as Error).message}`);
    }
  }
}

@Controller('generations')
export class GenerationsController {
  constructor(
    private readonly db: Database,
    private readonly generations: GenerationsService,
  ) {}

  @Post()
  async start(
    @Req() req: SignedInRequest,
    @Body() body: Record<string, unknown>,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { generation, created } = await this.generations.start(req.member, body ?? {}, key);
    res.status(created ? 201 : 200);
    return generation;
  }

  @Get(':id')
  async read(@Req() req: SignedInRequest, @Param('id') id: string) {
    const generation = await generationById(this.db, recordId(id), req.member.workspace.id);
    if (!generation) throw refuse(404, 'not_found');
    return generation;
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Req() req: SignedInRequest, @Param('id') id: string) {
    return this.generations.cancel(req.member, id);
  }

  @Get(':id/output')
  @Header('Content-Type', 'image/svg+xml; charset=utf-8')
  @Header('Cache-Control', 'private, max-age=86400')
  @Header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
  async output(@Req() req: SignedInRequest, @Param('id') id: string) {
    const generation = await generationById(this.db, recordId(id), req.member.workspace.id);
    if (!generation) throw refuse(404, 'not_found');
    if (generation.status !== 'ready') throw refuse(409, 'not_ready');
    return drawPicture({
      phrase: generation.prompt,
      aspect: generation.aspect,
      seconds: generation.duration,
      label: generation.prompt,
    });
  }
}
