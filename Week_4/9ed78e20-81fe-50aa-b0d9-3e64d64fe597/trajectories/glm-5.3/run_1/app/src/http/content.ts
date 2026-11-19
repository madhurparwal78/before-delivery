import type { DbClient } from '../platform/db.js';
import { errors } from '../platform/errors.js';
import { writeAudit } from '../platform/audit.js';
import {
  type ContentKind,
  type ContentStatus,
  contentCanMove,
  type ClaimInput,
  readTimeMinutes,
  type ClaimView,
  type RowView,
  recordedDelta,
} from '../domain/lifecycles.js';
import { isValidSlug, trim, limitText, codePoints } from '../domain/text.js';
import { refreshSearchIndex } from '../db/migrate.js';

export type ContentRow = {
  id: string;
  kind: ContentKind;
  slug: string;
  title: string;
  summary: string;
  body: string;
  subject: string | null;
  tags: string[] | null;
  claims: ClaimInput[] | null;
  linked_news_slug: string | null;
  status: ContentStatus;
  author_email: string;
  release_at: Date | null;
  published_at: Date | null;
  read_time_minutes: number | null;
  version: number;
};

export const SERVER_OWNED_KEYS = [
  'id',
  'status',
  'version',
  'author',
  'author_email',
  'comments',
  'release_at',
  'published_at',
  'read_time_minutes',
  'created_at',
  'updated_at',
];

const KIND_KEYS: Record<ContentKind, string[]> = {
  model: ['slug', 'title', 'summary', 'body', 'claims', 'linked_news_slug'],
  news: ['slug', 'title', 'summary', 'body', 'subject', 'tags'],
};

export const CONTENT_EDITABLE_KEYS = ['slug', 'title', 'summary', 'body', 'subject', 'tags', 'claims', 'linked_news_slug'];

export function readOnlyFieldsFor(payload: Record<string, unknown>, kind: ContentKind | null, isPatch: boolean): Record<string, string> | null {
  const allowed = new Set<string>([
    ...KIND_KEYS.model,
    ...KIND_KEYS.news,
    ...(isPatch ? [] : ['kind']),
  ]);
  const offending: Record<string, string> = {};
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) {
      offending[key] = 'This field is set by the server.';
    }
  }
  if (Object.keys(offending).length > 0) return offending;
  return null;
}

export async function getContentById(client: DbClient, id: string): Promise<ContentRow | null> {
  const rows = await client.query<ContentRow & { tags: unknown; claims: unknown }>(
    `SELECT id, kind, slug, title, summary, body, subject, tags, claims, linked_news_slug,
            status, author_email, release_at, published_at, read_time_minutes, version
     FROM content_items WHERE id = $1`,
    [id],
  );
  const row = rows.rows[0];
  if (!row) return null;
  return normalizeContentRow(row);
}

export function normalizeContentRow(row: ContentRow & { tags: unknown; claims: unknown }): ContentRow {
  return {
    ...row,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : null,
    claims: Array.isArray(row.claims) ? (row.claims as ClaimInput[]) : null,
    release_at: row.release_at ? new Date(row.release_at) : null,
    published_at: row.published_at ? new Date(row.published_at) : null,
  };
}

export type ValidationOutcome = { valid: boolean; fields: Record<string, string> };

