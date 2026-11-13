import { Ctx, SessionUser } from '../http';
import {
  ApiError,
  STORAGE_DOWNLOAD_MESSAGE,
  STORAGE_SAVE_MESSAGE,
  forbidden,
  notFound,
  preconditionRequired,
  storageUnavailable,
  unauthenticated,
} from '../errors';
import {
  PartRow,
  RevisionRow,
  canReadPart,
  headRevisionOf,
  loadPart,
  loadRevision,
  revisionJson,
  revisionLabel,
} from '../records';
import { StorageUnavailable } from '../storage';

export function requireUser(ctx: Ctx): SessionUser {
  if (!ctx.user) throw unauthenticated();
  return ctx.user;
}

export async function readablePart(ctx: Ctx, slug: string): Promise<PartRow> {
  const part = await loadPart(slug);
  if (!part) throw notFound();
  if (!(await canReadPart(part, ctx.user))) throw notFound();
  return part;
}

export async function readableRevision(
  ctx: Ctx,
  id: string,
): Promise<{ revision: RevisionRow; part: PartRow }> {
  const revision = await loadRevision(id);
  if (!revision) throw notFound();
  const part = await readablePart(ctx, revision.part_slug);
  return { revision, part };
}

export function ownedPart(part: PartRow, user: SessionUser): void {
  if (part.owner_id !== user.id) throw forbidden();
}

export const etagOf = (headRevisionId: string | null): string => `"${headRevisionId ?? ''}"`;

export class HeadMovedError extends Error {}

/** If-Match is true when it is `*`, or when any listed strong tag equals the head's tag. */
export function checkIfMatch(ctx: Ctx, headRevisionId: string | null): void {
  const header = ctx.req.headers['if-match'];
  if (header === undefined || typeof header !== 'string' || header.trim().length === 0) {
    throw preconditionRequired();
  }
  const value = header.trim();
  if (value === '*') return;
  const tags = value.split(',').map((tag) => tag.trim());
  if (tags.some((tag) => tag === etagOf(headRevisionId))) return;
  throw new HeadMovedError();
}

export async function headMovedAnswer(slug: string): Promise<ApiError> {
  const head = await headRevisionOf(slug);
  return new ApiError(
    412,
    {
      error: 'head_moved',
      message: `This part changed since you opened it. ${revisionLabel(
        head!.label_number,
      )} is now the latest revision.`,
      headRevisionId: head!.id,
      head: revisionJson(head!),
    },
    { ETag: etagOf(head!.id) },
  );
}

export async function withDownloadStorage<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof StorageUnavailable) throw storageUnavailable(STORAGE_DOWNLOAD_MESSAGE);
    throw error;
  }
}

export async function withSaveStorage<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof StorageUnavailable) throw storageUnavailable(STORAGE_SAVE_MESSAGE);
    throw error;
  }
}
