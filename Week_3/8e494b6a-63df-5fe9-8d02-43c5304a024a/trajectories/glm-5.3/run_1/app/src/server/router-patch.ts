import type { NextFunction, Request, RequestHandler, Response, Router } from "express";

// Express 4 does not catch rejected promises from handlers, so every router method is
// patched to catch them and land in the one error ordering point.
export function patchRouterPromises(router: Router): void {
  for (const method of ["get", "post", "put", "patch", "delete"] as const) {
    const original = router[method].bind(router);
    (router as unknown as Record<string, unknown>)[method] = (path: unknown, ...handlers: unknown[]) => {
      const wrapped = handlers.map((h) => async (req: Request, res: Response, next: NextFunction) => {
        if (typeof h !== "function") {
          next();
          return;
        }
        try {
          const result = (h as (req: Request, res: Response, next: NextFunction) => unknown)(req, res, next);
          if (result instanceof Promise) await result;
        } catch (err) {
          if (res.headersSent) return;
          const { apiErrorHandler } = await import("./errors.js");
          apiErrorHandler(err, req, res, next);
        }
      });
      original(path as never, ...(wrapped as never[]));
    };
  }
}
