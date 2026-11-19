// The one sheet-query path: the query route, dashboards, exports and alerts all run sheets through here, with the
// requesting user's row-level security (no role is exempt).
import type { QueryRequest, SheetShape } from '../../shared/model.ts';
import type { QueryInput, QueryOutcome, Security, SheetScope } from '../engine/contract.ts';
import { runQuery } from '../engine/index.ts';
import type { App, AuthUser } from '../http/app.ts';
import type { SourceModel } from '../sources/model.ts';
import { sheetScope } from './scope.ts';
import type { LoadedSheet } from './scope.ts';
import type { SheetAccess } from './store.ts';

/** The caller's allowed values of the security field (the engine matches them as text); null when not secured. */
function securityFor(model: SourceModel, user: AuthUser): Security | null {
  const field = model.security.field;
  if (field === null) return null;
  return { field: field.name, allowed: model.security.users[user.username.toLowerCase()] ?? [] };
}

export function queryInput(app: App, user: AuthUser, loaded: LoadedSheet, sheet: SheetShape, request: QueryRequest): QueryInput {
  return { ...loaded.scope, sheet, request, security: securityFor(loaded.model, user), limits: app.config };
}

interface SheetQuery {
  /** the sheet shape with current names, as queried */
  sheet: SheetShape;
  scope: SheetScope;
  outcome: QueryOutcome;
}

export async function runSheet(
  app: App,
  user: AuthUser,
  access: SheetAccess,
  request: QueryRequest,
  reshape: (sheet: SheetShape) => SheetShape = (sheet) => sheet,
): Promise<SheetQuery> {
  const loaded = await sheetScope(app, access.workbook, access.sheet);
  const sheet = reshape(loaded.shape);
  return { sheet, scope: loaded.scope, outcome: await runQuery(queryInput(app, user, loaded, sheet, request)) };
}
