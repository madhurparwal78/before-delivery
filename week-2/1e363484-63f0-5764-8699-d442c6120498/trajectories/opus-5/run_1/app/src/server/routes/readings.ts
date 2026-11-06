import { pool } from '../db/pool';
import { bodyField, INGESTION_BODY_LIMIT, sendJson } from '../http/context';
import { requireIngestableProject, requirePerson } from '../http/guards';
import type { Route } from '../http/router';
import { ingestReadings } from '../ingest';
import { flushAlerts } from '../services/alerts';

export const readingRoutes: readonly Route[] = [
  {
    method: 'POST',
    path: '/api/projects/:slug/readings',
    bodyLimit: INGESTION_BODY_LIMIT,
    handler: async (context) => {
      const person = await requirePerson(pool, context);
      const project = await requireIngestableProject(pool, person, context.params.slug!);
      const result = await ingestReadings(person, project, bodyField(context.body, 'readings'));
      sendJson(context, 200, {
        batch_id: result.batchId,
        inserted: result.inserted,
        revised: result.revised,
        unchanged: result.unchanged,
        broken_figures: result.brokenFigures,
      });
      if (result.brokenFigures.length > 0) void flushAlerts();
    },
  },
];
