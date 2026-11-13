// Grading routes: seeded workspaces and the per-workspace clock. Answer 404 when CORBEL_GRADING is off.
import { randomBytes, randomUUID } from 'node:crypto';
import { COPY } from '../shared/copy.ts';
import type { Units } from '../shared/types.ts';
import { createSession, createWorkspace, hashPassword } from './accounts.ts';
import { clearWorkspaceClock, DEFAULT_ZONE, isStudioZone, parseInstant, setWorkspaceClock } from './clock.ts';
import { config } from './config.ts';
import { isUuid, query, transaction } from './db.ts';
import { createDrawing } from './drawing-store.ts';
import { blankModel, studioPlanModel } from './engine/index.ts';
import { evaluateTimeEdges } from './events.ts';
import { HttpError, registerRoute, validation, type Handler } from './http.ts';

const DRAFTER = 'Ines Halloran';
const REVIEWER = 'Tomas Wren';
const PRESETS = ['blank', 'studio-plan'] as const;
const UNITS: readonly Units[] = ['mm', 'm'];
const DRAWING_NAME = 'Plan A.dxf';
const EMAIL_DOMAIN = 'corbel-grading.test';

const enabled = (handler: Handler): Handler => async (ctx) => {
  if (!config.grading) throw new HttpError(404, { error: 'not_found' });
  return handler(ctx);
};

async function requireWorkspace(id: string): Promise<void> {
  const found = isUuid(id) ? await query('SELECT 1 FROM workspaces WHERE id = $1', [id]) : [];
  if (found.length === 0) throw new HttpError(404, { error: 'not_found' });
}

export function registerGradingRoutes(): void {
  registerRoute('POST', '/api/grading/workspaces', enabled(async (ctx) => {
    const body = await ctx.json();
    const preset = body.preset;
    const zone = body.time_zone ?? DEFAULT_ZONE;
    const units = body.units ?? 'mm';
    const errors: Record<string, string> = {};
    if (!PRESETS.some((known) => known === preset)) errors.preset = 'Choose blank or studio-plan.';
    if (!isStudioZone(zone)) errors.time_zone = COPY.timeZoneInvalid;
    if (!UNITS.some((known) => known === units)) errors.units = 'Choose mm or m.';
    if (Object.keys(errors).length > 0 || !isStudioZone(zone)) throw validation(errors);
    const model = preset === 'blank' ? blankModel(units as Units) : studioPlanModel(units as Units);
    const password = randomBytes(15).toString('base64url');
    const passwordHash = await hashPassword(password);
    const at = new Date();
    const drafter = { name: DRAFTER, email: `${randomBytes(9).toString('hex')}@${EMAIL_DOMAIN}`, password };
    const reviewer = { name: REVIEWER, email: `${randomBytes(9).toString('hex')}@${EMAIL_DOMAIN}` };
    const created = await transaction(async (client) => {
      const { workspaceId, rootFolderId } = await createWorkspace(client, zone, at);
      const userId = randomUUID();
      await client.query(
        `INSERT INTO users (id, workspace_id, name, email, email_key, password_hash, time_zone, verified, confirmed_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $8)`,
        [userId, workspaceId, drafter.name, drafter.email, drafter.email, passwordHash, zone, at],
      );
      const drawingId = await createDrawing(client, { workspaceId, folderId: rootFolderId, name: DRAWING_NAME, model, at });
      const { rows } = await client.query<{ version: number }>('SELECT version FROM drawings WHERE id = $1', [drawingId]);
      return { workspaceId, drawingId, version: rows[0]?.version ?? 1, session: await createSession(client, userId) };
    });
    return {
      status: 201,
      body: {
        workspace_id: created.workspaceId,
        drafter,
        reviewer,
        session: { name: 'corbel_session', value: created.session },
        drawing: { id: created.drawingId, name: DRAWING_NAME, url: `${config.publicUrl}/d/${created.drawingId}`, version: created.version },
      },
    };
  }), { anonymous: true });

  registerRoute('PUT', '/api/grading/workspaces/:id/clock', enabled(async (ctx) => {
    const id = ctx.params.id ?? '';
    await requireWorkspace(id);
    const now = parseInstant((await ctx.json()).now);
    if (!now) throw validation({ now: 'Enter a time in ISO 8601 form, for example 2027-02-01T20:00:00Z.' });
    await setWorkspaceClock(id, now);
    void evaluateTimeEdges();
    return { status: 200, body: { now: now.toISOString() } };
  }), { anonymous: true });

  registerRoute('DELETE', '/api/grading/workspaces/:id/clock', enabled(async (ctx) => {
    const id = ctx.params.id ?? '';
    await requireWorkspace(id);
    await clearWorkspaceClock(id);
    void evaluateTimeEdges();
    return { status: 204 };
  }), { anonymous: true });
}
