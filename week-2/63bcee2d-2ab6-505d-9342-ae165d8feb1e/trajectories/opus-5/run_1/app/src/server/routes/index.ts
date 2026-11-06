import { Router } from '../http/router.js';
import { registerSessionRoutes } from './session.js';
import { registerMemberRoutes } from './members.js';
import { registerProjectRoutes } from './projects.js';
import { registerStageRoutes } from './stages.js';
import { registerSheetRoutes } from './sheets.js';
import { registerTenderRoutes } from './tenders.js';
import { registerVariationRoutes } from './variations.js';
import { registerCertificateRoutes } from './certificates.js';
import { registerShopDrawingRoutes } from './shopDrawings.js';
import { registerSiteWalkRoutes } from './siteWalk.js';
import { registerFinishRoutes } from './finishes.js';
import { registerCaseStudyRoutes } from './caseStudies.js';
import { registerPublicRoutes } from './publicSite.js';

export function buildRouter(): Router {
  const router = new Router();
  registerSessionRoutes(router);
  registerMemberRoutes(router);
  registerProjectRoutes(router);
  registerStageRoutes(router);
  registerSheetRoutes(router);
  registerTenderRoutes(router);
  registerVariationRoutes(router);
  registerCertificateRoutes(router);
  registerShopDrawingRoutes(router);
  registerSiteWalkRoutes(router);
  registerFinishRoutes(router);
  registerCaseStudyRoutes(router);
  registerPublicRoutes(router);
  return router;
}
