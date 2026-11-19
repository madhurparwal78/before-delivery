import { now } from '../clock.js';
import { copy } from '../copy.js';
import { ApiError, invalid, notFound } from '../errors.js';
import { withAudit } from '../audit.js';
import { optionalText, optionalWhole, readBody, text, whole } from '../fields.js';
import { isOfficeDate, officeDate, officeMidnight, officeOffset } from '../officeTime.js';
import { newId } from '../secretStore.js';
import {
  asOfNights,
  buildAsOf,
  guardRuleState,
  guardRuleVersion,
  loadRule,
  loadRules,
  ruleJson,
} from '../domain/rules.js';
import { loadCredentials } from '../domain/credentials.js';
import { allVaults } from '../domain/visibility.js';
import type { Route } from '../http.js';

const DESK_STAFF = ['office_manager', 'managing_partner'] as const;

function checkMinLength(fields: Record<string, string>, minLength: number): void {
  if (!Number.isInteger(minLength) || minLength < 8 || minLength > 64) {
    fields.min_length = 'Use a whole number from 8 to 64.';
  }
}

function checkEffectiveOn(fields: Record<string, string>, effectiveOn: string, today: string): void {
  if (!isOfficeDate(effectiveOn) || effectiveOn <= today) fields.effective_on = copy.effectiveDatePast;
}

