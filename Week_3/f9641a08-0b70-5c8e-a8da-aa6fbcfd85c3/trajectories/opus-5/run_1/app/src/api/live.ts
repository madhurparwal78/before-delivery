import { isStaff } from '../http/context';
import { route } from '../http/router';
import { attach } from '../services/live';

export function registerLiveRoutes(): void {
  route('GET', '/api/live', 'stream', async (ctx) => {
    const header = ctx.request.headers['last-event-id'];
    const queryAfter = ctx.query.get('after');
    const raw = typeof header === 'string' && header !== '' ? header : queryAfter;
    const after = raw === null ? null : Number(raw);
    await attach(ctx.response, {
      userId: ctx.user?.id ?? null,
      isStaff: isStaff(ctx.user),
      after: after !== null && Number.isFinite(after) && after >= 0 ? after : null
    });
  });
}
