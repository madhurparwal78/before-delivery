import { createHash } from 'node:crypto';
import { bodyLimits } from '../config.js';
import { newId, pool } from '../db.js';
import { apiErrors } from '../errors.js';
import type { Router } from '../http.js';
import { publish } from '../live.js';
import { createRecipe, isTeamMember, recipeAudience, recipeSummary } from '../store.js';
import { parseWringLine } from '../../shared/wringline.js';

export function registerImportRoutes(router: Router): void {
  router.add('POST', '/api/imports', async (ctx) => {
    const session = ctx.requireSession();
    const body = await ctx.readJson(bodyLimits.json);
    const owner = body['owner'];
    const type = typeof owner === 'object' && owner !== null ? (owner as Record<string, unknown>)['type'] : null;
    const ownerId = typeof owner === 'object' && owner !== null ? (owner as Record<string, unknown>)['id'] : null;
    if (type === 'team') {
      if (typeof ownerId !== 'string' || !(await isTeamMember(ownerId, session.userId))) throw apiErrors.notFound();
    } else if (type === 'user') {
      if (ownerId !== session.userId) throw apiErrors.notFound();
    } else {
      throw apiErrors.validation({ owner: 'Choose where to save this recipe.' });
    }
    const raw = typeof body['text'] === 'string' ? body['text'] : '';
    const normalized = raw.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    const textHash = createHash('sha256').update(normalized).digest('hex');

    const parsed = parseWringLine(normalized);
    if (parsed.problems.length > 0) {
      await pool.query(
        'insert into imports (id, user_id, text_hash, status, report) values ($1, $2, $3, $4, $5::jsonb)',
        [newId('i'), session.userId, textHash, 'unmatched', JSON.stringify({ lines: parsed.problems })],
      );
      throw apiErrors.importUnmatched(parsed.problems);
    }

    const earlier = await pool.query<{ recipe_id: string; version: number }>(
      `select recipe_id, version from imports
       where user_id = $1 and text_hash = $2 and status = 'created' and recipe_id is not null
       order by created_at limit 1`,
      [session.userId, textHash],
    );
    const previous = earlier.rows[0];
    if (previous !== undefined) {
      const summary = await recipeSummary(previous.recipe_id);
      if (summary !== null) {
        ctx.json(200, {
          import: {
            status: 'already_imported',
            recipe: summary,
            version: previous.version,
            message: `Already imported as ${summary.name} (version ${previous.version}). Nothing was created.`,
          },
        });
        return;
      }
    }

    const outcome = await createRecipe(
      { type, id: ownerId as string },
      { name: parsed.name, note: 'Imported from Wring Line v1', tags: [], steps: parsed.steps },
      session.userId,
    );
    await pool.query(
      'insert into imports (id, user_id, text_hash, status, recipe_id, version, report) values ($1,$2,$3,$4,$5,$6,$7::jsonb)',
      [
        newId('i'),
        session.userId,
        textHash,
        'created',
        outcome.summary.id,
        1,
        JSON.stringify({ lineCount: parsed.lineCount }),
      ],
    );
    publish(await recipeAudience(outcome.summary.id), {
      type: 'version_saved',
      recipeId: outcome.summary.id,
      version: 1,
      name: outcome.version.name,
      authorId: session.userId,
      authorName: session.displayName,
      teamId: outcome.summary.owner.type === 'team' ? outcome.summary.owner.id : null,
    });
    ctx.json(201, {
      import: {
        status: 'created',
        recipe: outcome.summary,
        version: 1,
        lineCount: parsed.lineCount,
      },
    });
  });
}
