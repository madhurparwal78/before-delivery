/**
 * Brand and company scoping. Anything outside a caller's scope, at any nesting
 * depth, answers the same 404 as an unknown id.
 */

import {
  isStudioRole,
  regionZone,
  type Currency,
  type Region,
  type TimeZoneName,
} from '../../shared/domain.js';
import { firstRow, rows, type Queryable } from '../db/pool.js';
import { forbidden, notFound } from '../http/errors.js';
import type { Member } from '../http/session.js';

export interface ProjectRecord {
  id: string;
  reference: string;
  name: string;
  brandId: string;
  brandName: string;
  region: Region;
  currency: Currency;
  timeZone: TimeZoneName;
  defectsPeriodMonths: number;
  practicalCompletionOn: string | null;
  defectsEndOn: string | null;
}

export interface StoreRecord {
  code: string;
  name: string;
  weight: number;
}

interface ProjectRow {
  id: string;
  reference: string;
  name: string;
  brand_id: string;
  brand_name: string;
  region: Region;
  currency: Currency;
  defects_period_months: number;
  practical_completion_on: string | null;
  defects_end_on: string | null;
}

const PROJECT_SELECT = `
  SELECT p.id, p.reference, p.name, p.brand_id, b.name AS brand_name, p.region, p.currency,
         p.defects_period_months, p.practical_completion_on, p.defects_end_on
    FROM projects p JOIN brands b ON b.id = p.brand_id`;

function toProject(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    reference: row.reference,
    name: row.name,
    brandId: row.brand_id,
    brandName: row.brand_name,
    region: row.region,
    currency: row.currency,
    timeZone: regionZone(row.region),
    defectsPeriodMonths: row.defects_period_months,
    practicalCompletionOn: row.practical_completion_on,
    defectsEndOn: row.defects_end_on,
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) throw notFound();
  return value;
}

export async function contractorHoldsContract(
  client: Queryable,
  projectId: string,
  member: Member,
): Promise<boolean> {
  if (member.role !== 'contractor' || !member.companyId) return false;
  const row = await firstRow(
    client,
    'SELECT 1 FROM contracts WHERE project_id = $1 AND company_id = $2',
    [projectId, member.companyId],
  );
  return row !== null;
}

async function contractorIsBidder(
  client: Queryable,
  projectId: string,
  member: Member,
): Promise<boolean> {
  if (!member.companyId) return false;
  const row = await firstRow(
    client,
    `SELECT 1 FROM tender_bidders tb
       JOIN tenders t ON t.id = tb.tender_id
      WHERE t.project_id = $1 AND tb.company_id = $2 AND t.status <> 'draft'`,
    [projectId, member.companyId],
  );
  return row !== null;
}

/** The project the caller may see, or the same 404 as an unknown id. */
export async function requireProject(
  client: Queryable,
  projectId: string,
  member: Member,
): Promise<ProjectRecord> {
  requireUuid(projectId);
  const row = await firstRow<ProjectRow>(client, `${PROJECT_SELECT} WHERE p.id = $1`, [projectId]);
  if (!row) throw notFound();
  const project = toProject(row);
  if (isStudioRole(member.role)) return project;
  if (member.role === 'client_approver') {
    if (member.brandId !== project.brandId) throw notFound();
    return project;
  }
  if (
    (await contractorHoldsContract(client, project.id, member)) ||
    (await contractorIsBidder(client, project.id, member))
  ) {
    return project;
  }
  throw notFound();
}

export async function visibleProjects(
  client: Queryable,
  member: Member,
): Promise<ProjectRecord[]> {
  if (isStudioRole(member.role)) {
    const found = await rows<ProjectRow>(client, `${PROJECT_SELECT} ORDER BY p.reference`);
    return found.map(toProject);
  }
  if (member.role === 'client_approver') {
    const found = await rows<ProjectRow>(
      client,
      `${PROJECT_SELECT} WHERE p.brand_id = $1 ORDER BY p.reference`,
      [member.brandId],
    );
    return found.map(toProject);
  }
  const found = await rows<ProjectRow>(
    client,
    `${PROJECT_SELECT}
      WHERE EXISTS (SELECT 1 FROM contracts c WHERE c.project_id = p.id AND c.company_id = $1)
         OR EXISTS (SELECT 1 FROM tender_bidders tb JOIN tenders t ON t.id = tb.tender_id
                     WHERE t.project_id = p.id AND tb.company_id = $1 AND t.status <> 'draft')
      ORDER BY p.reference`,
    [member.companyId],
  );
  return found.map(toProject);
}

export async function projectStores(
  client: Queryable,
  projectId: string,
): Promise<StoreRecord[]> {
  return rows<StoreRecord>(
    client,
    'SELECT code, name, weight FROM project_stores WHERE project_id = $1 ORDER BY ord',
    [projectId],
  );
}

export interface ContractRecord {
  id: string;
  companyId: string;
  companyName: string;
  contractSumCents: number;
}

export async function projectContract(
  client: Queryable,
  projectId: string,
): Promise<ContractRecord | null> {
  const row = await firstRow<{
    id: string;
    company_id: string;
    company_name: string;
    contract_sum_cents: number;
  }>(
    client,
    `SELECT c.id, c.company_id, co.name AS company_name, c.contract_sum_cents
       FROM contracts c JOIN companies co ON co.id = c.company_id
      WHERE c.project_id = $1`,
    [projectId],
  );
  return row
    ? {
        id: row.id,
        companyId: row.company_id,
        companyName: row.company_name,
        contractSumCents: row.contract_sum_cents,
      }
    : null;
}

/** Contractors never see stage fees or finishes on projects they can see. */
export function refuseContractor(member: Member): void {
  if (member.role === 'contractor') throw forbidden();
}
