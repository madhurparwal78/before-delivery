import { errors } from '../http/errors.js';
import { route } from '../http/router.js';
import { listHourPacks } from '../db/repo/catalog.js';
import { hourLedger, purchaseHourPack } from '../services/hourPacks.js';
import {
  invoicePdfBytes,
  invoicesFor,
  issueInvoice,
  payInvoice,
  requireInvoice,
} from '../services/invoices.js';
import { assignShelf, shelfViews } from '../services/shelves.js';
import { policyHistory, savePolicy } from '../services/policy.js';
import { requireTenant } from '../services/tenants.js';
import { invoiceJson, ledgerEntryJson, policyJson } from './serialize.js';
import { integerField, optionalString, queryValue, stringField } from './params.js';

route('GET', '/api/cancellation-policy', {}, async () => {
  const { current, history } = await policyHistory();
  return {
    status: 200,
    json: { current: policyJson(current), history: history.map(policyJson) },
  };
});

route('PUT', '/api/cancellation-policy', { bodyKind: 'json' }, async (ctx) => {
  ctx.requireRole('operator');
  const body = ctx.jsonBody();
  const policy = await savePolicy(
    ctx.actor.id,
    integerField(body, 'free_window_hours'),
    integerField(body, 'late_fee_percent'),
    integerField(body, 'based_on_version'),
  );
  return { status: 201, json: policyJson(policy) };
});

route('GET', '/api/hour-packs', {}, async (ctx) => {
  ctx.requireRole('operator', 'owner');
  const packs = await listHourPacks();
  return {
    status: 200,
    json: {
      packs: packs.map((pack) => ({
        id: pack.id,
        name: pack.name,
        minutes: pack.minutes,
        price_cents: pack.priceCents,
      })),
    },
  };
});

route('POST', '/api/hour-packs/purchase', { bodyKind: 'json' }, async (ctx) => {
  ctx.requireRole('owner');
  if (ctx.idempotencyKey === null) throw errors.idempotencyKeyRequired();
  const body = ctx.jsonBody();
  return { status: 201, json: await purchaseHourPack(ctx.actor, stringField(body, 'pack_id')) };
});

route('GET', '/api/hour-ledger', {}, async (ctx) => {
  ctx.requireRole('operator', 'owner');
  const requested = queryValue(ctx.query, 'tenant_id');
  let tenantId: string;
  if (ctx.actor.role === 'operator') {
    if (requested === null) throw errors.validation({ tenant_id: 'Choose a tenant.' });
    tenantId = requested;
  } else {
    if (requested !== null && requested !== ctx.actor.tenantId) throw errors.notFound();
    tenantId = ctx.actor.tenantId!;
  }
  await requireTenant(tenantId);
  const ledger = await hourLedger(tenantId);
  return {
    status: 200,
    json: {
      tenant_id: ledger.tenantId,
      balance_minutes: ledger.balanceMinutes,
      entries: ledger.entries.map(ledgerEntryJson),
    },
  };
});

route('GET', '/api/shelves', {}, async (ctx) => {
  ctx.requireRole('operator', 'owner');
  return { status: 200, json: { shelves: await shelfViews(ctx.scopeTenantId) } };
});

route('PUT', '/api/shelves/:id', { bodyKind: 'json' }, async (ctx) => {
  ctx.requireRole('operator');
  const body = ctx.jsonBody();
  const shelf = await assignShelf(ctx.actor.id, ctx.params['id']!, optionalString(body, 'tenant_id'));
  return { status: 200, json: shelf };
});

route('POST', '/api/invoices', { bodyKind: 'json' }, async (ctx) => {
  ctx.requireRole('operator');
  const body = ctx.jsonBody();
  const invoice = await issueInvoice(
    ctx.actor,
    stringField(body, 'tenant_id'),
    stringField(body, 'period'),
  );
  return { status: 201, json: invoiceJson(invoice) };
});

route('GET', '/api/invoices', {}, async (ctx) => {
  ctx.requireRole('operator', 'owner');
  const invoices = await invoicesFor(ctx.actor, queryValue(ctx.query, 'tenant_id'));
  return { status: 200, json: { invoices: invoices.map(invoiceJson) } };
});

route('GET', '/api/invoices/:id', {}, async (ctx) => {
  const invoice = await requireInvoice(ctx.params['id']!, ctx.actor);
  ctx.requireRole('operator', 'owner');
  return { status: 200, json: invoiceJson(invoice) };
});

route('GET', '/api/invoices/:id/pdf', {}, async (ctx) => {
  const invoice = await requireInvoice(ctx.params['id']!, ctx.actor);
  ctx.requireRole('operator', 'owner');
  return {
    status: 200,
    buffer: await invoicePdfBytes(invoice),
    contentType: 'application/pdf',
    headers: { 'content-disposition': `attachment; filename="${invoice.number}.pdf"` },
  };
});

route('POST', '/api/invoices/:id/pay', { bodyKind: 'json' }, async (ctx) => {
  await requireInvoice(ctx.params['id']!, ctx.actor);
  ctx.requireRole('owner');
  if (ctx.idempotencyKey === null) throw errors.idempotencyKeyRequired();
  ctx.jsonBody();
  return { status: 200, json: invoiceJson(await payInvoice(ctx.actor, ctx.params['id']!)) };
});
