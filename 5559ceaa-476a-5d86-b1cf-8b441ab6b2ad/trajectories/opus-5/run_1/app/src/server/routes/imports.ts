import { pool } from '../db.js';
import type { Route } from '../http/router.js';
import { assertMentor, loadMembership } from '../repository.js';
import { applyImport, loadPlan, planImport } from '../services/imports.js';
import { withStorage } from './checkpoints.js';

export const importRoutes: Route[] = [
  {
    method: 'POST',
    pattern: '/api/projects/:project_id/imports',
    scope: 'project',
    body: 'zip',
    handler: async (ctx) => {
      assertMentor(ctx.role);
      const plan = await withStorage(() => planImport(ctx.project.id, ctx.body));
      return { status: 201, payload: { import: plan } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/imports/:import_id/apply',
    scope: 'auth',
    body: 'json',
    handler: async (ctx) => {
      const plan = await loadPlan(pool, ctx.params['import_id'] ?? '');
      const membership = await loadMembership(pool, plan.project_id, ctx.user.id);
      assertMentor(membership.role);
      const decisions = ctx.fields()['decisions'];
      const applied = await withStorage(() => applyImport(plan, ctx.user, decisions));
      return {
        status: 200,
        payload: {
          import: { id: plan.id, state: 'applied', ...applied.summary },
          files: applied.files,
        },
      };
    },
  },
];
