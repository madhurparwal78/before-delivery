import { first, pool, rows, type Row } from "../db/pool";
import { figuresFor } from "../domain/derived";
import { CITIES, ROLE_FAMILIES, nameOf, payBandOf, type CityId, type RoleFamilyId } from "../../shared/reference";
import type { Document, IndexName } from "./search";

type JobRow = Row & {
  id: string; title: string; company_id: string; company_name: string; company_slug: string; city: CityId;
  role_family: RoleFamilyId; remote: string; pay_low: number; pay_high: number; listed_at: Date;
};

const JOB_COLUMNS = `j.id, j.title, j.company_id, c.name AS company_name, c.slug AS company_slug, j.city, j.role_family,
  j.remote, j.pay_low, j.pay_high, j.listed_at`;

function jobDocument(job: JobRow): Document {
  return {
    id: job.id,
    title: job.title,
    company_id: job.company_id,
    company_name: job.company_name,
    company_slug: job.company_slug,
    city: job.city,
    city_name: nameOf(CITIES, job.city),
    role_family: job.role_family,
    role_family_name: nameOf(ROLE_FAMILIES, job.role_family),
    remote: job.remote,
    pay_band: payBandOf(job.pay_low),
    pay_low: job.pay_low,
    pay_high: job.pay_high,
    listed_at: Math.floor(job.listed_at.getTime() / 1000),
  };
}

async function listedJobDocuments(ids?: string[]): Promise<Document[]> {
  const jobs = await rows<JobRow>(
    `SELECT ${JOB_COLUMNS} FROM jobs j JOIN companies c ON c.id = j.company_id
      WHERE j.status = 'listed' AND ($1::text[] IS NULL OR j.id = ANY($1))`,
    [ids ?? null],
  );
  return jobs.map(jobDocument);
}

type CompanyRow = Row & {
  id: string; slug: string; name: string; city: CityId; size: string; verified: boolean;
};

export async function companyDocuments(ids?: string[]): Promise<Document[]> {
  const companies = await rows<CompanyRow>(
    `SELECT id, slug, name, city, size, verified FROM companies WHERE ($1::text[] IS NULL OR id = ANY($1))`,
    [ids ?? null],
  );
  const figures = await figuresFor(pool, companies.map((company) => company.id));
  return companies.map((company) => {
    const entry = figures.get(company.id);
    return {
      id: company.id,
      slug: company.slug,
      name: company.name,
      city: company.city,
      city_name: nameOf(CITIES, company.city),
      size: company.size,
      verified: company.verified,
      rating: entry?.rating.overall ?? null,
      review_count: entry?.rating.review_count ?? 0,
      pay_report_count: entry?.payReports.reduce((total, report) => total + report.amounts.length, 0) ?? 0,
    };
  });
}

export async function documentsFor(index: IndexName, ids?: string[]): Promise<Document[]> {
  return index === "jobs" ? listedJobDocuments(ids) : companyDocuments(ids);
}

/** The search document a draft job will have once it is listed at `listedAt`. */
export async function listedJobDocument(id: string, listedAt: Date): Promise<Document | undefined> {
  const job = await first<JobRow>(
    `SELECT ${JOB_COLUMNS} FROM jobs j JOIN companies c ON c.id = j.company_id WHERE j.id = $1`,
    [id],
  );
  return job ? jobDocument({ ...job, listed_at: listedAt }) : undefined;
}