export function validateContentFields(
  payload: Record<string, unknown>,
  kind: ContentKind,
  client: DbClient | null,
): { fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  if (typeof payload.slug !== 'string' || !isValidSlug(trim(payload.slug))) {
    fields.slug = 'Use lowercase letters, numbers and single hyphens, up to 80 characters.';
  }
  if (typeof payload.title !== 'string' || trim(payload.title).length === 0) {
    fields.title = 'Enter a title.';
  }
  if (typeof payload.summary !== 'string' || trim(payload.summary).length === 0) {
    fields.summary = 'Enter a summary.';
  }
  if (typeof payload.body !== 'string' || trim(payload.body).length === 0) {
    fields.body = 'Enter a body.';
  }
  if (kind === 'news') {
    if (/\[claim:/i.test(String(payload.body ?? ''))) {
      fields.body = 'Claim markers belong on model routes.';
    }
    if (payload.subject !== undefined && !['research', 'safety', 'policy', 'company'].includes(String(payload.subject))) {
      fields.subject = 'Choose a subject.';
    }
    if (payload.tags !== undefined && !Array.isArray(payload.tags)) {
      fields.tags = 'Choose tags.';
    }
  }
  if (kind === 'model') {
    if (payload.claims !== undefined && !Array.isArray(payload.claims)) {
      fields.claims = 'Each claim needs an id, text, benchmark, evaluation date, comparator and stated difference.';
    }
  }
  return { fields };
}

export async function slugInUse(client: DbClient, slug: string, excludeId?: string): Promise<boolean> {
  const rows = await client.query<{ id: string }>(
    `SELECT id FROM content_items WHERE slug = $1 AND ($2::uuid IS NULL OR id <> $2)`,
    [slug, excludeId ?? null],
  );
  return rows.rows.length > 0;
}

export async function insertContent(
  client: DbClient,
  args: {
    kind: ContentKind;
    slug: string;
    title: string;
    summary: string;
    body: string;
    subject: string | null;
    tags: string[] | null;
    claims: ClaimInput[] | null;
    linked_news_slug: string | null;
    author: string;
  },
): Promise<ContentRow> {
  const rows = await client.query(
    `INSERT INTO content_items (kind, slug, title, summary, body, subject, tags, claims, linked_news_slug, status, author_email, version)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, 'draft', $10, 1)
     RETURNING id`,
    [
      args.kind,
      args.slug,
      args.title,
      args.summary,
      args.body,
      args.subject,
      JSON.stringify(args.tags ?? null),
      JSON.stringify(args.claims ?? null),
      args.linked_news_slug,
      args.author,
    ],
  );
  const id = rows.rows[0].id as string;
  await writeAudit(client, {
    actor: args.author,
    action: 'content.create',
    targetType: 'content',
    targetId: id,
    detail: { kind: args.kind, slug: args.slug, title: args.title },
  });
  if (args.kind === 'model') {
    await client.query(`INSERT INTO release_records (content_id) VALUES ($1) ON CONFLICT DO NOTHING`, [id]);
  }
  const content = await getContentById(client, id);
  if (!content) throw new Error('content insert failed');
  return content;
}

export async function updateContentFields(
  client: DbClient,
  id: string,
  payload: Record<string, unknown>,
  current: ContentRow,
  actor: string,
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  const add = (column: string, value: unknown) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };
  if (payload.slug !== undefined) add('slug', trim(String(payload.slug)));
  if (payload.title !== undefined) add('title', trim(String(payload.title)));
  if (payload.summary !== undefined) add('summary', trim(String(payload.summary)));
  if (payload.body !== undefined) add('body', trim(String(payload.body)));
  if (payload.subject !== undefined) add('subject', payload.subject === null ? null : String(payload.subject));
  if (payload.tags !== undefined) {
    add('tags', payload.tags === null ? null : JSON.stringify(payload.tags));
  }
  if (payload.claims !== undefined) {
    add('claims', payload.claims === null ? null : JSON.stringify(payload.claims));
  }
  if (payload.linked_news_slug !== undefined) {
    add('linked_news_slug', payload.linked_news_slug === null ? null : String(payload.linked_news_slug));
  }
  sets.push(`updated_at = now()`);
  params.push(id);
  const updated = await client.query(
    `UPDATE content_items SET ${sets.join(', ')}, version = version + 1
     WHERE id = $${params.length} AND version = $${params.length + 1}
     RETURNING version`,
    [...params, current.version],
  );
  if ((updated.rowCount ?? 0) === 0) {
    throw errors.staleVersion();
  }
  await writeAudit(client, {
    actor,
    action: 'content.update',
    targetType: 'content',
    targetId: id,
    detail: { slug: payload.slug !== undefined ? trim(String(payload.slug)) : current.slug },
  });
  if (current.kind === 'model') {
    // Any edit to a model route empties its release record.
    const voided = await client.query(
      `UPDATE release_records
       SET status = 'open', safety_by = NULL, safety_at = NULL, safety_note = NULL, safety_grant_id = NULL,
           legal_by = NULL, legal_at = NULL, legal_note = NULL, legal_grant_id = NULL,
           claims_validated_at = NULL, last_validation = NULL, cleared_by = NULL, cleared_at = NULL
       WHERE content_id = $1 AND status <> 'open' AND status <> 'cleared'
       RETURNING content_id`,
      [id],
    );
    if ((voided.rowCount ?? 0) > 0) {
      await writeAudit(client, {
        actor,
        action: 'release_record.void',
        targetType: 'release_record',
        targetId: id,
        detail: { reason: 'route_edited' },
      });
    }
  }
}

