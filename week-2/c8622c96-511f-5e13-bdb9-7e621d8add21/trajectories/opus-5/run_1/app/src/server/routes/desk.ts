import { codePointLength, parseBody, stringField } from '../../domain/validate.js';
import { serverNow } from '../clock.js';
import { db } from '../db/pool.js';
import {
  allEssays,
  essayView,
  essaysByState,
  loadEssay,
  withdrawalRequests,
} from '../data/essays.js';
import { holdEssay, publishEssay, takedownEssay, withdrawEssay } from '../desk.js';
import { notFound, validationFailed } from '../http/errors.js';
import { jsonBody, requireRole, type Reply, type Route } from '../http/router.js';

const NOTE_MESSAGE = 'Desk note must be 1 to 1000 characters';
const REFERENCE_MESSAGE = 'Legal reference must be 1 to 200 characters';

export const deskRoutes: Route[] = [
  {
    method: 'GET',
    pattern: '/api/desk/queue',
    roles: ['desk_editor'],
    async handle(ctx): Promise<Reply> {
      const person = requireRole(ctx, 'desk_editor');
      const now = await serverNow();
      const queue = await essaysByState(db, ['in_review'], 'submitted');
      const requests = await withdrawalRequests(db);
      const essays = [];
      for (const essay of queue) {
        essays.push(await essayView(db, essay, person, now, { newsroomView: false }));
      }
      const withdrawals = [];
      for (const essay of requests) {
        withdrawals.push(await essayView(db, essay, person, now, { newsroomView: false }));
      }
      return { status: 200, json: { essays, withdrawal_requests: withdrawals } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/desk/essays',
    roles: ['desk_editor'],
    async handle(ctx): Promise<Reply> {
      const person = requireRole(ctx, 'desk_editor');
      const now = await serverNow();
      const rows = await allEssays(db);
      const essays = [];
      for (const essay of rows) {
        essays.push(await essayView(db, essay, person, now, { newsroomView: false }));
      }
      return { status: 200, json: { essays } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/essays/:id/publish',
    async handle(ctx): Promise<Reply> {
      const person = requireRole(ctx, 'desk_editor');
      const essayId = ctx.params.id as string;
      if (!(await loadEssay(db, essayId))) throw notFound();
      const parsed = parseBody<Record<string, never>>(jsonBody(ctx), {});
      if (!parsed.ok) throw validationFailed(parsed.fields);
      const essay = await publishEssay(essayId);
      const now = await serverNow();
      return {
        status: 200,
        json: await essayView(db, essay, person, now, { newsroomView: false }),
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/essays/:id/hold',
    async handle(ctx): Promise<Reply> {
      const person = requireRole(ctx, 'desk_editor');
      const essayId = ctx.params.id as string;
      if (!(await loadEssay(db, essayId))) throw notFound();
      const parsed = parseBody<{ note: string }>(jsonBody(ctx), {
        note: stringField(NOTE_MESSAGE, (value) => {
          const length = codePointLength(value);
          return length >= 1 && length <= 1000 ? null : NOTE_MESSAGE;
        }),
      });
      if (!parsed.ok) throw validationFailed(parsed.fields);
      await holdEssay(essayId, parsed.value.note);
      const essay = await loadEssay(db, essayId);
      if (!essay) throw notFound();
      const now = await serverNow();
      return {
        status: 200,
        json: await essayView(db, essay, person, now, { newsroomView: false }),
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/essays/:id/withdraw',
    async handle(ctx): Promise<Reply> {
      const person = requireRole(ctx, 'desk_editor');
      const essayId = ctx.params.id as string;
      if (!(await loadEssay(db, essayId))) throw notFound();
      const parsed = parseBody<Record<string, never>>(jsonBody(ctx), {});
      if (!parsed.ok) throw validationFailed(parsed.fields);
      await withdrawEssay(essayId);
      const essay = await loadEssay(db, essayId);
      if (!essay) throw notFound();
      const now = await serverNow();
      return {
        status: 200,
        json: await essayView(db, essay, person, now, { newsroomView: false }),
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/essays/:id/takedown',
    async handle(ctx): Promise<Reply> {
      requireRole(ctx, 'desk_editor');
      const essayId = ctx.params.id as string;
      if (!(await loadEssay(db, essayId))) throw notFound();
      const parsed = parseBody<{ reference: string }>(jsonBody(ctx), {
        reference: stringField(REFERENCE_MESSAGE, (value) => {
          const length = codePointLength(value);
          return length >= 1 && length <= 200 ? null : REFERENCE_MESSAGE;
        }),
      });
      if (!parsed.ok) throw validationFailed(parsed.fields);
      const result = await takedownEssay(essayId, parsed.value.reference);
      return {
        status: 200,
        json: {
          id: result.essayId,
          state: 'taken_down',
          revoked_licences: result.revokedLicenceIds.length,
        },
      };
    },
  },
];
