import type { Queryable } from '../db.js';
import { notFound } from '../http/errors.js';
import type { Actor } from '../http/context.js';
import { mayReadRequest, projectRequest } from '../domain/projection.js';
import { loadHistory, loadOneById, type LoadedRequest } from '../store/requests.js';
import type { RequestView } from '../../shared/types.js';

/** Precedence step 4: an unknown id and an id the caller may not see answer alike. */
export async function readableRequest(
  actor: Actor,
  id: string,
  client?: Queryable,
): Promise<LoadedRequest> {
  const loaded = client === undefined ? await loadOneById(id) : await loadOneById(id, client);
  if (loaded === null || !mayReadRequest(actor, loaded)) throw notFound();
  return loaded;
}

export async function viewOf(actor: Actor, loaded: LoadedRequest, now: Date): Promise<RequestView> {
  const needsHistory = actor.role === 'coordinator' || actor.role === 'billing_admin';
  const history = needsHistory ? await loadHistory(loaded.row.id) : null;
  return projectRequest(actor, loaded, history, now);
}

export async function viewById(actor: Actor, id: string, now: Date): Promise<RequestView> {
  return viewOf(actor, await readableRequest(actor, id), now);
}
