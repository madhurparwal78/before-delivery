import { HttpException, Injectable } from '@nestjs/common';
import { DbService } from '../db.service';
import { MemberContext } from '../auth/auth.service';
import { UUID } from './projects.controller';
import { generationCost, modelById, planById } from '../../shared/catalog';
import { checkText } from '../../shared/forms';

export interface GenerationView {
  id: string;
  project_id: string;
  model: string;
  prompt: string;
  duration: number | null;
  image_count: number | null;
  aspect: string;
  cost: number;
  status: 'queued' | 'rendering' | 'ready' | 'cancelled';
  started_by: string;
  created_at: Date;
  finished_at: Date | null;
}

const GENERATION_COLUMNS = `
  g.id, g.project_id, g.model, g.prompt, g.duration, g.image_count, g.aspect, g.cost, g.status,
  u.name as started_by, g.created_at, g.finished_at`;

interface StartInput {
  project_id?: unknown;
  model?: unknown;
  prompt?: unknown;
  duration?: unknown;
  image_count?: unknown;
  aspect?: unknown;
}

const ASPECTS = ['16:9', '9:16', '1:1'];

@Injectable()
export class GenerationsService {
  constructor(private readonly db: DbService) {}

  async listForProject(member: MemberContext, projectId: string): Promise<GenerationView[]> {
    if (!UUID.test(projectId)) throw new HttpException({ error: 'not_found' }, 404);
    const project = await this.db.query('select 1 from projects where id = $1 and workspace_id = $2', [
      projectId,
      member.workspace.id
    ]);
    if (!project.rowCount) throw new HttpException({ error: 'not_found' }, 404);
    const result = await this.db.query<GenerationView>(
      `select ${GENERATION_COLUMNS} from generations g join users u on u.id = g.user_id
        where g.project_id = $1 and g.workspace_id = $2 order by g.created_at desc, g.id desc`,
      [projectId, member.workspace.id]
    );
    return result.rows;
  }

  async read(member: MemberContext, id: string): Promise<GenerationView & { charge: number; refund: number | null }> {
    if (!UUID.test(id)) throw new HttpException({ error: 'not_found' }, 404);
    const result = await this.db.query<GenerationView & { charge: number; refund: number | null }>(
      `select ${GENERATION_COLUMNS},
              (select amount from credit_entries c where c.generation_id = g.id and c.kind = 'charge') as charge,
              (select amount from credit_entries c where c.generation_id = g.id and c.kind = 'refund') as refund
         from generations g join users u on u.id = g.user_id
        where g.id = $1 and g.workspace_id = $2`,
      [id, member.workspace.id]
    );
    if (!result.rows[0]) throw new HttpException({ error: 'not_found' }, 404);
    return result.rows[0];
  }

  /**
   * Writes the generation and its charge as one all-or-nothing change under the
   * workspace lock, so the balance cannot be spent twice.
   */
  async start(
    member: MemberContext,
    body: StartInput,
    idempotencyKey: string | null
  ): Promise<{ generation: GenerationView; created: boolean }> {
    const errors: Record<string, string> = {};
    const model = typeof body.model === 'string' ? modelById(body.model) : undefined;
    if (!model) errors.model = 'Choose a model.';

    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt) errors.prompt = 'Write a prompt first.';
    else {
      const tooLong = checkText(prompt, 1, 1000, 'Keep the prompt under 1,000 characters.');
      if (tooLong) errors.prompt = tooLong;
    }

    let duration: number | null = null;
    let imageCount: number | null = null;
    if (model?.kind === 'video') {
      duration = Number(body.duration);
      if (duration !== 5 && duration !== 10) errors.duration = 'Choose a length of 5 or 10 seconds.';
    } else if (model?.kind === 'image') {
      imageCount = Number(body.image_count);
      if (!Number.isInteger(imageCount) || imageCount < 1 || imageCount > 4) {
        errors.image_count = 'Choose between 1 and 4 images.';
      }
    }