export const ruleRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/rules',
    roles: DESK_STAFF,
    handler: async (ctx) => {
      const today = officeDate(now());
      const vaultId = ctx.query.get('vault_id');
      const rules = (await loadRules()).filter((rule) => vaultId === null || rule.vault_id === vaultId);
      return { status: 200, body: { rules: rules.map((rule) => ruleJson(rule, today)) } };
    },
  },
  {
    method: 'GET',
    path: '/api/rules/:id',
    roles: DESK_STAFF,
    handler: async (ctx) => {
      const rule = await loadRule(ctx.params.id as string);
      if (rule === null) throw notFound();
      return { status: 200, body: ruleJson(rule, officeDate(now())) };
    },
  },
  {
    method: 'POST',
    path: '/api/rules',
    roles: DESK_STAFF,
    handler: async (ctx) => {
      const body = readBody(ctx.body, {
        vault_id: { kind: 'string' },
        min_length: { kind: 'integer' },
        effective_on: { kind: 'string' },
      });
      const today = officeDate(now());
      const vault = (await allVaults()).find((entry) => entry.id === text(body, 'vault_id'));
      const minLength = whole(body, 'min_length');
      const effectiveOn = text(body, 'effective_on');
      const fields: Record<string, string> = {};
      if (vault === undefined) fields.vault_id = 'Pick a vault from the list.';
      checkMinLength(fields, minLength);
      checkEffectiveOn(fields, effectiveOn, today);
      if (Object.keys(fields).length > 0) throw invalid(fields);

      const id = newId();
      await withAudit(async (client, write) => {
        await client.query(
          `insert into rules (id, vault_id, min_length, effective_on, state, version, drafted_by)
           values ($1,$2,$3,$4,'drafted',1,$5)`,
          [id, vault?.id, minLength, effectiveOn, ctx.caller.person.id],
        );
        await write({
          actor: { personId: ctx.caller.person.id, name: ctx.caller.person.full_name },
          action: 'rule_draft',
          subject: { kind: 'vault', id: vault?.id ?? null, name: vault?.name ?? '' },
          details: { rule_id: id, min_length: minLength, effective_on: effectiveOn },
        });
      });
      const created = await loadRule(id);
      if (created === null) throw notFound();
      return { status: 201, body: ruleJson(created, today) };
    },
  },
  {
    method: 'PATCH',
    path: '/api/rules/:id',
    roles: DESK_STAFF,
    handler: async (ctx) => {
      const rule = await loadRule(ctx.params.id as string);
      if (rule === null) throw notFound();
      const body = readBody(ctx.body, {
        version: { kind: 'integer' },
        min_length: { kind: 'integer', optional: true },
        effective_on: { kind: 'string', optional: true },
      });
      guardRuleState(rule, false);
      guardRuleVersion(rule, optionalWhole(body, 'version'));
      const today = officeDate(now());
      const minLength = optionalWhole(body, 'min_length') ?? rule.min_length;
      const effectiveOn = optionalText(body, 'effective_on') ?? rule.effective_on;
      const fields: Record<string, string> = {};
      checkMinLength(fields, minLength);
      checkEffectiveOn(fields, effectiveOn, today);
      if (Object.keys(fields).length > 0) throw invalid(fields);

      const vault = (await allVaults()).find((entry) => entry.id === rule.vault_id);
      await withAudit(async (client, write) => {
        await client.query(
          `update rules set min_length = $2, effective_on = $3, state = 'drafted', signed_by = null,
                            version = version + 1
            where id = $1 and version = $4`,
          [rule.id, minLength, effectiveOn, rule.version],
        );
        await write({
          actor: { personId: ctx.caller.person.id, name: ctx.caller.person.full_name },
          action: 'rule_edit',
          subject: { kind: 'vault', id: rule.vault_id, name: vault?.name ?? '' },
          details: { rule_id: rule.id, min_length: minLength, effective_on: effectiveOn },
        });
      });
      const after = await loadRule(rule.id);
      if (after === null) throw notFound();
      return { status: 200, body: ruleJson(after, today) };
    },
  },
  {
    method: 'POST',
    path: '/api/rules/:id/sign',
    roles: ['managing_partner'],
    handler: async (ctx) => {
      const rule = await loadRule(ctx.params.id as string);
      if (rule === null) throw notFound();
      const body = readBody(ctx.body, { version: { kind: 'integer' } });
      guardRuleState(rule, true);
      guardRuleVersion(rule, optionalWhole(body, 'version'));
      const today = officeDate(now());
      if (rule.effective_on <= today) {
        throw new ApiError(409, 'effective_date_passed', copy.ruleNotSignable);
      }
      const taken = (await loadRules()).some(
        (other) =>
          other.id !== rule.id &&
          other.vault_id === rule.vault_id &&
          other.state === 'scheduled' &&
          other.effective_on === rule.effective_on,
      );
      if (taken) throw new ApiError(409, 'rule_date_taken', copy.ruleNotSignable);

      const vault = (await allVaults()).find((entry) => entry.id === rule.vault_id);
      const signed = await withAudit(async (client, write) => {
        const updated = await client.query(
          `update rules set state = 'scheduled', signed_by = $2, version = version + 1
            where id = $1 and version = $3 and state = 'drafted'`,
          [rule.id, ctx.caller.person.id, rule.version],
        );
        if ((updated.rowCount ?? 0) === 0) return false;
        await write({
          actor: { personId: ctx.caller.person.id, name: ctx.caller.person.full_name },
          action: 'rule_sign',
          subject: { kind: 'vault', id: rule.vault_id, name: vault?.name ?? '' },
          details: { rule_id: rule.id, effective_on: rule.effective_on },
        });
        return true;
      });
      if (!signed) throw new ApiError(409, 'not_a_draft', copy.ruleNotSignable);
      const after = await loadRule(rule.id);
      if (after === null) throw notFound();
      return { status: 200, body: ruleJson(after, today) };
    },
  },
  {
    method: 'GET',
    path: '/api/as-of',
    roles: DESK_STAFF,
    handler: async (ctx) => {
      const at = now();
      const today = officeDate(at);
      const night = ctx.query.get('night');
      const nights = asOfNights(today);
      if (night === null || !nights.includes(night)) {
        throw invalid({ night: 'Pick one of the next 60 office midnights.' });
      }
      const vaults = await allVaults();
      const credentials = await loadCredentials(null);
      const lengths = new Map<string, number[]>();
      for (const credential of credentials) {
        const list = lengths.get(credential.vault_id) ?? [];
        list.push(credential.secret_length);
        lengths.set(credential.vault_id, list);
      }
      const built = buildAsOf({ night, today, vaults, rules: await loadRules(), secretLengths: lengths });
      const startsAt = officeMidnight(night);
      return {
        status: 200,
        body: {
          night,
          offset: officeOffset(startsAt),
          starts_at: startsAt.toISOString(),
          out_of_policy_count: built.total,
          vaults: built.vaults,
        },
      };
    },
  },
];
