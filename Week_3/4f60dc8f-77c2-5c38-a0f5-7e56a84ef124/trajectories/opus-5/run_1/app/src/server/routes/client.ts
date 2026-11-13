import { pipeline } from 'node:stream/promises';
import { FIELD_COPY } from '../../shared/errors.js';
import { isShotCode, isUnitDecision } from '../../shared/domain.js';
import { fail } from '../http/app-error.js';
import {
  idempotencyKey,
  readJson,
  route,
  sendJson,
  type Ctx,
  type Route,
} from '../http/kernel.js';
import { claimIdempotency, settleClaim } from '../db/idempotency.js';
import {
  deleteQuoteLine,
  findIntakeFile,
  findInvoice,
  listBrandEngagements,
  listInvoiceLines,
  putQuoteLine,
  setUnitDecision,
  type EngagementRow,
  type IntakeFileRow,
} from '../db/engagements.js';
import { listRates } from '../db/fx.js';
import { query } from '../db/pool.js';
import { insertEngagement } from '../db/brands.js';
import { brandEngagement, requireClientSession } from '../app/auth.js';
import { servicesForRead } from '../app/content.js';
import { payDeposit, payMilestoneInvoice, settleOverdue } from '../app/billing.js';
import { receiveIntakeUpload } from '../app/intake.js';
import { kickOutbox } from '../app/outbox-worker.js';
import { boundedText, check } from '../app/validate.js';
import { contentDisposition } from '../domain/intake.js';
import { quoteOpen } from '../domain/states.js';
import { getObjectStream } from '../services/storage.js';
import {
  engagementView,
  intakeFileView,
  invoiceView,
  loadEngagementBundle,
  quoteViewOf,
} from '../serialise.js';

const phaseOf = (engagement: EngagementRow) => ({
  state: engagement.state,
  finalsOut: engagement.finals_out,
  revisionMilestone: engagement.revision_milestone,
});

const engagementPayload = async (engagement: EngagementRow) => {
  await settleOverdue(engagement.id);
  const refreshed = await brandEngagement(engagement.brand_id, engagement.id);
  const bundle = await loadEngagementBundle(refreshed, await servicesForRead(), await listRates());
  return engagementView(bundle, 'client');
};

