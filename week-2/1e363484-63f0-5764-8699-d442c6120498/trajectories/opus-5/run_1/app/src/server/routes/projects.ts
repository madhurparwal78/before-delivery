import { percent, tonnes } from '../../domain/decimal';
import { derive } from '../../domain/derivation';
import { DAY_MS, formatDate, formatTimestamp, parseDate } from '../../domain/time';
import { pool } from '../db/pool';
import { loadSummary } from '../figures';
import { bodyField, sendJson } from '../http/context';
import { ValidationError } from '../http/errors';
import { requirePerson, requireProject } from '../http/guards';
import type { Route } from '../http/router';
import { validateIntervalRequest } from '../intervals';
import { previewJson, projectListJson, summaryJson } from '../presenters';
import {
  effectiveRole,
  loadAllProjects,
  loadGrants,
  loadReadings,
  loadRecordBounds,
  shapeOf,
} from '../projects';
import { loadIntactIntervals, previewBlock } from '../seal';

export const projectRoutes: readonly Route[] = [
  {
    method: 'GET',
    path: '/api/projects',
    handler: async (context) => {
      const person = await requirePerson(pool, context);
      const grants = await loadGrants(pool, person.id);
      const projects = await loadAllProjects(pool);
      const visible = [];
      for (const project of projects) {
        const role = effectiveRole(person, grants.get(project.slug));
        if (role === null) continue;
        visible.push(projectListJson(project, role, await loadSummary(pool, project.slug)));
      }
      sendJson(context, 200, { projects: visible });
    },
  },
  {
    method: 'GET',
    path: '/api/projects/:slug',
    handler: async (context) => {
      const person = await requirePerson(pool, context);
      const { project, role } = await requireProject(pool, person, context.params.slug!);
      const bounds = await loadRecordBounds(pool, project.slug);
      sendJson(context, 200, {
        slug: project.slug,
        name: project.name,
        kind: project.kind,
        code: project.code,
        floor_pct: percent(project.floorPct),
        buffer_pct: percent(project.bufferPct),
        lead_person_id: project.leadPersonId,
        boundary: project.boundary,
        boundary_area_m2: Number(project.boundaryAreaM2),
        sensors: project.sensors.map((sensor) => ({
          id: sensor.id,
          kind: sensor.kind,
          polygon: sensor.polygon,
        })),
        record_start: bounds.startMs === null ? null : formatTimestamp(bounds.startMs),
        record_end: bounds.endMs === null ? null : formatTimestamp(bounds.endMs),
        role,
        summary: summaryJson(await loadSummary(pool, project.slug)),
      });
    },
  },
  {
    method: 'GET',
    path: '/api/projects/:slug/timeline',
    handler: async (context) => {
      const person = await requirePerson(pool, context);
      const { project } = await requireProject(pool, person, context.params.slug!);
      const bounds = await loadRecordBounds(pool, project.slug);
      const errors: Record<string, string> = {};
      const fromRaw = context.query.get('from');
      const toRaw = context.query.get('to');
      const fromDay = fromRaw === null ? null : parseDate(fromRaw);
      const toDay = toRaw === null ? null : parseDate(toRaw);
      if (fromRaw !== null && fromDay === null) errors.from = 'Give from as YYYY-MM-DD.';
      if (toRaw !== null && toDay === null) errors.to = 'Give to as YYYY-MM-DD.';
      if (fromDay !== null && toDay !== null && fromDay > toDay) {
        errors.to = 'to must be on or after from.';
      }
      if (Object.keys(errors).length > 0) throw new ValidationError(errors);
      if (bounds.startMs === null || bounds.endMs === null) {
        sendJson(context, 200, { days: [] });
        return;
      }

      const firstDay = Math.max(
        fromDay ?? bounds.startMs,
        Math.floor(bounds.startMs / DAY_MS) * DAY_MS,
      );
      const lastDay = Math.min(
        toDay ?? bounds.endMs - 1,
        Math.floor((bounds.endMs - 1) / DAY_MS) * DAY_MS,
      );
      const windowStart = Math.floor(firstDay / DAY_MS) * DAY_MS;
      const windowEnd = Math.floor(lastDay / DAY_MS) * DAY_MS + DAY_MS;
      const sensorIds = project.sensors.map((sensor) => sensor.id);
      const readings =
        windowEnd <= windowStart
          ? []
          : await loadReadings(pool, project.slug, sensorIds, windowStart, windowEnd);
      const byDay = new Map<number, typeof readings>();
      for (const reading of readings) {
        const day = Math.floor(reading.intervalStartMs / DAY_MS) * DAY_MS;
        const bucket = byDay.get(day);
        if (bucket === undefined) byDay.set(day, [reading]);
        else bucket.push(reading);
      }
      const days = [...byDay.keys()]
        .sort((a, b) => a - b)
        .map((day) => {
          const derived = derive({
            shape: shapeOf(project),
            startMs: day,
            endMs: day + DAY_MS,
            sensorIds,
            readings: byDay.get(day)!,
          });
          return {
            date: formatDate(day),
            net_tco2e: tonnes(derived.net),
            coverage_pct: percent(derived.coveragePct),
          };
        });
      sendJson(context, 200, { days });
    },
  },
  {
    method: 'POST',
    path: '/api/projects/:slug/preview',
    handler: async (context) => {
      const person = await requirePerson(pool, context);
      const { project, role } = await requireProject(
        pool,
        person,
        context.params.slug!,
        'analyst',
      );
      const bounds = await loadRecordBounds(pool, project.slug);
      const interval = validateIntervalRequest(
        project,
        bounds,
        bodyField(context.body, 'start'),
        bodyField(context.body, 'end'),
        bodyField(context.body, 'sensor_ids'),
      );
      const readings = await loadReadings(
        pool,
        project.slug,
        interval.sensorIds,
        interval.startMs,
        interval.endMs,
      );
      const derived = derive({
        shape: shapeOf(project),
        startMs: interval.startMs,
        endMs: interval.endMs,
        sensorIds: interval.sensorIds,
        readings,
      });
      const intact = await loadIntactIntervals(pool, project.slug);
      const block = previewBlock(derived, project, role, intact);
      sendJson(
        context,
        200,
        previewJson(derived, project.floorPct, project.bufferPct, {
          sealable: block === null,
          blockedReason: block === null ? null : block.reason,
          blockingFigureId:
            block !== null && 'figureId' in block ? block.figureId : null,
        }),
      );
    },
  },
];