    const aspect = typeof body.aspect === 'string' && ASPECTS.includes(body.aspect) ? body.aspect : null;
    if (!aspect) errors.aspect = 'Choose an aspect.';

    const projectId = typeof body.project_id === 'string' ? body.project_id : '';
    if (!UUID.test(projectId)) errors.project_id = 'Choose a project.';

    if (Object.keys(errors).length) throw new HttpException({ errors }, 422);

    const cost = generationCost(model!, duration, imageCount);
    const parallelLimit = planById(member.workspace.plan)!.parallel_limit!;

    return this.db.transaction(async (client) => {
      await this.db.lockWorkspace(client, member.workspace.id);

      if (idempotencyKey) {
        const earlier = await client.query<GenerationView>(
          `select ${GENERATION_COLUMNS} from generations g join users u on u.id = g.user_id
            where g.workspace_id = $1 and g.idempotency_key = $2`,
          [member.workspace.id, idempotencyKey]
        );
        if (earlier.rows[0]) return { generation: earlier.rows[0], created: false };
      }

      const project = await client.query('select 1 from projects where id = $1 and workspace_id = $2', [
        projectId,
        member.workspace.id
      ]);
      if (!project.rowCount) throw new HttpException({ error: 'not_found' }, 404);

      const balance = await this.db.balanceOf(client, member.workspace.id);
      if (balance < cost) {
        throw new HttpException({ error: 'insufficient_credits', needed: cost, balance }, 402);
      }
      const active = await client.query<{ count: number }>(
        `select count(*)::int as count from generations
          where workspace_id = $1 and status in ('queued','rendering')`,
        [member.workspace.id]
      );
      if (active.rows[0].count >= parallelLimit) {
        throw new HttpException({ error: 'parallel_limit', limit: parallelLimit }, 409);
      }

      const inserted = await client.query<{ id: string }>(
        `insert into generations
           (workspace_id, project_id, user_id, model, prompt, duration, image_count, aspect, cost, status, idempotency_key)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'queued', $10) returning id`,
        [
          member.workspace.id,
          projectId,
          member.user.id,
          model!.id,
          prompt,
          duration,
          imageCount,
          aspect,
          cost,
          idempotencyKey
        ]
      );
      await this.db.addCreditEntry(client, {
        workspaceId: member.workspace.id,
        kind: 'charge',
        amount: -cost,
        userId: member.user.id,
        generationId: inserted.rows[0].id
      });
      const created = await client.query<GenerationView>(
        `select ${GENERATION_COLUMNS} from generations g join users u on u.id = g.user_id where g.id = $1`,
        [inserted.rows[0].id]
      );
      return { generation: created.rows[0], created: true };
    });
  }

  /** Cancelling refunds the full cost exactly once; the row lock keeps double cancels apart. */
  async cancel(member: MemberContext, id: string): Promise<GenerationView> {
    if (!UUID.test(id)) throw new HttpException({ error: 'not_found' }, 404);
    return this.db.transaction(async (client) => {
      await this.db.lockWorkspace(client, member.workspace.id);
      const found = await client.query<{ id: string; status: string; cost: number }>(
        'select id, status, cost from generations where id = $1 and workspace_id = $2 for update',
        [id, member.workspace.id]
      );
      const generation = found.rows[0];
      if (!generation) throw new HttpException({ error: 'not_found' }, 404);
      if (generation.status !== 'queued' && generation.status !== 'rendering') {
        throw new HttpException({ error: 'cannot_cancel' }, 409);
      }
      await client.query(
        `update generations set status = 'cancelled', finished_at = now() where id = $1`,
        [id]
      );
      await this.db.addCreditEntry(client, {
        workspaceId: member.workspace.id,
        kind: 'refund',
        amount: generation.cost,
        userId: member.user.id,
        generationId: id
      });
      const updated = await client.query<GenerationView>(
        `select ${GENERATION_COLUMNS} from generations g join users u on u.id = g.user_id where g.id = $1`,
        [id]
      );
      return updated.rows[0];
    });
  }
}
