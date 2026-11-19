import { json, Router } from '../http/router.js';
import { statusSnapshot } from '../services/health.js';
import { registerCampaignRoutes } from './campaigns.js';
import { registerDocumentRoutes } from './documents.js';
import { registerFixRoutes } from './fix.js';
import { registerMediaRoutes } from './media.js';
import { registerPeopleRoutes } from './people.js';
import { registerPledgeRoutes } from './pledges.js';
import { registerTierRoutes } from './tiers.js';

export function buildRouter(): Router {
  const router = new Router();
  registerPeopleRoutes(router);
  registerCampaignRoutes(router);
  registerTierRoutes(router);
  registerMediaRoutes(router);
  registerPledgeRoutes(router);
  registerFixRoutes(router);
  registerDocumentRoutes(router);

  router.add({
    method: 'GET',
    pattern: '/api/status',
    auth: 'none',
    body: 'none',
    handle: async () => json(200, statusSnapshot()),
  });

  router.add({
    method: 'GET',
    pattern: '/api/health',
    auth: 'none',
    body: 'none',
    handle: async () => json(200, { status: 'ok' }),
  });

  return router;
}
