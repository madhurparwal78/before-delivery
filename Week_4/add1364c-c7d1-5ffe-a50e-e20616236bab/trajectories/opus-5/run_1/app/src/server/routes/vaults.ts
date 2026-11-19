import { now } from '../clock.js';
import { copy } from '../copy.js';
import { ApiError, invalid, notFound } from '../errors.js';
import { isUniqueViolation, query } from '../db.js';
import { withAudit } from '../audit.js';
import { flag, optionalFlag, optionalText, readBody, text } from '../fields.js';
import { officeDate } from '../officeTime.js';
import { newId, openSecret, sealSecret } from '../secretStore.js';
import { loadCredential, loadVendors, policyStand } from '../domain/credentials.js';
import { resolveRuleInForce, rulesOfVault } from '../domain/rules.js';
import { visibleVaultIds } from '../domain/visibility.js';
import { credentialsOfVault, loadDrawerContext, vaultJson } from '../views.js';
import { readHost } from '../domain/imports.js';
import type { Route } from '../http.js';

const DEFAULT_MIN_LENGTH = 12;

async function requireVisibleVault(vaultId: string, ctx: { caller: { person: Parameters<typeof visibleVaultIds>[0] } }, at: Date): Promise<void> {
  if (!(await visibleVaultIds(ctx.caller.person, at)).includes(vaultId)) throw notFound();
}

