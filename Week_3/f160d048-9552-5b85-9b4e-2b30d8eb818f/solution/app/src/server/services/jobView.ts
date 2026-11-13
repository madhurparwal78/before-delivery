import type { JobDetail, JobSummary } from "../../shared/api";
import { CITIES, nameOf, payBandOf, type CityId, type JobStatus, type RoleFamilyId, type WorkPatternId } from "../../shared/reference";

export const JOB_SQL = `SELECT j.id, j.company_id, j.title, c.name AS company_name, c.slug AS company_slug, j.city, j.role_family, j.remote,
  j.pay_low, j.pay_high, j.listed_at, j.description, j.status
  FROM jobs j JOIN companies c ON c.id = j.company_id`;

export type JobRow = {
  id: string; company_id: string; title: string; company_name: string; company_slug: string; city: CityId; role_family: RoleFamilyId;
  remote: WorkPatternId; pay_low: number; pay_high: number; listed_at: Date | null; description: string; status: JobStatus;
};

export function toJobSummary(row: JobRow): JobSummary {
  return {
    id: row.id,
    title: row.title,
    company_name: row.company_name,
    company_slug: row.company_slug,
    city: row.city,
    city_name: nameOf(CITIES, row.city),
    role_family: row.role_family,
    remote: row.remote,
    pay_low: row.pay_low,
    pay_high: row.pay_high,
    pay_band: payBandOf(row.pay_low),
    listed_at: row.listed_at ? row.listed_at.toISOString() : null,
  };
}

export function toJobDetail(row: JobRow): JobDetail {
  return { ...toJobSummary(row), description: row.description, status: row.status };
}
