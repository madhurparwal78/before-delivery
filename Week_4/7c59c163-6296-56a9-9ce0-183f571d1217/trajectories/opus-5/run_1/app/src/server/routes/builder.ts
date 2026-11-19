import { randomUUID } from 'node:crypto';
import { inTransaction, pool } from '../db/pool.js';
import { ApiError, ValidationError } from '../http/errors.js';
import { json, memberRoute, noContent } from '../http/router.js';
import { hashSecret, mintApiKeySecret } from '../auth.js';
import { RANGES, asObject, onlyFields, readEnum, readString } from '../domain/validate.js';
import { PLANS, effectivePlan, isUpgrade, rateFor } from '../domain/plans.js';
import { iso } from '../domain/views.js';
import { deleteKeyRate, setKeyRate } from '../providers/valkey.js';
import { ProviderUnreachable } from '../providers/http.js';
import * as killbill from '../providers/killbill.js';
import * as svix from '../providers/svix.js';
import {
  billingUnavailable,
  ensureBillingRow,
  killbillAccountKey,
  planBundleKey,
  readBilling,
} from '../billing.js';
import { ownApiKey } from './common.js';
import type { Plan, Venue } from '../domain/types.js';
import type { Route } from '../http/router.js';

const webhooksUnavailable = (): ApiError => new ApiError(503, 'webhooks_unavailable');
const URL_PATTERN = /^https?:\/\/\S+$/;

async function killbillAccountId(venue: Venue, memberId: string, name: string, email: string): Promise<string> {
  return killbill.ensureAccount(killbillAccountKey(venue.slug, memberId), name, email, null);
}

