import { MAX_ENDPOINTS_PER_TEAM } from '../config';
import { fail, fieldMessages } from '../errors';
import { Ctx, Router, created, noContent, ok } from '../http/router';
import { checkUrl } from '../services/outbound';
import {
  EndpointRecord,
  deliveriesOf,
  enableEndpoint,
  endpointById,
  endpointCount,
  endpointsOfTeam,
  insertEndpoint,
  removeEndpoint,
} from '../store/webhooks';
import { JsonObject, JsonValue } from '../types';
import { requireRole, resolveTeam } from './support';

function endpointJson(endpoint: EndpointRecord, withSecret: boolean): JsonObject {
  const json: JsonObject = {
    id: endpoint.id,
    team_id: endpoint.teamId,
    url: endpoint.url,
    state: endpoint.state,
    consecutive_failures: endpoint.consecutiveFailures,
    created_by: endpoint.createdBy,
    created_at: endpoint.createdAt.toISOString(),
  };
  if (withSecret) json['secret'] = endpoint.secret;
  return json;
}

async function endpointForCaller(ctx: Ctx): Promise<EndpointRecord> {
  const endpoint = await endpointById(ctx.params['id']!);
  if (!endpoint) throw fail.notFound();
  if (ctx.caller.member.role === 'member' && ctx.caller.member.teamId !== endpoint.teamId) throw fail.notFound();
  if (ctx.caller.member.role === 'finance' || ctx.caller.member.role === 'compliance') throw fail.forbidden();
  return endpoint;
}

export function registerWebhookRoutes(router: Router): void {
  router.add('POST', '/api/webhook-endpoints', 'json', async (ctx) => {
    requireRole(ctx.caller, ['member']);
    const team = await resolveTeam(ctx, { required: false });
    const url = ctx.body['url'];
    if (typeof url !== 'string' || url.length === 0) {
      throw fail.validation({ url: 'Enter the endpoint URL.' });
    }
    const check = await checkUrl(url);
    if (check.kind === 'refused') throw fail.validation({ url: fieldMessages.refusedAddress });
    if ((await endpointCount(team.id)) >= MAX_ENDPOINTS_PER_TEAM) throw fail.endpointLimitReached();
    const endpoint = await insertEndpoint(team.id, url, ctx.caller.member.id);
    return created({ endpoint: endpointJson(endpoint, true) });
  });

  router.add('GET', '/api/webhook-endpoints', 'none', async (ctx) => {
    if (ctx.caller.member.role === 'finance' || ctx.caller.member.role === 'compliance') throw fail.forbidden();
    const team = await resolveTeam(ctx, { required: false });
    const endpoints = await endpointsOfTeam(team.id);
    return ok({ endpoints: endpoints.map((endpoint) => endpointJson(endpoint, false)) as unknown as JsonValue });
  });

  router.add('POST', '/api/webhook-endpoints/:id/enable', 'none', async (ctx) => {
    const endpoint = await endpointForCaller(ctx);
    requireRole(ctx.caller, ['admin']);
    if (endpoint.state !== 'disabled') throw fail.endpointNotDisabled();
    const enabled = await enableEndpoint(endpoint.id);
    return ok({ endpoint: endpointJson(enabled!, false) });
  });

  router.add('DELETE', '/api/webhook-endpoints/:id', 'none', async (ctx) => {
    const endpoint = await endpointForCaller(ctx);
    await removeEndpoint(endpoint.id);
    return noContent();
  });

  router.add('GET', '/api/webhook-endpoints/:id/deliveries', 'none', async (ctx) => {
    const endpoint = await endpointForCaller(ctx);
    return ok({ deliveries: (await deliveriesOf(endpoint.id)) as unknown as JsonValue });
  });
}
