import {
  cityName,
  payBandFor,
  roleFamilyName,
  ROLE_FAMILIES,
  CITIES,
  type CityId,
  type Outcome,
  type PayBandId,
  type RoleFamilyId,
  type WorkPatternId,
} from '../../shared/reference';
import { config } from '../config';
import { db, type Db } from '../db/pool';
import type { SessionUser } from '../http/context';
import { AUTHOR_LABEL, cutForLockedViewer, postedMonth } from './anonymity';
import { bandFromReports, meanToOneDecimal, type Band } from './derived';

export interface ReviewProjection {
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

export interface PayRowProjection {
  role_family: RoleFamilyId;
  role_name: string;
  city: CityId;
  city_name: string;
  report_count: number;
  threshold: number;
  band: Band | null;
}

export interface InterviewNoteProjection {
  id: string;
  role_family: RoleFamilyId;
  role_name: string;
  difficulty: number;
  outcome: Outcome;
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
  city: CityId;
  city_name: string;
  role_family: RoleFamilyId;
  remote: WorkPatternId;
  pay_low: number;
  pay_high: number;
  pay_band: PayBandId;
  listed_at: string | null;
}

export interface CompanyProjection {
  slug: string;
  name: string;
  city: CityId;
  city_name: string;
  size: string;
  verified: boolean;
  mark_url: string | null;
  viewer_unlocked: boolean;
  rating: {
    overall: number | null;
    work_life: number | null;
    pay: number | null;
    management: number | null;
    review_count: number;
  };
  reviews: ReviewProjection[];
  pay_rows: PayRowProjection[];
  interview_notes: InterviewNoteProjection[];
  jobs: JobSummary[];
}

export interface CompanyHit {
  slug: string;
  name: string;
  city: CityId;
  city_name: string;
  size: string;
  verified: boolean;
  rating: number | null;
  review_count: number;
  pay_report_count: number;
}

export interface CompanyRow {
  id: string;
  slug: string;
  name: string;
  city: CityId;
  size: string;
  verified: boolean;
  email_domain: string;
  mark_file_id: string | null;
}

/** Only an unlocked member, an employer user, a moderator or the founder sees full detail. */
export function viewerUnlocked(viewer: SessionUser | null): boolean {
  if (!viewer) return false;
  return viewer.role !== 'member' || viewer.unlocked;
}

export async function findCompanyBySlug(slug: string, runner: Db = db): Promise<CompanyRow | null> {
  return runner.one<CompanyRow>(
    'SELECT id, slug, name, city, size, verified, email_domain, mark_file_id FROM companies WHERE slug = $1',
    [slug],
  );
}

export async function findCompanyById(id: string, runner: Db = db): Promise<CompanyRow | null> {
  return runner.one<CompanyRow>(
    'SELECT id, slug, name, city, size, verified, email_domain, mark_file_id FROM companies WHERE id = $1',
    [id],
  );
}

interface ApprovedReviewRow {
  id: string;
  title: string;
  overall: number;
  work_life: number;
  pay: number;
  management: number;
  pros: string;
  cons: string;
  created_at: Date;
  reply_body: string | null;
  reply_created_at: Date | null;
}

interface ApprovedPayRow {
  role_family: RoleFamilyId;
  city: CityId;
  annual_pay: number;
}

interface ApprovedNoteRow {
  id: string;
  role_family: RoleFamilyId;
  difficulty: number;
  outcome: Outcome;
  body_text: string;
  created_at: Date;
}

export async function approvedReviews(companyId: string, runner: Db = db): Promise<ApprovedReviewRow[]> {
  return runner.query<ApprovedReviewRow>(
    `SELECT p.id, p.title, p.overall, p.work_life, p.pay, p.management, p.pros, p.cons, p.created_at,
            r.body AS reply_body, r.created_at AS reply_created_at
       FROM posts p
       LEFT JOIN review_replies r ON r.review_id = p.id
      WHERE p.company_id = $1 AND p.kind = 'review' AND p.state = 'approved' AND p.deleted_at IS NULL
      ORDER BY p.created_at DESC, p.id`,
    [companyId],
  );
}

export async function approvedPayReports(companyId: string, runner: Db = db): Promise<ApprovedPayRow[]> {
  return runner.query<ApprovedPayRow>(
    `SELECT role_family, city, annual_pay
       FROM posts
      WHERE company_id = $1 AND kind = 'pay_report' AND state = 'approved' AND deleted_at IS NULL`,
    [companyId],
  );
}

export function buildRating(reviews: ReadonlyArray<ApprovedReviewRow>): CompanyProjection['rating'] {
  return {
    overall: meanToOneDecimal(reviews.map((review) => review.overall)),
    work_life: meanToOneDecimal(reviews.map((review) => review.work_life)),
    pay: meanToOneDecimal(reviews.map((review) => review.pay)),
    management: meanToOneDecimal(reviews.map((review) => review.management)),
    review_count: reviews.length,
  };
}

function buildPayRows(reports: ReadonlyArray<ApprovedPayRow>, unlocked: boolean): PayRowProjection[] {
  const grouped = new Map<string, number[]>();
  for (const report of reports) {
    const key = `${report.role_family}:${report.city}`;
    const list = grouped.get(key);
    if (list) list.push(report.annual_pay);
    else grouped.set(key, [report.annual_pay]);
  }
  const rows: PayRowProjection[] = [];
  for (const role of ROLE_FAMILIES) {
    for (const city of CITIES) {
      const amounts = grouped.get(`${role.id}:${city.id}`);
      if (!amounts) continue;
      const atThreshold = amounts.length >= config.minPayReports;
      rows.push({
        role_family: role.id,
        role_name: role.name,
        city: city.id,
        city_name: city.name,
        report_count: amounts.length,
        threshold: config.minPayReports,
        band: atThreshold && unlocked ? bandFromReports(amounts) : null,
      });
    }
  }
  return rows;
}

export function projectReview(row: ApprovedReviewRow, companyName: string, unlocked: boolean): ReviewProjection {
  const pros = cutForLockedViewer(row.pros, unlocked);
  const cons = cutForLockedViewer(row.cons, unlocked);
  return {
    id: row.id,
    title: row.title,
    overall: row.overall,
    work_life: row.work_life,
    pay: row.pay,
    management: row.management,
    pros: pros.text,
    cons: cons.text,
    truncated: pros.truncated || cons.truncated,
    posted_month: postedMonth(row.created_at),
    author_label: AUTHOR_LABEL,
    reply:
      row.reply_body && row.reply_created_at
        ? { company_name: companyName, body: row.reply_body, posted_month: postedMonth(row.reply_created_at) }
        : null,
  };
}

async function listedJobSummaries(companyId: string, runner: Db = db): Promise<JobSummary[]> {
  const rows = await runner.query<{
    id: string;
    title: string;
    company_name: string;
    company_slug: string;
    city: CityId;
    role_family: RoleFamilyId;
    remote: WorkPatternId;
    pay_low: number;
    pay_high: number;
    listed_at: Date | null;
  }>(
    `SELECT j.id, j.title, c.name AS company_name, c.slug AS company_slug, j.city, j.role_family, j.remote,
            j.pay_low, j.pay_high, j.listed_at
       FROM jobs j JOIN companies c ON c.id = j.company_id
      WHERE j.company_id = $1 AND j.status = 'listed'
      ORDER BY j.listed_at DESC NULLS LAST, j.id`,
    [companyId],
  );
  return rows.map(toJobSummary);
}

export function toJobSummary(row: {
  id: string;
  title: string;
  company_name: string;
  company_slug: string;
  city: CityId;
  role_family: RoleFamilyId;
  remote: WorkPatternId;
  pay_low: number;
  pay_high: number;
  listed_at: Date | null;
}): JobSummary {
  return {
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
    listed_at: row.listed_at ? row.listed_at.toISOString() : null,
  };
}

export async function projectCompany(
  company: CompanyRow,
  viewer: SessionUser | null,
  runner: Db = db,
): Promise<CompanyProjection> {
  const unlocked = viewerUnlocked(viewer);
  const reviews = await approvedReviews(company.id, runner);
  const reports = await approvedPayReports(company.id, runner);
  const notes = await runner.query<ApprovedNoteRow>(
    `SELECT id, role_family, difficulty, outcome, body_text, created_at
       FROM posts
      WHERE company_id = $1 AND kind = 'interview_note' AND state = 'approved' AND deleted_at IS NULL
      ORDER BY created_at DESC, id`,
    [company.id],
  );

  return {
    slug: company.slug,
    name: company.name,
    city: company.city,
    city_name: cityName(company.city),
    size: company.size,
    verified: company.verified,
    mark_url: company.mark_file_id ? `/api/files/${company.mark_file_id}` : null,
    viewer_unlocked: unlocked,
    rating: buildRating(reviews),
    reviews: reviews.map((review) => projectReview(review, company.name, unlocked)),
    pay_rows: buildPayRows(reports, unlocked),
    interview_notes: notes.map((note) => {
      const text = cutForLockedViewer(note.body_text, unlocked);
      return {
        id: note.id,
        role_family: note.role_family,
        role_name: roleFamilyName(note.role_family),
        difficulty: note.difficulty,
        outcome: note.outcome,
        text: text.text,
        truncated: text.truncated,
        posted_month: postedMonth(note.created_at),
        author_label: AUTHOR_LABEL,
      };
    }),
    jobs: await listedJobSummaries(company.id, runner),
  };
}

export async function companyHit(company: CompanyRow, runner: Db = db): Promise<CompanyHit> {
  const reviews = await approvedReviews(company.id, runner);
  const reports = await approvedPayReports(company.id, runner);
  const rating = buildRating(reviews);
  return {
    slug: company.slug,
    name: company.name,
    city: company.city,
    city_name: cityName(company.city),
    size: company.size,
    verified: company.verified,
    rating: rating.overall,
    review_count: rating.review_count,
    pay_report_count: reports.length,
  };
}
