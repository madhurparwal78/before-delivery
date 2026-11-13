import {
  CHAPTERS,
  DEFAULT_FINISH,
  DEFAULT_HUB,
  DEFAULT_MODEL,
  FINISHES,
  HUBS,
  MODELS,
  isFinishId,
  isHubId,
  isModelId,
  type FinishId,
  type HubId,
  type ModelId,
} from '../../shared/catalogue.js';
import { isCalendarDate, istDate, istDaysBetween, labelDay } from '../clock.js';
import { appNow } from '../clock.js';
import { fail } from '../errors.js';
import type { Reply, RequestContext } from '../http.js';
import { liveReading } from '../domain/reading.js';
import { rideDays } from '../domain/calendar.js';
import { slotsForDay } from '../domain/views.js';
import type { Caller } from '../auth.js';

export interface Selection {
  hub: HubId;
  model: ModelId;
  finish: FinishId;
}

/** Query values fall back exactly as the URL state rules say; unknown ones are refused. */
export function selectionFromQuery(ctx: RequestContext): Selection {
  const hub = ctx.queryOf('hub');
  const model = ctx.queryOf('model');
  const finish = ctx.queryOf('finish');
  if (hub !== null && !isHubId(hub)) fail('invalid_body');
  if (model !== null && !isModelId(model)) fail('invalid_body');
  if (finish !== null && !isFinishId(finish)) fail('invalid_body');
  return {
    hub: (hub as HubId | null) ?? DEFAULT_HUB,
    model: (model as ModelId | null) ?? DEFAULT_MODEL,
    finish: (finish as FinishId | null) ?? DEFAULT_FINISH,
  };
}

export function health(): Reply {
  return { status: 200, json: { status: 'ok' } };
}

export function catalogue(): Reply {
  return {
    status: 200,
    json: {
      models: MODELS.map((m) => ({ id: m.id, name: m.name, cc: m.cc })),
      finishes: FINISHES.map((f) => ({ id: f.id, name: f.name })),
      hubs: HUBS.map((h) => ({ id: h.id, name: h.name })),
      chapters: CHAPTERS.map((c) => ({
        id: c.id,
        name: c.name,
        parts: c.parts.map((p) => ({ id: p.id, name: p.name })),
      })),
    },
  };
}

export async function liveNow(ctx: RequestContext, caller: Caller | null): Promise<Reply> {
  const selection = selectionFromQuery(ctx);
  const reading = await liveReading(
    selection.hub,
    selection.model,
    selection.finish,
    caller?.user.role === 'rider' ? caller.user.id : null,
  );
  return { status: 200, json: reading };
}

export async function hubSlots(ctx: RequestContext): Promise<Reply> {
  const hub = ctx.params.hub;
  if (!isHubId(hub)) fail('not_found');
  const date = ctx.queryOf('date');
  if (!isCalendarDate(date)) fail('invalid_body');
  const now = appNow();
  const delta = istDaysBetween(istDate(now), date);
  if (delta < 0 || delta > 14) {
    return {
      status: 200,
      json: { date, dayLabel: labelDay(date, now), open: false, slots: [] },
    };
  }
  const { open, slots } = await slotsForDay(hub, date, now);
  return { status: 200, json: { date, dayLabel: labelDay(date, now), open, slots } };
}

export function hubRideDays(ctx: RequestContext): Reply {
  const hub = ctx.params.hub;
  if (!isHubId(hub)) fail('not_found');
  return { status: 200, json: { days: rideDays(hub, appNow()) } };
}
