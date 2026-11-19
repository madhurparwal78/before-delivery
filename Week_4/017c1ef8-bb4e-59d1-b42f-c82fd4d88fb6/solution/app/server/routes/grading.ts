import type { FastifyInstance } from 'fastify';
import { seedInTransaction, type SeedBody } from '../domain/seed.js';
import { requireGradingKey } from './system.js';

export async function gradingRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/grading/seed', async (request, reply) => {
    requireGradingKey(request.headers['x-grading-key']);
    const ids = await seedInTransaction((request.body ?? {}) as SeedBody);
    return reply.status(201).send({ ids });
  });
}
