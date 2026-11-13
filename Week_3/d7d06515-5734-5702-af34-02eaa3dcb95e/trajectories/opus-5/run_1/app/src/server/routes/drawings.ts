import { copy } from '../../shared/copy';
import { DRAWING_COMMANDS } from '../../shared/commands';
import { formatAngle, formatLength, type Units } from '../../shared/format';
import { angleOf, distance, round6, sub } from '../geometry';
import { config } from '../config';
import { callerFromSession, requireCaller } from '../accounts';
import { assertBaseWrite, resolveDrawingCaller } from '../access';
import { runCommand } from '../commands';
import { query } from '../db';
import { fail, ValidationError } from '../errors';
import { loadDrawingState, serializeDrawing } from '../drawings';
import { openAccountStream, openDrawingStream, publishDrawing } from '../live';
import { recordPresenceInput } from '../bus';
import { json, noContent, type Router } from '../http';
import type { Point } from '../../shared/api';

function readPoint(body: Record<string, unknown>, field: string): Point {
  const value = body[field];
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    typeof value[0] !== 'number' ||
    typeof value[1] !== 'number' ||
    !Number.isFinite(value[0]) ||
    !Number.isFinite(value[1])
  ) {
    throw new ValidationError({ [field]: copy.history.invalidPoint });
  }
  return [value[0] as number, value[1] as number];
}

/** The DIST line, in the drawing's units. */
export function measureText(first: Point, second: Point, units: Units): string {
  const delta = sub(second, first);
  return [
    `Distance = ${formatLength(distance(first, second), units)}`,
    `Angle in XY Plane = ${formatAngle(angleOf(delta))}`,
    `Delta X = ${formatLength(delta[0], units)}`,
    `Delta Y = ${formatLength(delta[1], units)}`,
  ].join(', ');
}

export function registerDrawingRoutes(router: Router): void {
  router.add('GET', '/api/drawings/:id', async (context) => {
    const caller = await resolveDrawingCaller(context, context.params.id!);
    const state = await loadDrawingState(caller.drawing.id);
    if (state === null) fail('not_found');
    return json(200, await serializeDrawing(state, caller.access, caller.ownerName));
  });

  router.add('POST', '/api/drawings/:id/commands', async (context) => {
    const caller = await resolveDrawingCaller(context, context.params.id!);
    const body = await context.json();
    assertBaseWrite(caller);
    const command = typeof body.command === 'string' ? body.command : '';
    if (!(DRAWING_COMMANDS as readonly string[]).includes(command)) {
      throw new ValidationError({ command: 'Unknown command.' });
    }
    const baseVersion = typeof body.base_version === 'number' ? body.base_version : -1;
    const outcome = await runCommand({
      drawingId: caller.drawing.id,
      actor: caller.actor,
      baseVersion,
      command,
      args: body.args ?? {},
      zone: caller.workspace.time_zone,
      now: caller.now,
    });
    if (outcome.changed.length > 0 || outcome.version !== baseVersion) {
      await publishDrawing(caller.drawing.id, {
        type: 'change',
        version: outcome.version,
        changed: outcome.changed,
        actor: caller.actor.name,
        command,
      });
      if (outcome.activity !== null) {
        await publishDrawing(caller.drawing.id, { type: 'activity', entry: outcome.activity });
      }
    }
    return json(200, {
      version: outcome.version,
      created: outcome.created,
      modified: outcome.modified,
      erased: outcome.erased,
      locked: outcome.locked,
      objects: outcome.objects,
      history: outcome.history,
    });
  });

  router.add('POST', '/api/drawings/:id/measure', async (context) => {
    const caller = await resolveDrawingCaller(context, context.params.id!);
    const body = await context.json();
    const first = readPoint(body, 'first');
    const second = readPoint(body, 'second');
    const units = caller.drawing.units;
    const delta = sub(second, first);
    return json(200, {
      distance: round6(distance(first, second)),
      angle: round6(angleOf(delta)),
      delta_x: round6(delta[0]),
      delta_y: round6(delta[1]),
      text: measureText(first, second, units),
    });
  });

  router.add('GET', '/api/drawings/:id/activity', async (context) => {
    const caller = await resolveDrawingCaller(context, context.params.id!);
    const rows = await query<{
      at: Date;
      actor: string;
      command: string;
      count: number;
      verb: 'created' | 'modified' | 'erased';
      text: string;
    }>(
      'select at, actor, command, count, verb, text from activity where drawing_id = $1 order by id desc limit 50',
      [caller.drawing.id],
    );
    return json(200, {
      entries: rows.map((row) => ({
        at: row.at.toISOString(),
        actor: row.actor,
        command: row.command,
        count: row.count,
        verb: row.verb,
        text: row.text,
      })),
    });
  });

  router.add('POST', '/api/drawings/:id/presence', async (context) => {
    const caller = await resolveDrawingCaller(context, context.params.id!);
    const body = await context.json();
    const tabId = typeof body.tab_id === 'string' ? body.tab_id : '';
    if (tabId === '') throw new ValidationError({ tab_id: 'Missing tab id.' });
    await recordPresenceInput(
      caller.drawing.id,
      tabId,
      caller.actor.key,
      caller.actor.name,
      caller.access,
      caller.now,
    );
    return noContent();
  });

  router.add('GET', '/api/drawings/:id/events', async (context) => {
    const caller = await resolveDrawingCaller(context, context.params.id!);
    return openDrawingStream(context, {
      drawingId: caller.drawing.id,
      workspace: caller.workspace,
      actorKey: caller.actor.key,
      share: caller.share,
      ownerUserId: caller.drawing.owner_user_id,
      tabId: context.query('tab'),
    });
  });

  router.add('GET', '/api/events', async (context) => {
    const caller = requireCaller(await callerFromSession(context.cookie(config.sessionCookie)));
    return openAccountStream(context, caller.user.id, caller.workspace.id);
  });
}
