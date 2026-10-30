// Loading and shaping the records several routes return: notes, insights, releases, companies.
import type { Attachment, Company, Insight, Note, Release } from "../../shared/api.js";
import type { ReleaseStatus } from "../../shared/lifecycles.js";
import { monthOf } from "../../shared/months.js";
import type { Queryable } from "../db.js";
import { iso } from "../domain/time.js";
import { notFound } from "../http/errors.js";
import type { MemberCtx } from "../http/router.js";

export async function audit(q: Queryable, ctx: MemberCtx | null, workspaceId: string, action: string, subjectId: string, detail: Record<string, unknown> = {}): Promise<void> {
  await q.query("INSERT INTO audit_log (workspace_id, member_id, action, subject_id, detail) VALUES ($1, $2, $3, $4, $5)", [
    workspaceId, ctx?.session.member.id ?? null, action, subjectId, detail,
  ]);
}

interface InsightRow {
  id: string; note_id: string; feature_id: string; feature_name: string; start_offset: number; end_offset: number;
  quote: string; importance: Insight["importance"]; company_id: string | null;
}

const INSIGHT_SELECT = `SELECT i.id, i.note_id, i.feature_id, f.name AS feature_name, i.start_offset, i.end_offset, i.quote,
    i.importance, c.company_id
  FROM insights i JOIN features f ON f.id = i.feature_id JOIN notes n ON n.id = i.note_id LEFT JOIN contacts c ON c.id = n.contact_id`;

const toInsight = (r: InsightRow): Insight => ({
  id: r.id, noteId: r.note_id, featureId: r.feature_id, featureName: r.feature_name, start: r.start_offset, end: r.end_offset,
  quote: r.quote, importance: r.importance, companyId: r.company_id,
});

async function insightsOfNote(q: Queryable, noteId: string): Promise<Insight[]> {
  return (await q.query<InsightRow>(`${INSIGHT_SELECT} WHERE i.note_id = $1 ORDER BY i.start_offset, i.end_offset, i.id`, [noteId])).map(toInsight);
}

/** A feature's insights, ordered by importance (critical first) then newest first: the export's top-quote order. */
export async function insightsOfFeature(q: Queryable, featureId: string): Promise<Insight[]> {
  return (await q.query<InsightRow>(
    `${INSIGHT_SELECT} WHERE i.feature_id = $1
      ORDER BY CASE i.importance WHEN 'critical' THEN 0 WHEN 'important' THEN 1 ELSE 2 END, i.created_at DESC, i.id DESC`,
    [featureId],
  )).map(toInsight);
}

export async function insightById(q: Queryable, workspaceId: string, id: string): Promise<Insight | null> {
  const [row] = await q.query<InsightRow>(`${INSIGHT_SELECT} WHERE i.id = $1 AND i.workspace_id = $2`, [id, workspaceId]);
  return row ? toInsight(row) : null;
}

interface NoteRow {
  id: string; title: string; body: string; text: string; source: Note["source"]; status: Note["status"];
  snoozed_until: Date | null; received_on: string | null; created_at: Date;
  contact_id: string | null; contact_name: string | null; contact_email: string | null; company_id: string | null; company_name: string | null;
}

