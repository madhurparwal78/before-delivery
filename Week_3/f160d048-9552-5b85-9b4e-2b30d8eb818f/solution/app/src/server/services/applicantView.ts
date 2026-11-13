import type { Applicant } from "../../shared/api";
import type { StageId } from "../../shared/reference";

export const APPLICANT_SQL = `SELECT a.id, a.job_id, a.user_id, a.candidate_name, a.contact_email, a.phone, a.cover_note, a.stage,
  a.applied_at, a.updated_at, a.resume_file_id, j.title AS job_title, j.company_id, c.name AS company_name
  FROM applications a JOIN jobs j ON j.id = a.job_id JOIN companies c ON c.id = j.company_id`;

export type ApplicantRow = {
  id: string; job_id: string; user_id: string; candidate_name: string; contact_email: string; phone: string; cover_note: string;
  stage: StageId; applied_at: Date; updated_at: Date; resume_file_id: string; job_title: string; company_id: string; company_name: string;
};

const day = (moment: Date): string => moment.toISOString().slice(0, 10);

/** Only what the candidate typed into the apply form, plus the stage and dates: no account field. */
export function toApplicant(row: ApplicantRow): Applicant {
  return {
    id: row.id,
    job_id: row.job_id,
    candidate_name: row.candidate_name,
    contact_email: row.contact_email,
    phone: row.phone,
    cover_note: row.cover_note,
    stage: row.stage,
    applied_on: day(row.applied_at),
    updated_on: day(row.updated_at),
    resume_file_id: row.resume_file_id,
  };
}

