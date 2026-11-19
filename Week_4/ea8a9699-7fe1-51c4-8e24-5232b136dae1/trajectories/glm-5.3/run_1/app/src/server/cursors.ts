// Cursors: opaque, bound to the surface and workspace that issued them.

import { validation } from './errors.js';

export interface CursorScope {
  surface: 'references' | 'feed';
  workspace: string;
}

export function encodeCursor(scope: CursorScope, payload: Record<string, string | number>): string {
  const data = { s: scope.surface, w: scope.workspace, ...payload };
  return Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
}

export function decodeCursor(scope: CursorScope, cursor: string | null): Record<string, string | number> {
  if (cursor === null) return {};
  let parsed: { s?: unknown; w?: unknown };
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    parsed = JSON.parse(json) as { s?: unknown; w?: unknown };
  } catch {
    throw validation({ cursor: 'Invalid cursor.' });
  }
  if (typeof parsed !== 'object' || parsed === null) throw validation({ cursor: 'Invalid cursor.' });
  if (parsed.s !== scope.surface || parsed.w !== scope.workspace) {
    throw validation({ cursor: 'Invalid cursor.' });
  }
  const { s: _s, w: _w, ...rest } = parsed as Record<string, unknown>;
  for (const v of Object.values(rest)) {
    if (typeof v !== 'string' && typeof v !== 'number') {
      throw validation({ cursor: 'Invalid cursor.' });
    }
  }
  return rest as Record<string, string | number>;
}
