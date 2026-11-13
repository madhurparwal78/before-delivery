import { one, query } from '../db.js';
import { fail } from '../errors.js';
import { route, type ResolvedResource } from '../http.js';
import { currentSeq } from '../live.js';
import { runPipeline, validateProcessors, type Processor } from '../domain/pipeline.js';

const PIPELINE_NAME = /^[a-z0-9-]{1,40}$/;

async function pipelineResource(
  space: { id: number },
  params: Record<string, string>,
): Promise<ResolvedResource | null> {
  const row = await one(`select name, processors from pipelines where space_id = $1 and name = $2`, [
    space.id,
    params.name,
  ]);
  return row === null ? null : { value: row };
}

export function registerPipelineRoutes(): void {
  route({
    method: 'GET',
    path: '/api/pipelines',
    auth: 'session',
    space: true,
    role: 'viewer',
    body: 'none',
    handler: async (ctx) => {
      const rows = await query(
        `select name, version, processors from pipelines where space_id = $1 order by name asc`,
        [ctx.space.id],
      );
      return {
        status: 200,
        body: {
          pipelines: rows.map((row) => ({
            name: String(row.name),
            version: Number(row.version),
            processors: row.processors as Processor[],
          })),
        },
      };
    },
  });

  route({
    method: 'PUT',
    path: '/api/pipelines/:name',
    auth: 'session',
    space: true,
    role: 'admin',
    body: 'json',
    handler: async (ctx) => {
      const name = ctx.params.name;
      if (!PIPELINE_NAME.test(name)) {
        throw fail.invalid({ name: 'Use 1 to 40 characters: a-z, 0-9 or -.' });
      }
      const checked = validateProcessors(ctx.body.processors ?? []);
      if ('fields' in checked) throw fail.invalid(checked.fields);
      const existing = await one(`select version from pipelines where space_id = $1 and name = $2`, [
        ctx.space.id,
        name,
      ]);
      if (!existing) {
        await query(
          `insert into pipelines (space_id, name, version, processors) values ($1, $2, 1, $3)`,
          [ctx.space.id, name, JSON.stringify(checked.processors)],
        );
        return {
          status: 201,
          body: {
            name,
            version: 1,
            processors: checked.processors,
            message: 'Pipeline saved. Only new events are affected.',
            seq: await currentSeq(ctx.space.id),
          },
        };
      }
      const updated = await one<{ version: number }>(
        `update pipelines set version = version + 1, processors = $3
         where space_id = $1 and name = $2 returning version`,
        [ctx.space.id, name, JSON.stringify(checked.processors)],
      );
      return {
        status: 200,
        body: {
          name,
          version: Number(updated?.version),
          processors: checked.processors,
          message: 'Pipeline saved. Only new events are affected.',
          seq: await currentSeq(ctx.space.id),
        },
      };
    },
  });

  route({
    method: 'POST',
    path: '/api/pipelines/:name/simulate',
    auth: 'session',
    resource: pipelineResource,
    space: true,
    role: 'editor',
    body: 'json',
    handler: async (ctx) => {
      const row = await one(`select name, processors from pipelines where space_id = $1 and name = $2`, [
        ctx.space.id,
        ctx.params.name,
      ]);
      if (!row) throw fail.notFound();
      const processors = row.processors as Processor[];
      const text = String(ctx.body.lines ?? '');
      const lines = text.split('\n').filter((line) => line.trim() !== '');
      const results = lines.map((line, index) => {
        const number = index + 1;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          return {
            event: number,
            outcome: 'failed' as const,
            error: `Event ${number}: not valid JSON.`,
            steps: [],
          };
        }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return {
            event: number,
            outcome: 'failed' as const,
            error: `Event ${number}: not an object.`,
            steps: [],
          };
        }
        const run = runPipeline(String(row.name), processors, parsed as Record<string, unknown>);
        return {
          event: number,
          outcome: run.outcome,
          error: run.error,
          steps: run.steps,
        };
      });
      return { status: 200, body: { results } };
    },
  });
}
