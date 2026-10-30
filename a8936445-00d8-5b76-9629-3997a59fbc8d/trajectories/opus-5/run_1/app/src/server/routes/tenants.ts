import { errors } from '../http/errors.js';
import { route } from '../http/router.js';
import { kitchenToday } from '../domain/time.js';
import {
  activateTenant,
  offboardTenant,
  requireTenant,
  tenantView,
  visibleTenants,
} from '../services/tenants.js';
import {
  currentInspectionLink,
  issueInspectionLink,
  revokeInspectionLink,
} from '../services/inspect.js';
import { integerField } from './params.js';
import type { RequestContext } from '../http/context.js';

function scopedTenantId(ctx: RequestContext, id: string): string {
  if (ctx.actor.tenantId !== null && ctx.actor.tenantId !== id) throw errors.notFound();
  return id;
}

route('GET', '/api/tenants', {}, async (ctx) => {
  const today = kitchenToday();
  const tenants = await visibleTenants(ctx.scopeTenantId);
  return {
    status: 200,
    json: { tenants: await Promise.all(tenants.map((tenant) => tenantView(tenant, today))) },
  };
});

route('GET', '/api/tenants/:id', {}, async (ctx) => {
  const tenant = await requireTenant(scopedTenantId(ctx, ctx.params['id']!));
  return { status: 200, json: await tenantView(tenant, kitchenToday()) };
});

route('POST', '/api/tenants/:id/activate', { bodyKind: 'json' }, async (ctx) => {
  await requireTenant(scopedTenantId(ctx, ctx.params['id']!));
  ctx.requireRole('operator');
  ctx.jsonBody();
  const tenant = await activateTenant(ctx.params['id']!, ctx.actor.id);
  return { status: 200, json: await tenantView(tenant, kitchenToday()) };
});

route('POST', '/api/tenants/:id/offboard', { bodyKind: 'json' }, async (ctx) => {
  await requireTenant(scopedTenantId(ctx, ctx.params['id']!));
  ctx.requireRole('operator');
  ctx.jsonBody();
  const tenant = await offboardTenant(ctx.params['id']!, ctx.actor.id);
  return { status: 200, json: await tenantView(tenant, kitchenToday()) };
});

route('POST', '/api/tenants/:id/inspection-link', { bodyKind: 'json' }, async (ctx) => {
  await requireTenant(scopedTenantId(ctx, ctx.params['id']!));
  ctx.requireRole('operator');
  const body = ctx.jsonBody();
  const link = await issueInspectionLink(
    ctx.actor.id,
    ctx.params['id']!,
    integerField(body, 'expires_in_seconds'),
  );
  return { status: 201, json: link };
});

route('GET', '/api/tenants/:id/inspection-link', {}, async (ctx) => {
  await requireTenant(scopedTenantId(ctx, ctx.params['id']!));
  ctx.requireRole('operator');
  return { status: 200, json: await currentInspectionLink(ctx.params['id']!) };
});

route('DELETE', '/api/tenants/:id/inspection-link', {}, async (ctx) => {
  await requireTenant(scopedTenantId(ctx, ctx.params['id']!));
  ctx.requireRole('operator');
  await revokeInspectionLink(ctx.actor.id, ctx.params['id']!);
  return { status: 204, json: null };
});
