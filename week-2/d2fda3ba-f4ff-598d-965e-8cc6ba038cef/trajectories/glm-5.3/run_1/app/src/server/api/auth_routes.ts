import { ApiError, type Ctx } from '../api_types';
import { q, tx } from '../db';
import { hashPassword, verifyPassword, newToken, tokenHash } from '../crypt';
import { config } from '../config';
import { deviceApprovalEmail, inviteEmail } from '../mail';
import { isUuid } from '../../shared/domain';
import {
  accountOf, requireAccount, withDeviceApproved, vaultFor, deviceJson, vaultJson,
  whenInZone,
} from './core';
import { readAddon } from '../billing';

export interface Route {
  method: string;
  pattern: RegExp;
  handler: (ctx: Ctx, params: string[]) => Promise<{ status: number; body?: unknown; headers?: Record<string, string> } | undefined>;
  limit?: number;
}

export const routes: Route[] = [];

export const route = (
  method: string,
  pattern: string,
  handler: (ctx: Ctx, params: string[]) => Promise<{ status: number; body?: unknown; headers?: Record<string, string> } | undefined>,
  opts?: { limit?: number },
): void => {
  const names: string[] = [];
  const rx = pattern.replace(/<(\w+)>/g, (_m, name: string) => {
    names.push(name);
    return '([^/]+)';
  });
  routes.push({
    method,
    pattern: new RegExp(`^${rx}$`),
    handler: (ctx, params) => {
      void names;
      return handler(ctx, params);
    },
    ...opts,
  });
};

const bad = (fields: Record<string, string>): ApiError =>
  new ApiError('validation_failed', 'Check the highlighted fields.', { fields });

