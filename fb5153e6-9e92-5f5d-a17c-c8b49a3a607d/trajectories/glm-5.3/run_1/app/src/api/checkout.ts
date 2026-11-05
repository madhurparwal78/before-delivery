import { Router, type RequestContext, validationError } from '../http/types.js';
import { ApiError } from '../errors.js';
import { bodyOf } from '../http/body.js';
import { sendJson, sendRaw } from '../http/respond.js';
import {
  performCheckout,
  getOrderByReceipt,
  orderRefunds,
  upgradeOptionsFor,
  type LicenceType,
} from '../domain/commerce.js';
import { getModelBySlug, getModelById, type ModelRow } from '../domain/models.js';
import { publicAccess, receiptFileAccess } from '../domain/access.js';
import { viewerContextOf, viewerForUser } from './public.js';
import { idempotent } from '../domain/idempotency.js';
import { isEmail, isLocaleValue } from '../domain/ids.js';
import { sessionSecret } from '../server-context.js';
import { getObject, derivativeKey } from '../providers/storage.js';
import { renderInvoicePdf } from '../providers/invoice.js';

const IDEM_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export function idempotencyKeyOf(ctx: RequestContext): string {
  const key = ctx.idempotencyKey ?? '';
  if (key === '') throw new ApiError(400, 'idempotency_key_required');
  if (!IDEM_PATTERN.test(key)) throw new ApiError(400, 'idempotency_key_invalid');
  return key;
}

const CHECKOUT_FIELDS = ['model', 'licence', 'email', 'terms', 'locale', 'access', 'upgrade_from'];

export interface ParsedCheckoutBody {
  model: string;
  licence: LicenceType;
  email: string;
  terms: boolean;
  locale: 'en' | 'de';
  access?: string;
  upgrade_from?: string;
}

export function parseCheckoutBody(ctx: RequestContext): ParsedCheckoutBody {
  const raw = bodyOf(ctx);
  for (const key of Object.keys(raw)) {
    if (!CHECKOUT_FIELDS.includes(key)) throw validationError({ [key]: 'Unknown field.' });
  }
  const fields: Record<string, string> = {};
  const model = typeof raw['model'] === 'string' ? raw['model'] : '';
  const licence = typeof raw['licence'] === 'string' ? raw['licence'] : '';
  const email = typeof raw['email'] === 'string' ? raw['email'] : '';
  const terms = raw['terms'];
  const localeRaw = typeof raw['locale'] === 'string' ? raw['locale'] : '';
  const locale = localeRaw === 'de' ? 'de' : 'en';
  if (!isEmail(email)) fields['email'] = 'Enter a valid email address.';
  if (terms !== true) fields['terms'] = 'Accept the licence terms to continue.';
  if (!['personal', 'commercial', 'studio', 'edition'].includes(licence)) fields['licence'] = 'Choose one of the listed values.';
  if (!isLocaleValue(localeRaw)) fields['locale'] = 'Choose one of the listed values.';
  if (model === '') fields['model'] = 'Unknown field.';
  if (Object.keys(fields).length > 0) throw validationError(fields);
  return {
    model,
    licence: licence as LicenceType,
    email,
    terms: true,
    locale: locale as 'en' | 'de',
    access: typeof raw['access'] === 'string' ? raw['access'] : undefined,
    upgrade_from: typeof raw['upgrade_from'] === 'string' ? raw['upgrade_from'] : undefined,
  };
}

async function purchasableCheck(ctx: RequestContext, model: ModelRow, accessToken: string | undefined): Promise<void> {
  const viewer = viewerForUser(null);
  const access = await publicAccess(model, { viewer, accessToken }, await sessionSecret());
  if (!access.allowed) throw new ApiError(404, 'not_found');
  if (access.passwordGate) throw new ApiError(403, 'password_required');
  if (model.read_only) throw new ApiError(404, 'not_found');
}

