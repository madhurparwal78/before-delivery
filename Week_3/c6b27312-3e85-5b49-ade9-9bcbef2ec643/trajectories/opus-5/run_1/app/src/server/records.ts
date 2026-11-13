import { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { query } from './db';
import { cmpNumber, cmpText, foldEmail } from '../shared/order';
import { TineProgram } from '../tine/ast';
import { parseTine } from '../tine/parse';
import { Values } from '../tine/manifest';
import { SessionUser } from './http';

export type PartRow = {
  slug: string;
  title: string;
  category: string;
  visibility: string;
  owner_id: string;
  seed_position: number | null;
  created_at: Date;
  head_revision_id: string | null;
};

export type RevisionRow = {
  id: string;
  part_slug: string;
  label_number: number;
  parent_revision_id: string | null;
  author_id: string;
  created_at: Date;
  values_json: Values;
  source_ref: string;
  evaluation_id: string | null;
  geometry_digest: string;
  message: string;
  restored_from: string | null;
  forked_from_revision_id: string | null;
  forked_from_operation: number | null;
  volume: number;
  bbox: [number, number, number];
  faces: number;
};

export type RoomRow = {
  id: string;
  part_slug: string;
  base_revision_id: string;
  head_revision_id: string;
  title: string;
  state: string;
  required_approvals: number;
  created_by: string;
  created_at: Date;
};

export type CommentRow = {
  id: string;
  room_id: string;
  author_id: string;
  body: string;
  anchor: unknown;
  pose: unknown;
  revision_id: string;
  created_at: Date;
};

export type ApprovalRow = {
  id: string;
  room_id: string;
  reviewer_id: string;
  revision_id: string;
  geometry_digest: string;
  at: Date;
};

export const revisionLabel = (labelNumber: number): string => `r${labelNumber}`;

type Runner = <T extends QueryResultRow>(text: string, params: unknown[]) => Promise<QueryResult<T>>;

/** Reads inside a transaction share the writer's client; others use the pool. */
function runnerOf(client?: PoolClient): Runner {
  return <T extends QueryResultRow>(text: string, params: unknown[]) =>
    client ? client.query<T>(text, params) : query<T>(text, params);
}

export type RevisionJson = {
  id: string;
  label: string;
  partSlug: string;
  parentRevisionId: string | null;
  authorId: string;
  createdAt: string;
  values: Values;
  sourceRef: string;
  evaluationId: string | null;
  geometryDigest: string;
  message: string;
  restoredFrom: string | null;
  forkedFrom: { revisionId: string; operation: number } | null;
};

export function revisionJson(row: RevisionRow): RevisionJson {
  return {
    id: row.id,
    label: revisionLabel(row.label_number),
    partSlug: row.part_slug,
    parentRevisionId: row.parent_revision_id,
    authorId: row.author_id,
    createdAt: row.created_at.toISOString(),
    values: row.values_json,
    sourceRef: row.source_ref,
    evaluationId: row.evaluation_id,
    geometryDigest: row.geometry_digest,
    message: row.message,
    restoredFrom: row.restored_from,
    forkedFrom:
      row.forked_from_revision_id === null
        ? null
        : { revisionId: row.forked_from_revision_id, operation: row.forked_from_operation ?? 0 },
  };
}

export async function loadPart(slug: string): Promise<PartRow | null> {
  const result = await query<PartRow>('select * from parts where slug = $1', [slug]);
  return result.rows[0] ?? null;
}

export async function loadRevision(id: string): Promise<RevisionRow | null> {
  const result = await query<RevisionRow>('select * from revisions where id = $1', [id]);
  return result.rows[0] ?? null;
}

export async function headRevisionOf(slug: string): Promise<RevisionRow | null> {
  const result = await query<RevisionRow>(
    'select * from revisions where part_slug = $1 order by label_number desc limit 1',
    [slug],
  );
  return result.rows[0] ?? null;
}

/** Revisions in label order, newest first. */
export async function listRevisions(slug: string): Promise<RevisionRow[]> {
  const result = await query<RevisionRow>(
    'select * from revisions where part_slug = $1 order by label_number desc',
    [slug],
  );
  return result.rows;
}

export async function loadRoom(id: string): Promise<RoomRow | null> {
  const result = await query<RoomRow>('select * from rooms where id = $1', [id]);
  return result.rows[0] ?? null;
}

/** A private part is readable by its owner and by the reviewers of its rooms. */
export async function canReadPart(part: PartRow, user: SessionUser | null): Promise<boolean> {
  if (part.visibility === 'public') return true;
  if (!user) return false;
  if (part.owner_id === user.id) return true;
  const result = await query(
    `select 1 from room_reviewers rr join rooms r on r.id = rr.room_id
     where r.part_slug = $1 and rr.email_folded = $2 limit 1`,
    [part.slug, foldEmail(user.email)],
  );
  return (result.rowCount ?? 0) > 0;
}

/** A room is readable only by its part's owner and its reviewers. */
export async function canReadRoom(room: RoomRow, user: SessionUser | null): Promise<boolean> {
  if (!user) return false;
  if (room.created_by === user.id) return true;
  const result = await query(
    'select 1 from room_reviewers where room_id = $1 and email_folded = $2 limit 1',
    [room.id, foldEmail(user.email)],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function isRoomReviewer(roomId: string, user: SessionUser): Promise<boolean> {
  const result = await query(
    'select 1 from room_reviewers where room_id = $1 and email_folded = $2 limit 1',
    [roomId, foldEmail(user.email)],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function sourceOfRef(ref: string, client?: PoolClient): Promise<string> {
  const result = await runnerOf(client)<{ body: string }>('select body from sources where ref = $1', [ref]);
  return result.rows[0]?.body ?? '';
}

const programCache = new Map<string, TineProgram>();

export async function programOfRef(ref: string): Promise<TineProgram> {
  const cached = programCache.get(ref);
  if (cached) return cached;
  const source = await sourceOfRef(ref);
  const program = parseTine(source);
  programCache.set(ref, program);
  return program;
}

export function programOfSource(source: string): TineProgram {
  return parseTine(source);
}

export async function likeCount(slug: string): Promise<number> {
  const result = await query<{ count: string }>('select count(*)::text as count from likes where part_slug = $1', [
    slug,
  ]);
  return Number(result.rows[0].count);
}

export async function likedBy(slug: string, user: SessionUser | null): Promise<boolean> {
  if (!user) return false;
  const result = await query('select 1 from likes where part_slug = $1 and user_id = $2', [slug, user.id]);
  return (result.rowCount ?? 0) > 0;
}

export async function displayNameOf(userId: string): Promise<string> {
  const result = await query<{ display_name: string }>('select display_name from users where id = $1', [
    userId,
  ]);
  return result.rows[0]?.display_name ?? '';
}

export type RoomJson = {
  id: string;
  partSlug: string;
  baseRevisionId: string;
  headRevisionId: string;
  title: string;
  state: string;
  requiredApprovals: number;
  approvals: { reviewerId: string; revisionId: string; geometryDigest: string; at: string }[];
  reviewers: { email: string; userId: string | null; displayName: string | null }[];
  createdBy: string;
};

export async function roomJson(room: RoomRow, client?: PoolClient): Promise<RoomJson> {
  const runner = runnerOf(client);
  const head = await runner<{ geometry_digest: string }>(
    'select geometry_digest from revisions where id = $1',
    [room.head_revision_id],
  );
  const digest = head.rows[0]?.geometry_digest ?? '';
  const approvals = await runner<ApprovalRow>(
    'select * from approvals where room_id = $1 and geometry_digest = $2',
    [room.id, digest],
  );
  const reviewers = await runner<{
    email: string;
    email_folded: string;
    id: string | null;
    display_name: string | null;
  }>(
    `select rr.email, rr.email_folded, u.id, u.display_name
     from room_reviewers rr left join users u on u.email_folded = rr.email_folded
     where rr.room_id = $1`,
    [room.id],
  );
  const sortedApprovals = [...approvals.rows].sort((a, b) => {
    const byTime = cmpNumber(a.at.getTime(), b.at.getTime());
    return byTime !== 0 ? byTime : cmpText(a.reviewer_id, b.reviewer_id);
  });
  const sortedReviewers = [...reviewers.rows].sort((a, b) => {
    const byEmail = cmpText(a.email_folded, b.email_folded);
    if (byEmail !== 0) return byEmail;
    if (a.id === b.id) return 0;
    if (a.id === null) return 1;
    if (b.id === null) return -1;
    return cmpText(a.id, b.id);
  });
  return {
    id: room.id,
    partSlug: room.part_slug,
    baseRevisionId: room.base_revision_id,
    headRevisionId: room.head_revision_id,
    title: room.title,
    state: room.state,
    requiredApprovals: room.required_approvals,
    approvals: sortedApprovals.map((row) => ({
      reviewerId: row.reviewer_id,
      revisionId: row.revision_id,
      geometryDigest: row.geometry_digest,
      at: row.at.toISOString(),
    })),
    reviewers: sortedReviewers.map((row) => ({
      email: row.email,
      userId: row.id,
      displayName: row.display_name,
    })),
    createdBy: room.created_by,
  };
}

export type CommentJson = {
  id: string;
  roomId: string;
  author: { id: string; displayName: string };
  body: string;
  anchor: unknown;
  pose: unknown;
  revisionId: string;
  createdAt: string;
};

export async function commentJson(row: CommentRow, client?: PoolClient): Promise<CommentJson> {
  const author = await runnerOf(client)<{ display_name: string }>(
    'select display_name from users where id = $1',
    [row.author_id],
  );
  return {
    id: row.id,
    roomId: row.room_id,
    author: { id: row.author_id, displayName: author.rows[0]?.display_name ?? '' },
    body: row.body,
    anchor: row.anchor,
    pose: row.pose,
    revisionId: row.revision_id,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listComments(roomId: string): Promise<CommentRow[]> {
  const result = await query<CommentRow>('select * from comments where room_id = $1', [roomId]);
  return [...result.rows].sort((a, b) => {
    const byTime = cmpNumber(a.created_at.getTime(), b.created_at.getTime());
    return byTime !== 0 ? byTime : cmpText(a.id, b.id);
  });
}
