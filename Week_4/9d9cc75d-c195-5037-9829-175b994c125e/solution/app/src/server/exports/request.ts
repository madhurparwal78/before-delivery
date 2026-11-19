// The body of `POST /api/exports`, narrowed.
import type { ExportKind } from '../../shared/model.ts';
import type { JsonObject } from '../http/validate.ts';
import { isObject, nonBlank } from '../http/validate.ts';
import { Malformed, filters, oneOf, parameterValues } from '../sheets/shape.ts';
import type { ExportRequest, ExportTarget } from './jobs.ts';

const KINDS: readonly ExportKind[] = ['pdf', 'png', 'csv'];

/** The sheet or dashboard the body names, or null when it names neither or both. */
export function targetOf(body: JsonObject): ExportTarget | null {
  const sheet = nonBlank(body.sheet);
  const dashboard = nonBlank(body.dashboard);
  if (sheet !== null && dashboard === null) return { sheet };
  if (dashboard !== null && sheet === null) return { dashboard };
  return null;
}

/** A part of the wrong shape is a `Malformed` on its key. */
export function exportRequest(body: JsonObject): ExportRequest {
  const kind = oneOf(KINDS, body.kind);
  if (kind === null) throw new Malformed('kind', 'Kind must be pdf, png or csv.');
  const target = targetOf(body);
  if (target === null) throw new Malformed('sheet', 'Name a sheet or a dashboard.');
  return { kind, target, filters: filters(body.filters), parameters: parameterValues(body.parameters) };
}

/** The request a body holds, or null when any part of it is malformed (the route then answers 422 after its other checks). */
export function tryExportRequest(sent: unknown): ExportRequest | null {
  if (!isObject(sent)) return null;
  try {
    return exportRequest(sent);
  } catch (error) {
    if (error instanceof Malformed) return null;
    throw error;
  }
}
