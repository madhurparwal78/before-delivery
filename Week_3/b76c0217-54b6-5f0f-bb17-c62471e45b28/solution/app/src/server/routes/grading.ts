import { config } from '../config';
import { fail } from '../errors';
import { endpoint, reply } from '../http';
import { Fields } from '../input';
import { startOutage } from '../outage';
import { seedWorkspace } from '../domain/seed';

/** The seed and outage routes exist only while GRADING_ROUTES is on; otherwise they are not found. */
export function gradingRoutes(): void {
  endpoint('POST', '/api/grading/seed', {
    access: 'public',
    body: 'json',
    handle: async (ctx) => {
      if (!config.gradingRoutes) {
        throw fail.notFound();
      }
      return reply.json(201, await seedWorkspace(ctx.json));
    },
  });

  endpoint('POST', '/api/grading/outage', {
    access: 'public',
    body: 'json',
    handle: async (ctx) => {
      if (!config.gradingRoutes) {
        throw fail.notFound();
      }
      const fields = new Fields(ctx.json);
      const service = fields.oneOf('service', ['storage', 'mail'] as const);
      const ms = fields.integer('ms', 1);
      if (ms > 600_000) {
        fields.problems.ms = 'ms is at most 600000.';
      }
      fields.check();
      return reply.json(200, { service, until: startOutage(service, ms) });
    },
  });
}
