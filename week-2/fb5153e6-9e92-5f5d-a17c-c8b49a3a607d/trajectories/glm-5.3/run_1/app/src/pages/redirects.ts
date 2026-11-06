import type { RequestContext } from '../http/types.js';

export function redirect(ctx: RequestContext, location: string): void {
  ctx.res.statusCode = 302;
  ctx.res.setHeader('Location', location);
  ctx.res.end();
}
