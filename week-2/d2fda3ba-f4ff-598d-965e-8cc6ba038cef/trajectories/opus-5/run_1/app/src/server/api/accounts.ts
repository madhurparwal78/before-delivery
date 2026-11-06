import { addSeconds, formatDisplayTime } from '../../shared/time';
import {
  validateDeviceName,
  validateDisplayName,
  validateEmail,
  validatePassword,
  validateTimeZone,
  type FieldErrors,
} from '../../shared/validation';
import {
  clearedSessionCookie,
  createSession,
  deleteSession,
  hashPassword,
  hashToken,
  newId,
  newToken,
  requireCaller,
  sessionCookie,
  verifyPassword,
  type AccountRow,
  type DeviceRow,
} from '../auth';
import { ApiError, notFound, validationFailed } from '../errors';
import { jsonReply, type Router } from '../http';
import { deviceApprovalEmail } from '../mail';
import { accountJson, deviceJson } from '../serialize';
import type { Services } from '../services';

interface AccountBody {
  email?: unknown;
  password?: unknown;
  display_name?: unknown;
  time_zone?: unknown;
  device_name?: unknown;
}

function deviceNameOf(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().slice(0, 40) : 'Browser';
}

async function sendApprovalEmail(services: Services, account: AccountRow, device: DeviceRow): Promise<void> {
  const token = newToken();
  const now = new Date();
  const expiresAt = addSeconds(now, services.config.timers.deviceApprovalTtlSeconds);
  await services.db.query(
    'insert into device_approvals (token_hash, device_id, created_at, expires_at) values ($1, $2, $3, $4)',
    [hashToken(token), device.id, now, expiresAt],
  );
  await services.mailer.send(
    deviceApprovalEmail(
      account.email,
      device.name,
      formatDisplayTime(now, account.time_zone),
      `${services.config.publicUrl}/devices/approve/${token}`,
      formatDisplayTime(expiresAt, account.time_zone),
    ),
  );
}

