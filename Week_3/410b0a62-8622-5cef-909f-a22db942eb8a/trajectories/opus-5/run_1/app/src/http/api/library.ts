import { JSON_BODY_MAX_BYTES } from '../../config.js';
import { pool } from '../../db/pool.js';
import { deleteLibraryItem, insertLibraryItem, libraryForOwner } from '../../db/records.js';
import { normaliseSteps, validateSteps } from '../../domain/steps.js';
import { Validator } from '../../domain/validation.js';
import { readJsonBody } from '../body.js';
import { requireUser, type RequestContext } from '../context.js';
import { notFound, ValidationError } from '../errors.js';
import { sendJson, sendNoContent } from '../respond.js';

export async function listLibrary(ctx: RequestContext): Promise<void> {
  const user = requireUser(ctx);
  sendJson(ctx.res, 200, { library: await libraryForOwner(pool, user.id) });
}

export async function createLibraryItem(ctx: RequestContext): Promise<void> {
  const user = requireUser(ctx);
  const body = await readJsonBody(ctx.req, JSON_BODY_MAX_BYTES);
  const validator = new Validator();
  const name = validator.title('name', body.name);
  const sport = validator.sport('sport', body.sport);
  const message = validateSteps(body.steps);
  if (message) validator.add('steps', message);
  if (validator.failed) throw new ValidationError(validator.fields);

  const item = await insertLibraryItem(pool, {
    ownerId: user.id,
    name: name as string,
    sport: sport as 'bike' | 'run',
    steps: normaliseSteps(body.steps),
  });
  sendJson(ctx.res, 201, { item });
}

export async function removeLibraryItem(ctx: RequestContext): Promise<void> {
  const user = requireUser(ctx);
  const removed = await deleteLibraryItem(pool, ctx.params.id as string, user.id);
  if (!removed) throw notFound();
  sendNoContent(ctx.res);
}