export const vaultRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/vaults',
    handler: async (ctx) => {
      const at = now();
      const context = await loadDrawerContext(at);
      const visible = await visibleVaultIds(ctx.caller.person, at);
      return {
        status: 200,
        body: {
          vaults: context.vaults
            .filter((vault) => visible.includes(vault.id))
            .map((vault) => vaultJson(vault, context, ctx.caller.person)),
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/api/vaults/:id',
    handler: async (ctx) => {
      const at = now();
      const vaultId = ctx.params.id as string;
      await requireVisibleVault(vaultId, ctx, at);
      const context = await loadDrawerContext(at);
      const vault = context.vaults.find((entry) => entry.id === vaultId);
      if (vault === undefined) throw notFound();
      return {
        status: 200,
        body: {
          vault: vaultJson(vault, context, ctx.caller.person),
          credentials: credentialsOfVault(vault.id, context),
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/api/vaults',
    roles: ['office_manager'],
    handler: async (ctx) => {
      const body = readBody(ctx.body, { name: { kind: 'string' }, off_when_travelling: { kind: 'boolean' } });
      const name = text(body, 'name');
      if (name.trim().length < 2 || name.length > 40) throw invalid({ name: 'Use 2 to 40 characters.' });
      const at = now();
      const id = newId();
      try {
        await withAudit(async (client, write) => {
          const order = await client.query<{ next: number }>(
            'select coalesce(max(drawer_order), 0) + 1 as next from vaults',
          );
          await client.query(
            'insert into vaults (id, name, off_when_travelling, drawer_order) values ($1,$2,$3,$4)',
            [id, name, flag(body, 'off_when_travelling'), order.rows[0]?.next ?? 1],
          );
          await client.query(
            `insert into rules (id, vault_id, min_length, effective_on, state, version, drafted_by, signed_by, took_force_at)
             values ($1,$2,$3,$4,'in_force',1,$5,$5,$6)`,
            [newId(), id, DEFAULT_MIN_LENGTH, officeDate(at), ctx.caller.person.id, at],
          );
          await write({
            actor: { personId: ctx.caller.person.id, name: ctx.caller.person.full_name },
            action: 'vault_create',
            subject: { kind: 'vault', id, name },
            details: { off_when_travelling: flag(body, 'off_when_travelling') },
          });
        });
      } catch (error) {
        if (isUniqueViolation(error, 'vaults_name_key')) throw invalid({ name: 'A vault already has this name.' });
        throw error;
      }
      const context = await loadDrawerContext(at);
      const vault = context.vaults.find((entry) => entry.id === id);
      if (vault === undefined) throw notFound();
      return { status: 201, body: vaultJson(vault, context, ctx.caller.person) };
    },
  },
  {
    method: 'PATCH',
    path: '/api/vaults/:id',
    roles: ['office_manager'],
    handler: async (ctx) => {
      const at = now();
      const vaultId = ctx.params.id as string;
      const before = (await loadDrawerContext(at)).vaults.find((entry) => entry.id === vaultId);
      if (before === undefined) throw notFound();
      const body = readBody(ctx.body, {
        name: { kind: 'string', optional: true },
        off_when_travelling: { kind: 'boolean', optional: true },
      });
      const name = optionalText(body, 'name');
      const offWhenTravelling = optionalFlag(body, 'off_when_travelling');
      if (name !== undefined && (name.trim().length < 2 || name.length > 40)) {
        throw invalid({ name: 'Use 2 to 40 characters.' });
      }
      const renamed = name !== undefined && name !== before.name;
      try {
        await withAudit(async (client, write) => {
          const actor = { personId: ctx.caller.person.id, name: ctx.caller.person.full_name };
          if (renamed) {
            await client.query('update vaults set name = $2, formerly = $3 where id = $1', [
              vaultId,
              name,
              before.name,
            ]);
            await client.query(
              `insert into renames (id, subject_kind, subject_id, old_name, new_name, by_person_id, at)
               values ($1,'vault',$2,$3,$4,$5,$6)`,
              [newId(), vaultId, before.name, name, ctx.caller.person.id, at],
            );
            await write({
              actor,
              action: 'vault_rename',
              subject: { kind: 'vault', id: vaultId, name: before.name },
              details: { old: before.name, new: name },
            });
          }
          if (offWhenTravelling !== undefined && offWhenTravelling !== before.off_when_travelling) {
            await client.query('update vaults set off_when_travelling = $2 where id = $1', [
              vaultId,
              offWhenTravelling,
            ]);
            await write({
              actor,
              action: 'vault_change',
              subject: { kind: 'vault', id: vaultId, name: name ?? before.name },
              details: { off_when_travelling: offWhenTravelling },
            });
          }
        });
      } catch (error) {
        if (isUniqueViolation(error, 'vaults_name_key')) throw invalid({ name: 'A vault already has this name.' });
        throw error;
      }
      const context = await loadDrawerContext(at);
      const vault = context.vaults.find((entry) => entry.id === vaultId);
      if (vault === undefined) throw notFound();
      return { status: 200, body: vaultJson(vault, context, ctx.caller.person) };
    },
  },
  {
    method: 'GET',
    path: '/api/vendors',
    handler: async () => {
      const vendors = await loadVendors();
      const renames = await query<{ subject_id: string; old_name: string; new_name: string; by_name: string; at: Date }>(
        `select r.subject_id, r.old_name, r.new_name, coalesce(p.full_name, 'Lockset') as by_name, r.at
           from renames r left join people p on p.id = r.by_person_id
          where r.subject_kind = 'vendor' order by r.at asc`,
      );
      return {
        status: 200,
        body: {
          vendors: vendors.map((vendor) => ({
            id: vendor.id,
            name: vendor.name,
            domain: vendor.domain,
            formerly: vendor.formerly,
            renames: renames
              .filter((rename) => rename.subject_id === vendor.id)
              .map((rename) => ({
                old: rename.old_name,
                new: rename.new_name,
                by: rename.by_name,
                at: rename.at.toISOString(),
              })),
          })),
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/api/vendors',
    roles: ['office_manager'],
    handler: async (ctx) => {
      const body = readBody(ctx.body, { name: { kind: 'string' }, domain: { kind: 'string' } });
      const name = text(body, 'name');
      const domain = text(body, 'domain');
      const fields: Record<string, string> = {};
      if (name.trim().length < 2 || name.length > 60) fields.name = 'Use 2 to 60 characters.';
      const host = readHost(domain);
      if (host === null || host !== domain.trim().toLowerCase()) fields.domain = 'Use a host name like example.com.';
      if (Object.keys(fields).length > 0) throw invalid(fields);
      const id = newId();
      try {
        await withAudit(async (client, write) => {
          await client.query('insert into vendors (id, name, domain) values ($1,$2,$3)', [id, name, host]);
          await write({
            actor: { personId: ctx.caller.person.id, name: ctx.caller.person.full_name },
            action: 'vendor_create',
            subject: { kind: 'vendor', id, name },
            details: { domain: host },
          });
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw invalid({ domain: 'A vendor already has this domain.' });
        throw error;
      }
      const vendor = (await loadVendors()).find((entry) => entry.id === id);
      if (vendor === undefined) throw notFound();
      return { status: 201, body: vendor };
    },
  },
  {
    method: 'PATCH',
    path: '/api/vendors/:id',
    roles: ['office_manager'],
    handler: async (ctx) => {
      const before = (await loadVendors()).find((entry) => entry.id === ctx.params.id);
      if (before === undefined) throw notFound();
      const body = readBody(ctx.body, {
        name: { kind: 'string', optional: true },
        domain: { kind: 'string', optional: true },
      });
      const name = optionalText(body, 'name');
      const domain = optionalText(body, 'domain');
      const fields: Record<string, string> = {};
      if (name !== undefined && (name.trim().length < 2 || name.length > 60)) fields.name = 'Use 2 to 60 characters.';
      let host: string | null = null;
      if (domain !== undefined) {
        host = readHost(domain);
        if (host === null || host !== domain.trim().toLowerCase()) fields.domain = 'Use a host name like example.com.';
      }
      if (Object.keys(fields).length > 0) throw invalid(fields);
      const at = now();
      try {
        await withAudit(async (client, write) => {
          const actor = { personId: ctx.caller.person.id, name: ctx.caller.person.full_name };
          if (name !== undefined && name !== before.name) {
            await client.query('update vendors set name = $2, formerly = $3 where id = $1', [
              before.id,
              name,
              before.name,
            ]);
            await client.query(
              `insert into renames (id, subject_kind, subject_id, old_name, new_name, by_person_id, at)
               values ($1,'vendor',$2,$3,$4,$5,$6)`,
              [newId(), before.id, before.name, name, ctx.caller.person.id, at],
            );
            await write({
              actor,
              action: 'vendor_rename',
              subject: { kind: 'vendor', id: before.id, name: before.name },
              details: { old: before.name, new: name },
            });
          }
          if (host !== null && host !== before.domain) {
            await client.query('update vendors set domain = $2 where id = $1', [before.id, host]);
            await write({
              actor,
              action: 'vendor_change',
              subject: { kind: 'vendor', id: before.id, name: name ?? before.name },
              details: { domain: host },
            });
          }
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw invalid({ domain: 'A vendor already has this domain.' });
        throw error;
      }
      const vendor = (await loadVendors()).find((entry) => entry.id === before.id);
      if (vendor === undefined) throw notFound();
      return { status: 200, body: vendor };
    },
  },
  {
    method: 'POST',
    path: '/api/credentials',
    roles: ['office_manager'],
    handler: async (ctx) => {
      const body = readBody(ctx.body, {
        vault_id: { kind: 'string' },
        vendor_id: { kind: 'string' },
        label: { kind: 'string' },
        username: { kind: 'string' },
        secret: { kind: 'string' },
      });
      const at = now();
      const context = await loadDrawerContext(at);
      const vaultId = text(body, 'vault_id');
      const vault = context.vaults.find((entry) => entry.id === vaultId);
      if (vault === undefined) throw notFound();
      const vendor = context.vendors.find((entry) => entry.id === text(body, 'vendor_id'));
      const label = text(body, 'label');
      const username = text(body, 'username');
      const secret = text(body, 'secret');
      const rule = resolveRuleInForce(rulesOfVault(context.rules, vault.id), context.today);
      const fields: Record<string, string> = {};
      if (vendor === undefined) fields.vendor_id = 'Pick a vendor from the list.';
      if (label.length < 1 || label.length > 60) fields.label = 'Use 1 to 60 characters.';
      if (username.length < 1 || username.length > 120) fields.username = 'Use 1 to 120 characters.';
      if (secret.length < 1 || secret.length > 128) fields.secret = 'Use 1 to 128 characters.';
      else if (rule !== null && secret.length < rule.min_length) {
        fields.secret = copy.minimumLength(vault.name, rule.min_length);
      }
      if (Object.keys(fields).length > 0) throw invalid(fields);

      const id = newId();
      try {
        await withAudit(async (client, write) => {
          await client.query(
            `insert into credentials (id, vault_id, vendor_id, label, username, secret_cipher, secret_length,
                                      last_turned_on, secret_set_on)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
            [id, vault.id, vendor?.id, label, username, sealSecret(secret), secret.length, context.today],
          );
          await write({
            actor: { personId: ctx.caller.person.id, name: ctx.caller.person.full_name },
            action: 'credential_create',
            subject: { kind: 'credential', id, name: label },
            details: { vault_id: vault.id, vendor_id: vendor?.id },
          });
        });
      } catch (error) {
        if (isUniqueViolation(error, 'credentials_identity_key')) {
          throw invalid({ username: 'This login is already on file.' });
        }
        throw error;
      }
      const after = await loadDrawerContext(at);
      const created = after.credentials.find((entry) => entry.id === id);
      if (created === undefined) throw notFound();
      return { status: 201, body: credentialsOfVault(vault.id, after).find((entry) => entry.id === id) };
    },
  },
  {
    method: 'GET',
    path: '/api/credentials/:id',
    handler: async (ctx) => {
      const at = now();
      const credential = await loadCredential(ctx.params.id as string);
      if (credential === null) throw notFound();
      await requireVisibleVault(credential.vault_id, ctx, at);
      const context = await loadDrawerContext(at);
      const body = credentialsOfVault(credential.vault_id, context).find((entry) => entry.id === credential.id);
      return { status: 200, body };
    },
  },
  {
    method: 'PUT',
    path: '/api/credentials/:id/secret',
    handler: async (ctx) => {
      const at = now();
      const credential = await loadCredential(ctx.params.id as string);
      if (credential === null) throw notFound();
      await requireVisibleVault(credential.vault_id, ctx, at);
      if (ctx.caller.person.role === 'managing_partner' || ctx.caller.person.role === 'outside_bookkeeper') {
        throw new ApiError(403, 'forbidden', 'This is not yours to do.');
      }
      const body = readBody(ctx.body, { secret: { kind: 'string' } });
      const context = await loadDrawerContext(at);
      const vault = context.vaults.find((entry) => entry.id === credential.vault_id);
      if (vault === undefined) throw notFound();
      const rule = resolveRuleInForce(rulesOfVault(context.rules, vault.id), context.today);
      const secret = text(body, 'secret');
      if (secret.length < 1 || secret.length > 128) throw invalid({ secret: 'Use 1 to 128 characters.' });
      if (rule !== null && secret.length < rule.min_length) {
        throw invalid({ secret: copy.minimumLength(vault.name, rule.min_length) });
      }

      await withAudit(async (client, write) => {
        const actor = { personId: ctx.caller.person.id, name: ctx.caller.person.full_name };
        await client.query(
          `update credentials set secret_cipher = $2, secret_length = $3, last_turned_on = $4, secret_set_on = $4
            where id = $1`,
          [credential.id, sealSecret(secret), secret.length, context.today],
        );
        await client.query('delete from credential_holders where credential_id = $1', [credential.id]);
        await client.query('insert into credential_holders (credential_id, person_id) values ($1,$2)', [
          credential.id,
          ctx.caller.person.id,
        ]);
        await write({
          actor,
          action: 'secret_edit',
          subject: { kind: 'credential', id: credential.id, name: credential.label },
          details: { rule_id: rule?.id ?? null },
        });
        const turned = await client.query<{ id: string }>(
          "update turns set state = 'turned', turned_at = $2 where credential_id = $1 and state in ('due','overdue') returning id",
          [credential.id, at],
        );
        for (const turn of turned.rows) {
          await write({
            actor,
            action: 'turn_done',
            subject: { kind: 'credential', id: credential.id, name: credential.label },
            details: { turn_id: turn.id },
          });
        }
      });
      const after = await loadDrawerContext(at);
      return {
        status: 200,
        body: credentialsOfVault(credential.vault_id, after).find((entry) => entry.id === credential.id),
      };
    },
  },
  {
    method: 'POST',
    path: '/api/credentials/:id/reveal',
    handler: async (ctx) => revealOrCopy(ctx, 'reveal'),
  },
  {
    method: 'POST',
    path: '/api/credentials/:id/copy',
    handler: async (ctx) => revealOrCopy(ctx, 'copy'),
  },
];

async function revealOrCopy(
  ctx: Parameters<Route['handler']>[0],
  action: 'reveal' | 'copy',
): Promise<{ status: number; body: unknown }> {
  const at = now();
  const credential = await loadCredential(ctx.params.id as string);
  if (credential === null) throw notFound();
  await requireVisibleVault(credential.vault_id, ctx, at);
  readBody(ctx.body, {});
  const context = await loadDrawerContext(at);
  const rule = resolveRuleInForce(rulesOfVault(context.rules, credential.vault_id), context.today);
  const { leewayEndsAt } = policyStand(credential, rule);
  if (leewayEndsAt !== null && at.getTime() >= leewayEndsAt.getTime()) {
    throw new ApiError(423, 'turn_required', copy.turnRequired);
  }
  const auditId = await withAudit(async (_client, write) =>
    write({
      actor: { personId: ctx.caller.person.id, name: ctx.caller.person.full_name },
      action,
      subject: { kind: 'credential', id: credential.id, name: credential.label },
      details: { rule_id: rule?.id ?? null },
    }),
  );
  return {
    status: 200,
    body: {
      credential_id: credential.id,
      secret: openSecret(credential.secret_cipher),
      rule_id: rule?.id ?? null,
      audit_id: auditId,
    },
  };
}
