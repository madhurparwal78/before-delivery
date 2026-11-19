// Filter evaluation against record snapshots, shared by lists and reports.

import { Ctx as ExprCtx, parse, evaluate, truthy } from '../express/expression.js';
import { RecordSnapshot } from './recordengine.js';

/** Evaluate filter text against a record snapshot. Unknown paths are null. */
export function matchesFilterText(filter: string, scope: Record<string, unknown>, username: string): boolean {
  const ctx: ExprCtx = {
    rec: scope,
    now: 0,
    me: username,
    roles: new Set(),
    resolve: (path: string) => {
      let cur: unknown = scope;
      for (const part of path.split('.')) {
        if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
          cur = (cur as Record<string, unknown>)[part];
        } else if (part === 'username' && typeof cur === 'string') {
          return cur;
        } else {
          return null;
        }
      }
      return cur;
    },
  };
  try {
    return truthy(evaluate(parse(filter), ctx));
  } catch {
    return false;
  }
}

/** The scope a filter sees for a record: fields plus state and number. */
export function recordScope(snap: RecordSnapshot): Record<string, unknown> {
  return { ...snap.fields, state: snap.state, number: snap.number };
}
