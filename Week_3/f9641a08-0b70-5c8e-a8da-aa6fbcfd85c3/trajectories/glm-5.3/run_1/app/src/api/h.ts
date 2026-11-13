import type { Request, Response, NextFunction, RequestHandler } from 'express';

type AsyncHandler = (req: Request, res: Response) => unknown;

/** Express 4 does not forward rejected async handlers; this wrapper does. */
export function h(fn: AsyncHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    void Promise.resolve(fn(req, res)).catch(next);
  };
}