const streamIntakeContent = async (ctx: Ctx, file: IntakeFileRow): Promise<void> => {
  const body = await getObjectStream(file.object_key);
  ctx.response.writeHead(200, {
    'Content-Type': file.content_type,
    'Content-Length': file.size_bytes,
    'Content-Disposition': contentDisposition(file.name),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  await pipeline(body, ctx.response);
};

export const clientRoutes: Route[] = [
  route('GET', '/api/engagements', async (ctx) => {
    const session = await requireClientSession(ctx);
    const engagements = await listBrandEngagements(session.brand.id);
    sendJson(ctx, 200, {
      engagements: engagements.map((engagement) => ({
        id: engagement.id,
        reference: engagement.reference,
        title: engagement.title,
        state: engagement.state,
      })),
    });
  }),

  route('POST', '/api/engagements', async (ctx) => {
    const session = await requireClientSession(ctx);
    const body = await readJson(ctx);
    if (!boundedText(body.title, 1, 120)) check({ title: FIELD_COPY.title });
    const engagementId = await insertEngagement(
      { query },
      session.brand.id,
      (body.title as string).trim(),
    );
    const engagement = await brandEngagement(session.brand.id, engagementId);
    sendJson(ctx, 201, await engagementPayload(engagement));
  }),

  route('GET', '/api/engagements/:id', async (ctx) => {
    const session = await requireClientSession(ctx);
    const engagement = await brandEngagement(session.brand.id, ctx.params.id);
    sendJson(ctx, 200, await engagementPayload(engagement));
  }),

  route('PUT', '/api/engagements/:id/quote/lines/:shot_code', async (ctx) => {
    const session = await requireClientSession(ctx);
    const engagement = await brandEngagement(session.brand.id, ctx.params.id);
    if (!isShotCode(ctx.params.shot_code)) fail('not_found');
    if (!quoteOpen(phaseOf(engagement))) fail('quote_locked');
    const body = await readJson(ctx);
    const quantity = body.quantity;
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 6)
      check({ quantity: FIELD_COPY.quantity });
    const services = await servicesForRead();
    if (!services.some((service) => service.code === ctx.params.shot_code)) fail('not_found');

    const written = await putQuoteLine(engagement.id, ctx.params.shot_code, quantity as number);
    const rates = await listRates();
    sendJson(
      ctx,
      200,
      quoteViewOf(
        { ...engagement, quote_revision: written.revision },
        written.lines,
        services,
        rates,
        new Date(),
      ),
    );
  }),

  route('DELETE', '/api/engagements/:id/quote/lines/:shot_code', async (ctx) => {
    const session = await requireClientSession(ctx);
    const engagement = await brandEngagement(session.brand.id, ctx.params.id);
    if (!isShotCode(ctx.params.shot_code)) fail('not_found');
    if (!quoteOpen(phaseOf(engagement))) fail('quote_locked');
    const services = await servicesForRead();
    const written = await deleteQuoteLine(engagement.id, ctx.params.shot_code);
    const rates = await listRates();
    sendJson(
      ctx,
      200,
      quoteViewOf(
        { ...engagement, quote_revision: written.revision },
        written.lines,
        services,
        rates,
        new Date(),
      ),
    );
  }),

  route('POST', '/api/engagements/:id/files', async (ctx) => {
    const session = await requireClientSession(ctx);
    const engagement = await brandEngagement(session.brand.id, ctx.params.id);
    const file = await receiveIntakeUpload(ctx, engagement.id, quoteOpen(phaseOf(engagement)));
    sendJson(ctx, 201, intakeFileView(file));
  }),

  route('GET', '/api/engagements/:id/files/:file_id/content', async (ctx) => {
    const session = await requireClientSession(ctx);
    const engagement = await brandEngagement(session.brand.id, ctx.params.id);
    const file = await findIntakeFile(ctx.params.file_id);
    if (file === null || file.engagement_id !== engagement.id) fail('not_found');
    await streamIntakeContent(ctx, file as IntakeFileRow);
  }),

  route('PUT', '/api/engagements/:id/files/:file_id/unit', async (ctx) => {
    const session = await requireClientSession(ctx);
    const engagement = await brandEngagement(session.brand.id, ctx.params.id);
    const file = await findIntakeFile(ctx.params.file_id);
    if (file === null || file.engagement_id !== engagement.id) fail('not_found');
    const row = file as IntakeFileRow;
    if (!quoteOpen(phaseOf(engagement))) fail('quote_locked');
    if (row.kind === 'model' && row.measurement !== 'measured') fail('measurement_pending');
    const body = await readJson(ctx);
    if (row.kind !== 'model') check({ unit: FIELD_COPY.unit_not_model });
    if (!isUnitDecision(body.unit)) check({ unit: FIELD_COPY.unit });
    await setUnitDecision(row.id, body.unit as NonNullable<IntakeFileRow['unit']>);
    const updated = await findIntakeFile(row.id);
    sendJson(ctx, 200, intakeFileView(updated as IntakeFileRow));
  }),

  route('POST', '/api/engagements/:id/deposit', async (ctx) => {
    const session = await requireClientSession(ctx);
    const engagement = await brandEngagement(session.brand.id, ctx.params.id);
    const key = idempotencyKey(ctx);
    const body = await readJson(ctx);
    const scope = `deposit:${session.brand.id}`;
    const claim = await claimIdempotency(scope, key, body);
    if (claim.kind === 'stored') {
      sendJson(ctx, claim.outcome.status, claim.outcome.body);
      return;
    }
    const outcome = await settleClaim(scope, key, async () => ({
      status: 201,
      body: await payDeposit(engagement.id, session.brand, body.card),
    }));
    kickOutbox();
    sendJson(ctx, outcome.status, outcome.body);
  }),

  route('GET', '/api/invoices/:invoice_id', async (ctx) => {
    const session = await requireClientSession(ctx);
    const found = await findInvoice(ctx.params.invoice_id);
    if (found === null || found.issued_at === null) fail('not_found');
    const engagement = await brandEngagement(session.brand.id, found.engagement_id);
    await settleOverdue(engagement.id);
    const fresh = await findInvoice(found.id);
    if (fresh === null) fail('not_found');
    sendJson(ctx, 200, invoiceView(fresh, await listInvoiceLines(found.id)));
  }),

  route('POST', '/api/invoices/:invoice_id/payments', async (ctx) => {
    const session = await requireClientSession(ctx);
    const found = await findInvoice(ctx.params.invoice_id);
    if (found === null || found.issued_at === null) fail('not_found');
    await brandEngagement(session.brand.id, found.engagement_id);
    const key = idempotencyKey(ctx);
    const body = await readJson(ctx);
    const scope = `invoice_payment:${session.brand.id}`;
    const claim = await claimIdempotency(scope, key, body);
    if (claim.kind === 'stored') {
      sendJson(ctx, claim.outcome.status, claim.outcome.body);
      return;
    }
    const outcome = await settleClaim(scope, key, async () => ({
      status: 201,
      body: await payMilestoneInvoice(found.id, session.brand, body.card),
    }));
    kickOutbox();
    sendJson(ctx, outcome.status, outcome.body);
  }),
];
