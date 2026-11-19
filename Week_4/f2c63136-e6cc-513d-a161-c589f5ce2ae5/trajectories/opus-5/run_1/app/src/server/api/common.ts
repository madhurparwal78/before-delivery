import { withTx, type Db } from '../db.js';
import { ApiError, unavailable } from '../errors.js';
import { EventSink, publish } from '../live.js';
import { jsonLimitFor, parseJsonBody, repoAccess, type Ctx, type Need, type RepoAccess } from '../http.js';
import { ARCHIVE_OUTAGE_MESSAGE, PUSH_OUTAGE_MESSAGE, StorageUnavailable } from '../storage.js';

/** The body is parsed only after the access checks, so the published error order holds. */
export function body(ctx: Ctx): Record<string, unknown> {
  if (ctx.parsedBody === null) {
    ctx.parsedBody = parseJsonBody(ctx.rawBody ?? Buffer.alloc(0), jsonLimitFor(ctx.url.pathname));
  }
  return ctx.parsedBody;
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Runs one repository action in a transaction and pushes its live events after it commits. */
export async function inRepoTx<T>(
  ctx: Ctx,
  org: string,
  name: string,
  need: Need,
  options: { tokensAllowed?: boolean },
  run: (tx: Db, access: RepoAccess, sink: EventSink) => Promise<T>,
): Promise<T> {
  const sink = new EventSink();
  let repoId = 0;
  const result = await withTx(async (tx) => {
    const access = await repoAccess(tx, ctx, org, name, need, options);
    repoId = access.repo.id;
    return run(tx, access, sink);
  });
  if (sink.list().length > 0) publish(repoId, sink.list());
  return result;
}

export function storageError(error: unknown, kind: 'push' | 'archive'): never {
  if (error instanceof StorageUnavailable) {
    throw unavailable(kind === 'push' ? PUSH_OUTAGE_MESSAGE : ARCHIVE_OUTAGE_MESSAGE);
  }
  throw error as ApiError;
}

export function wholeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  return null;
}
