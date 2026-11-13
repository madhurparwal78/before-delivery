import crypto from 'node:crypto';
import { STUDIO_TIME_ZONES } from '../../shared/api';
import { config } from '../config';
import { formatIsoDate } from '../../shared/format';
import { applyPreset, createWorkspace, insertDrawing, type Preset } from '../workspaces';
import { createSession, findWorkspace, hashPassword } from '../accounts';
import { queryOn, query, transaction } from '../db';
import { fail, ValidationError } from '../errors';
import { json, noContent, type Router } from '../http';
import { providerStatus } from '../health';

function gradingEnabled(): void {
  if (!config.gradingEnabled) fail('not_found');
}

export function registerGradingRoutes(router: Router): void {
  router.add('GET', '/api/health', async () => {
    const status = providerStatus();
    const ok = status.postgres && status.minio && status.mailpit && status.valkey;
    return json(200, { status: ok ? 'ok' : 'unavailable' });
  });

  router.add('POST', '/api/grading/workspaces', async (context) => {
    gradingEnabled();
    const body = await context.json();
    const errors: Record<string, string> = {};
    const preset = body.preset === undefined ? 'blank' : body.preset;
    if (preset !== 'blank' && preset !== 'studio-plan') errors.preset = 'Unknown preset.';
    const timeZone = body.time_zone === undefined ? 'UTC' : body.time_zone;
    if (typeof timeZone !== 'string' || !(STUDIO_TIME_ZONES as readonly string[]).includes(timeZone)) {
      errors.time_zone = 'Unknown time zone.';
    }
    const units = body.units === undefined ? 'mm' : body.units;
    if (units !== 'mm' && units !== 'm') errors.units = 'Unknown units.';
    if (Object.keys(errors).length > 0) throw new ValidationError(errors);

    const now = new Date();
    const zone = timeZone as string;
    const today = formatIsoDate(now, zone);
    const suffix = crypto.randomBytes(6).toString('hex');
    const drafterEmail = `ines.halloran.${suffix}@corbel-grading.test`;
    const reviewerEmail = `tomas.wren.${suffix}@corbel-grading.test`;
    const password = crypto.randomBytes(12).toString('base64url');
    const passwordHash = await hashPassword(password);

    const created = await transaction(async (client) => {
      const seed = await createWorkspace(client, zone, units as 'mm' | 'm', now, today);
      const userRows = await queryOn<{ id: string }>(
        client,
        `insert into users (id, workspace_id, name, email, password_hash, verified, confirmed_on, created_at)
         values ($1,$2,'Ines Halloran',$3,$4,true,$5,$6) returning id`,
        [crypto.randomUUID(), seed.workspace.id, drafterEmail, passwordHash, today, now],
      );
      const userId = userRows[0]!.id;
      const drawingId = await insertDrawing(client, {
        workspaceId: seed.workspace.id,
        folderId: seed.rootFolderId,
        name: 'Plan A.dxf',
        units: units as 'mm' | 'm',
        ownerUserId: userId,
        now,
      });
      await applyPreset(client, drawingId, preset as Preset);
      await client.query('update drawings set owner_user_id = $2 where id = $1', [drawingId, userId]);
      return { workspaceId: seed.workspace.id, userId, drawingId };
    });

    const sessionToken = await createSession(created.userId, now);
    return json(201, {
      workspace_id: created.workspaceId,
      drafter: { name: 'Ines Halloran', email: drafterEmail, password },
      reviewer: { name: 'Tomas Wren', email: reviewerEmail },
      session: { name: config.sessionCookie, value: sessionToken },
      drawing: {
        id: created.drawingId,
        name: 'Plan A.dxf',
        url: `${config.publicUrl}/d/${created.drawingId}`,
        version: 1,
      },
    });
  });

  router.add('PUT', '/api/grading/workspaces/:id/clock', async (context) => {
    gradingEnabled();
    const workspace = await findWorkspace(context.params.id!);
    if (workspace === null) fail('not_found');
    const body = await context.json();
    const raw = typeof body.now === 'string' ? body.now : '';
    const instant = raw === '' ? null : new Date(raw);
    if (instant === null || Number.isNaN(instant.getTime())) {
      throw new ValidationError({ now: 'Enter an ISO 8601 instant.' });
    }
    await query('update workspaces set clock_set_real = $2, clock_set_now = $3 where id = $1', [
      workspace.id,
      new Date(),
      instant,
    ]);
    return json(200, { now: instant.toISOString() });
  });

  router.add('DELETE', '/api/grading/workspaces/:id/clock', async (context) => {
    gradingEnabled();
    const workspace = await findWorkspace(context.params.id!);
    if (workspace === null) fail('not_found');
    await query('update workspaces set clock_set_real = null, clock_set_now = null where id = $1', [workspace.id]);
    return noContent();
  });
}

