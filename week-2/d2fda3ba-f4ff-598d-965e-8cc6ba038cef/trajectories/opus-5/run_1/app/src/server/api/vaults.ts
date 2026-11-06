import { addSeconds, formatDisplayTime, toIso } from '../../shared/time';
import { validateEmail, validateKeyEnvelope, validateVaultName, type FieldErrors } from '../../shared/validation';
import { hashToken, newId, newToken, requireCaller } from '../auth';
import { ApiError, notFound, validationFailed } from '../errors';
import { jsonReply, type Router } from '../http';
import { inviteEmail } from '../mail';
import { vaultJson, type VaultRow } from '../serialize';
import type { Services } from '../services';
import { requireApprovedDevice, requireVaultMember } from '../vaultAccess';

export function registerVaultRoutes(router: Router, services: Services): void {
  const { db } = services;

  router.add('POST', '/api/vaults', async (ctx) => {
    const caller = await requireCaller(db, ctx);
    requireApprovedDevice(caller);
    const plans = await services.entitlement.read(caller.account);
    if (plans.sync.state !== 'active') {
      throw new ApiError(402, 'sync_not_entitled', 'Syncing needs the Sync add-on.');
    }

    const body = (ctx.body ?? {}) as { name?: unknown; key_envelope?: unknown };
    const fields: FieldErrors = {};
    const name = validateVaultName(body.name);
    if (name) fields.name = name;
    const envelope = validateKeyEnvelope(body.key_envelope);
    if (envelope) fields.key_envelope = envelope;
    if (Object.keys(fields).length > 0) throw validationFailed(fields);

    const vaultId = newId();
    const vault = await db.transaction(async (client) => {
      const created = await client.query<{ id: string; name: string; created_at: Date }>(
        'insert into vaults (id, owner_account_id, name, key_envelope) values ($1, $2, $3, $4) returning id, name, created_at',
        [vaultId, caller.account.id, String(body.name).trim(), JSON.stringify(body.key_envelope)],
      );
      await client.query('insert into vault_members (vault_id, account_id, role) values ($1, $2, $3)', [
        vaultId,
        caller.account.id,
        'owner',
      ]);
      return created.rows[0];
    });
    if (!vault) throw new ApiError(500, 'internal_error', 'Could not create the vault.');

    return jsonReply(201, {
      vault: vaultJson({ id: vault.id, name: vault.name, role: 'owner', created_at: vault.created_at }),
    });
  });

  router.add('GET', '/api/vaults', async (ctx) => {
    const caller = await requireCaller(db, ctx);
    const vaults = await db.query<VaultRow>(
      `select v.id, v.name, m.role, v.created_at
         from vaults v join vault_members m on m.vault_id = v.id
        where m.account_id = $1
        order by v.created_at`,
      [caller.account.id],
    );
    return jsonReply(200, { vaults: vaults.map(vaultJson) });
  });

  router.add('GET', '/api/vaults/:vault_id', async (ctx) => {
    const caller = await requireCaller(db, ctx);
    const vault = await requireVaultMember(db, caller.account.id, ctx.params.vault_id);
    requireApprovedDevice(caller);
    const members = await db.query<{ display_name: string; role: string }>(
      `select a.display_name, m.role from vault_members m join accounts a on a.id = m.account_id
        where m.vault_id = $1 order by m.created_at`,
      [vault.id],
    );
    const head = await db.one<{ head: number | null }>('select max(rev) as head from revisions where vault_id = $1', [
      vault.id,
    ]);
    return jsonReply(200, {
      vault: vaultJson({ id: vault.id, name: vault.name, role: vault.role, created_at: vault.created_at }),
      key_envelope: vault.key_envelope,
      members: members.map((member) => ({ display_name: member.display_name, role: member.role })),
      head: head?.head ?? null,
    });
  });

  router.add('POST', '/api/vaults/:vault_id/invites', async (ctx) => {
    const caller = await requireCaller(db, ctx);
    const vault = await requireVaultMember(db, caller.account.id, ctx.params.vault_id);
    if (vault.role !== 'owner') {
      throw new ApiError(403, 'not_vault_owner', 'Only the vault owner can invite a partner.');
    }

    const body = (ctx.body ?? {}) as { email?: unknown };
    const email = validateEmail(body.email);
    if (email) throw validationFailed({ email });

    const token = newToken();
    const now = new Date();
    const expiresAt = addSeconds(now, services.config.timers.inviteTtlSeconds);
    const inviteId = newId();
    await db.query(
      'insert into vault_invites (id, vault_id, email, token_hash, created_at, expires_at) values ($1, $2, $3, $4, $5, $6)',
      [inviteId, vault.id, String(body.email).trim(), hashToken(token), now, expiresAt],
    );
    await services.mailer.send(
      inviteEmail(
        String(body.email).trim(),
        caller.account.display_name,
        `${services.config.publicUrl}/invites/${token}`,
        formatDisplayTime(expiresAt, caller.account.time_zone),
      ),
    );

    return jsonReply(201, {
      invite: { id: inviteId, email: String(body.email).trim(), expires_at: toIso(expiresAt) },
    });
  });

  router.add('POST', '/api/invites/:token/accept', async (ctx) => {
    const caller = await requireCaller(db, ctx);
    const tokenHash = hashToken(ctx.params.token ?? '');
    const invite = await db.one<{
      id: string;
      vault_id: string;
      email: string;
      expires_at: Date;
      used_at: Date | null;
      name: string;
      created_at: Date;
    }>(
      `select i.id, i.vault_id, i.email, i.expires_at, i.used_at, v.name, v.created_at
         from vault_invites i join vaults v on v.id = i.vault_id
        where i.token_hash = $1`,
      [tokenHash],
    );
    if (!invite) throw notFound();
    if (invite.email.toLowerCase() !== caller.account.email.toLowerCase()) {
      throw new ApiError(403, 'invite_email_mismatch', 'This invite was sent to a different email address.');
    }
    if (invite.used_at) throw new ApiError(409, 'link_used', 'This invite was already used.');
    if (invite.expires_at.getTime() <= Date.now()) {
      throw new ApiError(410, 'link_expired', 'This invite has expired.');
    }

    await db.transaction(async (client) => {
      await client.query('update vault_invites set used_at = now() where id = $1', [invite.id]);
      await client.query(
        `insert into vault_members (vault_id, account_id, role) values ($1, $2, 'partner')
           on conflict (vault_id, account_id) do nothing`,
        [invite.vault_id, caller.account.id],
      );
    });

    return jsonReply(200, {
      vault: vaultJson({ id: invite.vault_id, name: invite.name, role: 'partner', created_at: invite.created_at }),
    });
  });
}
