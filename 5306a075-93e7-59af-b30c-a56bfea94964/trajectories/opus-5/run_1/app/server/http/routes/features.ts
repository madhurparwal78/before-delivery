import type { FeatureStatus, ScoreVersion } from '../../../shared/types';
import { isUniqueViolation, lockFeature, lockRelease, newId, withTransaction } from '../../db';
import { NO_SUCH_RECORD, conflict, notFound } from '../../errors';
import { priorityScore } from '../../domain/priority';
import { featureTransitionAllowed, featureTransitionError } from '../../domain/transitions';
import { toInstant } from '../../domain/zone';
import {
  loadFeatureWorld,
  loadObjectives,
  rankedFeatures,
  toSummary,
  type FeatureRecord,
} from '../../repo/features';
import { recordAudit } from '../../repo/session';
import { toInsight } from '../../repo/notes';
import { Router, requirePrincipal, type RequestContext } from '../kernel';
import {
  CONFIDENCE_MESSAGE,
  EFFORT_MESSAGE,
  FieldErrors,
  WEIGHT_MESSAGE,
  failField,
  hasKey,
  inRange,
} from '../validate';

const FEATURE_STATUSES: FeatureStatus[] = [
  'candidate',
  'planned',
  'in_progress',
  'released',
  'archived',
];

const NAME_TAKEN = 'A feature with this name already exists.';

async function resolveFeature(ctx: RequestContext) {
  const principal = requirePrincipal(ctx);
  const { rows } = await ctx.db.query<{ id: string }>(
    'SELECT id FROM features WHERE workspace_id = $1 AND id = $2',
    [principal.workspaceId, ctx.params.id],
  );
  if (rows.length === 0) throw notFound();
  return { principal, featureId: rows[0].id };
}

function validateName(errors: FieldErrors, raw: unknown): string {
  if (typeof raw !== 'string') {
    errors.add('name', 'Add a feature name.');
    return '';
  }
  const name = raw.trim();
  if (name === '') errors.add('name', 'Add a feature name.');
  else if (name.length > 120) errors.add('name', 'Use 120 characters or fewer.');
  return name;
}

function validateDescription(errors: FieldErrors, raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') {
    errors.add('publicDescription', 'This must be text.');
    return '';
  }
  if (raw.length > 500) errors.add('publicDescription', 'Use 500 characters or fewer.');
  return raw;
}

