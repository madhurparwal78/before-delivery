// API assembly: origin boundary, routers, page routes with proper statuses.

import type { Express, Request, Response, NextFunction } from 'express';
import { ApiError, notFound, validationError, FIELD_ERRORS } from '../lib/errors.js';
import type { Config } from '../lib/config.js';
import { sessionRouter } from './session.js';
import { membersRouter, invitationsPublicRouter } from './members.js';
import { projectsRouter } from './projects.js';
import { drawingsRouter } from './drawings.js';
import { tendersRouter, tenderLinksPublicRouter } from './tenders.js';
import { variationsRouter } from './variations.js';
import { certificatesRouter } from './certificates.js';
import { shopDrawingsRouter } from './shop.js';
import { viewpointsRouter } from './snags.js';
import { finishesRouter } from './finishes.js';
import { caseStudiesRouter, publicRouter } from './public.js';
import { KillBill } from '../lib/killbill.js';
import { Storage } from '../lib/s3.js';

export function registerApi(app: Express, config: Config): void {
  const storage = new Storage(config.s3);
  const killbill = new KillBill(config.killbill);

  // Same-origin boundary: no cross-origin allow headers, and state-changing
  // requests whose Origin names another origin answer 403 forbidden.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      const origin = req.headers.origin;
      if (origin) {
        let allowed: URL | null = null;
        try {
          allowed = new URL(config.baseUrl);
        } catch {
          allowed = null;
        }
        let given: URL | null = null;
        try {
          given = new URL(origin);
        } catch {
          given = null;
        }
        const same = allowed !== null && given !== null && given.origin === allowed.origin;
        if (!same) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.status(403).json({ error: 'forbidden' });
          return;
        }
      }
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  // Idempotency-Key validation happens inside withIdempotency on the marked
  // endpoints (transmittals, variations).

  // Public token endpoints and the public site come first: the authed routers
  // below use a session middleware that must not answer public routes.
  app.use(publicRouter(config));
  app.use(sessionRouter(config));
  app.use(invitationsPublicRouter(config));
  app.use(tenderLinksPublicRouter(config));
  app.use(membersRouter(config));
  app.use(projectsRouter(config, { killbill }));
  app.use(drawingsRouter(config, storage));
  app.use(tendersRouter(config));
  app.use(variationsRouter(config));
  app.use(certificatesRouter(config));
  app.use(shopDrawingsRouter(config, storage));
  app.use(viewpointsRouter(config, storage));
  app.use(finishesRouter(config));
  app.use(caseStudiesRouter(config));

  // The API 404: anything unmatched under /api.
  app.use('/api', (req: Request, res: Response) => {
    res.status(404).json({ error: 'not_found' });
  });
}

export { notFound, validationError, FIELD_ERRORS, ApiError, Storage, KillBill };