export async function loadNote(q: Queryable, workspaceId: string, id: string): Promise<Note> {
  const [row] = await q.query<NoteRow>(
    `SELECT n.id, n.title, n.body, n.text, n.source, n.status, n.snoozed_until, n.received_on, n.created_at,
            c.id AS contact_id, c.name AS contact_name, c.email AS contact_email, co.id AS company_id, co.name AS company_name
       FROM notes_live n LEFT JOIN contacts c ON c.id = n.contact_id LEFT JOIN companies co ON co.id = c.company_id
      WHERE n.id = $1 AND n.workspace_id = $2`,
    [id, workspaceId],
  );
  if (!row) throw notFound();
  const attachments = await q.query<{ id: string; filename: string; content_type: string; size: number; status: Attachment["status"] }>(
    "SELECT id, filename, content_type, size, status FROM attachments WHERE note_id = $1 ORDER BY created_at, id",
    [id],
  );
  return {
    id: row.id, title: row.title, body: row.body, text: row.text, source: row.source, status: row.status,
    snoozedUntil: row.snoozed_until && iso(row.snoozed_until), receivedOn: row.received_on, createdAt: iso(row.created_at),
    contact: row.contact_id && row.contact_name !== null && row.contact_email !== null ? { id: row.contact_id, name: row.contact_name, email: row.contact_email } : null,
    company: row.company_id && row.company_name !== null ? { id: row.company_id, name: row.company_name } : null,
    attachments: attachments.map((a) => ({ id: a.id, filename: a.filename, contentType: a.content_type, size: a.size, status: a.status })),
    insights: await insightsOfNote(q, id),
  };
}

export interface ReleaseRow {
  id: string; name: string; target_date: string; is_public: boolean; status: ReleaseStatus; order_version: number;
  snapshot_version: number | null; shipped_at: Date | null; feature_ids: string[]; queued: number; sent: number;
}

const RELEASE_SELECT = `SELECT r.id, r.name, r.target_date, r.is_public, r.status, r.order_version, r.snapshot_version, r.shipped_at,
    (SELECT coalesce(json_agg(f.id ORDER BY f.position), '[]'::json) FROM features f WHERE f.release_id = r.id) AS feature_ids,
    (SELECT count(*) FROM outbox o WHERE o.release_id = r.id) AS queued,
    (SELECT count(*) FROM outbox o WHERE o.release_id = r.id AND o.sent_at IS NOT NULL) AS sent
  FROM releases r`;

export const toRelease = (r: ReleaseRow): Release => ({
  id: r.id, name: r.name, targetDate: r.target_date, targetMonth: monthOf(r.target_date), status: r.status, isPublic: r.is_public,
  orderVersion: r.order_version, snapshotVersion: r.snapshot_version, featureIds: r.feature_ids, shippedAt: r.shipped_at && iso(r.shipped_at),
  emails: { queued: r.queued, sent: r.sent },
});

/** Releases of the workspace in board order: target date, then creation. */
export async function releaseRows(q: Queryable, workspaceId: string, id: string | null = null): Promise<ReleaseRow[]> {
  return q.query<ReleaseRow>(
    `${RELEASE_SELECT} WHERE r.workspace_id = $1 AND ($2::text IS NULL OR r.id = $2::text) ORDER BY r.target_date, r.created_at, r.id`,
    [workspaceId, id],
  );
}

export async function loadRelease(q: Queryable, workspaceId: string, id: string): Promise<Release> {
  const [row] = await releaseRows(q, workspaceId, id);
  if (!row) throw notFound();
  return toRelease(row);
}

/** Every company of the workspace (or one), name A–Z ignoring case. */
export async function companies(q: Queryable, workspaceId: string, id: string | null = null): Promise<Company[]> {
  return q.query<Company>(
    `SELECT co.id, co.name,
            (SELECT coalesce(json_agg(d.domain ORDER BY d.domain), '[]'::json) FROM company_domains d WHERE d.company_id = co.id) AS domains,
            (SELECT coalesce(json_agg(json_build_object('id', c.id, 'name', c.name, 'email', c.email) ORDER BY lower(c.name), c.id), '[]'::json)
               FROM contacts c WHERE c.company_id = co.id) AS contacts,
            (SELECT count(*) FROM notes n JOIN contacts c ON c.id = n.contact_id WHERE c.company_id = co.id)::int AS "noteCount"
       FROM companies co
      WHERE co.workspace_id = $1 AND ($2::text IS NULL OR co.id = $2::text)
      ORDER BY lower(co.name), co.id`,
    [workspaceId, id],
  );
}
