import { queryOne, withClient } from '../db.js';
import { ApiError, notFound } from '../errors.js';
import { route, type Ctx } from '../http.js';
import { getObject } from '../services/storage.js';
import { verifyExportPath } from '../services/signing.js';
import { registerSessionRoutes } from './session.js';
import { registerHorseRoutes } from './horses.js';
import { registerBarnDayRoutes } from './barndays.js';
import { registerBookingRoutes } from './bookings.js';
import { registerVisitRoutes } from './visits.js';
import { registerUploadRoutes } from './uploads.js';
import { registerMarksRoutes } from './marks.js';
import { registerComparisonRoutes } from './comparison.js';
import { registerVetLinkRoutes } from './vetlinks.js';
import { registerInvoiceRoutes } from './invoices.js';
import { registerDashboardRoutes } from './dashboard.js';
import { registerPriceRoutes } from './prices.js';
import { registerImportRoutes } from './imports.js';
import { registerStreamRoutes } from './streams.js';

export function registerRoutes(): void {
  registerSessionRoutes();
  registerHorseRoutes();
  registerBarnDayRoutes();
  registerBookingRoutes();
  registerVisitRoutes();
  registerUploadRoutes();
  registerMarksRoutes();
  registerComparisonRoutes();
  registerVetLinkRoutes();
  registerInvoiceRoutes();
  registerDashboardRoutes();
  registerPriceRoutes();
  registerImportRoutes();
  registerStreamRoutes();

  // The month's ledger export, reached through the same signed key ring as photos.
  route({
    method: 'GET',
    path: '/media/exports/:id',
    openToVets: true,
    handler: async (ctx: Ctx) => {
      const jobId = ctx.params.id as string;
      const key = await withClient(async (db) => {
        const valid = await verifyExportPath(db, jobId, ctx.url.searchParams);
        if (!valid) throw new ApiError(403, 'url_invalid');
        const job = await queryOne<{ result: { key?: string } | null }>(
          db,
          `SELECT result FROM jobs WHERE id = $1 AND kind = 'csv_export'`,
          [jobId],
        );
        const stored = job?.result?.key;
        if (stored === undefined) throw notFound();
        return stored;
      });
      const bytes = await getObject(key);
      if (bytes === null) throw notFound();
      return {
        kind: 'bytes' as const,
        status: 200,
        body: bytes,
        contentType: 'text/csv; charset=utf-8',
        headers: { 'content-disposition': `attachment; filename="ledger.csv"` },
      };
    },
  });
}