export function registerFeatureRoutes(router: Router): void {
  router.add({
    method: 'GET',
    pattern: '/api/hierarchy',
    access: 'member',
    handle: async (ctx) => {
      const principal = requirePrincipal(ctx);
      const world = await loadFeatureWorld(ctx.db, principal.workspaceId);
      const { rows: products } = await ctx.db.query<{ id: string; name: string }>(
        'SELECT id, name FROM products WHERE workspace_id = $1 ORDER BY created_at, id',
        [principal.workspaceId],
      );
      const { rows: components } = await ctx.db.query<{ id: string; product_id: string; name: string }>(
        `SELECT components.id, components.product_id, components.name FROM components
           JOIN products ON products.id = components.product_id
          WHERE products.workspace_id = $1 ORDER BY components.created_at, components.id`,
        [principal.workspaceId],
      );
      const features = [...world.features.values()];
      return {
        status: 200,
        json: {
          products: products.map((product) => ({
            id: product.id,
            name: product.name,
            components: components
              .filter((component) => component.product_id === product.id)
              .map((component) => ({
                id: component.id,
                name: component.name,
                features: features
                  .filter(
                    (feature) =>
                      feature.componentId === component.id &&
                      feature.parentFeatureId === null &&
                      feature.status !== 'archived',
                  )
                  .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
                  .map((feature) => ({
                    ...toSummary(feature),
                    subfeatures: subfeaturesOf(features, feature.id),
                  })),
              })),
          })),
        },
      };
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/products',
    access: 'member',
    roles: ['head_of_product', 'product_manager'],
    handle: async (ctx) => {
      const principal = requirePrincipal(ctx);
      const errors = new FieldErrors();
      const name = typeof ctx.body.name === 'string' ? ctx.body.name.trim() : '';
      if (name === '' || name.length > 120) errors.add('name', 'Add a product name of up to 120 characters.');
      errors.throwIfAny();
      const id = newId();
      await ctx.db.query('INSERT INTO products (id, workspace_id, name) VALUES ($1, $2, $3)', [
        id,
        principal.workspaceId,
        name,
      ]);
      return { status: 201, json: { product: { id, name } } };
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/components',
    access: 'member',
    roles: ['head_of_product', 'product_manager'],
    handle: async (ctx) => {
      const principal = requirePrincipal(ctx);
      const errors = new FieldErrors();
      const name = typeof ctx.body.name === 'string' ? ctx.body.name.trim() : '';
      if (name === '' || name.length > 120) {
        errors.add('name', 'Add a component name of up to 120 characters.');
      }
      const productId = typeof ctx.body.productId === 'string' ? ctx.body.productId : '';
      const { rows } = await ctx.db.query<{ id: string }>(
        'SELECT id FROM products WHERE workspace_id = $1 AND id = $2',
        [principal.workspaceId, productId],
      );
      if (rows.length === 0) errors.add('productId', NO_SUCH_RECORD);
      errors.throwIfAny();
      const id = newId();
      await ctx.db.query('INSERT INTO components (id, product_id, name) VALUES ($1, $2, $3)', [
        id,
        productId,
        name,
      ]);
      return { status: 201, json: { component: { id, productId, name } } };
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/features',
    access: 'member',
    roles: ['head_of_product', 'product_manager'],
    handle: async (ctx) => {
      const principal = requirePrincipal(ctx);
      const errors = new FieldErrors();
      const name = validateName(errors, ctx.body.name);
      const publicDescription = validateDescription(errors, ctx.body.publicDescription);
      const componentId = typeof ctx.body.componentId === 'string' ? ctx.body.componentId : '';
      const { rows: componentRows } = await ctx.db.query<{ id: string }>(
        `SELECT components.id FROM components
           JOIN products ON products.id = components.product_id
          WHERE products.workspace_id = $1 AND components.id = $2`,
        [principal.workspaceId, componentId],
      );
      if (componentRows.length === 0) errors.add('componentId', NO_SUCH_RECORD);

      const rawParent = ctx.body.parentFeatureId;
      let parentFeatureId: string | null = null;
      if (typeof rawParent === 'string' && rawParent !== '') {
        const { rows } = await ctx.db.query<{ component_id: string; parent_feature_id: string | null }>(
          'SELECT component_id, parent_feature_id FROM features WHERE workspace_id = $1 AND id = $2',
          [principal.workspaceId, rawParent],
        );
        const parent = rows[0];
        if (!parent) errors.add('parentFeatureId', NO_SUCH_RECORD);
        else if (parent.parent_feature_id !== null || parent.component_id !== componentId) {
          errors.add('parentFeatureId', 'The parent must be a top-level feature in the same component.');
        } else {
          parentFeatureId = rawParent;
        }
      } else if (rawParent !== undefined && rawParent !== null) {
        errors.add('parentFeatureId', NO_SUCH_RECORD);
      }
      errors.throwIfAny();

      const id = newId();
      try {
        await withTransaction(async (client) => {
          await client.query(
            `INSERT INTO features (id, workspace_id, component_id, parent_feature_id, name,
                                   public_description, status, effort, confidence, version)
             VALUES ($1, $2, $3, $4, $5, $6, 'candidate', 5, 50, 1)`,
            [id, principal.workspaceId, componentId, parentFeatureId, name, publicDescription],
          );
          const objectives = await loadObjectives(client, principal.workspaceId);
          const fits: Record<string, number> = {};
          for (const objective of objectives) fits[objective.id] = 0;
          await client.query(
            `INSERT INTO score_versions (id, feature_id, version, effort, confidence, fits, priority, saved_by)
             VALUES ($1, $2, 1, 5, 50, $3::jsonb, 0, $4)`,
            [newId(), id, JSON.stringify(fits), principal.memberId],
          );
          await recordAudit(client, principal.workspaceId, principal.memberId, 'feature.create', 'feature', id);
        });
      } catch (error) {
        if (isUniqueViolation(error, 'features_workspace_name')) failField('name', NAME_TAKEN);
        throw error;
      }
      const world = await loadFeatureWorld(ctx.db, principal.workspaceId);
      return { status: 201, json: { feature: toSummary(world.features.get(id) as FeatureRecord) } };
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/features',
    access: 'member',
    handle: async (ctx) => {
      const principal = requirePrincipal(ctx);
      const query = ctx.url.searchParams.get('q');
      if (query !== null && query.length > 100) failField('q', 'Use 100 characters or fewer.');
      const world = await loadFeatureWorld(ctx.db, principal.workspaceId);
      const needle = (query ?? '').toLowerCase();
      const features = rankedFeatures(world)
        .filter((feature) => needle === '' || feature.name.toLowerCase().includes(needle))
        .map(toSummary);
      return { status: 200, json: { features } };
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/features/:id',
    access: 'member',
    resolve: resolveFeature,
    handle: async (ctx, { principal, featureId }) => {
      const world = await loadFeatureWorld(ctx.db, principal.workspaceId);
      const feature = world.features.get(featureId) as FeatureRecord;
      const features = [...world.features.values()];

      const { rows: insightRows } = await ctx.db.query<Parameters<typeof toInsight>[0]>(
        `SELECT insights.id, insights.note_id, insights.feature_id, features.name AS feature_name,
                insights.start_offset, insights.end_offset, insights.quote, insights.importance,
                contacts.company_id
           FROM insights
           JOIN features ON features.id = insights.feature_id
           JOIN notes ON notes.id = insights.note_id
           LEFT JOIN contacts ON contacts.id = notes.contact_id
          WHERE insights.feature_id = $1
          ORDER BY insights.created_at DESC, insights.id DESC`,
        [featureId],
      );
      const { rows: requestedBy } = await ctx.db.query<{
        company_id: string;
        company_name: string;
        insight_count: string;
      }>(
        `SELECT companies.id AS company_id, companies.name AS company_name, COUNT(*) AS insight_count
           FROM insights
           JOIN notes ON notes.id = insights.note_id
           JOIN contacts ON contacts.id = notes.contact_id
           JOIN companies ON companies.id = contacts.company_id
          WHERE insights.feature_id = $1
          GROUP BY companies.id, companies.name
          ORDER BY COUNT(*) DESC, lower(companies.name), companies.id`,
        [featureId],
      );
      const { rows: versionRows } = await ctx.db.query<{
        version: number;
        effort: number;
        confidence: number;
        fits: Record<string, number>;
        priority: string;
        saved_at: Date;
        saved_by: string | null;
      }>(
        `SELECT version, effort, confidence, fits, priority, saved_at, saved_by
           FROM score_versions WHERE feature_id = $1 ORDER BY version DESC`,
        [featureId],
      );
      const scoreVersions: ScoreVersion[] = versionRows.map((row) => ({
        version: row.version,
        effort: row.effort,
        confidence: row.confidence,
        fits: row.fits,
        priority: Number(row.priority),
        savedAt: toInstant(row.saved_at) as string,
        savedBy: row.saved_by,
      }));

      return {
        status: 200,
        json: {
          feature: {
            ...toSummary(feature),
            requestedBy: requestedBy.map((row) => ({
              companyId: row.company_id,
              companyName: row.company_name,
              insightCount: Number(row.insight_count),
            })),
            insights: insightRows.map(toInsight),
            subfeatures: subfeaturesOf(features, featureId),
            scoreVersions,
          },
        },
      };
    },
  });

  router.add({
    method: 'PATCH',
    pattern: '/api/features/:id',
    access: 'member',
    roles: ['head_of_product', 'product_manager'],
    resolve: resolveFeature,
    handle: async (ctx, { principal, featureId }) => {
      const errors = new FieldErrors();
      const changesName = hasKey(ctx.body, 'name');
      const changesDescription = hasKey(ctx.body, 'publicDescription');
      const name = changesName ? validateName(errors, ctx.body.name) : null;
      const publicDescription = changesDescription
        ? validateDescription(errors, ctx.body.publicDescription)
        : null;
      errors.throwIfAny();
      try {
        await withTransaction(async (client) => {
          if (name !== null) {
            await client.query('UPDATE features SET name = $1 WHERE id = $2', [name, featureId]);
          }
          if (publicDescription !== null) {
            await client.query('UPDATE features SET public_description = $1 WHERE id = $2', [
              publicDescription,
              featureId,
            ]);
          }
          await recordAudit(
            client,
            principal.workspaceId,
            principal.memberId,
            'feature.details',
            'feature',
            featureId,
          );
        });
      } catch (error) {
        if (isUniqueViolation(error, 'features_workspace_name')) failField('name', NAME_TAKEN);
        throw error;
      }
      const world = await loadFeatureWorld(ctx.db, principal.workspaceId);
      return { status: 200, json: { feature: toSummary(world.features.get(featureId) as FeatureRecord) } };
    },
  });

  router.add({
    method: 'PATCH',
    pattern: '/api/features/:id/scores',
    access: 'member',
    roles: ['head_of_product', 'product_manager'],
    resolve: resolveFeature,
    handle: async (ctx, { principal, featureId }) => {
      const errors = new FieldErrors();
      const version = ctx.body.version;
      if (!Number.isInteger(version)) errors.add('version', 'Name the version you are editing.');
      let effort: number | null = null;
      if (hasKey(ctx.body, 'effort')) {
        const value = ctx.body.effort;
        if (!Number.isInteger(value) || !inRange(value as number, 1, 100)) errors.add('effort', EFFORT_MESSAGE);
        else effort = value as number;
      }
      let confidence: number | null = null;
      if (hasKey(ctx.body, 'confidence')) {
        const value = ctx.body.confidence;
        if (!Number.isInteger(value) || !inRange(value as number, 10, 100)) {
          errors.add('confidence', CONFIDENCE_MESSAGE);
        } else confidence = value as number;
      }
      let fitsInput: Record<string, number> | null = null;
      if (hasKey(ctx.body, 'fits')) {
        const value = ctx.body.fits;
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
          errors.add('fits', 'Objective fits must be levels from 0 to 3.');
        } else {
          const objectives = await loadObjectives(ctx.db, principal.workspaceId);
          const known = new Set(objectives.map((objective) => objective.id));
          const parsed: Record<string, number> = {};
          for (const [key, level] of Object.entries(value as Record<string, unknown>)) {
            if (!known.has(key) || !Number.isInteger(level) || !inRange(level as number, 0, 3)) {
              errors.add('fits', 'Objective fits must be levels from 0 to 3.');
              break;
            }
            parsed[key] = level as number;
          }
          if (!errors.any) fitsInput = parsed;
        }
      }
      errors.throwIfAny();

      const summary = await withTransaction(async (client) => {
        await lockFeature(client, featureId);
        const world = await loadFeatureWorld(client, principal.workspaceId);
        const feature = world.features.get(featureId) as FeatureRecord;
        if (feature.version !== version) {
          throw conflict('version_conflict', 'Someone else saved these scores first.', {
            current: {
              version: feature.version,
              effort: feature.effort,
              confidence: feature.confidence,
              fits: feature.fits,
              priority: feature.priority,
            },
          });
        }
        const nextEffort = effort ?? feature.effort;
        const nextConfidence = confidence ?? feature.confidence;
        const nextFits = { ...feature.fits, ...(fitsInput ?? {}) };
        const nextVersion = feature.version + 1;

        await client.query('UPDATE features SET effort = $1, confidence = $2, version = $3 WHERE id = $4', [
          nextEffort,
          nextConfidence,
          nextVersion,
          featureId,
        ]);
        for (const [objectiveId, level] of Object.entries(nextFits)) {
          await client.query(
            `INSERT INTO feature_fits (feature_id, objective_id, level) VALUES ($1, $2, $3)
             ON CONFLICT (feature_id, objective_id) DO UPDATE SET level = EXCLUDED.level`,
            [featureId, objectiveId, level],
          );
        }
        const committedPriority = priorityScore(world.objectives, {
          fits: nextFits,
          impact: feature.impact,
          confidence: nextConfidence,
          effort: nextEffort,
        });
        await client.query(
          `INSERT INTO score_versions (id, feature_id, version, effort, confidence, fits, priority, saved_by)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
          [
            newId(),
            featureId,
            nextVersion,
            nextEffort,
            nextConfidence,
            JSON.stringify(nextFits),
            committedPriority,
            principal.memberId,
          ],
        );
        await recordAudit(
          client,
          principal.workspaceId,
          principal.memberId,
          'feature.scores',
          'feature',
          featureId,
          { version: nextVersion },
        );
        const after = await loadFeatureWorld(client, principal.workspaceId);
        return toSummary(after.features.get(featureId) as FeatureRecord);
      });
      return { status: 200, json: { feature: summary } };
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/features/:id/status',
    access: 'member',
    roles: ['head_of_product', 'product_manager'],
    resolve: resolveFeature,
    handle: async (ctx, { principal, featureId }) => {
      const to = ctx.body.to;
      if (typeof to !== 'string' || (to !== 'restore' && !FEATURE_STATUSES.includes(to as FeatureStatus))) {
        failField('to', 'Choose a status.');
      }
      const summary = await withTransaction(async (client) => {
        await lockFeature(client, featureId);
        const world = await loadFeatureWorld(client, principal.workspaceId);
        const feature = world.features.get(featureId) as FeatureRecord;
        const priorStatus = world.priorStatus.get(featureId) ?? null;

        let next: FeatureStatus;
        if (to === 'restore') {
          if (feature.status !== 'archived' || priorStatus === null) {
            throw featureTransitionError(feature.name, feature.status, 'archived');
          }
          next = priorStatus;
        } else {
          next = to as FeatureStatus;
          if (!featureTransitionAllowed(feature.status, next)) {
            throw featureTransitionError(feature.name, feature.status, next);
          }
        }

        if (next === 'archived' && feature.releaseId !== null) {
          await lockRelease(client, feature.releaseId);
          const { rows } = await client.query<{ status: string }>(
            'SELECT status FROM releases WHERE id = $1',
            [feature.releaseId],
          );
          if (rows[0]?.status === 'frozen') {
            throw conflict('release_frozen', 'This release is frozen. Ask a head of product to change its scope.');
          }
          if (rows[0]?.status === 'open') {
            await client.query('UPDATE features SET release_id = NULL, board_position = 0 WHERE id = $1', [
              featureId,
            ]);
            await client.query('UPDATE releases SET order_version = order_version + 1 WHERE id = $1', [
              feature.releaseId,
            ]);
          }
        }

        if (to === 'restore') {
          await client.query('UPDATE features SET status = $1, prior_status = NULL WHERE id = $2', [
            next,
            featureId,
          ]);
        } else if (next === 'archived') {
          await client.query('UPDATE features SET status = $1, prior_status = $2 WHERE id = $3', [
            next,
            feature.status,
            featureId,
          ]);
        } else {
          await client.query('UPDATE features SET status = $1 WHERE id = $2', [next, featureId]);
        }
        await recordAudit(
          client,
          principal.workspaceId,
          principal.memberId,
          'feature.status',
          'feature',
          featureId,
          { from: feature.status, to: next },
        );
        const after = await loadFeatureWorld(client, principal.workspaceId);
        return toSummary(after.features.get(featureId) as FeatureRecord);
      });
      return { status: 200, json: { feature: summary } };
    },
  });

  router.add({
    method: 'GET',
    pattern: '/api/objectives',
    access: 'member',
    handle: async (ctx) => {
      const principal = requirePrincipal(ctx);
      return { status: 200, json: { objectives: await loadObjectives(ctx.db, principal.workspaceId) } };
    },
  });

  router.add({
    method: 'POST',
    pattern: '/api/objectives',
    access: 'member',
    roles: ['head_of_product'],
    handle: async (ctx) => {
      const principal = requirePrincipal(ctx);
      const errors = new FieldErrors();
      const name = typeof ctx.body.name === 'string' ? ctx.body.name.trim() : '';
      if (name === '' || name.length > 120) errors.add('name', 'Add an objective name.');
      const weight = ctx.body.weight;
      if (!Number.isInteger(weight) || !inRange(weight as number, 0, 100)) {
        errors.add('weight', WEIGHT_MESSAGE);
      }
      errors.throwIfAny();
      const id = newId();
      await ctx.db.query('INSERT INTO objectives (id, workspace_id, name, weight) VALUES ($1, $2, $3, $4)', [
        id,
        principal.workspaceId,
        name,
        weight,
      ]);
      return { status: 201, json: { objective: { id, name, weight } } };
    },
  });

  router.add({
    method: 'PATCH',
    pattern: '/api/objectives/:id',
    access: 'member',
    roles: ['head_of_product'],
    resolve: async (ctx) => {
      const principal = requirePrincipal(ctx);
      const { rows } = await ctx.db.query<{ id: string; name: string; weight: number }>(
        'SELECT id, name, weight FROM objectives WHERE workspace_id = $1 AND id = $2',
        [principal.workspaceId, ctx.params.id],
      );
      if (rows.length === 0) throw notFound();
      return { principal, objective: rows[0] };
    },
    handle: async (ctx, { principal, objective }) => {
      const errors = new FieldErrors();
      let name = objective.name;
      if (hasKey(ctx.body, 'name')) {
        const raw = typeof ctx.body.name === 'string' ? ctx.body.name.trim() : '';
        if (raw === '' || raw.length > 120) errors.add('name', 'Add an objective name.');
        else name = raw;
      }
      let weight = objective.weight;
      if (hasKey(ctx.body, 'weight')) {
        const value = ctx.body.weight;
        if (!Number.isInteger(value) || !inRange(value as number, 0, 100)) errors.add('weight', WEIGHT_MESSAGE);
        else weight = value as number;
      }
      errors.throwIfAny();
      await withTransaction(async (client) => {
        await client.query('UPDATE objectives SET name = $1, weight = $2 WHERE id = $3', [
          name,
          weight,
          objective.id,
        ]);
        await recordAudit(
          client,
          principal.workspaceId,
          principal.memberId,
          'objective.update',
          'objective',
          objective.id,
          { weight },
        );
      });
      return { status: 200, json: { objective: { id: objective.id, name, weight } } };
    },
  });
}

function subfeaturesOf(features: readonly FeatureRecord[], parentId: string) {
  return features
    .filter((feature) => feature.parentFeatureId === parentId && feature.status !== 'archived')
    .map((feature) => ({ id: feature.id, name: feature.name, status: feature.status }));
}
