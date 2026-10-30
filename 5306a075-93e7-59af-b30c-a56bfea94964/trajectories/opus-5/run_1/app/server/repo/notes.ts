import type {
  Attachment,
  Insight,
  Note,
  NoteListItem,
  NoteSource,
  NoteStatus,
} from '../../shared/types';
import type { Queryable } from '../db';
import { INBOX_ORDER_SQL, inboxAfterCursorSql } from '../domain/cursor';
import { toCalendarDate, toInstant } from '../domain/zone';

/** A snoozed note whose time has passed reads as unprocessed everywhere. */
export const EFFECTIVE_STATUS_SQL =
  "(CASE WHEN notes.status = 'snoozed' AND notes.snoozed_until <= now() THEN 'unprocessed' ELSE notes.status END)";

const EFFECTIVE_SNOOZE_SQL =
  "(CASE WHEN notes.status = 'snoozed' AND notes.snoozed_until > now() THEN notes.snoozed_until ELSE NULL END)";

interface NoteRow {
  id: string;
  title: string;
  body: string;
  text: string;
  source: NoteSource;
  effective_status: NoteStatus;
  effective_snooze: Date | null;
  received_on: string | null;
  created_at: Date;
  contact_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  company_id: string | null;
  company_name: string | null;
}

const NOTE_COLUMNS = `notes.id, notes.title, notes.body, notes.text, notes.source,
  ${EFFECTIVE_STATUS_SQL} AS effective_status, ${EFFECTIVE_SNOOZE_SQL} AS effective_snooze,
  notes.received_on, notes.created_at,
  contacts.id AS contact_id, contacts.name AS contact_name, contacts.email AS contact_email,
  companies.id AS company_id, companies.name AS company_name`;

const NOTE_JOINS = `FROM notes
  LEFT JOIN contacts ON contacts.id = notes.contact_id
  LEFT JOIN companies ON companies.id = contacts.company_id`;

export async function findNote(db: Queryable, workspaceId: string, noteId: string): Promise<Note | null> {
  const { rows } = await db.query<NoteRow>(
    `SELECT ${NOTE_COLUMNS} ${NOTE_JOINS}
      WHERE notes.workspace_id = $1 AND notes.id = $2`,
    [workspaceId, noteId],
  );
  const row = rows[0];
  if (!row) return null;
  const [attachments, insights] = await Promise.all([
    loadAttachments(db, noteId),
    loadNoteInsights(db, noteId),
  ]);
  return buildNote(row, attachments, insights);
}

function buildNote(row: NoteRow, attachments: Attachment[], insights: Insight[]): Note {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    text: row.text,
    source: row.source,
    status: row.effective_status,
    snoozedUntil: toInstant(row.effective_snooze),
    receivedOn: toCalendarDate(row.received_on),
    createdAt: toInstant(row.created_at) as string,
    contact:
      row.contact_id === null
        ? null
        : { id: row.contact_id, name: row.contact_name as string, email: row.contact_email as string },
    company: row.company_id === null ? null : { id: row.company_id, name: row.company_name as string },
    attachments,
    insights,
  };
}

export async function loadAttachments(db: Queryable, noteId: string): Promise<Attachment[]> {
  const { rows } = await db.query<{
    id: string;
    filename: string;
    content_type: string;
    size: number;
    status: 'available' | 'pending';
  }>(
    `SELECT id, filename, content_type, size, status FROM attachments
      WHERE note_id = $1 ORDER BY created_at, id`,
    [noteId],
  );
  return rows.map((row) => ({
    id: row.id,
    filename: row.filename,
    contentType: row.content_type,
    size: row.size,
    status: row.status,
  }));
}

export async function loadNoteInsights(db: Queryable, noteId: string): Promise<Insight[]> {
  const { rows } = await db.query<{
    id: string;
    note_id: string;
    feature_id: string;
    feature_name: string;
    start_offset: number;
    end_offset: number;
    quote: string;
    importance: Insight['importance'];
    company_id: string | null;
  }>(
    `SELECT insights.id, insights.note_id, insights.feature_id, features.name AS feature_name,
            insights.start_offset, insights.end_offset, insights.quote, insights.importance,
            contacts.company_id
       FROM insights
       JOIN features ON features.id = insights.feature_id
       JOIN notes ON notes.id = insights.note_id
       LEFT JOIN contacts ON contacts.id = notes.contact_id
      WHERE insights.note_id = $1
      ORDER BY insights.start_offset, insights.id`,
    [noteId],
  );
  return rows.map(toInsight);
}

export function toInsight(row: {
  id: string;
  note_id: string;
  feature_id: string;
  feature_name: string;
  start_offset: number;
  end_offset: number;
  quote: string;
  importance: Insight['importance'];
  company_id: string | null;
}): Insight {
  return {
    id: row.id,
    noteId: row.note_id,
    featureId: row.feature_id,
    featureName: row.feature_name,
    start: row.start_offset,
    end: row.end_offset,
    quote: row.quote,
    importance: row.importance,
    companyId: row.company_id,
  };
}

export async function noteStatusCounts(
  db: Queryable,
  workspaceId: string,
): Promise<{ unprocessed: number; snoozed: number; processed: number }> {
  const { rows } = await db.query<{ effective_status: NoteStatus; total: string }>(
    `SELECT ${EFFECTIVE_STATUS_SQL} AS effective_status, COUNT(*) AS total
       FROM notes WHERE notes.workspace_id = $1 GROUP BY 1`,
    [workspaceId],
  );
  const counts = { unprocessed: 0, snoozed: 0, processed: 0 };
  for (const row of rows) counts[row.effective_status] = Number(row.total);
  return counts;
}

export interface NoteListRow {
  item: NoteListItem;
  createdAt: string;
}

/** One capped page of a status list in the inbox order, plus one probe row. */
export async function listNotesPage(
  db: Queryable,
  workspaceId: string,
  status: NoteStatus,
  limit: number,
  after: { createdAt: string; id: string } | null,
): Promise<{ page: NoteListRow[]; hasMore: boolean }> {
  const params: unknown[] = [workspaceId, status];
  let predicate = '';
  if (after) {
    params.push(after.createdAt, after.id);
    predicate = ` AND ${inboxAfterCursorSql(3, 4)}`;
  }
  params.push(limit + 1);
  const { rows } = await db.query<{
    id: string;
    title: string;
    source: NoteSource;
    effective_status: NoteStatus;
    effective_snooze: Date | null;
    contact_name: string | null;
    company_name: string | null;
    created_at: Date;
    insight_count: string;
  }>(
    `SELECT notes.id, notes.title, notes.source,
            ${EFFECTIVE_STATUS_SQL} AS effective_status,
            ${EFFECTIVE_SNOOZE_SQL} AS effective_snooze,
            contacts.name AS contact_name, companies.name AS company_name, notes.created_at,
            (SELECT COUNT(*) FROM insights WHERE insights.note_id = notes.id) AS insight_count
       ${NOTE_JOINS}
      WHERE notes.workspace_id = $1 AND ${EFFECTIVE_STATUS_SQL} = $2${predicate}
      ${INBOX_ORDER_SQL}
      LIMIT $${params.length}`,
    params,
  );
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).map((row) => ({
    createdAt: toInstant(row.created_at) as string,
    item: {
      id: row.id,
      title: row.title,
      source: row.source,
      status: row.effective_status,
      snoozedUntil: toInstant(row.effective_snooze),
      contactName: row.contact_name,
      companyName: row.company_name,
      createdAt: toInstant(row.created_at) as string,
      insightCount: Number(row.insight_count),
    },
  }));
  return { page, hasMore };
}
