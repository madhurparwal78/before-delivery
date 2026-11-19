import { Ctx, requireSession, sendJson } from '../http/context';
import { outages, serviceState } from '../services/status';
import { subscribe } from '../events';

export async function health(ctx: Ctx): Promise<void> {
  const state = serviceState();
  const ok = state.mail && state.pdf && state.postgres;
  sendJson(ctx.res, 200, { status: ok ? 'ok' : 'unavailable' });
}

export async function events(ctx: Ctx): Promise<void> {
  const user = requireSession(ctx);
  ctx.res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  ctx.res.write(`data: ${JSON.stringify({ type: 'ready', services: outages() })}\n\n`);
  const unsubscribe = subscribe({
    practiceId: user.practice_id,
    userId: user.id,
    role: user.role,
    clientId: user.client_id,
    res: ctx.res,
  });
  ctx.req.on('close', unsubscribe);
  ctx.res.on('close', unsubscribe);
  await new Promise<void>((resolve) => {
    ctx.res.on('close', resolve);
  });
}