export const builderRoutes: Route[] = [
  memberRoute('GET', '/api/keys', { venue: true, roles: ['builder'] }, async ({ actor }) => {
    const result = await pool.query<{
      id: string;
      name: string;
      created_at: Date;
      revoked_at: Date | null;
    }>(
      'select id, name, created_at, revoked_at from api_keys where member_id = $1 order by created_at desc',
      [actor.member.id],
    );
    return json(200, {
      keys: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        created_at: iso(row.created_at),
        revoked_at: row.revoked_at === null ? null : iso(row.revoked_at),
      })),
    });
  }),

  memberRoute('POST', '/api/keys', { venue: true, roles: ['builder'] }, async ({ actor, body }) => {
    const venue = actor.venue as Venue;
    const fields = asObject(body);
    onlyFields(fields, ['name']);
    const name = readString(fields, 'name');
    if (name.length < RANGES.keyName.min || name.length > RANGES.keyName.max) {
      throw new ValidationError({ name: 'invalid' });
    }
    const minted = mintApiKeySecret();
    const id = randomUUID();
    const created = await inTransaction(async (client) => {
      const billing = await ensureBillingRow(client, actor.member);
      const result = await client.query<{ created_at: Date }>(
        `insert into api_keys (id, key_id, venue_id, member_id, name, secret_hash)
         values ($1,$2,$3,$4,$5,$6) returning created_at`,
        [id, minted.keyId, venue.id, actor.member.id, name, hashSecret(minted.secret)],
      );
      await setKeyRate(minted.keyId, rateFor(effectivePlan(billing.plan, billing.state)));
      return result.rows[0]?.created_at as Date;
    });
    return json(201, { id, name, secret: minted.secret, created_at: iso(created) });
  }),

  memberRoute('DELETE', '/api/keys/:id', { resource: ownApiKey }, async ({ resource }) => {
    await pool.query('update api_keys set revoked_at = now() where id = $1 and revoked_at is null', [
      resource.id,
    ]);
    await deleteKeyRate(resource.key_id);
    return noContent();
  }),

  memberRoute('GET', '/api/billing', { venue: true, roles: ['builder'] }, async ({ actor }) =>
    json(200, await readBilling(actor.member, actor.venue as Venue)),
  ),

  memberRoute('POST', '/api/billing/plan', { venue: true, roles: ['builder'] }, async ({ actor, body }) => {
    const venue = actor.venue as Venue;
    const fields = asObject(body);
    onlyFields(fields, ['plan']);
    const plan = readEnum<Plan>(fields, 'plan', PLANS);

    const current = await readBilling(actor.member, venue);
    if (current.provider === 'unavailable') throw billingUnavailable();
    if (current.state !== 'active') throw new ApiError(409, 'plan_locked');
    if (current.plan === plan && current.pending_plan === null) throw new ApiError(409, 'already_on_plan');

    try {
      const accountId = await killbillAccountId(
        venue,
        actor.member.id,
        actor.member.display_name,
        actor.member.email,
      );
      const bundleKey = planBundleKey(actor.member.id);
      const subscription = await killbill.activeSubscription(accountId, bundleKey);
      if (subscription === null) {
        await killbill.createSubscription(accountId, bundleKey, plan);
        await pool.query('update builder_billing set pending_plan = null, pending_effective_date = null where member_id = $1', [
          actor.member.id,
        ]);
      } else if (isUpgrade(current.plan, plan)) {
        await killbill.changeSubscriptionPlan(subscription.subscriptionId, plan, 'IMMEDIATE');
        await pool.query('update builder_billing set pending_plan = null, pending_effective_date = null where member_id = $1', [
          actor.member.id,
        ]);
      } else {
        await killbill.changeSubscriptionPlan(subscription.subscriptionId, plan, 'END_OF_TERM');
        await pool.query(
          'update builder_billing set pending_plan = $2, pending_effective_date = $3 where member_id = $1',
          [actor.member.id, plan, subscription.chargedThroughDate],
        );
      }
    } catch (error) {
      if (error instanceof ProviderUnreachable) throw billingUnavailable();
      throw error;
    }
    return json(200, await readBilling(actor.member, venue));
  }),

  memberRoute('POST', '/api/billing/pay', { venue: true, roles: ['builder'] }, async ({ actor }) => {
    const venue = actor.venue as Venue;
    try {
      const accountId = await killbillAccountId(
        venue,
        actor.member.id,
        actor.member.display_name,
        actor.member.email,
      );
      const paid = await killbill.payOutstanding(accountId);
      if (paid === 0) throw new ApiError(409, 'nothing_due');
    } catch (error) {
      if (error instanceof ProviderUnreachable) throw billingUnavailable();
      throw error;
    }
    return json(200, await readBilling(actor.member, venue));
  }),

  memberRoute('GET', '/api/webhooks', { venue: true, roles: ['builder'] }, async ({ actor }) => {
    const venue = actor.venue as Venue;
    const stored = await pool.query<{ url: string; svix_endpoint_id: string; signing_secret: string }>(
      'select url, svix_endpoint_id, signing_secret from webhook_endpoints where member_id = $1',
      [actor.member.id],
    );
    const endpoint = stored.rows[0] ?? null;
    if (endpoint === null) {
      const delivery = (await svix.up()) ? 'ok' : 'delayed';
      return json(200, { endpoint: null, delivery, attempts: [] });
    }
    try {
      const attempts = await svix.deliveryAttempts(venue.slug, actor.member.id);
      return json(200, { endpoint, delivery: 'ok', attempts });
    } catch (error) {
      if (!(error instanceof ProviderUnreachable)) throw error;
      return json(200, { endpoint, delivery: 'delayed', attempts: [] });
    }
  }),

  memberRoute(
    'PUT',
    '/api/webhooks/endpoint',
    { venue: true, roles: ['builder'] },
    async ({ actor, body }) => {
      const venue = actor.venue as Venue;
      const fields = asObject(body);
      onlyFields(fields, ['url']);
      const url = readString(fields, 'url');
      if (url.length > RANGES.endpointUrl.max || !URL_PATTERN.test(url)) {
        throw new ValidationError({ url: 'invalid' });
      }
      let endpoint: svix.Endpoint;
      try {
        endpoint = await svix.upsertEndpoint(venue.slug, actor.member.id, url);
      } catch (error) {
        if (error instanceof ProviderUnreachable) throw webhooksUnavailable();
        throw error;
      }
      await pool.query(
        `insert into webhook_endpoints (member_id, venue_id, url, svix_endpoint_id, signing_secret)
         values ($1,$2,$3,$4,$5)
         on conflict (member_id) do update set url = $3, svix_endpoint_id = $4, signing_secret = $5`,
        [actor.member.id, venue.id, endpoint.url, endpoint.id, endpoint.signingSecret],
      );
      return json(200, {
        url: endpoint.url,
        svix_endpoint_id: endpoint.id,
        signing_secret: endpoint.signingSecret,
      });
    },
  ),

  memberRoute('DELETE', '/api/webhooks/endpoint', { venue: true, roles: ['builder'] }, async ({ actor }) => {
    const venue = actor.venue as Venue;
    try {
      await svix.deleteEndpoint(venue.slug, actor.member.id);
    } catch (error) {
      if (error instanceof ProviderUnreachable) throw webhooksUnavailable();
      throw error;
    }
    await pool.query('delete from webhook_endpoints where member_id = $1', [actor.member.id]);
    return noContent();
  }),
];
