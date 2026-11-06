import { tonnes } from '../../domain/decimal';
import { pool } from '../db/pool';
import {
  loadFigure,
  loadLedger,
  loadMovedReadings,
  loadProjectFigures,
  loadSummary,
  rederiveFigure,
} from '../figures';
import { bodyField, sendJson, sendRawJson, type RequestContext } from '../http/context';
import { notFound } from '../http/errors';
import { requirePerson, requireProject } from '../http/guards';
import type { Route } from '../http/router';
import { figureJson, ledgerEntryJson, movedReadingJson, summaryJson } from '../presenters';
import { sealFigure } from '../seal';

async function figureInVisibleProject(context: RequestContext, figureId: string) {
  const person = await requirePerson(pool, context);
  const figure = await loadFigure(pool, figureId);
  if (figure === null) throw notFound();
  const access = await requireProject(pool, person, figure.projectSlug);
  return { person, figure, ...access };
}

export const figureRoutes: readonly Route[] = [
  {
    method: 'POST',
    path: '/api/projects/:slug/figures',
    handler: async (context) => {
      const person = await requirePerson(pool, context);
      const { project } = await requireProject(pool, person, context.params.slug!, 'sealer');
      const header = context.request.headers['idempotency-key'];
      const outcome = await sealFigure({
        person,
        project,
        idempotencyKey: Array.isArray(header) ? header[0] : header,
        startRaw: bodyField(context.body, 'start'),
        endRaw: bodyField(context.body, 'end'),
        sensorsRaw: bodyField(context.body, 'sensor_ids'),
        fingerprintRaw: bodyField(context.body, 'preview_fingerprint'),
      });
      sendRawJson(
        context,
        outcome.status,
        outcome.bodyText,
        outcome.replay ? { 'idempotent-replay': 'true' } : {},
      );
    },
  },
  {
    method: 'GET',
    path: '/api/projects/:slug/figures',
    handler: async (context) => {
      const person = await requirePerson(pool, context);
      const { project } = await requireProject(pool, person, context.params.slug!);
      const figures = await loadProjectFigures(pool, project.slug);
      sendJson(context, 200, {
        figures: figures.map((figure) => figureJson(figure)),
        summary: summaryJson(await loadSummary(pool, project.slug)),
      });
    },
  },
  {
    method: 'GET',
    path: '/api/projects/:slug/ledger',
    handler: async (context) => {
      const person = await requirePerson(pool, context);
      const { project } = await requireProject(pool, person, context.params.slug!);
      const entries = await loadLedger(pool, project.slug);
      const summary = await loadSummary(pool, project.slug);
      sendJson(context, 200, {
        entries: entries.map(ledgerEntryJson),
        balance_tco2e: tonnes(summary.sealedNet),
        buffer_tco2e: tonnes(summary.buffer),
      });
    },
  },
  {
    method: 'GET',
    path: '/api/figures/:id',
    handler: async (context) => {
      const { figure, project } = await figureInVisibleProject(context, context.params.id!);
      const rederived = await rederiveFigure(pool, figure, project);
      sendJson(
        context,
        200,
        figureJson(figure, { checkedAtMs: rederived.checkedAtMs, rederived }),
      );
    },
  },
  {
    method: 'GET',
    path: '/api/figures/:id/audit',
    handler: async (context) => {
      const { figure } = await figureInVisibleProject(context, context.params.id!);
      const moved = await loadMovedReadings(pool, figure);
      sendJson(context, 200, { figure_id: figure.id, moved: moved.map(movedReadingJson) });
    },
  },
];
