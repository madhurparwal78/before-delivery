import { bodyLimits } from '../config.js';
import { apiErrors } from '../errors.js';
import type { Router } from '../http.js';
import { publish } from '../live.js';
import { SearchDown, searchRecipes } from '../search.js';
import {
  appendVersion,
  conflictIfStale,
  createRecipe,
  getVersion,
  isTeamMember,
  keptVersions,
  markRecipeOpened,
  recipeAudience,
  summariesByIds,
  teamsOf,
  visibleRecipe,
  visibleRecipes,
  type SaveOutcome,
  type VersionDraft,
} from '../store.js';
import {
  compareVersions,
  validateName,
  validateNote,
  validateSteps,
  validateTags,
  type FieldErrors,
} from '../../shared/recipe.js';

function draftFrom(body: Record<string, unknown>, extra: FieldErrors = {}): VersionDraft {
  const fields: FieldErrors = { ...extra };
  const name = validateName(body['name'], fields);
  const note = validateNote(body['note'], fields);
  const tags = validateTags(body['tags'], fields);
  const steps = validateSteps(body['steps'], fields);
  if (Object.keys(fields).length > 0) throw apiErrors.validation(fields);
  return { name, note, tags, steps };
}

function announce(outcome: SaveOutcome, audience: readonly string[]): void {
  publish(audience, {
    type: 'version_saved',
    recipeId: outcome.summary.id,
    version: outcome.version.n,
    name: outcome.version.name,
    authorId: outcome.version.author.id,
    authorName: outcome.version.author.displayName,
    teamId: outcome.summary.owner.type === 'team' ? outcome.summary.owner.id : null,
  });
}

function readBaseVersion(body: Record<string, unknown>): number {
  const value = body['baseVersion'];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw apiErrors.validation({ baseVersion: 'Send the version this save is based on.' });
  }
  return value;
}

export function registerRecipeRoutes(router: Router): void {
  router.add('GET', '/api/recipes', async (ctx) => {
    const session = ctx.requireSession();
    ctx.json(200, { recipes: await visibleRecipes(session.userId) });
  });

  router.add('POST', '/api/recipes', async (ctx) => {
    const session = ctx.requireSession();
    const body = await ctx.readJson(bodyLimits.json);
    const owner = body['owner'];
    if (typeof owner !== 'object' || owner === null) {
      throw apiErrors.validation({ owner: 'Choose where to save this recipe.' });
    }
    const type = (owner as Record<string, unknown>)['type'];
    const id = (owner as Record<string, unknown>)['id'];
    if (type === 'team') {
      if (typeof id !== 'string' || !(await isTeamMember(id, session.userId))) throw apiErrors.notFound();
    } else if (type === 'user') {
      if (id !== session.userId) throw apiErrors.notFound();
    } else {
      throw apiErrors.validation({ owner: 'Choose where to save this recipe.' });
    }
    const draft = draftFrom(body);
    const outcome = await createRecipe({ type, id: id as string }, draft, session.userId);
    announce(outcome, await recipeAudience(outcome.summary.id));
    ctx.json(201, { recipe: outcome.summary, version: outcome.version });
  });

  router.add('GET', '/api/recipes/:id', async (ctx) => {
    const session = ctx.requireSession();
    const summary = await visibleRecipe(ctx.params['id']!, session.userId);
    if (summary === null) throw apiErrors.notFound();
    ctx.json(200, { recipe: summary, versions: await keptVersions(summary.id) });
  });

  router.add('GET', '/api/recipes/:id/versions/:n', async (ctx) => {
    const session = ctx.requireSession();
    const summary = await visibleRecipe(ctx.params['id']!, session.userId);
    if (summary === null) throw apiErrors.notFound();
    const version = await getVersion(summary.id, Number(ctx.params['n']));
    if (version === null) throw apiErrors.notFound();
    ctx.json(200, { version });
  });

  router.add('POST', '/api/recipes/:id/versions', async (ctx) => {
    const session = ctx.requireSession();
    const summary = await visibleRecipe(ctx.params['id']!, session.userId);
    if (summary === null) throw apiErrors.notFound();
    const body = await ctx.readJson(bodyLimits.json);
    const baseVersion = readBaseVersion(body);
    await conflictIfStale(summary.id, baseVersion);
    const draft = draftFrom(body);
    const outcome = await appendVersion(summary.id, baseVersion, draft, session.userId);
    announce(outcome, await recipeAudience(summary.id));
    ctx.json(201, { recipe: outcome.summary, version: outcome.version });
  });

  router.add('POST', '/api/recipes/:id/restore', async (ctx) => {
    const session = ctx.requireSession();
    const summary = await visibleRecipe(ctx.params['id']!, session.userId);
    if (summary === null) throw apiErrors.notFound();
    const body = await ctx.readJson(bodyLimits.json);
    const wanted = body['version'];
    if (typeof wanted !== 'number' || !Number.isInteger(wanted)) {
      throw apiErrors.validation({ version: 'Choose a version to restore.' });
    }
    const source = await getVersion(summary.id, wanted);
    if (source === null) throw apiErrors.notFound();
    const baseVersion = readBaseVersion(body);
    await conflictIfStale(summary.id, baseVersion);
    const outcome = await appendVersion(
      summary.id,
      baseVersion,
      {
        name: source.name,
        note: `Restored from version ${wanted}`,
        tags: source.tags,
        steps: source.steps,
      },
      session.userId,
    );
    announce(outcome, await recipeAudience(summary.id));
    ctx.json(201, { recipe: outcome.summary, version: outcome.version });
  });

  router.add('GET', '/api/recipes/:id/compare', async (ctx) => {
    const session = ctx.requireSession();
    const summary = await visibleRecipe(ctx.params['id']!, session.userId);
    if (summary === null) throw apiErrors.notFound();
    const from = await getVersion(summary.id, Number(ctx.url.searchParams.get('from')));
    const to = await getVersion(summary.id, Number(ctx.url.searchParams.get('to')));
    if (from === null || to === null) throw apiErrors.notFound();
    ctx.json(200, {
      changes: compareVersions(
        { name: from.name, steps: from.steps },
        { name: to.name, steps: to.steps },
      ),
    });
  });

  router.add('POST', '/api/recipes/:id/opened', async (ctx) => {
    const session = ctx.requireSession();
    const summary = await visibleRecipe(ctx.params['id']!, session.userId);
    if (summary === null) throw apiErrors.notFound();
    await markRecipeOpened(summary.id);
    ctx.empty(204);
  });

  router.add('GET', '/api/search', async (ctx) => {
    const session = ctx.requireSession();
    const query = ctx.url.searchParams.get('q') ?? '';
    const teams = await teamsOf(session.userId);
    try {
      const outcome = await searchRecipes(query, session.userId, teams.map((team) => team.id));
      const results = await summariesByIds(outcome.ids, session.userId);
      ctx.json(200, { results, total: outcome.total });
    } catch (cause) {
      if (cause instanceof SearchDown) throw apiErrors.searchUnavailable();
      throw cause;
    }
  });
}
