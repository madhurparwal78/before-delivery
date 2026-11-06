/** Every API endpoint, assembled from the area route modules. */

import type { Pool } from "../db/pool.js";
import express, { type Express } from "express";
import { boundary, jsonBodyError } from "./boundary.js";
import { installServerRoutes } from "./servers.routes.js";
import { installGameRoutes } from "./games.routes.js";
import { installWorldRoutes } from "./world.routes.js";
import { installCoinRoutes } from "./coins.routes.js";
import { installStreamRoutes } from "./streams.routes.js";
import { installRootRoutes } from "./root.routes.js";

export function installRoutes(app: Express, pool: Pool): void {
  app.use("/api", boundary);
  app.use(express.json({ limit: "16kb" }));
  app.use(jsonBodyError);
  // Every handler registered after this line has its async failures routed to
  // the one error builder.
  const wrap = (router: { [key: string]: ((...args: unknown[]) => unknown) | undefined }): void => {
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      const original = router[method];
      if (original === undefined) continue;
      const bound = original.bind(router);
      router[method] = (...args: unknown[]) => {
        const wrapped = args.map((arg, index) => {
          const isPath = index === 0 && typeof arg === "string";
          if (isPath || typeof arg !== "function" || (arg as (...fn: unknown[]) => unknown).length > 3) return arg;
          const handler = arg as (req: unknown, res: unknown, next: unknown) => unknown;
          return (req: unknown, res: unknown, next: unknown) => {
            void Promise.resolve(handler(req, res, next)).catch((err: unknown) => (next as (e: unknown) => void)(err));
          };
        });
        return bound(...wrapped);
      };
    }
  };
  wrap(app as unknown as { [key: string]: (...args: unknown[]) => unknown });
  installRootRoutes(app, pool);
  installServerRoutes(app, pool);
  installGameRoutes(app, pool);
  installWorldRoutes(app, pool);
  installCoinRoutes(app, pool);
  installStreamRoutes(app, pool);
}