export function registerCheckoutRoutes(router: Router): void {
  router.add({
    method: 'POST',
    pattern: '/api/checkout',
    allowedParams: [],
    json: true,
    handler: async ctx => {
      const key = idempotencyKeyOf(ctx);
      const body = parseCheckoutBody(ctx);
      const rawBody = JSON.stringify(bodyOf(ctx));
      const response = await idempotent('checkout', key, rawBody, async () => {
        const model = await getModelBySlug(body.model);
        if (model === null) throw new ApiError(404, 'not_found');
        await purchasableCheck(ctx, model, body.access);
        if (body.upgrade_from !== undefined) {
          const source = await getOrderByReceipt(body.upgrade_from);
          if (source !== null && source.model_id !== model.id) throw new ApiError(404, 'not_found');
        }
        const outcome = await performCheckout(
          {
            modelSlug: body.model,
            licence: body.licence,
            email: body.email,
            terms: true,
            locale: body.locale,
            upgradeFromToken: body.upgrade_from,
          },
          key,
        );
        return {
          status: 201,
          body: JSON.stringify({
            order: outcome.order_ref,
            receipt_url: `/receipts/${outcome.receipt_token}`,
            licence: outcome.licence,
            amount_cents: outcome.amount_cents,
            currency: 'EUR',
            edition_number: outcome.edition_number,
          }),
          contentType: 'application/json',
        };
      });
      sendRaw(ctx, response.status, response.body, response.content_type);
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/receipts/:token',
    allowedParams: [],
    handler: async ctx => {
      const order = await getOrderByReceipt(ctx.params['token'] ?? '');
      if (order === null) throw new ApiError(404, 'not_found');
      const model = await getModelByIdOrThrow(order.model_id);
      const purchasable =
        model.state === 'published' &&
        !model.read_only &&
        (model.visibility === 'public' || model.visibility === 'unlisted' || model.visibility === 'password');
      const options = await upgradeOptionsFor(order, purchasable);
      sendJson(ctx, 200, {
        order: order.order_ref,
        email: order.buyer_email,
        model: { slug: model.slug, title: model.title },
        licence: order.licence,
        seats: order.seats,
        amount_cents: order.amount_cents,
        refunded_cents: order.refunded_cents,
        status: order.status,
        edition_number: order.edition_number,
        edition_total: order.edition_total,
        locale: order.locale,
        created_at: order.created_at,
        upgraded_to: order.upgraded_to,
        upgrade_options: options.map(option => ({ licence: option.licence, amount_cents: option.amount_cents })),
      });
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/receipts/:token/invoice.pdf',
    allowedParams: [],
    handler: async ctx => {
      const order = await getOrderByReceipt(ctx.params['token'] ?? '');
      if (order === null) throw new ApiError(404, 'not_found');
      const model = await getModelByIdOrThrow(order.model_id);
      const refunds = await orderRefunds(order.id);
      const pdf = await renderInvoicePdf(order, model.title, refunds);
      sendRaw(ctx, 200, pdf, 'application/pdf', { 'Content-Disposition': `attachment; filename="invoice-${order.order_ref}.pdf"` });
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/receipts/:token/files/model.glb',
    allowedParams: [],
    handler: async ctx => serveReceiptFile(ctx, 'model.glb'),
  });
  router.add({
    method: 'GET',
    pattern: '/api/receipts/:token/files/model.stl',
    allowedParams: [],
    handler: async ctx => serveReceiptFile(ctx, 'model.stl'),
  });
}

async function getModelByIdOrThrow(id: number): Promise<ModelRow> {
  const model = await getModelById(id);
  if (model === null) throw new ApiError(404, 'not_found');
  return model;
}

async function serveReceiptFile(ctx: RequestContext, file: 'model.glb' | 'model.stl'): Promise<void> {
  const order = await getOrderByReceipt(ctx.params['token'] ?? '');
  if (order === null) throw new ApiError(404, 'not_found');
  const model = await getModelByIdOrThrow(order.model_id);
  const access = await receiptFileAccess(order.receipt_token, model);
  if (!access.ok) {
    if (access.reason === 'refunded') throw new ApiError(403, 'licence_refunded');
    if (access.reason === 'rebuilding') throw new ApiError(409, 'derivatives_rebuilding');
    throw new ApiError(404, 'not_found');
  }
  const buffer = await getObject(derivativeKey(model.slug, model.revision, file));
  sendRaw(ctx, 200, buffer, file === 'model.glb' ? 'model/gltf-binary' : 'application/octet-stream', {
    'Content-Disposition': `attachment; filename="${model.slug}.${file === 'model.glb' ? 'glb' : 'stl'}"`,
  });
}
