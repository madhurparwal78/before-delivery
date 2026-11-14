import type { Change } from '../../shared/types.ts';
import type { Context } from './context.ts';

/** A `set` of one field of a question, page or the form, made from the revision the person began editing at. */
export const setChange = (key: string, field: string, value: unknown, base_rev: number): Change => ({ op: 'set', key, field, value, base_rev });

/** Sends a change; when the server refuses it the refusal is reported and `revert` puts the box back to the draft. */
export async function commit(context: Context, change: Change, revert: () => void): Promise<boolean> {
  const outcome = await context.sync.send(change);
  if (outcome.ok) return true;
  context.sync.report(outcome.refusal);
  revert();
  return false;
}
