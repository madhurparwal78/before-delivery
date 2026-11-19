import { config } from '../core/config.js';
import { db, many, one } from '../core/db.js';
import { errors } from '../core/errors.js';
import { iso, now } from '../core/time.js';
import { newReportReference } from '../core/crypto.js';
import { copy, REPORT_CATEGORIES } from '../shared/copy.js';
import { validEmail } from './validation.js';

export type ReportCategory = 'hate' | 'terrorism' | 'csam' | 'ip' | 'privacy' | 'other';

export interface ReportInput {
  targetType: 'post' | 'comment';
  targetId: string;
  category: ReportCategory;
  explanation: string;
  reporterEmail: string;
  goodFaith: boolean;
}

export interface ReportRow {
  reference: string;
  target_type: 'post' | 'comment';
  target_id: string;
  category: ReportCategory;
  explanation: string;
  created_at: unknown;
  deadline_at: unknown;
  status: string;
  target_url: string | null;
}

export function parseReportInput(body: Record<string, unknown>, accountEmail: string | null): ReportInput {
  const fields: Record<string, string> = {};
  const targetType = body.targetType === 'comment' ? 'comment' : body.targetType === 'post' ? 'post' : null;
  const targetId = typeof body.targetId === 'string' ? body.targetId : '';
  const category = REPORT_CATEGORIES.some((option) => option.value === body.category)
    ? (body.category as ReportCategory)
    : null;
  const explanation = typeof body.explanation === 'string' ? body.explanation.trim() : '';
  const reporterEmail = accountEmail ?? (typeof body.reporterEmail === 'string' ? body.reporterEmail.trim() : '');

  if (category === null) fields.category = copy.report.categoryRequired;
  if (explanation.length < 1 || explanation.length > 2000) fields.explanation = copy.report.explanationRequired;
  if (!validEmail(reporterEmail)) fields.reporterEmail = copy.report.emailInvalid;
  if (body.goodFaith !== true) fields.goodFaith = copy.report.goodFaithRequired;
  if (targetType === null || !/^\d+$/.test(targetId)) fields.targetId = 'Choose something to report';
  if (Object.keys(fields).length > 0) throw errors.validation('Check the highlighted fields', fields);

  return {
    targetType: targetType as 'post' | 'comment',
    targetId,
    category: category as ReportCategory,
    explanation,
    reporterEmail,
    goodFaith: true,
  };
}

/** The deadline falls REPORT_DEADLINE_SECONDS after filing, on the server's clock. */
export async function fileReport(
  input: ReportInput,
  reporterMemberId: string | null,
): Promise<{ reference: string; deadlineAt: string }> {
  const row = await one<{ reference: string; deadline_at: unknown }>(
    db,
    `insert into reports (reference, target_type, target_id, category, explanation, reporter_email,
       reporter_member_id, deadline_at)
     values ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(secs => $8::integer))
     returning reference, deadline_at`,
    [
      newReportReference(),
      input.targetType,
      input.targetId,
      input.category,
      input.explanation,
      input.reporterEmail,
      reporterMemberId,
      config.limits.reportDeadlineSeconds,
    ],
  );
  return { reference: String(row?.reference), deadlineAt: iso(row?.deadline_at) };
}

const REPORT_SELECT = `
  select r.reference, r.target_type, r.target_id, r.category, r.explanation, r.created_at, r.deadline_at, r.status,
         case
           when r.target_type = 'post' then
             (select '/c/' || c.name || '/post/' || p.id from posts p join communities c on c.id = p.community_id
               where p.id = r.target_id)
           else
             (select '/c/' || c.name || '/post/' || p.id || '/comment/' || cm.id
               from comments cm join posts p on p.id = cm.post_id join communities c on c.id = p.community_id
               where cm.id = r.target_id)
         end as target_url
  from reports r
`;

/** The admin view never carries the reporter's email. */
export function reportProjection(row: ReportRow, at: Date): Record<string, unknown> {
  const deadline = new Date(iso(row.deadline_at));
  const secondsRemaining = Math.floor((deadline.getTime() - at.getTime()) / 1000);
  return {
    reference: row.reference,
    target: { type: row.target_type, id: String(row.target_id), url: row.target_url },
    category: row.category,
    explanation: row.explanation,
    createdAt: iso(row.created_at),
    deadlineAt: iso(row.deadline_at),
    secondsRemaining,
    overdue: at.getTime() >= deadline.getTime(),
    status: row.status,
  };
}

export async function reportQueue(status: 'open' | 'all'): Promise<{ items: Record<string, unknown>[]; serverTime: string }> {
  const rows = await many<ReportRow>(
    db,
    `${REPORT_SELECT} ${status === 'open' ? "where r.status = 'open'" : ''} order by r.deadline_at asc, r.id asc`,
  );
  const at = now();
  return { items: rows.map((row) => reportProjection(row, at)), serverTime: at.toISOString() };
}

export async function resolveReport(reference: string, outcome: 'actioned' | 'dismissed'): Promise<Record<string, unknown>> {
  const updated = await one<{ reference: string }>(
    db,
    `update reports set status = $2 where reference = $1 and status = 'open' returning reference`,
    [reference, outcome],
  );
  if (!updated) {
    const exists = await one(db, 'select 1 from reports where reference = $1', [reference]);
    if (!exists) throw errors.notFound('Report not found');
    throw errors.conflict('That report is already resolved');
  }
  const row = await one<ReportRow>(db, `${REPORT_SELECT} where r.reference = $1`, [reference]);
  if (!row) throw errors.notFound('Report not found');
  return reportProjection(row, now());
}

export async function ageReport(reference: string, seconds: number): Promise<Record<string, unknown>> {
  const row = await one<{ reference: string; created_at: unknown; deadline_at: unknown }>(
    db,
    `update reports set created_at = created_at - make_interval(secs => $2::integer),
       deadline_at = deadline_at - make_interval(secs => $2::integer)
     where reference = $1 returning reference, created_at, deadline_at`,
    [reference, seconds],
  );
  if (!row) throw errors.notFound('Report not found');
  return { reference: row.reference, createdAt: iso(row.created_at), deadlineAt: iso(row.deadline_at) };
}

export async function reportTargetAuthor(
  targetType: 'post' | 'comment',
  targetId: string,
): Promise<{ username: string } | null> {
  const row = await one<{ username: string }>(
    db,
    targetType === 'post'
      ? 'select m.username from posts p join members m on m.id = p.author_id where p.id = $1'
      : 'select m.username from comments c join members m on m.id = c.author_id where c.id = $1',
    [targetId],
  );
  return row ? { username: row.username } : null;
}
