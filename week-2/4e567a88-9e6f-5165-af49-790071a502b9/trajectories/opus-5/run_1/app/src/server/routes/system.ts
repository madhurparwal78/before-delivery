import { db } from '../db';
import { resolveAccess } from '../domain/access';
import { parseLocalIso, localIsoOf, localToInstant } from '../domain/zone';
import { fail, fieldMessages } from '../errors';
import { Ctx, Reply, Router, noContent, ok, created } from '../http/router';
import { dependencySnapshot } from '../services/deps';
import { allModels, deleteRate, insertRate, modelBySlug, rateAt, rateById, rateStatus, ratesOf } from '../store/catalogue';
import { allTeams, createSession, deleteSession, memberByCredentials } from '../store/people';
import { JsonObject, JsonValue, Member } from '../types';
import { policyNow, requireRole } from './support';

const SESSION_COOKIE = 'dispatch_session';

function memberJson(member: Member): JsonObject {
  return {
    id: member.id,
    name: member.name,
    email: member.email,
    role: member.role,
    team_id: member.teamId,
  };
}

export function registerSystemRoutes(router: Router): void {
  router.addPublic('GET', '/api/health', 'none', async () => ok({ status: 'ok' }));

  router.add('GET', '/api/system', 'none', async () => {
    const snapshot = dependencySnapshot();
    return ok({
      storage: snapshot.storage,
      billing: snapshot.billing,
      checked_at: snapshot.checkedAt.toISOString(),
    });
  });

  router.addPublic('POST', '/api/session', 'json', async (ctx) => {
    const email = ctx.body['email'];
    const passcode = ctx.body['passcode'];
    if (typeof email !== 'string' || typeof passcode !== 'string') throw fail.unauthenticated();
    const member = await memberByCredentials(email, passcode);
    if (!member) throw fail.unauthenticated();
    const sessionId = await createSession(member.id);
    return {
      status: 200,
      json: { member: memberJson(member) },
      headers: {
        'set-cookie': `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Strict`,
      },
    };
  });

  router.add('DELETE', '/api/session', 'none', async (ctx) => {
    if (ctx.sessionId) await deleteSession(ctx.sessionId);
    return {
      status: 204,
      headers: { 'set-cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0` },
    };
  });

  router.add('GET', '/api/me', 'none', async (ctx) => ok({ member: memberJson(ctx.caller.member) }));

  router.add('GET', '/api/teams', 'none', async (ctx) => {
    const teams = await allTeams();
    const visible =
      ctx.caller.member.role === 'member'
        ? teams.filter((team) => team.id === ctx.caller.member.teamId)
        : teams;
    return ok({ teams: visible.map((team) => ({ id: team.id, name: team.name })) });
  });

  router.add('GET', '/api/models', 'none', async (ctx) => {
    const models = await modelListJson(ctx);
    return ok({ models });
  });

  router.add('GET', '/api/models/:slug', 'none', async (ctx) => {
    const models = await modelListJson(ctx);
    const model = models.find((candidate) => candidate['slug'] === ctx.params['slug']);
    if (!model) throw fail.notFound();
    return ok({ model });
  });

  router.add('GET', '/api/models/:slug/rates', 'none', async (ctx) => {
    const slug = ctx.params['slug']!;
    const model = await modelBySlug(slug);
    if (!model) throw fail.notFound();
    const policy = await policyNow();
    const rates = await ratesOf(slug);
    const now = new Date();
    return ok({
      rates: rates.map((rate) => ({
        id: rate.id,
        micro_per_unit: Number(rate.microPerUnit),
        effective_at: rate.effectiveAt.toISOString(),
        effective_at_local: localIsoOf(rate.effectiveAt, policy.timezone),
        status: rateStatus(rates, rate, now),
        created_by: rate.createdBy,
      })),
    });
  });

  router.add('POST', '/api/models/:slug/rates', 'json', async (ctx) => scheduleRate(ctx));

  router.add('DELETE', '/api/models/:slug/rates/:id', 'none', async (ctx) => {
    requireRole(ctx.caller, ['finance']);
    const model = await modelBySlug(ctx.params['slug']!);
    if (!model) throw fail.notFound();
    const rate = await rateById(model.slug, ctx.params['id']!);
    if (!rate) throw fail.notFound();
    if (rate.effectiveAt.getTime() <= Date.now()) throw fail.rateAlreadyEffective();
    await deleteRate(rate.id);
    return noContent();
  });
}

async function scheduleRate(ctx: Ctx): Promise<Reply> {
  requireRole(ctx.caller, ['finance']);
  const model = await modelBySlug(ctx.params['slug']!);
  if (!model) throw fail.notFound();
  const policy = await policyNow();
  const errors: Record<string, string> = {};

  const microPerUnit = ctx.body['micro_per_unit'];
  if (
    typeof microPerUnit !== 'number' ||
    !Number.isInteger(microPerUnit) ||
    microPerUnit < 1 ||
    microPerUnit > 1000000000000
  ) {
    errors['micro_per_unit'] = 'Enter a whole number of micro-credits from 1 to 1000000000000.';
  }

  const localValue = ctx.body['effective_at_local'];
  let effectiveAt: Date | null = null;
  if (typeof localValue !== 'string') {
    errors['effective_at_local'] = 'Use the format YYYY-MM-DDTHH:MM:SS.';
  } else {
    const parts = parseLocalIso(localValue);
    if (!parts) {
      errors['effective_at_local'] = 'Use the format YYYY-MM-DDTHH:MM:SS.';
    } else {
      const resolution = localToInstant(parts, policy.timezone);
      if (resolution.kind === 'nonexistent') {
        errors['effective_at_local'] = fieldMessages.nonexistentLocalTime(policy.timezone);
      } else if (resolution.instant.getTime() <= Date.now()) {
        errors['effective_at_local'] = fieldMessages.notInFuture;
      } else {
        effectiveAt = resolution.instant;
      }
    }
  }

  if (Object.keys(errors).length > 0) throw fail.validation(errors);
  const rate = await insertRate(
    model.slug,
    BigInt(microPerUnit as number),
    effectiveAt!,
    ctx.caller.member.id,
  );
  const rates = await ratesOf(model.slug);
  return created({
    rate: {
      id: rate.id,
      micro_per_unit: Number(rate.microPerUnit),
      effective_at: rate.effectiveAt.toISOString(),
      effective_at_local: localIsoOf(rate.effectiveAt, policy.timezone),
      status: rateStatus(rates, rate, new Date()),
      created_by: rate.createdBy,
    },
  });
}

async function modelListJson(ctx: Ctx): Promise<JsonObject[]> {
  const policy = await policyNow();
  const models = await allModels();
  const teamId = ctx.caller.member.teamId;
  const now = new Date();
  const list: JsonObject[] = [];
  for (const model of models) {
    const rate = await rateAt(db, model.slug, now);
    list.push({
      slug: model.slug,
      name: model.name,
      modality: model.modality,
      unit: model.unit,
      unit_label: model.unitLabel,
      input_schema: model.inputSchema as JsonValue,
      current_rate:
        rate === null
          ? null
          : {
              id: rate.id,
              micro_per_unit: Number(rate.microPerUnit),
              effective_at: rate.effectiveAt.toISOString(),
            },
      access:
        teamId === null
          ? null
          : {
              api: resolveAccess(policy, teamId, model.slug, 'api'),
              playground: resolveAccess(policy, teamId, model.slug, 'playground'),
            },
    });
  }
  return list;
}
