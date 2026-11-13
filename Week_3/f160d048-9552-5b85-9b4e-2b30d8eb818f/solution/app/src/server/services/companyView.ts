import type { Company } from "../../shared/api";
import { CITIES, nameOf, type CityId } from "../../shared/reference";
import { figuresFor, payRowsFor, type Queryable } from "../domain/derived";
import { publicNote, publicReview, type NoteRow, type ReviewRow } from "../domain/anonymity";
import { JOB_SQL, toJobSummary, type JobRow } from "./jobView";

export type CompanyRecord = {
  id: string; slug: string; name: string; city: CityId; size: string; verified: boolean; mark_file_id: string | null;
};

export async function companyBySlug(db: Queryable, slug: string): Promise<CompanyRecord | undefined> {
  const found = await db.query<CompanyRecord>(
    "SELECT id, slug, name, city, size, verified, mark_file_id FROM companies WHERE slug = $1",
    [slug],
  );
  return found.rows[0];
}

/** The company page as one viewer may see it. */
export async function companyView(db: Queryable, company: CompanyRecord, unlocked: boolean): Promise<Company> {
  const figures = (await figuresFor(db, [company.id])).get(company.id);
  const reviews = await db.query<ReviewRow>(
    `SELECT p.id, p.title, p.overall, p.work_life, p.pay, p.management, p.pros, p.cons, p.created_at,
            r.body AS reply_body, r.created_at AS reply_at, c.name AS company_name
       FROM posts p
       JOIN companies c ON c.id = p.company_id
       LEFT JOIN replies r ON r.review_id = p.id
      WHERE p.company_id = $1 AND p.kind = 'review' AND p.state = 'approved' AND p.deleted_at IS NULL
      ORDER BY p.created_at DESC, p.id`,
    [company.id],
  );
  const notes = await db.query<NoteRow>(
    `SELECT id, role_family, difficulty, outcome, text, created_at FROM posts
      WHERE company_id = $1 AND kind = 'interview_note' AND state = 'approved' AND deleted_at IS NULL
      ORDER BY created_at DESC, id`,
    [company.id],
  );
  const jobs = await db.query<JobRow>(
    `${JOB_SQL} WHERE j.company_id = $1 AND j.status = 'listed' ORDER BY j.listed_at DESC, j.id`,
    [company.id],
  );
  return {
    slug: company.slug,
    name: company.name,
    city: company.city,
    city_name: nameOf(CITIES, company.city),
    size: company.size,
    verified: company.verified,
    mark_url: company.mark_file_id ? `/api/files/${company.mark_file_id}` : null,
    viewer_unlocked: unlocked,
    rating: figures?.rating ?? { overall: null, work_life: null, pay: null, management: null, review_count: 0 },
    reviews: reviews.rows.map((row) => publicReview(row, unlocked)),
    pay_rows: payRowsFor(figures?.payReports ?? [], unlocked),
    interview_notes: notes.rows.map((row) => publicNote(row, unlocked)),
    jobs: jobs.rows.map(toJobSummary),
  };
}