export async function transitionContent(
  client: DbClient,
  id: string,
  from: ContentStatus,
  to: ContentStatus,
  version: number,
  actor: string,
  action: 'content.submit' | 'content.approve' | 'content.return' | 'content.withdraw',
  detail: import('../platform/audit.js').AuditDetail,
): Promise<void> {
  if (!contentCanMove(from, to)) {
    throw errors.illegalTransition(from, to);
  }
  const updated = await client.query(
    `UPDATE content_items SET status = $1, version = version + 1, updated_at = now()
     WHERE id = $2 AND version = $3 RETURNING version`,
    [to, id, version],
  );
  if ((updated.rowCount ?? 0) === 0) {
    throw errors.staleVersion();
  }
  await writeAudit(client, {
    actor,
    action,
    targetType: 'content',
    targetId: id,
    detail,
  });
  if (to === 'withdrawn') {
    await client.query(
      `UPDATE publication_history SET withdrawn_at = now() WHERE content_id = $1`,
      [id],
    );
    await client.query(`UPDATE search_index SET live = false WHERE (kind = 'model' OR kind = 'news') AND ref_id = $1`, [id]);
    // Drop references from published items.
    await client.query(
      `UPDATE content_items SET linked_news_slug = NULL WHERE linked_news_slug = (SELECT slug FROM content_items WHERE id = $1) AND status = 'published'`,
      [id],
    );
  }
}

export function contentToView(row: ContentRow): Record<string, unknown> {
  return {
    id: row.id,
    kind: row.kind,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    body: row.body,
    subject: row.subject,
    tags: row.tags,
    claims: row.claims,
    linked_news_slug: row.linked_news_slug,
    status: row.status,
    version: row.version,
    author: row.author_email,
    release_at: row.release_at ? new Date(row.release_at).toISOString() : null,
    published_at: row.published_at ? new Date(row.published_at).toISOString() : null,
    read_time_minutes: row.read_time_minutes,
  };
}

export async function loadComments(client: DbClient, contentId: string): Promise<unknown[]> {
  const rows = await client.query<{ id: string; author_email: string; body: string; created_at: Date }>(
    `SELECT id, author_email, body, created_at FROM comments WHERE content_id = $1 ORDER BY created_at ASC`,
    [contentId],
  );
  return rows.rows.map((r) => ({
    id: r.id,
    author: r.author_email,
    body: r.body,
    created_at: new Date(r.created_at).toISOString(),
  }));
}

/** Rows for a model route's chart and evaluation table, grouped per the rules. */
export async function chartGroupsFor(
  client: DbClient,
  slug: string,
): Promise<Array<{ benchmark: string; eval_date: string; rows: RowView[] }>> {
  const rows = await client.query<RowView>(
    `SELECT id, subject, subject_name, organisation, benchmark, eval_date, score
     FROM benchmark_rows
     WHERE benchmark IN (SELECT benchmark FROM benchmark_rows WHERE subject = $1)
       AND eval_date IN (SELECT eval_date FROM benchmark_rows WHERE subject = $1)
     ORDER BY benchmark ASC`,
    [slug],
  );
  const grouped = new Map<string, RowView[]>();
  for (const row of rows.rows) {
    const key = `${row.benchmark}\u0000${row.eval_date}`;
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }
  const out: Array<{ benchmark: string; eval_date: string; rows: RowView[] }> = [];
  const keys = [...grouped.keys()].sort((a, b) => {
    const [ab, ad] = a.split('\u0000');
    const [bb, bd] = b.split('\u0000');
    return ab === bb ? ad.localeCompare(bd) : ab.localeCompare(bb);
  });
  for (const key of keys) {
    const rowsInGroup = grouped.get(key) ?? [];
    const hasModel = rowsInGroup.some((r) => r.subject === slug);
    if (!hasModel) continue;
    const model = rowsInGroup.filter((r) => r.subject === slug);
    const comparators = rowsInGroup
      .filter((r) => r.subject !== slug)
      .sort((a, b) => a.subject_name.localeCompare(b.subject_name));
    out.push({
      benchmark: key.split('\u0000')[0],
      eval_date: key.split('\u0000')[1],
      rows: [...model, ...comparators],
    });
  }
  return out;
}

export function claimViewsFor(content: ContentRow, rows: RowView[]): ClaimView[] {
  if (!content.claims) return [];
  return content.claims.map((claim, index) => {
    const modelRow = rows.find(
      (r) => r.subject === content.slug && r.benchmark === claim.benchmark && r.eval_date === claim.eval_date,
    );
    const comparatorRow = rows.find(
      (r) => r.subject === claim.comparator && r.benchmark === claim.benchmark && r.eval_date === claim.eval_date,
    );
    const delta =
      modelRow && comparatorRow ? recordedDelta(modelRow.score, comparatorRow.score) : null;
    return {
      id: claim.id,
      number: index + 1,
      text: claim.text,
      benchmark: claim.benchmark,
      eval_date: claim.eval_date,
      model_row_id: modelRow?.id ?? '',
      comparator_row_id: comparatorRow?.id ?? '',
      delta: delta ?? '',
    };
  });
}

export { trim, limitText, codePoints, recordedDelta, readTimeMinutes, refreshSearchIndex };
