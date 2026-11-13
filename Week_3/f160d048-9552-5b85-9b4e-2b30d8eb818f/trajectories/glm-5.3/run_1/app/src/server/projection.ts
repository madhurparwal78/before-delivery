// The one anonymity projection: every public surface reads a company through it.
import type { App } from '../lib/app.js';
import { AUTHOR_LABEL, CITIES, ROLE_FAMILIES, payBandFor, cityName, roleName } from '../lib/reference.js';
import { payBand, ratingAverage, threshold } from '../lib/derived.js';

export interface Viewer {
  role: string;
  unlocked: boolean;
  userId: string | null;
}

export function unlockedFor(viewer: Viewer | null): boolean {
  if (!viewer) return false;
  return viewer.unlocked;
}

export function truncate(value: string, unlocked: boolean): { text: string; truncated: boolean } {
  if (unlocked) return { text: value, truncated: false };
  if (value.length <= 140) return { text: value, truncated: false };
  return { text: value.slice(0, 140), truncated: true };
}

interface RatingRow {
  overall: number | null;
  work_life: number | null;
  pay: number | null;
  management: number | null;
  count: number;
}

interface PayValueRow {
  role_family: string;
  city: string;
  annual_pay: number;
}

export interface CompanyView {
  slug: string;
  name: string;
  city: string;
  city_name: string;
  size: string;
  verified: boolean;
  mark_url: string | null;
  viewer_unlocked: boolean;
  rating: { overall: number | null; work_life: number | null; pay: number | null; management: number | null; review_count: number };
  reviews: ReviewView[];
  pay_rows: PayRowView[];
  interview_notes: InterviewNoteView[];
  jobs: JobSummary[];
}

export interface ReviewView {
  id: string;
  title: string;
  overall: number;
  work_life: number;
  pay: number;
  management: number;
  pros: string;
  cons: string;
  truncated: boolean;
  posted_month: string;
  author_label: string;
  reply: { company_name: string; body: string; posted_month: string } | null;
}

export interface PayRowView {
  role_family: string;
  role_name: string;
  city: string;
  city_name: string;
  report_count: number;
  threshold: number;
  band: { low: number; median: number; high: number } | null;
}

export interface InterviewNoteView {
  id: string;
  role_family: string;
  role_name: string;
  difficulty: number;
  outcome: string;
  text: string;
  truncated: boolean;
  posted_month: string;
  author_label: string;
}

export interface JobSummary {
  id: string;
  title: string;
  company_name: string;
  company_slug: string;
  city: string;
  city_name: string;
  role_family: string;
  remote: string;
  pay_low: number;
  pay_high: number;
  pay_band: string;
  listed_at: number | null;
}

export async function companyView(
  app: App,
  slug: string,
  viewer: Viewer | null,
): Promise<CompanyView | null> {
  const company = await app.db.one<{
    id: string;
    slug: string;
    name: string;
    city: string;
    size: string;
    verified: boolean;
    mark_file_id: string | null;
  }>('select id, slug, name, city, size, verified, mark_file_id from companies where slug = $1', [slug]);
  if (!company) return null;

  const unlocked = unlockedFor(viewer);
  const [rating, reviews, payRows, notes, jobs] = await Promise.all([
    companyRating(app, company.id),
    companyReviews(app, company.id, viewer),
    companyPayRows(app, company.id, viewer),
    companyInterviewNotes(app, company.id, viewer),
    companyJobs(app, company.id),
  ]);

  return {
    slug: company.slug,
    name: company.name,
    city: company.city,
    city_name: cityName(company.city),
    size: company.size,
    verified: company.verified,
    mark_url: company.mark_file_id ? `/api/files/${company.mark_file_id}` : null,
    viewer_unlocked: unlocked,
    rating: { overall: rating.overall, work_life: rating.work_life, pay: rating.pay, management: rating.management, review_count: rating.count },
    reviews,
    pay_rows: payRows,
    interview_notes: notes,
    jobs,
  };
}

export async function companyRating(app: App, companyId: string): Promise<RatingRow> {
  const row = await app.db.one<{ s: number | null; wl: number | null; p: number | null; m: number | null; c: number }>(
    `select sum(overall)::int as s, sum(work_life)::int as wl, sum(pay)::int as p, sum(management)::int as m, count(*)::int as c
     from posts where company_id = $1 and kind = 'review' and state = 'approved'`,
    [companyId],
  );
  const count = row?.c ?? 0;
  return {
    overall: ratingAverage(row?.s ?? 0, count),
    work_life: ratingAverage(row?.wl ?? 0, count),
    pay: ratingAverage(row?.p ?? 0, count),
    management: ratingAverage(row?.m ?? 0, count),
    count,
  };
}

