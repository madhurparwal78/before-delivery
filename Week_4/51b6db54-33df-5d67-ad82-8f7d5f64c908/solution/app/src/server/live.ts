import { asId, spriteAccess } from './access';
import { joinWorkspace, missedEvents, recordCursor } from './hub';
import { route } from './http';
import { Errors, intIn, objectBody } from './validate';

route('GET', '/api/sprites/:id/events', async (ctx) => {
  const { sprite } = await spriteAccess(ctx.need().id, asId(ctx.params.id));
  const since = Number(ctx.query.get('since') ?? 0);
  return { events: await missedEvents(sprite.id, Number.isInteger(since) && since > 0 ? since : 0) };
});

route('GET', '/api/sprites/:id/live', async (ctx) => {
  const user = ctx.need();
  const { sprite } = await spriteAccess(user.id, asId(ctx.params.id));
  const since = Number(ctx.query.get('since') ?? 0);
  await joinWorkspace(ctx.res, user, sprite.project_id, sprite.id, Number.isInteger(since) && since > 0 ? since : 0);
});

route('POST', '/api/sprites/:id/cursor', async (ctx) => {
  const { sprite } = await spriteAccess(ctx.need().id, asId(ctx.params.id));
  const body = objectBody(ctx.body);
  const errors = new Errors();
  if (!intIn(body.x, 0, sprite.width - 1)) errors.add('x', 'Use a cell of the sprite');
  if (!intIn(body.y, 0, sprite.height - 1)) errors.add('y', 'Use a cell of the sprite');
  if (!intIn(body.frame, 1, 100000)) errors.add('frame', 'Use a frame number');
  errors.check();
  recordCursor(sprite.id, ctx.need().id, { x: body.x as number, y: body.y as number, frame: body.frame as number });
  return { status: 204 };
});

