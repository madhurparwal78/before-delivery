import type { Request, Response } from "express";
import type { AppContext } from "./route-context.js";
import type { Role } from "../shared/enums.js";
import { requireSession } from "./session.js";
import type { Person } from "./person.js";
import { ApiError } from "./errors.js";

/** Error-precedence ladder helpers. Every route composes through this module. */

export type Handler = (req: Request, res: Response) => Promise<void>;

export class RouteRunner {
  constructor(
    private ctx: AppContext,
    private allowedRoles: Role[] | null
  ) {}

  /** Authenticate then check role, then run the handler with the person. */
  handle(handler: (req: Request, res: Response, person: Person) => Promise<void>): Handler {
    return async (req, res) => {
      const person = await requireSession(this.ctx.db, req, this.ctx.config.timers.sessionSeconds);
      if (this.allowedRoles !== null && !this.allowedRoles.includes(person.role)) {
        throw new ApiError(403, "forbidden", "You can't use that.");
      }
      await handler(req, res, person);
    };
  }
}

export function publicHandler(
  handler: (req: Request, res: Response) => Promise<void>
): Handler {
  return handler;
}