export async function companyReviews(
  app: App,
  companyId: string,
  viewer: Viewer | null,
): Promise<ReviewView[]> {
  const unlocked = unlockedFor(viewer);
  const rows = await app.db.many<{
    id: string;
    title: string;
    overall: number;
    work_life: number;
    pay: number;
    management: number;
    pros: string;
    cons: string;
    posted_month: string;
    reply_body: string | null;
    reply_month: string | null;
  }>(
    `select p.id, p.title, p.overall, p.work_life, p.pay, p.management, p.pros, p.cons, p.posted_month,
       r.body as reply_body, r.posted_month as reply_month
     from posts p
     left join replies r on r.review_id = p.id
     where p.company_id = $1 and p.kind = 'review' and p.state = 'approved'
     order by p.created_at desc`,
    [companyId],
  );
  const companyNameRow = await app.db.one<{ name: string }>('select name from companies where id = $1', [companyId]);
  const companyName = companyNameRow?.name ?? '';
  return rows.map((row) => {
    const pros = truncate(row.pros, unlocked);
    const cons = truncate(row.cons, unlocked);
    return {
      id: row.id,
      title: row.title,
      overall: row.overall,
      work_life: row.work_life,
      pay: row.pay,
      management: row.management,
      pros: pros.text + (pros.truncated ? '…' : ''),
      cons: cons.text + (cons.truncated ? '…' : ''),
      truncated: pros.truncated || cons.truncated,
      posted_month: row.posted_month,
      author_label: AUTHOR_LABEL,
      reply:
        row.reply_body !== null
          ? { company_name: companyName, body: row.reply_body, posted_month: row.reply_month ?? '' }
          : null,
    };
  });
}

export async function companyPayRows(
  app: App,
  companyId: string,
  viewer: Viewer | null,
): Promise<PayRowView[]> {
  const unlocked = unlockedFor(viewer);
  const rows = await app.db.many<PayValueRow>(
    `select role_family, city, annual_pay
     from posts
     where company_id = $1 and kind = 'pay_report' and state = 'approved'`,
    [companyId],
  );
  const grouped = new Map<string, number[]>();
  for (const row of rows) {
    const key = `${row.role_family}:${row.city}`;
    const list = grouped.get(key) ?? [];
    list.push(row.annual_pay);
    grouped.set(key, list);
  }
  const result: PayRowView[] = [];
  for (const family of ROLE_FAMILIES) {
    for (const city of CITIES) {
      const key = `${family.id}:${city.id}`;
      const values = grouped.get(key);
      if (!values) continue;
      const band = unlocked ? payBand(values) : null;
      result.push({
        role_family: family.id,
        role_name: family.name,
        city: city.id,
        city_name: city.name,
        report_count: values.length,
        threshold: threshold(),
        band,
      });
    }
  }
  return result;
}

export async function companyInterviewNotes(
  app: App,
  companyId: string,
  viewer: Viewer | null,
): Promise<InterviewNoteView[]> {
  const unlocked = unlockedFor(viewer);
  const rows = await app.db.many<{
    id: string;
    role_family: string;
    difficulty: number;
    outcome: string;
    text_field: string;
    posted_month: string;
  }>(
    `select id, role_family, difficulty, outcome, text_field, posted_month
     from posts
     where company_id = $1 and kind = 'interview_note' and state = 'approved'
     order by created_at desc`,
    [companyId],
  );
  return rows.map((row) => {
    const cut = truncate(row.text_field, unlocked);
    return {
      id: row.id,
      role_family: row.role_family,
      role_name: roleName(row.role_family),
      difficulty: row.difficulty,
      outcome: row.outcome,
      text: cut.text + (cut.truncated ? '…' : ''),
      truncated: cut.truncated,
      posted_month: row.posted_month,
      author_label: AUTHOR_LABEL,
    };
  });
}

export async function companyJobs(app: App, companyId: string): Promise<JobSummary[]> {
  const rows = await app.db.many<{
    id: string;
    title: string;
    company_name: string;
    company_slug: string;
    city: string;
    role_family: string;
    remote: string;
    pay_low: number;
    pay_high: number;
    listed_at: Date | null;
  }>(
    `select j.id, j.title, j.city, j.role_family, j.remote, j.pay_low, j.pay_high, j.listed_at,
       c.name as company_name, c.slug as company_slug
     from jobs j join companies c on c.id = j.company_id
     where j.company_id = $1 and j.status = 'listed'
     order by j.listed_at desc`,
    [companyId],
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    company_name: row.company_name,
    company_slug: row.company_slug,
    city: row.city,
    city_name: cityName(row.city),
    role_family: row.role_family,
    remote: row.remote,
    pay_low: row.pay_low,
    pay_high: row.pay_high,
    pay_band: payBandFor(row.pay_low),
    listed_at: row.listed_at ? Math.floor(row.listed_at.getTime() / 1000) : null,
  }));
}

// Company hit shape for search and lists; carries no pay figure.
export interface CompanyHit {
  slug: string;
  name: string;
  city: string;
  city_name: string;
  size: string;
  verified: boolean;
  rating: number | null;
  review_count: number;
  pay_report_count: number;
}

export async function companyHitBySlug(app: App, slug: string): Promise<CompanyHit | null> {
  const company = await app.db.one<{ id: string; slug: string; name: string; city: string; size: string; verified: boolean }>(
    'select id, slug, name, city, size, verified from companies where slug = $1',
    [slug],
  );
  if (!company) return null;
  const rating = await companyRating(app, company.id);
  const reports = await app.db.one<{ n: number }>(
    "select count(*)::int as n from posts where company_id = $1 and kind = 'pay_report' and state = 'approved'",
    [company.id],
  );
  return {
    slug: company.slug,
    name: company.name,
    city: company.city,
    city_name: cityName(company.city),
    size: company.size,
    verified: company.verified,
    rating: rating.overall,
    review_count: rating.count,
    pay_report_count: reports?.n ?? 0,
  };
}
