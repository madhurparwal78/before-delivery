import type { FastifyInstance } from 'fastify';
import { memberOf } from '../auth.js';
import { companyFollowers, companyPage, updateCompany } from '../domain/companies.js';
import { pool } from '../db.js';

export async function companyRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { handle: string } }>('/api/companies/:handle', async (request) => companyPage(pool, memberOf(request).id, request.params.handle));

  app.patch<{ Params: { handle: string } }>('/api/companies/:handle', async (request) =>
    updateCompany(pool, memberOf(request).id, request.params.handle, (request.body ?? {}) as Record<string, unknown>),
  );

  app.get<{ Params: { handle: string } }>('/api/companies/:handle/followers', async (request) => ({
    followers: await companyFollowers(pool, memberOf(request).id, request.params.handle),
  }));
}