const decode = (s: unknown): string => (typeof s === 'string' ? s : '');
const lenCheck = (s: string, min: number, max: number, name: string, fields: Record<string, string>): boolean => {
  if (s.length < min || s.length > max) {
    fields[name] = `must be ${min} to ${max} characters`;
    return false;
  }
  return true;
};

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const validTimeZone = (tz: string): boolean => {
  if (!/^[A-Za-z0-9_+\-/]+$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

// ---- Health ----
route('GET', '/api/health', async () => ({ status: 200, body: { status: 'ok' } }));

// ---- Accounts, sessions, devices ----
route('POST', '/api/accounts', async (ctx) => {
  const b = (ctx.body?.json() ?? {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};
  const email = decode(b.email).trim();
  const password = decode(b.password);
  const displayName = decode(b.display_name);
  const timeZone = decode(b.time_zone);
  const deviceName = decode(b.device_name);
  let ok = true;
  if (!EMAIL_RE.test(email) || email.length > 254) { fields.email = 'must be a valid address, up to 254 characters'; ok = false; }
  if (password.length < 10 || password.length > 128) { fields.password = 'must be 10 to 128 characters'; ok = false; }
  if (!lenCheck(displayName, 1, 60, 'display_name', fields)) ok = false;
  if (!validTimeZone(timeZone)) { fields.time_zone = 'must be an IANA zone name'; ok = false; }
  if (!lenCheck(deviceName, 1, 40, 'device_name', fields)) ok = false;
  if (!ok) throw bad(fields);
  const existing = await q('select 1 from accounts where email = $1', [email]);
  if (existing.rows.length) throw new ApiError('email_taken', 'An account with this email already exists.');
  const passwordHash = await hashPassword(password);
  const created = await tx(async (client) => {
    const acc = await client.query<{ id: string; email: string; display_name: string; time_zone: string; operator: boolean }>(
      'insert into accounts(email, password_hash, display_name, time_zone, operator) values ($1, $2, $3, $4, false) returning id, email, display_name, time_zone, operator',
      [email, passwordHash, displayName, timeZone],
    );
    const account = acc.rows[0];
    const dev = await client.query<{ id: string; name: string; approved: boolean; created_at: Date }>(
      'insert into devices(account_id, name, approved) values ($1, $2, true) returning id, name, approved, created_at',
      [account.id, deviceName],
    );
    const token = newToken(32);
    await client.query('insert into sessions(token, account_id, device_id) values ($1, $2, $3)', [tokenHash(token), account.id, dev.rows[0].id]);
    return { account, device: dev.rows[0], token };
  });
  ctx.setCookie(`cairn_session=${created.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=15552000`);
  return {
    status: 201,
    body: {
      account: {
        id: created.account.id, email: created.account.email, display_name: created.account.display_name,
        time_zone: created.account.time_zone, operator: created.account.operator,
      },
      device: deviceJson(created.device),
    },
  };
});

route('POST', '/api/sessions', async (ctx) => {
  const b = (ctx.body?.json() ?? {}) as Record<string, unknown>;
  const email = decode(b.email).trim();
  const password = decode(b.password);
  const deviceName = decode(b.device_name);
  const deviceId = decode(b.device_id);
  const acc = await q<{ id: string; email: string; display_name: string; time_zone: string; operator: boolean; password_hash: string }>(
    'select id, email, display_name, time_zone, operator, password_hash from accounts where email = $1',
    [email],
  );
  const account = acc.rows[0];
  if (!account || !(await verifyPassword(password, account.password_hash)))
    throw new ApiError('invalid_credentials', 'Wrong email or password.');
  let device: { id: string; name: string; approved: boolean; created_at: Date };
  if (deviceId && isUuid(deviceId)) {
    const existing = await q<{ id: string; name: string; approved: boolean; created_at: Date }>(
      'select id, name, approved, created_at from devices where id = $1 and account_id = $2',
      [deviceId, account.id],
    );
    if (existing.rows[0]) device = existing.rows[0];
    else device = (await q<{ id: string; name: string; approved: boolean; created_at: Date }>(
      'insert into devices(account_id, name, approved) values ($1, $2, false) returning id, name, approved, created_at',
      [account.id, deviceName],
    )).rows[0];
  } else {
    device = (await q<{ id: string; name: string; approved: boolean; created_at: Date }>(
      'insert into devices(account_id, name, approved) values ($1, $2, false) returning id, name, approved, created_at',
      [account.id, deviceName],
    )).rows[0];
  }
  if (!device.approved) {
    const approvedCount = await q<{ n: string }>(
      'select count(*)::text as n from devices where account_id = $1 and approved', [account.id],
    );
    if (Number(approvedCount.rows[0]?.n ?? 0) === 0) {
      await q('update devices set approved = true where id = $1', [device.id]);
      device = { ...device, approved: true };
    } else {
      const approvalToken = newToken(32);
      const expiresAt = new Date(Date.now() + config.timers.deviceApprovalTtl * 1000);
      await q(
        'insert into device_approvals(token, device_id, account_id, expires_at) values ($1, $2, $3, $4)',
        [tokenHash(approvalToken), device.id, account.id, expiresAt],
      );
      await deviceApprovalEmail(
        account.email, device.name,
        `${config.publicUrl}/devices/approve/${approvalToken}`, expiresAt,
        whenInZone(new Date(), account.time_zone),
      );
    }
  }
  const token = newToken(32);
  await q('insert into sessions(token, account_id, device_id) values ($1, $2, $3)', [tokenHash(token), account.id, device.id]);
  ctx.setCookie(`cairn_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=15552000`);
  return {
    status: 200,
    body: {
      account: {
        id: account.id, email: account.email, display_name: account.display_name,
        time_zone: account.time_zone, operator: account.operator,
      },
      device: deviceJson(device),
    },
  };
});

route('DELETE', '/api/sessions/current', async (ctx) => {
  const token = ctx.cookies['cairn_session'];
  if (token) await q('delete from sessions where token = $1', [tokenHash(token)]);
  ctx.setCookie('cairn_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  return { status: 204 };
});

route('GET', '/api/me', async (ctx) => {
  const a = await accountOf(ctx);
  if (!a) throw new ApiError('unauthenticated', 'Sign in to continue.');
  const withDevice = a as unknown as { device_id: string };
  const device = await q<{ id: string; name: string; approved: boolean; created_at: Date }>(
    'select id, name, approved, created_at from devices where id = $1', [withDevice.device_id],
  );
  return {
    status: 200,
    body: {
      account: { id: a.id, email: a.email, display_name: a.display_name, time_zone: a.time_zone, operator: a.operator },
      device: deviceJson(device.rows[0]),
    },
  };
});

route('GET', '/api/devices', async (ctx) => {
  const a = await accountOf(ctx);
  if (!a) throw new ApiError('unauthenticated', 'Sign in to continue.');
  const devices = await q<{ id: string; name: string; approved: boolean; created_at: Date }>(
    'select id, name, approved, created_at from devices where account_id = $1 order by created_at',
    [a.id],
  );
  return { status: 200, body: { devices: devices.rows.map(deviceJson) } };
});

route('POST', '/api/device-approvals/<token>', async (_ctx, params) => {
  const token = params[0];
  const r = await q<{ device_id: string; expires_at: Date; used: boolean }>(
    'select device_id, expires_at, used from device_approvals where token = $1', [tokenHash(token)],
  );
  const row = r.rows[0];
  if (!row) throw new ApiError('not_found', 'This approval link does not exist.');
  if (row.used) throw new ApiError('link_used', 'This device is already approved.');
  if (row.expires_at.getTime() < Date.now())
    throw new ApiError('link_expired', 'This approval link has expired. Sign in again on the new device to get a fresh one.');
  await tx(async (client) => {
    await client.query('update device_approvals set used = true where token = $1', [tokenHash(token)]);
    await client.query('update devices set approved = true where id = $1', [row.device_id]);
  });
  const dev = await q<{ id: string; name: string; approved: boolean; created_at: Date }>(
    'select id, name, approved, created_at from devices where id = $1', [row.device_id],
  );
  return { status: 200, body: { device: deviceJson(dev.rows[0]) } };
});

// ---- Vaults ----
route('POST', '/api/vaults', async (ctx) => {
  const account = requireAccount(ctx);
  await withDeviceApproved(ctx.deviceId as string);
  const b = (ctx.body?.json() ?? {}) as { name?: unknown; key_envelope?: unknown };
  const fields: Record<string, string> = {};
  const name = decode(b.name);
  const envelope = b.key_envelope as Record<string, unknown> | undefined;
  if (name.length < 1 || name.length > 80) fields.name = 'must be 1 to 80 characters';
  const envOk = envelope && typeof envelope === 'object'
    && typeof envelope.salt === 'string' && typeof envelope.iv === 'string'
    && typeof envelope.wrapped_key === 'string' && typeof envelope.iterations === 'number';
  if (!envOk) fields.key_envelope = 'must include salt, iterations, iv and wrapped_key';
  if (Object.keys(fields).length) throw bad(fields);
  const sync = await readAddon(account.id, 'sync');
  if (sync.source === 'cache' && sync.state === 'none') throw new ApiError('billing_unavailable', 'Billing is unavailable. Try again shortly.');
  if (sync.state !== 'active') throw new ApiError('sync_not_entitled', 'Creating a vault needs the Sync add-on.');
  const created = await tx(async (client) => {
    const v = await client.query<{ id: string; created_at: Date }>(
      'insert into vaults(owner_id, name) values ($1, $2) returning id, created_at', [account.id, name],
    );
    await client.query('insert into vault_members(vault_id, account_id, role) values ($1, $2, $3)', [v.rows[0].id, account.id, 'owner']);
    await client.query(
      'insert into key_envelopes(vault_id, salt, iterations, iv, wrapped_key) values ($1, $2, $3, $4, $5)',
      [v.rows[0].id, String(envelope?.salt), Number(envelope?.iterations), String(envelope?.iv), String(envelope?.wrapped_key)],
    );
    return v.rows[0];
  });
  return { status: 201, body: { vault: vaultJson(created.id, name, 'owner', created.created_at) } };
});

route('GET', '/api/vaults', async (ctx) => {
  const account = requireAccount(ctx);
  const rows = await q<{ id: string; name: string; role: string; created_at: Date }>(
    `select v.id, v.name, m.role, v.created_at from vault_members m join vaults v on v.id = m.vault_id
     where m.account_id = $1 order by v.created_at`,
    [account.id],
  );
  return { status: 200, body: { vaults: rows.rows.map((r) => vaultJson(r.id, r.name, r.role as 'owner' | 'partner', r.created_at)) } };
});

route('GET', '/api/vaults/<vault_id>', async (ctx, params) => {
  const account = requireAccount(ctx);
  const vaultId = params[0];
  await vaultFor(account.id, vaultId);
  await withDeviceApproved(ctx.deviceId as string);
  const vault = await vaultFor(account.id, vaultId);
  const env = await q<{ salt: string; iterations: number; iv: string; wrapped_key: string }>(
    'select salt, iterations, iv, wrapped_key from key_envelopes where vault_id = $1', [vaultId],
  );
  const members = await q<{ display_name: string; role: string }>(
    'select a.display_name, m.role from vault_members m join accounts a on a.id = m.account_id where m.vault_id = $1',
    [vaultId],
  );
  const head = await q<{ rev: number }>('select max(rev) as rev from revisions where vault_id = $1', [vaultId]);
  const myRole = await q<{ role: string }>(
    'select role from vault_members where vault_id = $1 and account_id = $2', [vaultId, account.id],
  );
  return {
    status: 200,
    body: {
      vault: vaultJson(vault.id, vault.name, (myRole.rows[0]?.role as 'owner' | 'partner') ?? 'owner', vault.created_at),
      key_envelope: env.rows[0] ? { salt: env.rows[0].salt, iterations: env.rows[0].iterations, iv: env.rows[0].iv, wrapped_key: env.rows[0].wrapped_key } : null,
      members: members.rows,
      head: head.rows[0]?.rev ?? null,
    },
  };
});

route('POST', '/api/vaults/<vault_id>/invites', async (ctx, params) => {
  const account = requireAccount(ctx);
  const vaultId = params[0];
  const vault = await vaultFor(account.id, vaultId);
  const membership = await q<{ role: string }>(
    'select role from vault_members where vault_id = $1 and account_id = $2', [vaultId, account.id],
  );
  if (membership.rows[0]?.role !== 'owner') throw new ApiError('not_vault_owner', 'Only the vault owner can invite.');
  const b = (ctx.body?.json() ?? {}) as { email?: unknown };
  const email = decode(b.email).trim();
  const fields: Record<string, string> = {};
  if (!EMAIL_RE.test(email) || email.length > 254) fields.email = 'must be a valid address';
  if (Object.keys(fields).length) throw bad(fields);
  const token = newToken(32);
  const expiresAt = new Date(Date.now() + config.timers.inviteTtl * 1000);
  await q('insert into invites(token, vault_id, email, expires_at) values ($1, $2, $3, $4)', [tokenHash(token), vault.id, email, expiresAt]);
  await inviteEmail(email, account.display_name || account.email, `${config.publicUrl}/invites/${token}`, expiresAt);
  return {
    status: 201,
    body: { invite: { id: newToken(8), email, expires_at: expiresAt.toISOString().replace(/\.\d{3}Z$/, 'Z') } },
  };
});

route('POST', '/api/invites/<token>/accept', async (ctx, params) => {
  const account = requireAccount(ctx);
  const token = params[0];
  const r = await q<{ id: string; vault_id: string; email: string; expires_at: Date; used: boolean }>(
    'select id, vault_id, email, expires_at, used from invites where token = $1', [tokenHash(token)],
  );
  const row = r.rows[0];
  if (!row) throw new ApiError('not_found', 'This invite does not exist.');
  if (row.used) throw new ApiError('link_used', 'This invite has already been used.');
  if (row.expires_at.getTime() < Date.now()) throw new ApiError('link_expired', 'This invite has expired.');
  if (row.email.toLowerCase() !== account.email.toLowerCase())
    throw new ApiError('invite_email_mismatch', 'This invite was sent to a different email address.');
  await tx(async (client) => {
    await client.query('update invites set used = true where id = $1', [row.id]);
    await client.query('insert into vault_members(vault_id, account_id, role) values ($1, $2, $3) on conflict do nothing', [row.vault_id, account.id, 'partner']);
  });
  const v = await q<{ id: string; name: string; owner_id: string; created_at: Date }>(
    'select id, name, owner_id, created_at from vaults where id = $1', [row.vault_id],
  );
  return { status: 200, body: { vault: vaultJson(v.rows[0].id, v.rows[0].name, 'partner', v.rows[0].created_at) } };
});
