import { maybeRow, type Db } from '../db.js';

export async function isCompanyAdmin(db: Db, memberId: string, companyId: string): Promise<boolean> {
  return (await maybeRow(db, 'SELECT 1 FROM company_admins WHERE company_id = $1 AND member_id = $2', [companyId, memberId])) !== undefined;
}

/** True when the member is an admin of the job's company. */
export async function isJobAdmin(db: Db, memberId: string, jobId: string): Promise<boolean> {
  return (
    (await maybeRow(db, 'SELECT 1 FROM jobs j JOIN company_admins a ON a.company_id = j.company_id WHERE j.id = $1 AND a.member_id = $2', [jobId, memberId])) !== undefined
  );
}
