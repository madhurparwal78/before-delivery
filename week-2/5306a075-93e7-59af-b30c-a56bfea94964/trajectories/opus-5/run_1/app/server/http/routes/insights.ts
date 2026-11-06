import type { Importance } from '../../../shared/types';
import { lockFeature, newId, withTransaction, type Queryable } from '../../db';
import { NO_SUCH_RECORD, conflict, notFound } from '../../errors';
import { loadFeatureWorld, toSummary } from '../../repo/features';
import { recordAudit } from '../../repo/session';
import { Router, requirePrincipal, type RequestContext } from '../kernel';
import { FieldErrors, failField } from '../validate';

const IMPORTANCES: Importance[] = ['nice_to_have', 'important', 'critical'];
const MAX_QUOTE_LENGTH = 2000;

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

interface FeatureSnapshot {
  impact: number;
  priority: number;
  rank: number | null;
}

async function snapshot(db: Queryable, workspaceId: string, featureId: string): Promise<FeatureSnapshot> {
  const world = await loadFeatureWorld(db, workspaceId);
  const feature = world.features.get(featureId);
  if (!feature) throw notFound();
  return { impact: feature.impact, priority: feature.priority, rank: feature.rank };
}

export function registerInsightRoutes(router: Router): void {
  router.add({
    method: 'POST',
    pattern: '/api/insights',
    access: 'member',
    roles: ['head_of_product', 'product_manager'],
    handle: async (ctx) => {
      const principal = requirePrincipal(ctx);
      const errors = new FieldErrors();

      const noteId = typeof ctx.body.noteId === 'string' ? ctx.body.noteId : '';
      const featureId = typeof ctx.body.featureId === 'string' ? ctx.body.featureId : '';
      const importance = ctx.body.importance;
      if (typeof importance !== 'string' || !IMPORTANCES.includes(importance as Importance)) {
        errors.add('importance', 'Choose an importance.');
      }
      const start = ctx.body.start;
      const end = ctx.body.end;
      if (!Number.isInteger(start)) errors.add('start', 'Start must be a whole number.');
      if (!Number.isInteger(end)) errors.add('end', 'End must be a whole number.');

      const { rows: noteRows } = await ctx.db.query<{ text: string }>(
        'SELECT text FROM notes WHERE workspace_id = $1 AND id = $2',
        [principal.workspaceId, noteId],
      );
      if (noteRows.length === 0) errors.add('noteId', NO_SUCH_RECORD);

      const { rows: featureRows } = await ctx.db.query<{
        name: string;
        status: string;
        parent_feature_id: string | null;
      }>('SELECT name, status, parent_feature_id FROM features WHERE workspace_id = $1 AND id = $2', [
        principal.workspaceId,
        featureId,
      ]);
      const feature = featureRows[0];
      if (!feature) errors.add('featureId', NO_SUCH_RECORD);
      else if (feature.status === 'archived' || feature.parent_feature_id !== null) {
        errors.add('featureId', 'This feature cannot take insights.');
      }
      errors.throwIfAny();

      const text = noteRows[0].text;
      const startOffset = start as number;
      const endOffset = end as number;
      if (startOffset < 0 || startOffset >= endOffset) failField('start', 'Start must come before end.');
      if (endOffset > text.length) failField('end', 'End must be inside the note text.');
      if (startOffset > 0 && isLowSurrogate(text.charCodeAt(startOffset))) {
        failField('start', 'Start must not split a character.');
      }
      if (endOffset < text.length && isLowSurrogate(text.charCodeAt(endOffset))) {
        failField('end', 'End must not split a character.');
      }
      const quote = text.slice(startOffset, endOffset);
      if (quote.trim() === '') failField('start', 'The quote must hold a non-space character.');
      if (quote.length > MAX_QUOTE_LENGTH) failField('end', 'The quote must be 2,000 characters or fewer.');

      const result = await withTransaction(async (client) => {
        await lockFeature(client, featureId);
        const { rows: existing } = await client.query<{ id: string }>(
          `SELECT id FROM insights
            WHERE note_id = $1 AND feature_id = $2 AND start_offset = $3 AND end_offset = $4`,
          [noteId, featureId, startOffset, endOffset],
        );
        if (existing.length > 0) {
          throw conflict('duplicate_insight', `This quote is already linked to ${feature.name}.`);
        }
        const before = await snapshot(client, principal.workspaceId, featureId);
        const insightId = newId();
        await client.query(
          `INSERT INTO insights (id, workspace_id, note_id, feature_id, start_offset, end_offset,
                                 quote, importance)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [insightId, principal.workspaceId, noteId, featureId, startOffset, endOffset, quote, importance],
        );
        await recordAudit(
          client,
          principal.workspaceId,
          principal.memberId,
          'insight.create',
          'insight',
          insightId,
          { featureId, noteId },
        );
        const world = await loadFeatureWorld(client, principal.workspaceId);
        const { rows: insightRows } = await client.query<{ company_id: string | null }>(
          `SELECT contacts.company_id FROM notes
             LEFT JOIN contacts ON contacts.id = notes.contact_id
            WHERE notes.id = $1`,
          [noteId],
        );
        return {
          insight: {
            id: insightId,
            noteId,
            featureId,
            featureName: world.features.get(featureId)?.name ?? feature.name,
            start: startOffset,
            end: endOffset,
            quote,
            importance: importance as Importance,
            companyId: insightRows[0]?.company_id ?? null,
          },
          feature: toSummary(world.features.get(featureId)!),
          before,
        };
      });
      return { status: 201, json: result };
    },
  });

  router.add({
    method: 'PATCH',
    pattern: '/api/insights/:id',
    access: 'member',
    roles: ['head_of_product', 'product_manager'],
    resolve: resolveInsight,
    handle: async (ctx, { principal, insight }) => {
      const importance = ctx.body.importance;
      if (typeof importance !== 'string' || !IMPORTANCES.includes(importance as Importance)) {
        failField('importance', 'Choose an importance.');
      }
      const result = await withTransaction(async (client) => {
        await lockFeature(client, insight.feature_id);
        const { rowCount } = await client.query('SELECT 1 FROM insights WHERE id = $1 FOR UPDATE', [
          insight.id,
        ]);
        if (rowCount === 0) throw notFound();
        const before = await snapshot(client, principal.workspaceId, insight.feature_id);
        await client.query('UPDATE insights SET importance = $1 WHERE id = $2', [importance, insight.id]);
        await recordAudit(
          client,
          principal.workspaceId,
          principal.memberId,
          'insight.importance',
          'insight',
          insight.id,
          { importance },
        );
        const world = await loadFeatureWorld(client, principal.workspaceId);
        const feature = world.features.get(insight.feature_id)!;
        return {
          insight: {
            id: insight.id,
            noteId: insight.note_id,
            featureId: insight.feature_id,
            featureName: feature.name,
            start: insight.start_offset,
            end: insight.end_offset,
            quote: insight.quote,
            importance: importance as Importance,
            companyId: insight.company_id,
          },
          feature: toSummary(feature),
          before,
        };
      });
      return { status: 200, json: result };
    },
  });

  router.add({
    method: 'DELETE',
    pattern: '/api/insights/:id',
    access: 'member',
    roles: ['head_of_product', 'product_manager'],
    resolve: resolveInsight,
    handle: async (_ctx, { principal, insight }) => {
      const result = await withTransaction(async (client) => {
        await lockFeature(client, insight.feature_id);
        const { rowCount } = await client.query('SELECT 1 FROM insights WHERE id = $1 FOR UPDATE', [
          insight.id,
        ]);
        if (rowCount === 0) throw notFound();
        const before = await snapshot(client, principal.workspaceId, insight.feature_id);
        await client.query('DELETE FROM insights WHERE id = $1', [insight.id]);
        await recordAudit(
          client,
          principal.workspaceId,
          principal.memberId,
          'insight.delete',
          'insight',
          insight.id,
        );
        const world = await loadFeatureWorld(client, principal.workspaceId);
        return { feature: toSummary(world.features.get(insight.feature_id)!), before };
      });
      return { status: 200, json: result };
    },
  });
}

interface InsightRow {
  id: string;
  note_id: string;
  feature_id: string;
  start_offset: number;
  end_offset: number;
  quote: string;
  company_id: string | null;
}

async function resolveInsight(ctx: RequestContext) {
  const principal = requirePrincipal(ctx);
  const { rows } = await ctx.db.query<InsightRow>(
    `SELECT insights.id, insights.note_id, insights.feature_id, insights.start_offset,
            insights.end_offset, insights.quote, contacts.company_id
       FROM insights
       JOIN notes ON notes.id = insights.note_id
       LEFT JOIN contacts ON contacts.id = notes.contact_id
      WHERE insights.workspace_id = $1 AND insights.id = $2`,
    [principal.workspaceId, ctx.params.id],
  );
  const insight = rows[0];
  if (!insight) throw notFound();
  return { principal, insight };
}
