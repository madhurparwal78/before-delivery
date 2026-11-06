/** Helpers shared by every route module. */

import express, { type Request, type Response, type NextFunction } from "express";
import type { Db } from "../db/schema.js";
import type { PoolClient } from "pg";
import { withTransaction } from "../db/schema.js";
import { jobContext, type JobCtx } from "../context.js";


/** Runs `fn` inside a transaction with the job context, raising role-ended or
 *  404 before any work happens. */
export async function withJob<T>(req: Request, db: Db, jobId: string, fn: (ctx: JobCtx) => Promise<T>): Promise<T> {
  const person = req.person!;
  return withTransaction(db, async (client) => {
    const ctx = await jobContext(db, client, person, jobId);
    return fn(ctx);
  });
}

/** Loads the job context on a plain client, for read-only routes. */
export async function readJob(req: Request, db: Db, jobId: string): Promise<{ ctx: JobCtx; client: PoolClient; release: () => void }> {
  const person = req.person!;
  const client = await db.connect();
  try {
    const ctx = await jobContext(db, client, person, jobId);
    return { ctx, client, release: () => client.release() };
  } catch (e) {
    client.release();
    throw e;
  }
}

/** Wraps every handler on a router so a thrown or rejected error reaches the
 *  central error middleware instead of crashing the process. */
export function asyncify(router: express.Router): express.Router {
  for (const layer of router.stack) {
    if (layer.route !== undefined) {
      for (const handler of layer.route.stack) {
        wrapLayerHandler(handler);
      }
    } else {
      wrapLayerHandler(layer);
    }
  }
  return router;
}

function wrapLayerHandler(layer: { handle: (req: Request, res: Response, next: NextFunction) => unknown }): void {
  const original = layer.handle as (req: Request, res: Response, next: NextFunction) => unknown;
  if (original.length === 4) return;
  (layer as { handle: unknown }).handle = (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = original(req, res, next);
      if (result instanceof Promise) result.catch(next);
    } catch (e) {
      next(e);
    }
  };
}
