/**
 * The published API surface. Only these endpoints exist.
 */
import { Router } from '../http/context.ts';
import { accessRoutes } from './access.ts';
import { benchRoutes } from './bench.ts';
import { clientRoutes } from './clients.ts';
import { clientPageRoutes } from './clientPage.ts';
import { collectionRoutes } from './collections.ts';
import { dossierRoutes } from './dossier.ts';
import { estimateRoutes, rateRoutes } from './estimates.ts';
import { layoutRoutes } from './layout.ts';
import { materialRoutes } from './materials.ts';
import { photographRoutes } from './photographs.ts';
import { pieceRoutes } from './pieces.ts';
import { pinRoutes } from './pins.ts';
import { enquiryRoutes, searchRoutes } from './searchAndEnquiries.ts';
import { workbookRoutes } from './workbook.ts';

export function buildRouter(): Router {
  const router = new Router();
  router.addAll(accessRoutes);
  router.addAll(clientRoutes);
  router.addAll(pieceRoutes);
  router.addAll(pinRoutes);
  router.addAll(photographRoutes);
  router.addAll(layoutRoutes);
  router.addAll(materialRoutes);
  router.addAll(estimateRoutes);
  router.addAll(rateRoutes);
  router.addAll(clientPageRoutes);
  router.addAll(benchRoutes);
  router.addAll(collectionRoutes);
  router.addAll(workbookRoutes);
  router.addAll(dossierRoutes);
  router.addAll(searchRoutes);
  router.addAll(enquiryRoutes);
  return router;
}
