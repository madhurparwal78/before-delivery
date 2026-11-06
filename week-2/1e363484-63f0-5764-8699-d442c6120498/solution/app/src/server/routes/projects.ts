import { projectsWithRoles, requireRole, roleAtLeast, visibleProject } from "../auth.js";
import { pool, snapshot } from "../db.js";
import { boundaryAreaM2, derive, percent, tonnes, type Reading } from "../domain/derivation.js";
import { stateBlock } from "../domain/sealRules.js";
import { DAY, isoTimestamp, parseDate, utcDate } from "../domain/time.js";
import { deriveScope, derivedFields, FIGURE_COLUMNS, figureBody, intactFigures, ledgerEntryBody, ledgerState, type StoredFigure } from "../figures.js";
import { validationError, type Route } from "../http.js";
import { recordBounds, requirePerson, validateScope } from "./common.js";

const SLUG = "(?<slug>[a-z0-9-]+)";

export const projectRoutes: Route[] = [
  {
    method: "GET", pattern: /^\/api\/projects$/,
    handle: async (ctx) => {
      const person = await requirePerson(ctx);
      const visible = (await projectsWithRoles(person)).filter((p) => p.role !== null);
      const projects = await Promise.all(visible.map(async ({ project, role }) => ({
        slug: project.slug, name: project.name, kind: project.kind,
        floor_pct: percent(project.floorTenths), buffer_pct: percent(project.bufferTenths), role,
        summary: (await ledgerState(pool, project.slug)).summary,
      })));
      return { status: 200, json: { projects } };
    },
  },
  {
    method: "GET", pattern: new RegExp(`^/api/projects/${SLUG}$`),
    handle: async (ctx) => {
      const person = await requirePerson(ctx);
      const { project, role } = await visibleProject(person, ctx.params.slug!);
      const [bounds, { summary }] = await Promise.all([recordBounds(pool, project.slug), ledgerState(pool, project.slug)]);
      return {
        status: 200,
        json: {
          slug: project.slug, name: project.name, kind: project.kind, code: project.code,
          floor_pct: percent(project.floorTenths), buffer_pct: percent(project.bufferTenths),
          lead_person_id: project.leadPersonId, boundary: project.boundary,
          boundary_area_m2: Number(boundaryAreaM2(project)),
          sensors: project.sensors.map((s) => ({ id: s.id, kind: s.kind, polygon: s.polygon })),
          record_start: bounds ? isoTimestamp(bounds.start) : null,
          record_end: bounds ? isoTimestamp(bounds.end) : null,
          role, summary,
        },
      };
    },
  },
  {
    method: "GET", pattern: new RegExp(`^/api/projects/${SLUG}/timeline$`),
    handle: async (ctx) => {
      const person = await requirePerson(ctx);
      const { project } = await visibleProject(person, ctx.params.slug!);
      const errors: Record<string, string> = {};
      const fromText = ctx.query.get("from"), toText = ctx.query.get("to");
      const from = fromText === null ? null : parseDate(fromText);
      const to = toText === null ? null : parseDate(toText);
      if (fromText !== null && from === null) errors.from = "must be a date in the form YYYY-MM-DD";
      if (toText !== null && to === null) errors.to = "must be a date in the form YYYY-MM-DD";
      if (from !== null && to !== null && to < from) errors.to = "must be on or after from";
      if (Object.keys(errors).length) throw validationError(errors);

      const sensorIds = project.sensors.map((s) => s.id);
      const { rows } = await pool.query<{ sensor_id: string; t: number; fc_e4: number; fch4_e4: number; qc: number }>(
        `SELECT sensor_id, epoch(interval_start) AS t, fc_e4, fch4_e4, qc FROM readings
          WHERE project = $1 AND ($2::int8 IS NULL OR interval_start >= to_timestamp($2))
            AND ($3::int8 IS NULL OR interval_start < to_timestamp($3))`,
        [project.slug, from, to === null ? null : to + DAY]);
      const byDay = new Map<number, Reading[]>();
      for (const r of rows) {
        const day = r.t - (r.t % DAY);
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day)!.push({ sensorId: r.sensor_id, intervalStart: r.t, fcE4: r.fc_e4, fch4E4: r.fch4_e4, qc: r.qc });
      }
      const days = [...byDay.keys()].sort((a, b) => a - b).map((day) => {
        const d = derive(project, day, day + DAY, sensorIds, byDay.get(day)!);
        return { date: utcDate(day), net_tco2e: tonnes(d.netMilli), coverage_pct: percent(d.coverageTenths) };
      });
      return { status: 200, json: { days } };
    },
  },
  {
    method: "POST", pattern: new RegExp(`^/api/projects/${SLUG}/preview$`),
    handle: async (ctx) => {
      const person = await requirePerson(ctx);
      const { project, role } = await visibleProject(person, ctx.params.slug!);
      requireRole(role, "analyst");
      const errors: Record<string, string> = {};
      const scope = validateScope(project, await recordBounds(pool, project.slug), ctx.body, errors);
      if (!scope) throw validationError(errors);
      const derivation = await deriveScope(pool, project, scope.start, scope.end, scope.sensorIds);
      const block = stateBlock(derivation.atFloor, scope.start, scope.end, await intactFigures(pool, project.slug));
      const blockedReason = block?.reason ?? (roleAtLeast(role, "sealer") ? null : "role");
      return {
        status: 200,
        json: {
          ...derivedFields(project, scope.start, scope.end, scope.sensorIds, derivation),
          sealable: blockedReason === null,
          blocked_reason: blockedReason,
          blocking_figure_id: block && "figureId" in block ? block.figureId : null,
        },
      };
    },
  },
  {
    method: "GET", pattern: new RegExp(`^/api/projects/${SLUG}/figures$`),
    handle: async (ctx) => {
      const person = await requirePerson(ctx);
      const { project } = await visibleProject(person, ctx.params.slug!);
      return snapshot(async (db) => {
        const { rows } = await db.query<StoredFigure>(
          `SELECT ${FIGURE_COLUMNS} FROM figures WHERE project = $1 ORDER BY sealed_at DESC, id DESC`, [project.slug]);
        const { summary } = await ledgerState(db, project.slug);
        return { status: 200, json: { figures: rows.map(figureBody), summary } };
      });
    },
  },
  {
    method: "GET", pattern: new RegExp(`^/api/projects/${SLUG}/ledger$`),
    handle: async (ctx) => {
      const person = await requirePerson(ctx);
      const { project } = await visibleProject(person, ctx.params.slug!);
      const { entries, summary } = await ledgerState(pool, project.slug);
      return {
        status: 200,
        json: { entries: entries.map(ledgerEntryBody), balance_tco2e: summary.sealed_net_tco2e, buffer_tco2e: summary.buffer_tco2e },
      };
    },
  },
];
