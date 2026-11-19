import type { Request, Response, NextFunction } from 'express';
import { ApiError, sendError } from '../errors.js';
import type { Services } from './services.js';
import { registerSessionRoutes } from './session-routes.js';
import { registerProjectRoutes } from './project-routes.js';
import { registerFileRoutes } from './file-routes.js';
import { registerReviewRoutes } from './review-routes.js';
import { registerHistoryRoutes } from './history-routes.js';
import { registerMemberRoutes } from './member-routes.js';
import { registerShareRoutes } from './share-routes.js';
import { registerInviteRoutes } from './invite-routes.js';
import { registerExportRoutes } from './export-routes.js';
import { registerHealth } from './health.js';

export function registerRoutes(app: import('express').Express, svc: Services): void {
  const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
    async (req: Request, res: Response, _next: NextFunction) => {
      try {
        await fn(req, res);
      } catch (err) {
        if (err instanceof ApiError) sendError(res, err);
        else { console.error('unexpected', err); sendError(res, new ApiError(500, 'internal')); }
      }
    };

  registerHealth(app);
  const r = { wrap, svc };
  registerSessionRoutes(app, r);
  registerProjectRoutes(app, r);
  registerFileRoutes(app, r);
  registerReviewRoutes(app, r);
  registerHistoryRoutes(app, r);
  registerMemberRoutes(app, r);
  registerShareRoutes(app, r);
  registerInviteRoutes(app, r);
  registerExportRoutes(app, r);
}
