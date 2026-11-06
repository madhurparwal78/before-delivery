import { isValidTimezone } from '../domain/zone';
import { fail } from '../errors';
import { Router, ok } from '../http/router';
import { allModels } from '../store/catalogue';
import { allTeams } from '../store/people';
import { policyVersions, savePolicy } from '../store/policy';
import {
  AccessValue,
  Context,
  JsonObject,
  JsonValue,
  Policy,
  TeamAccessValue,
  TeamPolicy,
} from '../types';
import { policyNow, requireRole } from './support';

const CONTEXTS: readonly Context[] = ['api', 'playground'];
const TEAM_VALUES: readonly TeamAccessValue[] = ['allowed', 'blocked', 'inherit'];
const ORG_VALUES: readonly AccessValue[] = ['allowed', 'blocked'];
const RETENTION_DAYS = [7, 30, 90];

function asObject(value: JsonValue | undefined, path: string, errors: Record<string, string>): JsonObject | null {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    errors[path] = 'Send this as an object.';
    return null;
  }
  return value as JsonObject;
}

export function registerPolicyRoutes(router: Router): void {
  router.add('GET', '/api/policy', 'none', async (ctx) => {
    requireRole(ctx.caller, ['admin', 'finance']);
    return ok({ policy: (await policyNow()) as unknown as JsonValue });
  });

  router.add('GET', '/api/policy/versions', 'none', async (ctx) => {
    requireRole(ctx.caller, ['admin', 'finance']);
    return ok({ versions: (await policyVersions()) as unknown as JsonValue });
  });

  router.add('PUT', '/api/policy', 'json', async (ctx) => {
    requireRole(ctx.caller, ['admin']);
    const current = await policyNow();
    const models = await allModels();
    const teams = await allTeams();
    const errors: Record<string, string> = {};

    const version = ctx.body['version'];
    if (typeof version !== 'number' || !Number.isInteger(version)) {
      errors['version'] = 'Send the version this save is based on.';
    }
    const timezone = ctx.body['timezone'];
    if (typeof timezone !== 'string' || !isValidTimezone(timezone)) {
      errors['timezone'] = 'Choose an IANA time zone name.';
    }
    const retention = ctx.body['retention_days'];
    if (typeof retention !== 'number' || !RETENTION_DAYS.includes(retention)) {
      errors['retention_days'] = 'Choose 7, 30 or 90 days.';
    }

    const orgAccessRaw = asObject(ctx.body['org_model_access'], 'org_model_access', errors);
    const orgAccess: Record<string, Record<Context, AccessValue>> = {};
    if (orgAccessRaw) {
      for (const slug of Object.keys(orgAccessRaw)) {
        if (!models.some((model) => model.slug === slug)) {
          errors[`org_model_access.${slug}`] = 'No such model.';
        }
      }
      for (const model of models) {
        const entry = asObject(orgAccessRaw[model.slug], `org_model_access.${model.slug}`, errors);
        if (!entry) continue;
        const resolved: Record<string, AccessValue> = {};
        for (const context of CONTEXTS) {
          const value = entry[context];
          if (typeof value !== 'string' || !ORG_VALUES.includes(value as AccessValue)) {
            errors[`org_model_access.${model.slug}.${context}`] = 'Choose allowed or blocked.';
            continue;
          }
          resolved[context] = value as AccessValue;
        }
        orgAccess[model.slug] = resolved as Record<Context, AccessValue>;
      }
    }

    const teamsRaw = ctx.body['teams'];
    const teamPolicies: TeamPolicy[] = [];
    if (!Array.isArray(teamsRaw)) {
      errors['teams'] = 'Send the teams as a list.';
    } else {
      for (const [index, entry] of teamsRaw.entries()) {
        const teamObject = asObject(entry, `teams.${index}`, errors);
        if (!teamObject) continue;
        const id = teamObject['id'];
        const team = typeof id === 'string' ? teams.find((candidate) => candidate.id === id) : undefined;
        if (!team) {
          errors[`teams.${index}.id`] = 'No such team.';
          continue;
        }
        const concurrency = teamObject['concurrency'];
        if (typeof concurrency !== 'number' || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20) {
          errors[`teams.${index}.concurrency`] = 'Enter a whole number from 1 to 20.';
        }
        const visibility = teamObject['payload_visibility'];
        if (visibility !== 'team' && visibility !== 'restricted') {
          errors[`teams.${index}.payload_visibility`] = 'Choose team or restricted.';
        }
        const soft = teamObject['soft_cap_credits'];
        const hard = teamObject['hard_cap_credits'];
        for (const [name, value] of [
          ['soft_cap_credits', soft],
          ['hard_cap_credits', hard],
        ] as const) {
          if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 10000000) {
            errors[`teams.${index}.${name}`] = 'Enter a whole number of credits from 0 to 10000000.';
          }
        }
        if (typeof soft === 'number' && typeof hard === 'number' && soft > hard) {
          errors[`teams.${index}.soft_cap_credits`] = 'The soft cap must be at or below the hard cap.';
        }
        const defaultsRaw = asObject(teamObject['context_defaults'], `teams.${index}.context_defaults`, errors);
        const contextDefaults: Record<string, TeamAccessValue> = {};
        if (defaultsRaw) {
          for (const context of CONTEXTS) {
            const value = defaultsRaw[context];
            if (typeof value !== 'string' || !TEAM_VALUES.includes(value as TeamAccessValue)) {
              errors[`teams.${index}.context_defaults.${context}`] = 'Choose allowed, blocked or inherit.';
              continue;
            }
            contextDefaults[context] = value as TeamAccessValue;
          }
        }
        const accessRaw = asObject(teamObject['model_access'], `teams.${index}.model_access`, errors);
        const modelAccess: Record<string, Record<Context, TeamAccessValue>> = {};
        if (accessRaw) {
          for (const slug of Object.keys(accessRaw)) {
            if (!models.some((model) => model.slug === slug)) {
              errors[`teams.${index}.model_access.${slug}`] = 'No such model.';
            }
          }
          for (const model of models) {
            const entryObject = asObject(
              accessRaw[model.slug],
              `teams.${index}.model_access.${model.slug}`,
              errors,
            );
            if (!entryObject) continue;
            const resolved: Record<string, TeamAccessValue> = {};
            for (const context of CONTEXTS) {
              const value = entryObject[context];
              if (typeof value !== 'string' || !TEAM_VALUES.includes(value as TeamAccessValue)) {
                errors[`teams.${index}.model_access.${model.slug}.${context}`] =
                  'Choose allowed, blocked or inherit.';
                continue;
              }
              resolved[context] = value as TeamAccessValue;
            }
            modelAccess[model.slug] = resolved as Record<Context, TeamAccessValue>;
          }
        }
        teamPolicies.push({
          id: team.id,
          name: team.name,
          concurrency: concurrency as number,
          payload_visibility: visibility as 'team' | 'restricted',
          soft_cap_credits: soft as number,
          hard_cap_credits: hard as number,
          context_defaults: contextDefaults as Record<Context, TeamAccessValue>,
          model_access: modelAccess,
        });
      }
      for (const team of teams) {
        if (!teamPolicies.some((candidate) => candidate.id === team.id)) {
          errors['teams'] = 'Send every team of the org.';
        }
      }
    }

    if (Object.keys(errors).length > 0) throw fail.validation(errors);

    const document: Policy = {
      version: current.version,
      timezone: timezone as string,
      retention_days: retention as number,
      org_model_access: orgAccess,
      teams: teamPolicies,
    };
    const result = await savePolicy(document, version as number, ctx.caller.member.id);
    if (result.kind === 'stale') throw fail.policyVersionStale(result.currentVersion);
    return ok({ policy: result.policy as unknown as JsonValue });
  });
}
