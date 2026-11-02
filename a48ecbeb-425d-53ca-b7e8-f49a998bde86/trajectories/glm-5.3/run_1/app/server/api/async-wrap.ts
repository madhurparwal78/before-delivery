import { Router, type RequestHandler, type Request, type Response, type NextFunction } from 'express';

type MaybePromise = void | Promise<void>;

const wrap = (handler: unknown): unknown => {
  if (typeof handler !== 'function') return handler;
  const fn = handler as (req: Request, res: Response, next: NextFunction, err?: unknown) => MaybePromise;
  if (fn.length > 3) return handler;
  return function wrapped(this: unknown, req: Request, res: Response, next: NextFunction): MaybePromise {
    const out = fn.apply(this, [req, res, next]);
    if (out !== null && out !== undefined && typeof (out as Promise<void>).catch === 'function') {
      (out as Promise<void>).catch(next);
    }
    return undefined;
  } as RequestHandler;
};

// Express attaches route methods to the Router factory object, which is also
// the prototype of every router instance.
const target = Router as unknown as Record<string, (...args: unknown[]) => unknown>;
for (const method of ['get', 'post', 'put', 'patch', 'delete', 'use'] as const) {
  const original = target[method];
  target[method] = function patchedRouterMethod(this: unknown, ...args: unknown[]): unknown {
    return original.apply(this, args.map(wrap));
  };
}