export function registerAccountRoutes(router: Router, services: Services): void {
  const { db } = services;

  router.add('GET', '/api/health', () => jsonReply(200, { status: 'ok' }));

  router.add('POST', '/api/accounts', async (ctx) => {
    const body = (ctx.body ?? {}) as AccountBody;

    if (typeof body.email === 'string') {
      const existing = await db.one<{ id: string }>('select id from accounts where lower(email) = lower($1)', [
        body.email.trim(),
      ]);
      if (existing) throw new ApiError(409, 'email_taken', 'An account already uses that email address.');
    }

    const fields: FieldErrors = {};
    const email = validateEmail(body.email);
    if (email) fields.email = email;
    const password = validatePassword(body.password);
    if (password) fields.password = password;
    const displayName = validateDisplayName(body.display_name);
    if (displayName) fields.display_name = displayName;
    const timeZone = validateTimeZone(body.time_zone);
    if (timeZone) fields.time_zone = timeZone;
    const deviceName = validateDeviceName(body.device_name);
    if (deviceName) fields.device_name = deviceName;
    if (Object.keys(fields).length > 0) throw validationFailed(fields);

    const accountId = newId();
    const account: AccountRow = {
      id: accountId,
      email: String(body.email).trim(),
      display_name: String(body.display_name).trim(),
      password_hash: await hashPassword(String(body.password)),
      time_zone: String(body.time_zone),
      operator: false,
    };
    await db.query(
      'insert into accounts (id, email, display_name, password_hash, time_zone, operator) values ($1, $2, $3, $4, $5, false)',
      [account.id, account.email, account.display_name, account.password_hash, account.time_zone],
    );
    const device = await db.one<DeviceRow>(
      'insert into devices (id, account_id, name, approved) values ($1, $2, $3, true) returning id, name, approved, created_at',
      [newId(), accountId, String(body.device_name).trim()],
    );
    if (!device) throw new ApiError(500, 'internal_error', 'Could not create the device.');
    const token = await createSession(db, accountId, device.id);

    return jsonReply(
      201,
      { account: accountJson(account), device: deviceJson(device) },
      { 'set-cookie': sessionCookie(token) },
    );
  });

  router.add('POST', '/api/sessions', async (ctx) => {
    const body = (ctx.body ?? {}) as {
      email?: unknown;
      password?: unknown;
      device_name?: unknown;
      device_id?: unknown;
    };
    const invalid = new ApiError(401, 'invalid_credentials', 'Wrong email or password.');
    if (typeof body.email !== 'string' || typeof body.password !== 'string') throw invalid;

    const account = await db.one<AccountRow>(
      'select id, email, display_name, password_hash, time_zone, operator from accounts where lower(email) = lower($1)',
      [body.email.trim()],
    );
    if (!account) throw invalid;
    if (!(await verifyPassword(body.password, account.password_hash))) throw invalid;

    const approved = await db.one<{ count: string }>(
      'select count(*)::text as count from devices where account_id = $1 and approved',
      [account.id],
    );
    const hasApprovedDevice = Number(approved?.count ?? '0') > 0;

    let device: DeviceRow | null = null;
    if (typeof body.device_id === 'string' && /^[0-9a-fA-F-]{36}$/.test(body.device_id)) {
      device = await db.one<DeviceRow>(
        'select id, name, approved, created_at from devices where id = $1 and account_id = $2',
        [body.device_id, account.id],
      );
    }
    if (!device) {
      device = await db.one<DeviceRow>(
        'insert into devices (id, account_id, name, approved) values ($1, $2, $3, $4) returning id, name, approved, created_at',
        [newId(), account.id, deviceNameOf(body.device_name), !hasApprovedDevice],
      );
    }
    if (!device) throw new ApiError(500, 'internal_error', 'Could not create the device.');

    if (!device.approved && !hasApprovedDevice) {
      await db.query('update devices set approved = true where id = $1', [device.id]);
      device = { ...device, approved: true };
    } else if (!device.approved) {
      await sendApprovalEmail(services, account, device);
    }

    const token = await createSession(db, account.id, device.id);
    return jsonReply(
      200,
      { account: accountJson(account), device: deviceJson(device) },
      { 'set-cookie': sessionCookie(token) },
    );
  });

  router.add('DELETE', '/api/sessions/current', async (ctx) => {
    await deleteSession(db, ctx);
    return { status: 204, headers: { 'set-cookie': clearedSessionCookie() } };
  });

  router.add('GET', '/api/me', async (ctx) => {
    const caller = await requireCaller(db, ctx);
    return jsonReply(200, { account: accountJson(caller.account), device: deviceJson(caller.device) });
  });

  router.add('GET', '/api/devices', async (ctx) => {
    const caller = await requireCaller(db, ctx);
    const devices = await db.query<DeviceRow>(
      'select id, name, approved, created_at from devices where account_id = $1 order by created_at',
      [caller.account.id],
    );
    return jsonReply(200, { devices: devices.map(deviceJson) });
  });

  router.add('POST', '/api/device-approvals/:token', async (ctx) => {
    const tokenHash = hashToken(ctx.params.token ?? '');
    const row = await db.one<{
      device_id: string;
      expires_at: Date;
      used_at: Date | null;
      name: string;
      created_at: Date;
    }>(
      `select a.device_id, a.expires_at, a.used_at, d.name, d.created_at
         from device_approvals a join devices d on d.id = a.device_id
        where a.token_hash = $1`,
      [tokenHash],
    );
    if (!row) throw notFound();
    if (row.used_at) throw new ApiError(409, 'link_used', 'This device is already approved.');
    if (row.expires_at.getTime() <= Date.now()) {
      throw new ApiError(410, 'link_expired', 'This approval link has expired.');
    }

    await db.query('update device_approvals set used_at = now() where token_hash = $1', [tokenHash]);
    await db.query('update devices set approved = true where id = $1', [row.device_id]);
    return jsonReply(200, {
      device: deviceJson({ id: row.device_id, name: row.name, approved: true, created_at: row.created_at }),
    });
  });
}
